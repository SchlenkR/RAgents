import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { Type } from "typebox";

import { convertToLlm, ModelRuntime } from "@ragents/agent";
import { fauxAssistantMessage, fauxText, fauxThinking, fauxToolCall, registerFauxProvider, type Context, type InputModality } from "@ragents/ai";

import { modelContextOf, turnModelContext } from "../src/agents/model-context.ts";
import { defineRunFunction, type RunFunction } from "../src/agents/tools.ts";
import { claimTurn } from "../src/agents/turn.ts";
import type { JsonValue } from "../src/domain/json.ts";
import { agentHookOf, type AgentHook } from "../src/drivers/agent-hooks.ts";
import { createTurnAbortLatch, AgentRuntimeManager } from "../src/drivers/agent-runtime.ts";
import { AgentLoopDriver } from "../src/drivers/agent.ts";
import type { LiveEvent, TurnRequest, TurnResult } from "../src/drivers/types.ts";
import type { AgentContribution } from "../src/plugin-types.ts";
import { Journal } from "../src/runtime/journal.ts";
import { Orchestration } from "../src/runtime/orchestration.ts";
import { deferred, executionFor, testServices } from "./support.ts";

const within = async <T>(operation: Promise<T>, timeoutMs = 3_000): Promise<T> => {
    let timer: ReturnType<typeof setTimeout> | undefined;

    try {
        return await Promise.race([
            operation,
            new Promise<T>((_, rejectPromise) => {
                timer = setTimeout(() => rejectPromise(new Error(`Operation exceeded ${timeoutMs} ms.`)), timeoutMs);
            }),
        ]);
    } finally {
        if (timer)
            clearTimeout(timer);
    }
};

const fauxModelRuntime = (id: string, input?: InputModality[], tokensPerSecond = 100_000) => {
    const faux = registerFauxProvider({ models: [{ id, reasoning: false, ...(input ? { input } : {}) }], tokensPerSecond });
    const modelRuntime = ModelRuntime.create();
    const model = faux.getModel();
    modelRuntime.registerProvider(model.provider, {
        baseUrl: model.baseUrl,
        apiKey: "faux-key",
        api: faux.api,
        models: faux.models.map((entry) => ({
            id: entry.id, name: entry.name, api: entry.api, reasoning: entry.reasoning, input: entry.input,
            cost: entry.cost, contextWindow: entry.contextWindow, maxTokens: entry.maxTokens, baseUrl: entry.baseUrl,
        })),
    });

    return { faux, modelRuntime, selection: { provider: model.provider, model: model.id } };
};

type TurnOverrides = Partial<Omit<TurnRequest<"agent">, "invoke">> & {
    invoke?: (toolCallId: string, name: string, input: JsonValue) => Promise<JsonValue>;
};

/** A run with one agent in a journal; each turn is claimed, handed to the driver and ended like the scheduler does. */
const journalHarness = (selection: { provider: string; model: string }, directory = ":memory:") => {
    const services = testServices();
    const journal = new Journal(directory, services);
    const runtime = new Orchestration(journal, services);
    const run = runtime.createRun({ commandId: "create" }, { title: "Driver", ownerHandle: "owner", ownerDisplayName: "Owner" });
    const agentId = runtime.spawnAgent({ actorId: run.ownerId, commandId: "spawn" }, run.id, {
        handle: "agent", displayName: "Agent", prompt: "Work.",
        execution: executionFor("agent", { profile: "agent", isolateWorkspace: false }), grants: [], toolNames: null,
    }).actors.find((actor) => actor.kind === "agent")!.id;

    return harnessOver(selection, journal, runtime, run.id, agentId);
};

const harnessOver = (
    selection: { provider: string; model: string },
    journal: Journal,
    runtime: Orchestration,
    runId: string,
    agentId: string,
    prefix = "",
) => {
    const run = { id: runId, ownerId: runtime.view(runId).ownerId };
    let posts = 0;
    const published: LiveEvent[] = [];

    const request = (prompt: string, overrides: TurnOverrides = {}): TurnRequest<"agent"> => {
        const inputId = runtime.enqueueInput({ actorId: run.ownerId, commandId: `${prefix}post-${++posts}` }, run.id, { actorId: agentId, content: prompt })
            .inputs.at(-1)!.id;
        const turn = claimTurn(runtime, run.id, agentId, inputId, `${prefix}claim-${posts}`);
        let emitted = 0;
        const command = (kind: string) => ({ actorId: agentId, commandId: `${turn.turnId}:${kind}:${emitted++}`, turnId: turn.turnId });
        const invoke = overrides.invoke ?? (async () => null);

        return {
            driverKind: "agent",
            runId: run.id,
            agentId,
            turnId: turn.turnId,
            startedAt: turn.startedAt,
            input: turn.input,
            prompt,
            selection,
            systemPrompt: "System contract.",
            workspace: process.cwd(),
            storeAttachment: () => Promise.reject(new Error("The test stores no attachments.")),
            tools: [],
            allowedToolNames: null,
            claimSteering: () => [],
            emit: (event) => {
                if (event.kind === "assistant-interrupted")
                    runtime.appendInterruptedModelOutput(command("interrupted"), run.id, agentId, { turnId: turn.turnId, text: event.text });
            },
            recordTool: (event) => {
                if (event.kind === "started")
                    runtime.startToolCall(command("tool"), run.id, agentId, { turnId: turn.turnId, toolCallId: event.id, name: event.name, input: event.input });
                else if (event.kind === "failed")
                    runtime.failToolCall(command("tool"), run.id, agentId, { turnId: turn.turnId, toolCallId: event.id, name: event.name, error: event.error });
                else
                    runtime.completeToolCall(command("tool"), run.id, agentId, { turnId: turn.turnId, toolCallId: event.id, name: event.name, output: event.output });
            },
            publish: (event) => { published.push(event); },
            ...turnModelContext(runtime, turn, () => emitted++),
            ...overrides,
            invoke: async (toolCallId, name, input) => {
                runtime.startToolCall(command("tool"), run.id, agentId, { turnId: turn.turnId, toolCallId, name, input });
                try {
                    const output = await invoke(toolCallId, name, input);
                    runtime.completeToolCall(command("tool"), run.id, agentId, { turnId: turn.turnId, toolCallId, name, output });
                    return { output, ignoredFields: [] };
                } catch (error) {
                    runtime.failToolCall(command("tool"), run.id, agentId, { turnId: turn.turnId, toolCallId, name, error: error instanceof Error ? error.message : String(error) });
                    throw error;
                }
            },
        };
    };

    /** Ends the turn in the journal the way the scheduler does after the driver returned. */
    const finish = (request: TurnRequest<"agent">, result: TurnResult, aborted = false) => {
        const context = { actorId: agentId, commandId: `${request.turnId}:end`, turnId: request.turnId };
        const running = runtime.state(run.id).actors.get(agentId);

        if (running?.kind === "human" || running?.lifecycle.kind !== "running")
            return result;

        if (aborted)
            runtime.interruptTurn(context, run.id, agentId, { turnId: request.turnId, reason: "Test" });
        else
            runtime.finishTurn(context, run.id, agentId, result.failure
                ? { turnId: request.turnId, outcome: "failed", reason: result.failure }
                : { turnId: request.turnId, outcome: "completed" });

        return result;
    };

    const outputsOf = (turnId: string) => runtime.events(run.id).flatMap((event) => {
        if ((event.type === "model.output.completed" || event.type === "model.reasoning.completed" || event.type === "model.output.interrupted")
            && event.payload.turnId === turnId)
            return [`${event.type}: ${event.payload.text}`];
        return [];
    });

    return { journal, runtime, runId: run.id, agentId, request, finish, outputsOf, published };
};

const turnOf = async (
    harness: ReturnType<typeof journalHarness>,
    manager: AgentRuntimeManager,
    prompt: string,
    overrides: TurnOverrides = {},
    signal = new AbortController().signal,
) => {
    const request = harness.request(prompt, overrides);
    const result = await manager.runTurn(request, signal);

    return { request, result: harness.finish(request, result, signal.aborted) };
};

const nativeTool = (name: string, description = `Execute ${name}.`): RunFunction => defineRunFunction({
    name, label: name, description, nativeTool: true,
    schema: Type.Object({}, { additionalProperties: false }), resultSchema: Type.Null(),
    available: () => true, run: () => null,
}) as RunFunction;

const hooksOf = (...contributions: AgentContribution[]) => (context: { runId: string; agentId: string; workspace: string }): AgentHook[] =>
    contributions.map((contribution) => agentHookOf(contribution, { ...context, audience: "agent" }));

for (const selectionKind of ["open", "selected"] as const) {
    test(`native tools refresh before each model request with ${selectionKind} function selection`, async () => {
        const { faux, modelRuntime, selection } = fauxModelRuntime(`native-refresh-${selectionKind}`);
        const harness = journalHarness(selection);
        const manager = new AgentRuntimeManager({ modelRuntime });
        let revision = 0;
        const calls: string[] = [];
        const tools = ["native_first", "native_second"].map((name) => nativeTool(name));
        faux.setResponses([
            (context) => {
                assert.deepEqual(context.tools?.map((tool) => tool.name), ["native_first"]);
                assert.match(context.systemPrompt ?? "", /Revision 0/);
                return fauxAssistantMessage([fauxToolCall("native_first", {}, { id: "first" })]);
            },
            (context) => {
                assert.deepEqual(context.tools?.map((tool) => tool.name), ["native_second"]);
                assert.match(context.systemPrompt ?? "", /Revision 1/);
                return fauxAssistantMessage([fauxToolCall("native_second", {}, { id: "second" })]);
            },
            (context) => {
                assert.deepEqual(context.tools ?? [], []);
                assert.match(context.systemPrompt ?? "", /Revision 2/);
                return fauxAssistantMessage("Done.");
            },
        ]);
        try {
            const { result } = await turnOf(harness, manager, "Go.", {
                tools: [tools[0]!],
                allowedToolNames: selectionKind === "open" ? null : tools.map((tool) => tool.name),
                refreshTools: async () => ({ tools: tools.slice(revision, revision + 1), systemPrompt: `Revision ${revision}.` }),
                invoke: async (_id, name) => {
                    calls.push(name);
                    revision++;
                    return null;
                },
            });
            assert.equal(result.failure, null);
            assert.deepEqual(calls, ["native_first", "native_second"]);
            assert.equal(revision, 2);
        } finally {
            await manager.shutdown();
            faux.unregister();
        }
    });
}

test("selected functions retain both TypeScript infrastructure tools through refresh and subsequent turns", async () => {
    const { faux, modelRuntime, selection } = fauxModelRuntime("selected-typescript-refresh");
    const harness = journalHarness(selection);
    const manager = new AgentRuntimeManager({ modelRuntime });
    const names = ["typescript_api", "typescript_eval"];
    const calls: string[] = [];
    let refreshes = 0;
    const tools = () => names.map((name) => nativeTool(name, `${name}, revision ${refreshes}.`));
    faux.setResponses(Array.from({ length: 6 }, (_, index) => (context: Context) => {
        assert.deepEqual(context.tools?.map((tool) => tool.name).sort(), [...names].sort());
        assert.ok(context.tools?.every((tool) => tool.description.includes(`revision ${refreshes}.`)));
        return index % 3 === 2 ? fauxAssistantMessage("Done.")
            : fauxAssistantMessage([fauxToolCall(names[index % 3]!, {}, { id: `infrastructure-${index}` })]);
    }));
    try {
        for (const prompt of ["First.", "Second."]) {
            const { result } = await turnOf(harness, manager, prompt, {
                allowedToolNames: ["read"],
                tools: tools(),
                refreshTools: async () => {
                    refreshes++;
                    return { tools: tools(), systemPrompt: `Revision ${refreshes}.` };
                },
                invoke: async (_id, name) => {
                    calls.push(name);
                    return null;
                },
            });
            assert.equal(result.failure, null);
        }
        assert.deepEqual(calls, [...names, ...names]);
        assert.ok(refreshes >= 6);
    } finally {
        await manager.shutdown();
        faux.unregister();
    }
});

test("catalog and runtime agree on model reasoning including max and reject off and medium before requests", async () => {
    const { faux, modelRuntime, selection } = fauxModelRuntime("thinking-contract");
    const model = faux.getModel();
    modelRuntime.registerProvider(model.provider, {
        baseUrl: model.baseUrl, apiKey: "faux-key", api: faux.api,
        models: [{ ...model, reasoning: true, thinkingLevelMap: { off: null, minimal: null, medium: null, max: "max" } }],
    });
    let calls = 0;
    faux.setResponses([() => { calls += 1; return fauxAssistantMessage("Answer"); }]);
    const harness = journalHarness(selection);
    const manager = new AgentRuntimeManager({ modelRuntime });
    const driver = new AgentLoopDriver({ modelRuntime });
    try {
        const entry = (await driver.catalog()).find((entry) => entry.provider === model.provider && entry.model === model.id);
        assert.deepEqual(entry?.thinking, ["low", "high", "max"]);
        assert.deepEqual(await driver.thinkingCapabilities(model.provider, model.id), entry?.thinking);
        const rejected = await turnOf(harness, manager, "Off.", { selection: { ...selection, thinking: "off" } });
        assert.match(rejected.result.failure ?? "", /thinking level off.*valid: low, high, max/);
        assert.equal(calls, 0);
        const medium = await turnOf(harness, manager, "Medium.", { selection: { ...selection, thinking: "medium" } });
        assert.match(medium.result.failure ?? "", /thinking level medium.*valid: low, high, max/);
        assert.equal(calls, 0);
        const valid = await turnOf(harness, manager, "Maximal.", { selection: { ...selection, thinking: "max" } });
        assert.equal(valid.result.failure, null);
        assert.equal(calls, 1);
    } finally {
        await manager.shutdown();
        await driver.shutdown();
        faux.unregister();
    }
});

test("The agent runtime nudges a reasoning-only answer once and fails the turn after a second one", async () => {
    const { faux, modelRuntime, selection } = fauxModelRuntime("empty-response");
    const harness = journalHarness(selection);
    const manager = new AgentRuntimeManager({ modelRuntime });
    const reasoningOnly = () => fauxAssistantMessage([fauxThinking("Still thinking.")]);
    faux.setResponses([reasoningOnly, () => fauxAssistantMessage("Done."), reasoningOnly, reasoningOnly, () => fauxAssistantMessage("Unreachable.")]);
    try {
        const recovered = await turnOf(harness, manager, "Go.");
        assert.equal(recovered.result.failure, null);
        assert.deepEqual(harness.outputsOf(recovered.request.turnId), [
            "model.reasoning.completed: Still thinking.",
            "model.output.completed: Done.",
        ]);
        const failed = await turnOf(harness, manager, "Once more.");
        assert.equal(failed.result.failure, "The model returned an empty response twice.");
        assert.deepEqual(harness.outputsOf(failed.request.turnId), [
            "model.reasoning.completed: Still thinking.",
            "model.reasoning.completed: Still thinking.",
        ]);
    } finally {
        await manager.shutdown();
        faux.unregister();
    }
});

test("A turn whose provider error the runtime retries successfully does not fail", async () => {
    const { faux, modelRuntime, selection } = fauxModelRuntime("provider-retry");
    const harness = journalHarness(selection);
    const manager = new AgentRuntimeManager({ modelRuntime, settings: { retry: { baseDelayMs: 10 } } });
    faux.setResponses([
        () => fauxAssistantMessage([], { stopReason: "error", errorMessage: "503 Service Unavailable" }),
        () => fauxAssistantMessage("Done."),
    ]);
    try {
        const { request, result } = await within(turnOf(harness, manager, "Go."), 10_000);
        assert.equal(result.failure, null);
        assert.equal(faux.state.callCount, 2);
        assert.deepEqual(harness.outputsOf(request.turnId), ["model.output.completed: Done."]);
        const steps = harness.runtime.events(harness.runId).filter((event) => event.type === "model.step.completed");
        assert.deepEqual(steps.map((event) => event.type === "model.step.completed" && event.payload.stopReason), ["error", "stop"]);
    } finally {
        await manager.shutdown();
        faux.unregister();
    }
});

test("A turn whose context overflow the runtime compacts and continues does not fail", async () => {
    const { faux, modelRuntime, selection } = fauxModelRuntime("overflow-compaction");
    const harness = journalHarness(selection);
    const manager = new AgentRuntimeManager({ modelRuntime });
    const answers = [
        () => fauxAssistantMessage("Answer 1."),
        () => fauxAssistantMessage([], { stopReason: "error", errorMessage: "prompt is too long: 213462 tokens > 200000 maximum" }),
        () => fauxAssistantMessage("Done."),
    ];
    let summaries = 0;
    faux.setResponses(Array.from({ length: 5 }, () => (context: Context) => {
        if (context.systemPrompt?.startsWith("You are a context summarization assistant")) {
            summaries += 1;
            return fauxAssistantMessage("## Goal\nSummary.");
        }
        const answer = answers.shift();
        assert.ok(answer, "unexpected model request");
        return answer();
    }));
    try {
        assert.equal((await turnOf(harness, manager, "First.")).result.failure, null);
        const { request, result } = await within(turnOf(harness, manager, "x".repeat(100_000)), 10_000);
        assert.equal(result.failure, null);
        assert.equal(summaries, 1);
        assert.equal(answers.length, 0);
        assert.deepEqual(harness.outputsOf(request.turnId), ["model.output.completed: Done."]);
        const compaction = harness.runtime.events(harness.runId).find((event) => event.type === "context.compacted");
        assert.ok(compaction?.type === "context.compacted");
        assert.equal(compaction.payload.turnId, request.turnId);
        assert.equal(compaction.payload.model, selection.model);
        assert.deepEqual(compaction.payload.threshold, { tokens: faux.getModel().contextWindow - 16_384, source: "catalog" });
    } finally {
        await manager.shutdown();
        faux.unregister();
    }
});

test("After a model switch the agent compacts with the values of the new model before its first step", async () => {
    const faux = registerFauxProvider({ models: [{ id: "switch-wide", reasoning: false }, { id: "switch-narrow", reasoning: false }], tokensPerSecond: 100_000 });
    const modelRuntime = ModelRuntime.create();
    const base = faux.getModel();
    const narrow = { threshold: 3_000, keepRecentTokens: 200, summaryTokens: 800 };
    modelRuntime.registerProvider(base.provider, {
        baseUrl: base.baseUrl,
        apiKey: "faux-key",
        api: faux.api,
        models: faux.models.map((entry) => ({
            id: entry.id, name: entry.name, api: entry.api, reasoning: entry.reasoning, input: entry.input,
            cost: entry.cost, contextWindow: entry.contextWindow, maxTokens: entry.maxTokens, baseUrl: entry.baseUrl,
            ...(entry.id === "switch-narrow" ? { compaction: narrow } : {}),
        })),
    });
    const harness = journalHarness({ provider: base.provider, model: "switch-wide" });
    const manager = new AgentRuntimeManager({ modelRuntime });
    const requests: string[] = [];
    faux.setResponses(Array.from({ length: 3 }, () => (context: Context, _options: unknown, _state: unknown, model: { id: string }) => {
        const summary = context.systemPrompt?.startsWith("You are a context summarization assistant") ?? false;
        requests.push(`${model.id}${summary ? ":summary" : ""}`);
        return fauxAssistantMessage(summary ? "## Goal\nSummary." : "Answer. ".repeat(200));
    }));
    try {
        assert.equal((await turnOf(harness, manager, "x".repeat(20_000))).result.failure, null);
        assert.equal(harness.runtime.events(harness.runId).some((event) => event.type === "context.compacted"), false);
        const { request, result } = await turnOf(harness, manager, "Continue.", { selection: { provider: base.provider, model: "switch-narrow" } });
        assert.equal(result.failure, null);
        assert.deepEqual(requests, ["switch-wide", "switch-narrow:summary", "switch-narrow"]);
        const compaction = harness.runtime.events(harness.runId).find((event) => event.type === "context.compacted");
        assert.ok(compaction?.type === "context.compacted");
        assert.equal(compaction.payload.turnId, request.turnId);
        assert.equal(compaction.payload.model, "switch-narrow");
        assert.deepEqual(compaction.payload.threshold, { tokens: 3_000, source: "model" });
    } finally {
        await manager.shutdown();
        faux.unregister();
    }
});

test("Compaction values that do not fit their model fail its registration", () => {
    const faux = registerFauxProvider({ models: [{ id: "unfit", reasoning: false, contextWindow: 10_000, maxTokens: 1_000 }] });
    const model = faux.getModel();
    const register = (compaction: unknown) => ModelRuntime.create().registerProvider(model.provider, {
        baseUrl: model.baseUrl, apiKey: "faux-key", api: faux.api,
        models: [{ id: model.id, name: model.name, reasoning: false, input: model.input, cost: model.cost, contextWindow: 10_000, maxTokens: 1_000, compaction: compaction as never }],
    });
    try {
        register({ threshold: 8_000, keepRecentTokens: 2_000, summaryTokens: 1_000 });
        assert.throws(() => register({ threshold: 9_500, keepRecentTokens: 2_000, summaryTokens: 1_000 }), /threshold plus summaryTokens \(10500\) must stay below the context window \(10000\)/);
        assert.throws(() => register({ threshold: 8_000, keepRecentTokens: 7_500, summaryTokens: 1_000 }), /keepRecentTokens plus summaryTokens \(8500\) must stay below threshold \(8000\)/);
        assert.throws(() => register({ threshold: 8_000, keepRecentTokens: 2_000, summaryTokens: 1_500 }), /summaryTokens \(1500\) exceeds the output limit \(1000\)/);
        assert.throws(() => register({ threshold: 8_000, keepRecentTokens: 0, summaryTokens: 1_000 }), /compaction\.keepRecentTokens must be a positive integer/);
        assert.throws(() => register({ threshold: 8_000, keepRecentTokens: 2_000 }), /compaction\.summaryTokens must be a positive integer/);
        assert.throws(() => register({ threshold: 8_000, keepRecentTokens: 2_000, summaryTokens: 1_000, reserveTokens: 1 }), /compaction\.reserveTokens is not supported/);
    } finally {
        faux.unregister();
    }
});

test("An overflow right after a retried provider error compacts and continues behind both error steps", async () => {
    const { faux, modelRuntime, selection } = fauxModelRuntime("overflow-after-retry");
    const harness = journalHarness(selection);
    const manager = new AgentRuntimeManager({ modelRuntime, settings: { retry: { baseDelayMs: 10 } } });
    const answers = [
        () => fauxAssistantMessage("Answer 1."),
        () => fauxAssistantMessage([], { stopReason: "error", errorMessage: "503 Service Unavailable" }),
        () => fauxAssistantMessage([], { stopReason: "error", errorMessage: "prompt is too long: 213462 tokens > 200000 maximum" }),
        () => fauxAssistantMessage("Done."),
    ];
    faux.setResponses(Array.from({ length: 6 }, () => (context: Context) => {
        if (context.systemPrompt?.startsWith("You are a context summarization assistant"))
            return fauxAssistantMessage("## Goal\nSummary.");
        const answer = answers.shift();
        assert.ok(answer, "unexpected model request");
        return answer();
    }));
    try {
        assert.equal((await turnOf(harness, manager, "First.")).result.failure, null);
        const { request, result } = await within(turnOf(harness, manager, "x".repeat(100_000)), 10_000);
        assert.equal(result.failure, null);
        assert.equal(answers.length, 0);
        assert.deepEqual(harness.outputsOf(request.turnId), ["model.output.completed: Done."]);
    } finally {
        await manager.shutdown();
        faux.unregister();
    }
});

test("A loop failure without a model call fails the turn but writes no model step", async () => {
    const { faux, modelRuntime, selection } = fauxModelRuntime("loop-failure");
    const harness = journalHarness(selection);
    const manager = new AgentRuntimeManager({ modelRuntime });
    faux.setResponses([() => fauxAssistantMessage("Answer.")]);
    let refreshes = 0;
    try {
        const { request, result } = await turnOf(harness, manager, "Go.", {
            refreshTools: async () => {
                refreshes += 1;
                if (refreshes > 1)
                    throw new Error("The tools are not readable.");
                return { tools: [], systemPrompt: "System contract." };
            },
        });
        assert.equal(result.failure, "The tools are not readable.");
        const steps = harness.runtime.events(harness.runId).filter((event) => event.type === "model.step.completed" && event.payload.turnId === request.turnId);
        assert.deepEqual(steps.map((event) => event.type === "model.step.completed" && event.payload.stopReason), ["stop"]);
    } finally {
        await manager.shutdown();
        faux.unregister();
    }
});

test("An abort during a compaction ends the turn without reporting a failed compaction", async () => {
    const { faux, modelRuntime, selection } = fauxModelRuntime("abort-compaction");
    const harness = journalHarness(selection);
    const diagnostics: string[] = [];
    const manager = new AgentRuntimeManager({ modelRuntime, onDiagnostic: (diagnostic) => { diagnostics.push(diagnostic.message); } });
    const controller = new AbortController();
    const answers = [
        () => fauxAssistantMessage("Answer 1."),
        () => fauxAssistantMessage([], { stopReason: "error", errorMessage: "prompt is too long: 213462 tokens > 200000 maximum" }),
    ];
    faux.setResponses(Array.from({ length: 4 }, () => (context: Context, options: { signal?: AbortSignal } | undefined) => {
        if (context.systemPrompt?.startsWith("You are a context summarization assistant")) {
            controller.abort();
            return new Promise((_resolve, reject) => {
                if (options?.signal?.aborted) reject(new Error("aborted"));
                options?.signal?.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
            });
        }
        const answer = answers.shift();
        assert.ok(answer, "unexpected model request");
        return answer();
    }));
    try {
        assert.equal((await turnOf(harness, manager, "First.")).result.failure, null);
        await within(turnOf(harness, manager, "x".repeat(100_000), {}, controller.signal), 10_000);
        assert.deepEqual(diagnostics.filter((message) => /compaction/i.test(message)), []);
    } finally {
        await manager.shutdown();
        faux.unregister();
    }
});

test("A turn whose provider error survives every retry fails with the last error", async () => {
    const { faux, modelRuntime, selection } = fauxModelRuntime("provider-error");
    const harness = journalHarness(selection);
    const manager = new AgentRuntimeManager({ modelRuntime });
    faux.setResponses([() => fauxAssistantMessage([], { stopReason: "error", errorMessage: "invalid request: unknown parameter" })]);
    try {
        const { result } = await turnOf(harness, manager, "Go.");
        assert.equal(result.failure, "invalid request: unknown parameter");
    } finally {
        await manager.shutdown();
        faux.unregister();
    }
});

test("Two skills with the same name, say from two plugins, fail the runtime creation and name both", async () => {
    const directory = mkdtempSync(join(tmpdir(), "ragents-duplicate-skills-"));
    const { faux, modelRuntime, selection } = fauxModelRuntime("duplicate-skills");
    const harness = journalHarness(selection);
    const skillIn = (plugin: string) => ({
        name: "review",
        description: "Reviews changes.",
        filePath: join(directory, plugin, "review", "SKILL.md"),
        baseDir: join(directory, plugin, "review"),
        location: "@skills/review/SKILL.md",
        disableModelInvocation: false,
    });
    const manager = new AgentRuntimeManager({ modelRuntime, resolveSkills: () => [skillIn("first"), skillIn("second")] });
    try {
        const { result } = await turnOf(harness, manager, "Go.");
        assert.equal(
            result.failure,
            `The skill review exists more than once: ${skillIn("first").filePath}, ${skillIn("second").filePath}.`,
        );
        assert.equal(faux.state.callCount, 0);
    } finally {
        await manager.shutdown();
        faux.unregister();
        rmSync(directory, { recursive: true, force: true });
    }
});

test("Preloading names the location the tools reach, never the host path of the SKILL.md", async () => {
    const directory = mkdtempSync(join(tmpdir(), "ragents-skill-location-"));
    const { faux, modelRuntime, selection } = fauxModelRuntime("skill-location");
    const harness = journalHarness(selection);
    mkdirSync(join(directory, "review"));
    writeFileSync(join(directory, "review", "SKILL.md"), "---\nname: review\ndescription: Reviews changes.\n---\nRead checklist.md.\n");
    const skill = {
        name: "review",
        description: "Reviews changes.",
        filePath: join(directory, "review", "SKILL.md"),
        baseDir: join(directory, "review"),
        location: "@skills/review/SKILL.md",
        disableModelInvocation: false,
    };
    const prompts: string[] = [];
    faux.setResponses([(context) => {
        prompts.push(context.systemPrompt ?? "");
        return fauxAssistantMessage("Reviewed.");
    }]);
    const manager = new AgentRuntimeManager({ modelRuntime, resolveSkills: () => [skill] });
    try {
        const { result } = await turnOf(harness, manager, "/skill:review please");
        assert.equal(result.failure, null);
        assert.equal(prompts.length, 1);
        assert.match(prompts[0]!, /<preloaded_skill name="review" location="@skills\/review\/SKILL\.md">\nRead checklist\.md\./);
        assert.equal(prompts[0]!.includes(directory), false);
    } finally {
        await manager.shutdown();
        faux.unregister();
        rmSync(directory, { recursive: true, force: true });
    }
});

test("The agent runtime delivers attachment-only images, video and PDF as native model content and keeps them as hashes", async () => {
    const { faux, modelRuntime, selection } = fauxModelRuntime("native-attachments", ["text", "image", "video", "file"]);
    const harness = journalHarness(selection);
    const manager = new AgentRuntimeManager({ modelRuntime });
    let received: unknown;
    faux.setResponses([(context) => {
        const content = context.messages.find((message) => message.role === "user")?.content;
        received = Array.isArray(content) ? content.filter((block) => block.type !== "text") : content;
        return fauxAssistantMessage("Files arrived.");
    }]);
    try {
        const content = new Uint8Array([0, 255, 13, 4]);
        const { result } = await turnOf(harness, manager, "Attachments.", {
            prompt: "",
            attachments: [
                { name: "photo.png", mediaType: "image/png", content },
                { name: "clip.mp4", mediaType: "video/mp4", content },
                { name: "report.pdf", mediaType: "application/pdf", content },
            ],
        });
        assert.equal(result.failure, null);
        const data = Buffer.from(content).toString("base64");
        assert.deepEqual(received, [
            { type: "image", data, mimeType: "image/png" },
            { type: "video", data, mimeType: "video/mp4" },
            { type: "file", data, mimeType: "application/pdf", filename: "report.pdf" },
        ]);
        const presented = harness.runtime.events(harness.runId).find((event) => event.type === "model.input.presented");
        assert.ok(presented?.type === "model.input.presented" && Array.isArray(presented.payload.content));
        assert.doesNotMatch(JSON.stringify(presented.payload), new RegExp(data.replaceAll("+", "\\+").replaceAll("/", "\\/")));
        assert.ok(presented.payload.content.slice(1).every((part) => part.type !== "text" && /^[0-9a-f]{64}$/.test(part.hash)));
    } finally {
        await manager.shutdown();
        faux.unregister();
    }
});

for (const stop of ["signal", "halt"] as const) {
    test(`the agent runtime preserves streamed text once when stopped by ${stop}, and the unfinished step is no context`, async () => {
        const { faux, modelRuntime, selection } = fauxModelRuntime(`partial-${stop}`);
        faux.setResponses([fauxAssistantMessage("Already visible text that would continue for much longer.")]);
        const harness = journalHarness(selection);
        const manager = new AgentRuntimeManager({ modelRuntime, turnAbortTimeoutMs: 30 });
        const controller = new AbortController();
        const visible: string[] = [];
        let halt: Promise<void> | undefined;
        try {
            const request = harness.request("Go.", {
                publish: (event) => {
                    if (event.kind !== "text") return;
                    visible.push(event.delta);
                    if (stop === "halt") halt = manager.haltRun(harness.runId);
                    else controller.abort();
                },
            });
            const result = await within(manager.runTurn(request, controller.signal));
            await halt;
            assert.match(result.failure ?? "", /aborted/);
            assert.ok(visible.join("").length > 0);
            assert.deepEqual(harness.outputsOf(request.turnId), [`model.output.interrupted: ${visible.join("").trim()}`]);
            await manager.shutdown();
            assert.deepEqual(harness.outputsOf(request.turnId), [`model.output.interrupted: ${visible.join("").trim()}`]);
            const types = harness.runtime.events(harness.runId).map((event) => event.type);
            assert.equal(types.includes("model.step.completed"), false, "a cancelled step is not context");
            assert.equal(types.includes("model.input.presented"), true);
        } finally {
            controller.abort();
            await manager.shutdown();
            faux.unregister();
        }
    });
}

test("text and thinking stream live as deltas while the journal gets one step at its end", async () => {
    const { faux, modelRuntime, selection } = fauxModelRuntime("live-deltas", undefined, 2_000);
    faux.setResponses([fauxAssistantMessage([fauxThinking("I am thinking, ".repeat(10)), fauxText("The answer comes piece by piece. ".repeat(6))])]);
    const harness = journalHarness(selection);
    const manager = new AgentRuntimeManager({ modelRuntime });
    const stepsWhileStreaming: number[] = [];
    try {
        const { request, result } = await turnOf(harness, manager, "Go.", {
            publish: (event) => {
                harness.published.push(event);
                stepsWhileStreaming.push(harness.runtime.events(harness.runId).filter((entry) => entry.type === "model.step.completed").length);
            },
        });
        assert.equal(result.failure, null);
        const thinking = harness.published.filter((event) => event.kind === "thinking");
        const text = harness.published.filter((event) => event.kind === "text");
        assert.ok(thinking.length > 1 && text.length > 1, "several deltas per block");
        assert.equal(thinking.map((event) => event.kind === "thinking" ? event.delta : "").join(""), "I am thinking, ".repeat(10));
        assert.equal(text.map((event) => event.kind === "text" ? event.delta : "").join(""), "The answer comes piece by piece. ".repeat(6));
        assert.ok(stepsWhileStreaming.every((count) => count === 0), "no step in the journal while it streams");
        const types = harness.runtime.events(harness.runId).filter((event) => event.payload && "turnId" in event.payload && event.payload.turnId === request.turnId).map((event) => event.type);
        assert.deepEqual(types.filter((type) => type.startsWith("model.")), ["model.input.presented", "model.reasoning.completed", "model.output.completed", "model.step.completed"]);
        const step = harness.runtime.events(harness.runId).find((event) => event.type === "model.step.completed");
        assert.ok(step?.type === "model.step.completed");
        assert.deepEqual(step.payload.content, [{ type: "thinking" }, { type: "text" }], "the step does not repeat text and thinking");
        assert.equal(new Set(harness.runtime.events(harness.runId).filter((event) => event.type.startsWith("model.") && event.type !== "model.input.presented").map((event) => event.commandId)).size, 1);
    } finally {
        await manager.shutdown();
        faux.unregister();
    }
});

test("a turn aborted during a tool call keeps the agent runtime: the next turn continues the same conversation", async () => {
    const { faux, modelRuntime, selection } = fauxModelRuntime("interrupted-turn");
    const harness = journalHarness(selection);
    const manager = new AgentRuntimeManager({ modelRuntime, turnAbortTimeoutMs: 1_000 });
    const controller = new AbortController();
    const tool = nativeTool("long_step", "Takes a while.");
    const userTexts = (context: Context) => context.messages.flatMap((message) => message.role === "user"
        ? [typeof message.content === "string" ? message.content : message.content.map((part) => part.type === "text" ? part.text : "").join("")]
        : []);
    const continued: string[][] = [];
    const answer = (context: Context) => {
        const texts = userTexts(context);
        if (!texts.some((text) => text.includes("Continue."))) return fauxAssistantMessage("Not done yet.");
        continued.push(texts);
        return fauxAssistantMessage("Moving on.");
    };
    faux.setResponses([fauxAssistantMessage([fauxToolCall("long_step", {}, { id: "long" })], { stopReason: "toolUse" }), answer, answer]);
    try {
        const interrupted = await within(turnOf(harness, manager, "Original input.", {
            tools: [tool],
            invoke: () => new Promise((_resolve, reject) => {
                controller.signal.addEventListener("abort", () => reject(new Error("Tool cancelled.")), { once: true });
                controller.abort();
            }),
        }, controller.signal));
        assert.match(interrupted.result.failure ?? "", /aborted/);
        assert.equal(faux.state.callCount, 1, "after the cancellation in the tool the loop does not query the model again");
        const next = await within(turnOf(harness, manager, "Continue.", { tools: [tool] }));
        assert.equal(next.result.failure, null);
        assert.deepEqual(harness.outputsOf(next.request.turnId), ["model.output.completed: Moving on."]);
        assert.ok(continued[0]?.some((text) => text.includes("Original input.")), "the first task stays in the conversation");
    } finally {
        controller.abort();
        await manager.shutdown();
        faux.unregister();
    }
});

test("an abort while a context hook still runs sends no model request once the hook returns", async () => {
    const { faux, modelRuntime, selection } = fauxModelRuntime("abort-in-hook");
    faux.setResponses([fauxAssistantMessage("Never sent.")]);
    const harness = journalHarness(selection);
    const controller = new AbortController();
    const hookEntered = Promise.withResolvers<void>();
    const hookRelease = Promise.withResolvers<void>();
    const hookReturned = Promise.withResolvers<void>();
    const manager = new AgentRuntimeManager({
        modelRuntime,
        turnAbortTimeoutMs: 30,
        resolveHooks: hooksOf({
            id: "test.slow",
            beforeModelCall: async () => {
                hookEntered.resolve();
                await hookRelease.promise;
                hookReturned.resolve();
                return undefined;
            },
        }),
    });
    try {
        const request = harness.request("Go.");
        const turn = manager.runTurn(request, controller.signal);
        await within(hookEntered.promise);
        controller.abort();
        hookRelease.resolve();
        assert.match((await within(turn)).failure ?? "", /aborted/);
        await within(hookReturned.promise);
        await within(manager.waitForRunSettlement(harness.runId) ?? Promise.resolve());
        await new Promise((resolve) => setTimeout(resolve, 20));
        assert.equal(faux.state.callCount, 0);
    } finally {
        controller.abort();
        hookRelease.resolve();
        await manager.shutdown();
        faux.unregister();
    }
});

test("a hook note reaches only its model call, and what a hook keeps stands in the journal for later turns", async () => {
    const { faux, modelRuntime, selection } = fauxModelRuntime("hook-state");
    const harness = journalHarness(selection);
    const seenKept: unknown[] = [];
    const lastUserTexts: string[] = [];
    faux.setResponses([1, 2].map(() => (context: Context) => {
        const last = context.messages.at(-1);
        lastUserTexts.push(last?.role === "user" && Array.isArray(last.content) ? last.content.map((part) => part.type === "text" ? part.text : "").join("") : String(last?.content));
        return fauxAssistantMessage("Seen.");
    }));
    const manager = new AgentRuntimeManager({
        modelRuntime,
        resolveHooks: hooksOf({
            id: "test.counter",
            beforeModelCall: (_agent, call) => {
                seenKept.push(call.kept);
                call.keep({ calls: typeof call.kept === "object" && call.kept !== null && "calls" in call.kept ? Number(call.kept.calls) + 1 : 1 });
                return "Hidden note.";
            },
        }),
    });
    try {
        await turnOf(harness, manager, "First.");
        await turnOf(harness, manager, "Second.");
        assert.deepEqual(seenKept, [undefined, { calls: 1 }]);
        assert.deepEqual(lastUserTexts, ["Hidden note.", "Hidden note."]);
        const context = JSON.stringify(turnModelContextOf(harness).messages);
        assert.doesNotMatch(context, /Hidden note/, "the note is not part of the context");
        const state = harness.runtime.view(harness.runId).pluginStates.find((entry) => entry.pluginId === "test.counter");
        assert.deepEqual(state?.scope, { kind: "actor", actorId: harness.agentId });
        assert.deepEqual(state?.state, { calls: 2 });
    } finally {
        await manager.shutdown();
        faux.unregister();
    }
});

const turnModelContextOf = (harness: ReturnType<typeof journalHarness>) =>
    modelContextOf(harness.runtime.events(harness.runId), harness.agentId, (hash) => harness.runtime.mediaContent(hash));

for (const stopDuring of ["tool", "next-message", "thinking"] as const) {
    test(`stopping during ${stopDuring} preserves only the unfinished message text`, async () => {
        const { faux, modelRuntime, selection } = fauxModelRuntime(`partial-boundary-${stopDuring}`);
        const harness = journalHarness(selection);
        const manager = new AgentRuntimeManager({ modelRuntime });
        const controller = new AbortController();
        const visible: string[] = [];
        const first = "Completed message.";
        const tool = nativeTool("next_step", "Continue the task.");
        faux.setResponses(stopDuring === "thinking"
            ? [fauxAssistantMessage([fauxThinking("Reasoning before any answer."), fauxText("Unseen answer.")])]
            : [
                fauxAssistantMessage([fauxText(first), fauxToolCall("next_step", {}, { id: "step" })], { stopReason: "toolUse" }),
                fauxAssistantMessage("The unfinished next message keeps going."),
            ]);
        try {
            const { request } = await within(turnOf(harness, manager, "Go.", {
                tools: [tool],
                invoke: async () => {
                    if (stopDuring === "tool") controller.abort();
                    return null;
                },
                publish: (event) => {
                    if (event.kind === "thinking" && stopDuring === "thinking") controller.abort();
                    const outputs = harness.outputsOf(harness.runtime.view(harness.runId).turns.at(-1)!.id);
                    if (event.kind !== "text" || outputs.length === 0) return;
                    visible.push(event.delta);
                    controller.abort();
                },
            }, controller.signal));
            assert.deepEqual(harness.outputsOf(request.turnId), stopDuring === "thinking" ? [] : [
                `model.output.completed: ${first}`,
                ...(stopDuring === "next-message" ? [`model.output.interrupted: ${visible.join("").trim()}`] : []),
            ]);
        } finally {
            controller.abort();
            await manager.shutdown();
            faux.unregister();
        }
    });
}

test("The agent runtime latches an abort during preflight and rejects before accepting the agent start", async () => {
    let aborts = 0;
    const latch = createTurnAbortLatch(async () => {
        aborts++;
    });

    assert.equal(latch.request(), null);
    assert.throws(
        () => latch.accept(),
        /aborted before agent start/,
    );
    assert.equal(aborts, 0);

    const active = createTurnAbortLatch(async () => {
        aborts++;
    });
    active.accept();
    const first = active.request();
    const second = active.request();
    assert.ok(first);
    assert.equal(second, first);
    await first;
    assert.equal(aborts, 1);

    const afterAgentStart = active.reapply();
    assert.ok(afterAgentStart);
    await afterAgentStart;
    assert.equal(aborts, 2);
});

test("The agent runtime reports runtime creation failures before submission", async () => {
    const harness = journalHarness({ provider: "faux", model: "unconfigured" });
    const unavailable = Promise.reject(new Error("agent setup unavailable."));
    const manager = new AgentRuntimeManager({ modelRuntime: unavailable });
    const { result } = await turnOf(harness, manager, "Go.");

    assert.equal(result.failure, "agent setup unavailable.");
});

test("The agent runtime run halt aborts a hook resolution that hangs during runtime creation and waits for its real end", async () => {
    const harness = journalHarness({ provider: "faux", model: "unconfigured" });
    let creationSignal: AbortSignal | undefined;
    const started = deferred();
    const release = deferred();
    const manager = new AgentRuntimeManager({
        modelRuntime: ModelRuntime.create(),
        resolveHooks: async (_context, signal) => {
            creationSignal = signal;
            started.resolve();
            await release.promise;
            return [];
        },
    });

    try {
        const request = harness.request("Go.");
        const turn = manager.runTurn(request, new AbortController().signal);

        await within(started.promise);
        await within(manager.haltRun(request.runId));
        const result = await within(turn);
        const settlement = manager.waitForRunSettlement(request.runId);

        assert.equal(creationSignal?.aborted, true);
        assert.match(result.failure ?? "", /stopping/);
        assert.ok(settlement);

        let settled = false;
        void settlement.then(() => {
            settled = true;
        });
        await new Promise<void>((resolveImmediate) => setImmediate(resolveImmediate));
        assert.equal(settled, false);

        release.resolve();
        await within(settlement);
        await manager.shutdown();
    } finally {
        release.resolve();
    }
});

test("The agent runtime manager shutdown waits beyond the turn deadline for a hanging hook", async () => {
    const release = deferred();
    const started = deferred();
    const { faux, modelRuntime, selection } = fauxModelRuntime("global-shutdown");
    faux.setResponses([fauxAssistantMessage("Never sent.")]);
    const harness = journalHarness(selection);

    try {
        const manager = new AgentRuntimeManager({
            modelRuntime,
            turnAbortTimeoutMs: 30,
            resolveHooks: hooksOf({
                id: "test.hanging",
                beforeModelCall: async () => {
                    started.resolve();
                    await release.promise;
                    return undefined;
                },
            }),
        });
        const turn = manager.runTurn(harness.request("Go."), new AbortController().signal);
        await within(started.promise);
        const shutdown = manager.shutdown();
        assert.match((await within(turn)).failure ?? "", /aborted|did not settle/);
        const state = await Promise.race([
            shutdown.then(() => "settled" as const),
            new Promise<"pending">((resolve) => setTimeout(() => resolve("pending"), 50)),
        ]);
        assert.equal(state, "pending");

        release.resolve();
        await within(shutdown);
    } finally {
        release.resolve();
        faux.unregister();
    }
});

test("The agent runtime halt quarantines a turn whose hook ignores abort, and the late hook reaches nothing", async () => {
    const { faux, modelRuntime, selection } = fauxModelRuntime("abort-deadline");
    faux.setResponses([fauxAssistantMessage("Late answer that nobody sees.")]);
    const harness = journalHarness(selection);
    const controller = new AbortController();
    const started = deferred();
    const release = deferred();
    let lateKeep: unknown;
    const published: unknown[] = [];
    const manager = new AgentRuntimeManager({
        modelRuntime,
        turnAbortTimeoutMs: 30,
        resolveHooks: hooksOf({
            id: "test.ignores-abort",
            beforeModelCall: async (_agent, call) => {
                started.resolve();
                await release.promise;
                try {
                    call.keep("too late");
                } catch (error) {
                    lateKeep = error;
                }
                throw new Error("Late hook failure.");
            },
        }),
    });

    try {
        const request = harness.request("Go.", { publish: (event) => published.push(event) });
        const turn = manager.runTurn(request, controller.signal);

        await within(started.promise);
        const halt = manager.haltRun(request.runId);
        const result = await within(turn);
        await within(halt);
        const settlement = manager.waitForRunSettlement(request.runId);

        assert.match(result.failure ?? "", /aborted/);
        assert.ok(settlement);

        let settled = false;
        void settlement.then(() => {
            settled = true;
        });
        await new Promise<void>((resolveImmediate) => setImmediate(resolveImmediate));
        assert.equal(settled, false);

        release.resolve();
        await within(settlement);
        await new Promise<void>((resolveImmediate) => setImmediate(resolveImmediate));
        assert.match(lateKeep instanceof Error ? lateKeep.message : String(lateKeep), /stale/);
        assert.deepEqual(harness.outputsOf(request.turnId), []);
        assert.deepEqual(published, []);
        assert.equal(faux.state.callCount, 0);
    } finally {
        controller.abort(new Error("Test cleanup."));
        release.resolve();
        await manager.shutdown().catch(() => undefined);
        faux.unregister();
    }
});

test("The agent runtime halt drops its runtime but allows the run to create a fresh one, and a disposed run stays retired", async () => {
    const { faux, modelRuntime, selection } = fauxModelRuntime("halt-fresh");
    faux.setResponses([fauxAssistantMessage("One."), fauxAssistantMessage("Two.")]);
    const harness = journalHarness(selection);
    let resolutions = 0;
    const manager = new AgentRuntimeManager({
        modelRuntime,
        resolveHooks: () => {
            resolutions++;
            return [];
        },
    });

    try {
        await turnOf(harness, manager, "First.");
        await manager.haltRun(harness.runId);
        assert.equal(resolutions, 1);
        await turnOf(harness, manager, "Second.");
        await manager.disposeRun(harness.runId);

        assert.equal(resolutions, 2);
        const request = harness.request("Third.");
        await assert.rejects(manager.runTurn(request, new AbortController().signal), /has been retired/);
    } finally {
        await manager.shutdown();
        faux.unregister();
    }
});

test("the runtime adds nothing of its own to the system prompt", async () => {
    const { faux, modelRuntime, selection } = fauxModelRuntime("plain-prompt");
    const prompts: string[] = [];
    faux.setResponses([1, 2].map(() => (context: Context) => {
        prompts.push(context.systemPrompt ?? "");
        return fauxAssistantMessage("Done.");
    }));
    const harness = journalHarness(selection);
    const manager = new AgentRuntimeManager({ modelRuntime });
    try {
        await turnOf(harness, manager, "First.", { workspace: "/only/on/the/workstation" });
        await turnOf(harness, manager, "Second.", { workspace: "/only/on/the/workstation" });
        assert.deepEqual(prompts, ["System contract.", "System contract."]);
    } finally {
        await manager.shutdown();
        faux.unregister();
    }
});

test("after a restart of the host an agent continues with a byte-identical model context", async () => {
    const directory = mkdtempSync(join(tmpdir(), "ragents-restart-context-"));
    const { faux, modelRuntime, selection } = fauxModelRuntime("restart-context", ["text", "image"]);
    const requests: Context[] = [];
    const record = (answer: () => ReturnType<typeof fauxAssistantMessage>) => (context: Context) => {
        requests.push(JSON.parse(JSON.stringify(context)) as Context);
        return answer();
    };
    faux.setResponses([
        record(() => fauxAssistantMessage([fauxThinking("Plan."), fauxText("Let me look.\n"), fauxToolCall("lookup", { value: 1 }, { id: "look" })], { stopReason: "toolUse" })),
        record(() => fauxAssistantMessage("  Found.  ")),
        record(() => fauxAssistantMessage("After the restart.")),
    ]);
    const lookup = defineRunFunction({
        name: "lookup", label: "lookup", description: "Look up.", nativeTool: true,
        schema: Type.Object({ value: Type.Number() }, { additionalProperties: false }), resultSchema: Type.Unknown(),
        available: () => true, run: () => null,
    }) as RunFunction;

    try {
        const first = journalHarness(selection, directory);
        const before = new AgentRuntimeManager({ modelRuntime });
        await turnOf(first, before, "First task.", { tools: [lookup], invoke: async () => ({ found: ["a", null] }) });
        await before.shutdown();
        const contextBefore = JSON.stringify(modelContextOf(first.runtime.events(first.runId), first.agentId, (hash) => first.runtime.mediaContent(hash)));
        first.journal.close();

        let next = 0;
        const services = { ...testServices(13), newId: (kind: string) => `${kind}-after-${++next}` };
        const journal = new Journal(directory, services);
        const runtime = new Orchestration(journal, services);
        const second = harnessOver(selection, journal, runtime, first.runId, first.agentId, "after-");
        const contextAfter = JSON.stringify(modelContextOf(runtime.events(first.runId), first.agentId, (hash) => runtime.mediaContent(hash)));
        assert.equal(contextAfter, contextBefore, "the projection is byte-identical after the restart");
        assert.equal(JSON.stringify(runtime.modelContext(first.runId, first.agentId)), contextBefore, "after the restart the held context is built once from the journal");

        const after = new AgentRuntimeManager({ modelRuntime });
        try {
            const { result } = await turnOf(second, after, "After the restart.", { tools: [lookup] });
            assert.equal(result.failure, null);
        } finally {
            await after.shutdown();
            journal.close();
        }

        const withoutLast = (context: Context) => JSON.stringify(context.messages.slice(0, -1));
        const expected = JSON.stringify(convertToLlm(JSON.parse(contextBefore).messages));
        assert.equal(withoutLast(requests[2]!), expected, "the prefix of the first request after the restart is byte-identical");
        assert.equal(JSON.stringify(requests[2]!.messages.slice(0, requests[1]!.messages.length)), JSON.stringify(requests[1]!.messages));
        assert.equal(requests[2]!.systemPrompt, requests[1]!.systemPrompt);
        assert.equal(JSON.stringify(requests[2]!.tools), JSON.stringify(requests[1]!.tools));
    } finally {
        faux.unregister();
        rmSync(directory, { recursive: true, force: true });
    }
});

test("a crash in the middle of a stream leaves no half step: the turn ends as interrupted and the next one starts after the input", async () => {
    const directory = mkdtempSync(join(tmpdir(), "ragents-crash-context-"));
    const snapshot = mkdtempSync(join(tmpdir(), "ragents-crash-snapshot-"));
    const { faux, modelRuntime, selection } = fauxModelRuntime("crash-context", undefined, 500);
    const streaming = deferred();
    faux.setResponses([
        fauxAssistantMessage("A long answer that nobody sees to the end. ".repeat(20)),
        (context: Context) => {
            assert.deepEqual(context.messages.map((message) => message.role), ["user", "user"]);
            return fauxAssistantMessage("Continue.");
        },
    ]);
    try {
        const first = journalHarness(selection, directory);
        const before = new AgentRuntimeManager({ modelRuntime });
        const controller = new AbortController();
        const running = before.runTurn(first.request("First.", {
            publish: () => streaming.resolve(),
        }), controller.signal);
        await within(streaming.promise);
        const { cpSync } = await import("node:fs");
        cpSync(directory, snapshot, { recursive: true, filter: (source) => !source.includes(".writer.lock") });
        controller.abort();
        await running;
        await before.shutdown();
        first.journal.close();

        let next = 0;
        const services = { ...testServices(13), newId: (kind: string) => `${kind}-after-${++next}` };
        const journal = new Journal(snapshot, services);
        const runtime = new Orchestration(journal, services);
        const view = runtime.view(first.runId);
        assert.deepEqual(view.turns.map((turn) => turn.status), ["interrupted"]);
        const types = runtime.events(first.runId).map((event) => event.type);
        assert.ok(types.includes("model.input.presented"));
        assert.equal(types.includes("model.step.completed"), false);
        assert.equal(types.includes("model.output.completed"), false);

        const second = harnessOver(selection, journal, runtime, first.runId, first.agentId, "after-");
        const after = new AgentRuntimeManager({ modelRuntime });
        try {
            const { result } = await turnOf(second, after, "Second.");
            assert.equal(result.failure, null);
        } finally {
            await after.shutdown();
            journal.close();
        }
    } finally {
        faux.unregister();
        rmSync(directory, { recursive: true, force: true });
        rmSync(snapshot, { recursive: true, force: true });
    }
});
