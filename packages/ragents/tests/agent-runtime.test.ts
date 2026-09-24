import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { Type } from "typebox";

import {
    ModelRuntime,
    type ExtensionAPI,
    type InlineExtension,
} from "@ragents/agent";
import { fauxAssistantMessage, fauxText, fauxThinking, fauxToolCall, registerFauxProvider, type Context, type InputModality } from "@ragents/ai";

import {
    createTurnAbortLatch,
    forkableBranch,
    AgentRuntimeManager,
} from "../src/drivers/agent-runtime.ts";
import { AgentSessionDriver } from "../src/drivers/agent.ts";
import { defineRunFunction } from "../src/agents/tools.ts";
import type { DriverEvent, TurnRequest } from "../src/drivers/types.ts";
import { deferred } from "./support.ts";

const requestFor = (): TurnRequest<"agent"> => ({
    driverKind: "agent",
    forkOf: null,
    runId: "run-1",
    agentId: "agent-1",
    turnId: "turn-2",
    startedAt: "2026-08-27T12:00:00.000Z",
    input: {
        id: "input-1",
        actorId: "agent-1",
        content: "Original input.",
        artifactIds: [],
        sourceEventIds: [],
        subscriptionId: null,
        enqueuedBy: "human-1",
        enqueuedAt: "2026-08-27T12:00:00.000Z",
        sequence: 1,
        lifecycle: { kind: "claimed", turnId: "turn-2", steered: false },
        event: null,
    },
    prompt: "Original input.",
    selection: { provider: "faux", model: "unconfigured" },
    systemPrompt: "System contract.",
    workspace: process.cwd(),
    runtimeDirectory: () => Promise.resolve(process.cwd()),
    storeAttachment: () => Promise.reject(new Error("Der Test legt keine Anhänge ab.")),
    tools: [],
    allowedToolNames: null,
    invoke: async () => ({ output: null, ignoredFields: [] }),
    claimSteering: () => [],
    emit: () => undefined,
    publish: () => undefined,
});

const within = async <T>(operation: Promise<T>, timeoutMs = 1_000): Promise<T> => {
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

const fauxModelRuntime = async (directory: string, id: string, responses: number, input?: InputModality[]) => {
    const faux = registerFauxProvider({ models: [{ id, reasoning: false, ...(input ? { input } : {}) }] });
    faux.setResponses(Array.from({ length: responses }, (_, index) => fauxAssistantMessage(`Antwort ${index + 1}.`)));
    const modelRuntime = ModelRuntime.create();
    const model = faux.getModel();
    modelRuntime.registerProvider(model.provider, {
        baseUrl: model.baseUrl,
        apiKey: "faux-key",
        api: faux.api,
        models: faux.models.map((entry) => ({
            id: entry.id,
            name: entry.name,
            api: entry.api,
            reasoning: entry.reasoning,
            input: entry.input,
            cost: entry.cost,
            contextWindow: entry.contextWindow,
            maxTokens: entry.maxTokens,
            baseUrl: entry.baseUrl,
        })),
    });

    return { faux, modelRuntime, selection: { provider: model.provider, model: model.id } };
};

for (const selectionKind of ["open", "selected"] as const) {
    test(`native tools refresh before each model request with ${selectionKind} function selection`, async () => {
        const directory = mkdtempSync(join(tmpdir(), "ragents-native-tool-refresh-"));
        const { faux, modelRuntime, selection } = await fauxModelRuntime(directory, `native-refresh-${selectionKind}`, 0);
        const manager = new AgentRuntimeManager({ modelRuntime });
        let revision = 0;
        const calls: string[] = [];
        const tools = ["native_first", "native_second"].map((name) => defineRunFunction({
            name, label: name, description: `Execute ${name}.`, nativeTool: true,
            schema: Type.Object({}, { additionalProperties: false }), resultSchema: Type.Null(),
            available: () => true, run: () => null,
        }));
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
                return fauxAssistantMessage("Fertig.");
            },
        ]);
        try {
            const result = await manager.runTurn({
                ...requestFor(), workspace: directory, selection,
                tools: [tools[0]!],
                allowedToolNames: selectionKind === "open" ? null : tools.map((tool) => tool.name),
                refreshTools: async () => ({ tools: tools.slice(revision, revision + 1), systemPrompt: `Revision ${revision}.` }),
                invoke: async (_id, name) => {
                    calls.push(name);
                    revision++;
                    return { output: null, ignoredFields: [] };
                },
            }, new AbortController().signal);
            assert.equal(result.failure, null);
            assert.deepEqual(calls, ["native_first", "native_second"]);
            assert.equal(revision, 2);
        } finally {
            await manager.shutdown();
            faux.unregister();
            rmSync(directory, { recursive: true, force: true });
        }
    });
}

test("selected functions retain both TypeScript infrastructure tools through refresh and subsequent turns", async () => {
    const directory = mkdtempSync(join(tmpdir(), "ragents-selected-typescript-refresh-"));
    const { faux, modelRuntime, selection } = await fauxModelRuntime(directory, "selected-typescript-refresh", 0);
    const manager = new AgentRuntimeManager({ modelRuntime });
    const names = ["typescript_api", "typescript_eval"];
    const calls: string[] = [];
    let refreshes = 0;
    const tools = () => names.map((name) => defineRunFunction({
        name, label: name, description: `${name}, revision ${refreshes}.`, nativeTool: true,
        schema: Type.Object({}, { additionalProperties: false }), resultSchema: Type.Null(),
        available: () => true, run: () => null,
    }));
    faux.setResponses(Array.from({ length: 6 }, (_, index) => (context) => {
        assert.deepEqual(context.tools?.map((tool) => tool.name).sort(), [...names].sort());
        assert.ok(context.tools?.every((tool) => tool.description.includes(`revision ${refreshes}.`)));
        return index % 3 === 2 ? fauxAssistantMessage("Fertig.")
            : fauxAssistantMessage([fauxToolCall(names[index % 3]!, {}, { id: `infrastructure-${index}` })]);
    }));
    try {
        for (const turnId of ["first-turn", "second-turn"]) {
            const result = await manager.runTurn({
                ...requestFor(), workspace: directory, selection, turnId,
                allowedToolNames: ["read"],
                tools: tools(),
                refreshTools: async () => {
                    refreshes++;
                    return { tools: tools(), systemPrompt: `Revision ${refreshes}.` };
                },
                invoke: async (_id, name) => {
                    calls.push(name);
                    return { output: null, ignoredFields: [] };
                },
            }, new AbortController().signal);
            assert.equal(result.failure, null);
        }
        assert.deepEqual(calls, [...names, ...names]);
        assert.ok(refreshes >= 6);
    } finally {
        await manager.shutdown();
        faux.unregister();
        rmSync(directory, { recursive: true, force: true });
    }
});

test("catalog and runtime agree on model reasoning including max and reject off and medium before requests", async () => {
    const directory = mkdtempSync(join(tmpdir(), "ragents-thinking-contract-"));
    const { faux, modelRuntime, selection } = await fauxModelRuntime(directory, "thinking-contract", 0);
    const model = faux.getModel();
    modelRuntime.registerProvider(model.provider, {
        baseUrl: model.baseUrl, apiKey: "faux-key", api: faux.api,
        models: [{ ...model, reasoning: true, thinkingLevelMap: { off: null, minimal: null, medium: null, max: "max" } }],
    });
    let calls = 0;
    faux.setResponses([() => { calls += 1; return fauxAssistantMessage("Antwort"); }]);
    const manager = new AgentRuntimeManager({ modelRuntime });
    const driver = new AgentSessionDriver({ modelRuntime });
    try {
        const entry = (await driver.catalog()).find((entry) => entry.provider === model.provider && entry.model === model.id);
        assert.deepEqual(entry?.thinking, ["low", "high", "max"]);
        assert.deepEqual(await driver.thinkingCapabilities(model.provider, model.id), entry?.thinking);
        const request = { ...requestFor(), workspace: directory, selection: { ...selection, thinking: "off" as const } };
        const rejected = await manager.runTurn(request, new AbortController().signal);
        assert.match(rejected.failure ?? "", /Denktiefe off.*gültig: low, high, max/);
        assert.equal(calls, 0);
        const medium = await manager.runTurn({ ...request, turnId: "invalid-medium", selection: { ...selection, thinking: "medium" } }, new AbortController().signal);
        assert.match(medium.failure ?? "", /Denktiefe medium.*gültig: low, high, max/);
        assert.equal(calls, 0);
        const result = await manager.runTurn({ ...request, turnId: "valid-thinking", selection: { ...selection, thinking: "max" } }, new AbortController().signal);
        assert.equal(result.failure, null);
        assert.equal(calls, 1);
    } finally {
        await manager.shutdown();
        await driver.shutdown();
        faux.unregister();
        rmSync(directory, { recursive: true, force: true });
    }
});

test("The agent runtime nudges a reasoning-only answer once and fails the turn after a second one", async () => {
    const directory = mkdtempSync(join(tmpdir(), "ragents-empty-response-"));
    const { faux, modelRuntime, selection } = await fauxModelRuntime(directory, "empty-response", 0);
    const manager = new AgentRuntimeManager({ modelRuntime });
    const reasoningOnly = () => fauxAssistantMessage([fauxThinking("Noch am Überlegen.")]);
    const outputs: string[] = [];
    faux.setResponses([reasoningOnly, () => fauxAssistantMessage("Fertig."), reasoningOnly, reasoningOnly, () => fauxAssistantMessage("Unerreichbar.")]);
    try {
        const request = { ...requestFor(), workspace: directory, selection, emit: (event: { kind: string; text: string }) => { outputs.push(`${event.kind}: ${event.text}`); } };
        const recovered = await manager.runTurn(request, new AbortController().signal);
        assert.equal(recovered.failure, null);
        assert.deepEqual(outputs, ["reasoning: Noch am Überlegen.", "assistant: Fertig."]);
        outputs.length = 0;
        const failed = await manager.runTurn({ ...request, turnId: "second-turn" }, new AbortController().signal);
        assert.equal(failed.failure, "Modell lieferte zweimal eine leere Antwort.");
        assert.deepEqual(outputs, ["reasoning: Noch am Überlegen.", "reasoning: Noch am Überlegen."]);
    } finally {
        await manager.shutdown();
        faux.unregister();
        rmSync(directory, { recursive: true, force: true });
    }
});

test("A turn whose provider error the session retries successfully does not fail", async () => {
    const directory = mkdtempSync(join(tmpdir(), "ragents-provider-retry-"));
    const { faux, modelRuntime, selection } = await fauxModelRuntime(directory, "provider-retry", 0);
    const manager = new AgentRuntimeManager({ modelRuntime });
    const outputs: string[] = [];
    faux.setResponses([
        () => fauxAssistantMessage([], { stopReason: "error", errorMessage: "503 Service Unavailable" }),
        () => fauxAssistantMessage("Fertig."),
    ]);
    try {
        const request = { ...requestFor(), workspace: directory, selection, emit: (event: { kind: string; text: string }) => { outputs.push(`${event.kind}: ${event.text}`); } };
        const result = await within(manager.runTurn(request, new AbortController().signal), 10_000);
        assert.equal(result.failure, null);
        assert.equal(faux.state.callCount, 2);
        assert.deepEqual(outputs, ["assistant: Fertig."]);
    } finally {
        await manager.shutdown();
        faux.unregister();
        rmSync(directory, { recursive: true, force: true });
    }
});

test("A turn whose context overflow the session compacts and continues does not fail", async () => {
    const directory = mkdtempSync(join(tmpdir(), "ragents-overflow-compaction-"));
    const { faux, modelRuntime, selection } = await fauxModelRuntime(directory, "overflow-compaction", 0);
    const manager = new AgentRuntimeManager({ modelRuntime });
    const outputs: string[] = [];
    const answers = [
        fauxAssistantMessage("Antwort 1."),
        fauxAssistantMessage([], { stopReason: "error", errorMessage: "prompt is too long: 213462 tokens > 200000 maximum" }),
        fauxAssistantMessage("Fertig."),
    ];
    let summaries = 0;
    faux.setResponses(Array.from({ length: 5 }, () => (context) => {
        if (context.systemPrompt?.startsWith("You are a context summarization assistant")) {
            summaries += 1;
            return fauxAssistantMessage("## Goal\nZusammenfassung.");
        }
        const answer = answers.shift();
        assert.ok(answer, "unexpected model request");
        return answer;
    }));
    try {
        const request = { ...requestFor(), workspace: directory, selection, emit: (event: { kind: string; text: string }) => { outputs.push(`${event.kind}: ${event.text}`); } };
        assert.equal((await manager.runTurn(request, new AbortController().signal)).failure, null);
        outputs.length = 0;
        const result = await within(manager.runTurn({ ...request, turnId: "overflow-turn", prompt: "x".repeat(100_000) }, new AbortController().signal), 10_000);
        assert.equal(result.failure, null);
        assert.equal(summaries, 1);
        assert.equal(answers.length, 0);
        assert.deepEqual(outputs, ["assistant: Fertig."]);
    } finally {
        await manager.shutdown();
        faux.unregister();
        rmSync(directory, { recursive: true, force: true });
    }
});

test("A turn whose provider error survives every retry fails with the last error", async () => {
    const directory = mkdtempSync(join(tmpdir(), "ragents-provider-error-"));
    const { faux, modelRuntime, selection } = await fauxModelRuntime(directory, "provider-error", 0);
    const manager = new AgentRuntimeManager({ modelRuntime });
    faux.setResponses([() => fauxAssistantMessage([], { stopReason: "error", errorMessage: "invalid request: unknown parameter" })]);
    try {
        const result = await manager.runTurn({ ...requestFor(), workspace: directory, selection }, new AbortController().signal);
        assert.equal(result.failure, "invalid request: unknown parameter");
    } finally {
        await manager.shutdown();
        faux.unregister();
        rmSync(directory, { recursive: true, force: true });
    }
});

test("Two skills with the same name, say from two plugins, fail the runtime creation and name both", async () => {
    const directory = mkdtempSync(join(tmpdir(), "ragents-duplicate-skills-"));
    const { faux, modelRuntime, selection } = await fauxModelRuntime(directory, "duplicate-skills", 1);
    const skillIn = (plugin: string) => ({
        name: "review",
        description: "Prüft Änderungen.",
        filePath: join(directory, plugin, "review", "SKILL.md"),
        baseDir: join(directory, plugin, "review"),
        disableModelInvocation: false,
    });
    const manager = new AgentRuntimeManager({ modelRuntime, resolveSkills: () => [skillIn("first"), skillIn("second")] });
    try {
        const result = await manager.runTurn({ ...requestFor(), workspace: directory, selection }, new AbortController().signal);
        assert.equal(
            result.failure,
            `Der Skill review ist mehrfach vorhanden: ${skillIn("first").filePath}, ${skillIn("second").filePath}.`,
        );
        assert.equal(faux.state.callCount, 0);
    } finally {
        await manager.shutdown();
        faux.unregister();
        rmSync(directory, { recursive: true, force: true });
    }
});

test("The agent runtime delivers attachment-only images, video and PDF as native model content", async () => {
    const directory = mkdtempSync(join(tmpdir(), "ragents-native-attachments-"));
    const { faux, modelRuntime, selection } = await fauxModelRuntime(directory, "native-attachments", 0, ["text", "image", "video", "file"]);
    const manager = new AgentRuntimeManager({ modelRuntime });
    let received: unknown;
    faux.setResponses([(context) => {
        const content = context.messages.find((message) => message.role === "user")?.content;
        received = Array.isArray(content) ? content.filter((block) => block.type !== "text") : content;
        return fauxAssistantMessage("Dateien angekommen.");
    }]);
    try {
        const content = new Uint8Array([0, 255, 13, 4]);
        const result = await manager.runTurn({
            ...requestFor(), workspace: directory, selection, prompt: "",
            attachments: [
                { name: "photo.png", mediaType: "image/png", content },
                { name: "clip.mp4", mediaType: "video/mp4", content },
                { name: "report.pdf", mediaType: "application/pdf", content },
            ],
        }, new AbortController().signal);
        assert.equal(result.failure, null);
        const data = Buffer.from(content).toString("base64");
        assert.deepEqual(received, [
            { type: "image", data, mimeType: "image/png" },
            { type: "video", data, mimeType: "video/mp4" },
            { type: "file", data, mimeType: "application/pdf", filename: "report.pdf" },
        ]);
    } finally {
        await manager.shutdown();
        faux.unregister();
        rmSync(directory, { recursive: true, force: true });
    }
});

for (const stop of ["signal", "halt"] as const) {
    test(`the agent runtime preserves streamed text once when stopped by ${stop}`, async () => {
        const directory = mkdtempSync(join(tmpdir(), "ragents-partial-output-"));
        const { faux, modelRuntime, selection } = await fauxModelRuntime(directory, `partial-${stop}`, 0);
        faux.setResponses([fauxAssistantMessage("Already visible text that would continue for much longer.")]);
        const manager = new AgentRuntimeManager({ modelRuntime, turnAbortTimeoutMs: 30 });
        const controller = new AbortController();
        const outputs: DriverEvent[] = [];
        const visible: string[] = [];
        let halt: Promise<void> | undefined;
        try {
            const result = await within(manager.runTurn({
                ...requestFor(), workspace: directory, selection,
                emit: (event) => outputs.push(event),
                publish: (event) => {
                    if (event.kind !== "text") return;
                    visible.push(event.delta);
                    if (stop === "halt") halt = manager.haltRun("run-1");
                    else controller.abort();
                },
            }, controller.signal), 3_000);
            await halt;
            assert.match(result.failure ?? "", /aborted/);
            assert.ok(visible.join("").length > 0);
            assert.deepEqual(outputs, [{ kind: "assistant-interrupted", text: visible.join("") }]);
            await manager.shutdown();
            assert.deepEqual(outputs, [{ kind: "assistant-interrupted", text: visible.join("") }]);
        } finally {
            controller.abort();
            await manager.shutdown();
            faux.unregister();
            rmSync(directory, { recursive: true, force: true });
        }
    });
}

test("a turn aborted during a tool call keeps the agent runtime: the next turn continues the same conversation", async () => {
    const directory = mkdtempSync(join(tmpdir(), "ragents-interrupted-turn-"));
    const { faux, modelRuntime, selection } = await fauxModelRuntime(directory, "interrupted-turn", 0);
    const manager = new AgentRuntimeManager({ modelRuntime, turnAbortTimeoutMs: 1_000 });
    const controller = new AbortController();
    const tool = defineRunFunction({
        name: "long_step", label: "Long step", description: "Takes a while.", nativeTool: true,
        schema: Type.Object({}), resultSchema: Type.Null(), available: () => true, run: () => null,
    });
    const userTexts = (context: Context) => context.messages.flatMap((message) => message.role === "user"
        ? [typeof message.content === "string" ? message.content : message.content.map((part) => part.type === "text" ? part.text : "").join("")]
        : []);
    const continued: string[][] = [];
    const answer = (context: Context) => {
        const texts = userTexts(context);
        if (!texts.some((text) => text.includes("Weiter."))) return fauxAssistantMessage("Noch nicht fertig.");
        continued.push(texts);
        return fauxAssistantMessage("Weiter geht es.");
    };
    faux.setResponses([fauxAssistantMessage([fauxToolCall("long_step", {}, { id: "long" })], { stopReason: "toolUse" }), answer, answer]);
    const outputs: DriverEvent[] = [];
    try {
        const interrupted = await within(manager.runTurn({
            ...requestFor(), workspace: directory, selection, tools: [tool],
            invoke: () => new Promise((_resolve, reject) => {
                controller.signal.addEventListener("abort", () => reject(new Error("Werkzeug abgebrochen.")), { once: true });
                controller.abort();
            }),
        }, controller.signal), 3_000);
        assert.match(interrupted.failure ?? "", /aborted/);
        assert.equal(faux.state.callCount, 1, "nach dem Abbruch im Werkzeug fragt die Schleife das Modell nicht noch einmal an");
        const next = await within(manager.runTurn({
            ...requestFor(), workspace: directory, selection, tools: [tool], turnId: "turn-3", prompt: "Weiter.",
            emit: (event) => outputs.push(event),
        }, new AbortController().signal), 3_000);
        assert.equal(next.failure, null);
        assert.deepEqual(outputs, [{ kind: "assistant", text: "Weiter geht es." }]);
        assert.ok(continued[0]?.some((text) => text.includes("Original input.")), "der erste Auftrag bleibt im Gespräch");
    } finally {
        controller.abort();
        await manager.shutdown();
        faux.unregister();
        rmSync(directory, { recursive: true, force: true });
    }
});

test("an abort while a context hook still runs sends no model request once the hook returns", async () => {
    const directory = mkdtempSync(join(tmpdir(), "ragents-abort-in-hook-"));
    const { faux, modelRuntime, selection } = await fauxModelRuntime(directory, "abort-in-hook", 1);
    const controller = new AbortController();
    const hookEntered = Promise.withResolvers<void>();
    const hookRelease = Promise.withResolvers<void>();
    const hookReturned = Promise.withResolvers<void>();
    const extension: InlineExtension = (agent) => {
        agent.on("context", async () => {
            hookEntered.resolve();
            await hookRelease.promise;
            hookReturned.resolve();
        });
    };
    const manager = new AgentRuntimeManager({ modelRuntime, extensionFactories: [extension], turnAbortTimeoutMs: 30 });
    try {
        const turn = manager.runTurn({ ...requestFor(), workspace: directory, selection }, controller.signal);
        await within(hookEntered.promise);
        controller.abort();
        hookRelease.resolve();
        assert.match((await within(turn)).failure ?? "", /aborted/);
        await within(hookReturned.promise);
        await within(manager.waitForRunSettlement("run-1") ?? Promise.resolve());
        await new Promise((resolve) => setTimeout(resolve, 20));
        assert.equal(faux.state.callCount, 0);
    } finally {
        controller.abort();
        hookRelease.resolve();
        await manager.shutdown();
        faux.unregister();
        rmSync(directory, { recursive: true, force: true });
    }
});

for (const stopDuring of ["tool", "next-message", "thinking"] as const) {
    test(`stopping during ${stopDuring} preserves only the unfinished message text`, async () => {
        const directory = mkdtempSync(join(tmpdir(), "ragents-partial-boundary-"));
        const { faux, modelRuntime, selection } = await fauxModelRuntime(directory, `partial-boundary-${stopDuring}`, 0);
        const manager = new AgentRuntimeManager({ modelRuntime });
        const controller = new AbortController();
        const outputs: DriverEvent[] = [];
        const visible: string[] = [];
        const first = "Completed message.";
        const tool = defineRunFunction({
            name: "next_step", label: "Next step", description: "Continue the task.", nativeTool: true,
            schema: Type.Object({}), resultSchema: Type.Null(), available: () => true, run: () => null,
        });
        faux.setResponses(stopDuring === "thinking"
            ? [fauxAssistantMessage([fauxThinking("Reasoning before any answer."), fauxText("Unseen answer.")])]
            : [
                fauxAssistantMessage([fauxText(first), fauxToolCall("next_step", {}, { id: "step" })], { stopReason: "toolUse" }),
                fauxAssistantMessage("The unfinished next message keeps going."),
            ]);
        try {
            await within(manager.runTurn({
                ...requestFor(), workspace: directory, selection, tools: [tool],
                emit: (event) => outputs.push(event),
                invoke: async () => {
                    if (stopDuring === "tool") controller.abort();
                    return { output: null, ignoredFields: [] };
                },
                publish: (event) => {
                    if (event.kind === "thinking" && stopDuring === "thinking") controller.abort();
                    if (event.kind !== "text" || outputs.length === 0) return;
                    visible.push(event.delta);
                    controller.abort();
                },
            }, controller.signal), 3_000);
            assert.deepEqual(outputs, stopDuring === "thinking" ? [] : [
                { kind: "assistant", text: first },
                ...(stopDuring === "next-message" ? [{ kind: "assistant-interrupted", text: visible.join("") }] : []),
            ]);
        } finally {
            controller.abort();
            await manager.shutdown();
            faux.unregister();
            rmSync(directory, { recursive: true, force: true });
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
    const unavailable = Promise.reject(new Error("agent setup unavailable."));
    const manager = new AgentRuntimeManager({ modelRuntime: unavailable });
    const result = await manager.runTurn(requestFor(), new AbortController().signal);

    assert.equal(result.failure, "agent setup unavailable.");
});

test("The agent runtime run halt aborts a hanging extension factory during runtime creation", async () => {
    const directory = mkdtempSync(join(tmpdir(), "ragents-agent-factory-abort-"));
    let creationSignal: AbortSignal | undefined;
    let extensionApi: ExtensionAPI | undefined;
    let lateApiError: unknown;
    let lateEffect = false;
    let markStarted: () => void = () => undefined;
    let releaseFactory: () => void = () => undefined;
    const started = new Promise<void>((resolveStarted) => {
        markStarted = resolveStarted;
    });
    const factoryRelease = new Promise<void>((resolveFactory) => {
        releaseFactory = resolveFactory;
    });
    const extension: InlineExtension = async (agent, context) => {
        extensionApi = agent;
        creationSignal = context.signal;
        markStarted();
        await factoryRelease;

        try {
            agent.getAllTools();
            lateEffect = true;
        } catch (error) {
            lateApiError = error;
        }
    };

    try {
        const modelRuntime = ModelRuntime.create();
        const manager = new AgentRuntimeManager({
            modelRuntime,
            extensionFactories: [extension],
        });
        const request = { ...requestFor(), workspace: directory };
        const turn = manager.runTurn(request, new AbortController().signal);

        await within(started);
        await within(manager.haltRun(request.runId));
        const result = await within(turn);
        const settlement = manager.waitForRunSettlement(request.runId);

        assert.equal(creationSignal?.aborted, true);
        assert.throws(() => extensionApi?.getAllTools(), /Extension creation was aborted/);
        assert.match(result.failure ?? "", /stopping/);
        assert.ok(settlement);

        let settled = false;
        void settlement.then(() => {
            settled = true;
        });
        await new Promise<void>((resolveImmediate) => setImmediate(resolveImmediate));
        assert.equal(settled, false);

        releaseFactory();
        await within(settlement);
        assert.equal(lateEffect, false);
        assert.match(lateApiError instanceof Error ? lateApiError.message : String(lateApiError), /Extension creation was aborted/);
        await manager.shutdown();
    } finally {
        releaseFactory();
        rmSync(directory, { recursive: true, force: true });
    }
});

test("The agent runtime manager shutdown waits beyond the turn deadline for a hanging hook", async () => {
    const directory = mkdtempSync(join(tmpdir(), "ragents-agent-global-shutdown-settlement-"));
    const release = deferred();
    const started = deferred();
    const extension: InlineExtension = (agent) => {
        agent.on("context", async () => {
            started.resolve();
            await release.promise;
        });
    };

    try {
        const { modelRuntime, selection } = await fauxModelRuntime(directory, "global-shutdown", 1);
        const manager = new AgentRuntimeManager({
            modelRuntime,
            extensionFactories: [extension],
            turnAbortTimeoutMs: 30,
        });
        const turn = manager.runTurn({ ...requestFor(), workspace: directory, selection }, new AbortController().signal);
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
        rmSync(directory, { recursive: true, force: true });
    }
});

test("The agent runtime halt quarantines a turn whose extension callback ignores abort", async () => {
    const directory = mkdtempSync(join(tmpdir(), "ragents-agent-turn-abort-deadline-"));
    const faux = registerFauxProvider({ models: [{ id: "abort-deadline", reasoning: false }] });
    faux.setResponses([fauxAssistantMessage("Late answer that nobody sees.")]);
    const controller = new AbortController();
    let manager: AgentRuntimeManager | undefined;
    let extensionApi: ExtensionAPI | undefined;
    let lateApiError: unknown;
    let markStarted: () => void = () => undefined;
    let releaseInput: () => void = () => undefined;
    const started = new Promise<void>((resolveStarted) => {
        markStarted = resolveStarted;
    });
    const inputRelease = new Promise<void>((resolveInput) => {
        releaseInput = resolveInput;
    });
    const extension: InlineExtension = (agent) => {
        extensionApi = agent;
        agent.on("context", async () => {
            markStarted();
            await inputRelease;

            try {
                agent.getAllTools();
            } catch (error) {
                lateApiError = error;
            }

            throw new Error("Late hook failure.");
        });
    };
    const emitted: unknown[] = [];
    const published: unknown[] = [];

    try {
        const modelRuntime = ModelRuntime.create();
        const model = faux.getModel();
        modelRuntime.registerProvider(model.provider, {
            baseUrl: model.baseUrl,
            apiKey: "faux-key",
            api: faux.api,
            models: faux.models.map((entry) => ({
                id: entry.id,
                name: entry.name,
                api: entry.api,
                reasoning: entry.reasoning,
                input: entry.input,
                cost: entry.cost,
                contextWindow: entry.contextWindow,
                maxTokens: entry.maxTokens,
                baseUrl: entry.baseUrl,
            })),
        });
        manager = new AgentRuntimeManager({
            modelRuntime,
            extensionFactories: [extension],
            turnAbortTimeoutMs: 30,
        });
        const request = {
            ...requestFor(),
            workspace: directory,
            selection: { provider: model.provider, model: model.id },
            emit: (event: Parameters<TurnRequest["emit"]>[0]) => emitted.push(event),
            publish: (event: Parameters<TurnRequest["publish"]>[0]) => published.push(event),
        };
        const turn = manager.runTurn(request, controller.signal);

        await within(started);
        const halt = manager.haltRun(request.runId);
        const result = await within(turn);
        await within(halt);
        const settlement = manager.waitForRunSettlement(request.runId);

        assert.match(result.failure ?? "", /aborted/);
        assert.ok(settlement);
        assert.throws(() => extensionApi?.getAllTools(), /stale/);

        let settled = false;
        void settlement.then(() => {
            settled = true;
        });
        await new Promise<void>((resolveImmediate) => setImmediate(resolveImmediate));
        assert.equal(settled, false);

        releaseInput();
        await within(settlement);
        await new Promise<void>((resolveImmediate) => setImmediate(resolveImmediate));
        assert.match(lateApiError instanceof Error ? lateApiError.message : String(lateApiError), /stale/);
        assert.deepEqual(emitted, []);
        assert.deepEqual(published, []);
    } finally {
        controller.abort(new Error("Test cleanup."));
        releaseInput();
        await manager?.shutdown().catch(() => undefined);
        faux.unregister();
        rmSync(directory, { recursive: true, force: true });
    }
});

test("The agent runtime halt disposes its extensions but allows the run to create a fresh runtime", async () => {
    const directory = mkdtempSync(join(tmpdir(), "ragents-agent-halt-"));
    const apis: ExtensionAPI[] = [];
    const extension: InlineExtension = (agent) => {
        apis.push(agent);
    };

    try {
        const { modelRuntime, selection } = await fauxModelRuntime(directory, "halt-fresh", 2);
        const manager = new AgentRuntimeManager({
            modelRuntime,
            extensionFactories: [extension],
        });
        const request = { ...requestFor(), workspace: directory, selection };

        await manager.runTurn(request, new AbortController().signal);
        await manager.haltRun(request.runId);
        assert.equal(apis.length, 1);
        assert.throws(() => apis[0]!.getAllTools(), /stale/);
        await manager.runTurn({ ...request, turnId: "turn-3" }, new AbortController().signal);
        await manager.disposeRun(request.runId);

        assert.equal(apis.length, 2);
        assert.throws(() => apis[1]!.getAllTools(), /stale/);
        await assert.rejects(
            manager.runTurn({ ...request, turnId: "turn-4" }, new AbortController().signal),
            /has been retired/,
        );
    } finally {
        rmSync(directory, { recursive: true, force: true });
    }
});

test("The agent session directory is created with the configured mode and never adopts a stray session file", async () => {
    const directory = mkdtempSync(join(tmpdir(), "ragents-agent-session-store-"));
    const chatDirectory = join(directory, "chat", "agent-1");
    const stray = join(directory, "chat", "agent-1", "stray.jsonl");
    const faux = registerFauxProvider({ models: [{ id: "session-store", reasoning: false }] });
    faux.setResponses([fauxAssistantMessage("Answer.")]);
    let manager: AgentRuntimeManager | undefined;

    try {
        const modelRuntime = ModelRuntime.create();
        const model = faux.getModel();
        modelRuntime.registerProvider(model.provider, {
            baseUrl: model.baseUrl,
            apiKey: "faux-key",
            api: faux.api,
            models: faux.models.map((entry) => ({
                id: entry.id,
                name: entry.name,
                api: entry.api,
                reasoning: entry.reasoning,
                input: entry.input,
                cost: entry.cost,
                contextWindow: entry.contextWindow,
                maxTokens: entry.maxTokens,
                baseUrl: entry.baseUrl,
            })),
        });
        mkdirSync(chatDirectory, { recursive: true, mode: 0o755 });
        writeFileSync(stray, "");
        manager = new AgentRuntimeManager({
            modelRuntime,
            sessions: {
                directory: (_runId, agentId) => join(directory, "chat", agentId),
                directoryMode: 0o700,
            },
        });
        const request = {
            ...requestFor(),
            workspace: directory,
            selection: { provider: model.provider, model: model.id },
        };

        await manager.runTurn(request, new AbortController().signal);

        assert.equal(statSync(chatDirectory).mode & 0o777, 0o700);
        const marker = JSON.parse(readFileSync(join(chatDirectory, "active-session.json"), "utf8")) as { file: string };
        assert.match(marker.file, /^ragents-.*\.jsonl$/);
    } finally {
        await manager?.shutdown();
        rmSync(directory, { recursive: true, force: true });
    }
});

test("forkableBranch keeps the source branch up to its last answered tool call and drops reasoning", () => {
    const message = (id: string, parentId: string | null, message: unknown) => ({ type: "message", id, parentId, timestamp: "now", message });
    const branch = [
        message("u1", null, { role: "user", content: "Analysiere", timestamp: 1 }),
        message("a1", "u1", { role: "assistant", content: [fauxThinking("privat"), fauxText("Ich lese."), fauxToolCall("bash", { command: "ls" }, { id: "call-1" })], stopReason: "toolUse", timestamp: 2 }),
        message("t1", "a1", { role: "toolResult", toolCallId: "call-1", toolName: "bash", content: [fauxText("src")], isError: false, timestamp: 3 }),
        message("a2", "t1", { role: "assistant", content: [fauxText("Start."), fauxToolCall("implementation_start", {}, { id: "call-2" })], stopReason: "toolUse", timestamp: 4 }),
    ] as unknown as import("@ragents/agent").SessionEntry[];

    const kept = forkableBranch(branch);

    assert.deepEqual(kept.map((entry) => entry.id), ["u1", "a1", "t1"]);
    const first = kept[1];
    assert.ok(first?.type === "message" && first.message.role === "assistant");
    assert.deepEqual(first.message.content.map((block) => block.type), ["text", "toolCall"]);
});

test("A forked agent starts its first turn with the source agent's context", async () => {
    const directory = mkdtempSync(join(tmpdir(), "ragents-agent-fork-"));
    const faux = registerFauxProvider({ models: [{ id: "fork", reasoning: false }] });
    const contexts: { messages: unknown[] }[] = [];
    let manager: AgentRuntimeManager | undefined;

    try {
        const modelRuntime = ModelRuntime.create();
        const model = faux.getModel();
        modelRuntime.registerProvider(model.provider, {
            baseUrl: model.baseUrl, apiKey: "faux-key", api: faux.api,
            models: faux.models.map((entry) => ({ id: entry.id, name: entry.name, api: entry.api, reasoning: entry.reasoning, input: entry.input, cost: entry.cost, contextWindow: entry.contextWindow, maxTokens: entry.maxTokens, baseUrl: entry.baseUrl })),
        });
        const lookup = defineRunFunction({
            name: "lookup", label: "lookup", description: "Nachschlagen.", nativeTool: true,
            schema: Type.Object({}, { additionalProperties: false }), resultSchema: Type.String(),
            available: () => true, run: () => "",
        });
        manager = new AgentRuntimeManager({
            modelRuntime,
            sessions: { directory: (_runId, agentId) => join(directory, "chat", agentId), directoryMode: 0o700 },
        });
        faux.setResponses([
            () => fauxAssistantMessage([fauxThinking("nachsehen"), fauxToolCall("lookup", {}, { id: "look" })]),
            () => fauxAssistantMessage("Analyse fertig."),
            (context) => { contexts.push({ messages: structuredClone(context.messages) }); return fauxAssistantMessage("Ich setze um."); },
        ]);
        const base = { ...requestFor(), workspace: directory, selection: { provider: model.provider, model: model.id }, tools: [lookup], allowedToolNames: ["lookup"], invoke: async () => ({ output: "Recht TREND_DELETE_ARCHIVES ist auskommentiert", ignoredFields: [] }) };

        await manager.runTurn({ ...base, agentId: "coordinator", prompt: "Analysiere den Auftrag." }, new AbortController().signal);
        await manager.runTurn({ ...base, agentId: "implementer", forkOf: "coordinator", turnId: "turn-3", prompt: "Setze um.", systemPrompt: "Implementierer." }, new AbortController().signal);

        const marker = JSON.parse(readFileSync(join(directory, "chat", "implementer", "active-session.json"), "utf8")) as { file: string };
        const lines = readFileSync(join(directory, "chat", "implementer", marker.file), "utf8").trim().split("\n").map((line) => JSON.parse(line) as Record<string, unknown>);
        assert.match(String(lines[0]!.parentSession), /chat\/coordinator\/ragents-.*\.jsonl$/);
        const history = JSON.stringify(contexts[0]!.messages);
        assert.match(history, /Analysiere den Auftrag/);
        assert.match(history, /TREND_DELETE_ARCHIVES/);
        assert.match(history, /Analyse fertig/);
        assert.match(history, /Setze um/);
        assert.doesNotMatch(history, /nachsehen/);
    } finally {
        await manager?.shutdown();
        rmSync(directory, { recursive: true, force: true });
    }
});

test("a stored session opens with its context in another runtime directory, as after a run move", async () => {
    const directory = mkdtempSync(join(tmpdir(), "ragents-moved-session-"));
    const [before, after] = ["before", "after"].map((name) => join(directory, name));
    mkdirSync(before!);
    mkdirSync(after!);
    const { faux, modelRuntime, selection } = await fauxModelRuntime(directory, "moved-session", 0);
    const seen: string[][] = [];
    faux.setResponses([1, 2].map((index) => (context) => {
        seen.push(context.messages.map((message) => message.role));
        return fauxAssistantMessage(`Antwort ${index}.`);
    }));
    const store = { directory: (_runId: string, agentId: string) => join(directory, "chat", agentId), directoryMode: 0o700 };
    const request = { ...requestFor(), workspace: directory, selection };
    try {
        const first = new AgentRuntimeManager({ modelRuntime, sessions: store });
        try {
            assert.equal((await first.runTurn({ ...request, runtimeDirectory: () => Promise.resolve(before!) }, new AbortController().signal)).failure, null);
        } finally {
            await first.shutdown();
        }
        const second = new AgentRuntimeManager({ modelRuntime, sessions: store });
        try {
            const result = await second.runTurn({ ...request, turnId: "turn-3", runtimeDirectory: () => Promise.resolve(after!) }, new AbortController().signal);
            assert.equal(result.failure, null);
        } finally {
            await second.shutdown();
        }
        assert.deepEqual(seen, [["user"], ["user", "assistant", "user"]]);
    } finally {
        faux.unregister();
        rmSync(directory, { recursive: true, force: true });
    }
});

test("the runtime adds no path of its own to the system prompt and keeps its session in its own folder", async () => {
    const directory = mkdtempSync(join(tmpdir(), "ragents-remote-workspace-"));
    const runtimeDirectory = join(directory, "server");
    mkdirSync(runtimeDirectory);
    const workspace = join(directory, "only-on-the-workstation", "project");
    const { faux, modelRuntime, selection } = await fauxModelRuntime(directory, "remote-workspace", 0);
    const prompts: string[] = [];
    faux.setResponses([1, 2].map(() => (context) => {
        prompts.push(context.systemPrompt ?? "");
        return fauxAssistantMessage("Erledigt.");
    }));
    const store = { directory: (_runId: string, agentId: string) => join(directory, "chat", agentId), directoryMode: 0o700 };
    const request = { ...requestFor(), workspace, selection, runtimeDirectory: () => Promise.resolve(runtimeDirectory) };
    const first = new AgentRuntimeManager({ modelRuntime, sessions: store });
    try {
        assert.equal((await first.runTurn(request, new AbortController().signal)).failure, null);
        await first.shutdown();
        const second = new AgentRuntimeManager({ modelRuntime, sessions: store });
        try {
            assert.equal((await second.runTurn({ ...request, turnId: "turn-3" }, new AbortController().signal)).failure, null);
        } finally {
            await second.shutdown();
        }
        assert.equal(prompts.length, 2);
        assert.ok(prompts.every((prompt) => prompt === request.systemPrompt));
        const stored = JSON.parse(readFileSync(join(directory, "chat", "agent-1", "active-session.json"), "utf8")) as { file: string };
        const header = JSON.parse(readFileSync(join(directory, "chat", "agent-1", stored.file), "utf8").split("\n")[0]!) as { cwd: string };
        assert.equal(header.cwd, runtimeDirectory);
    } finally {
        await first.shutdown();
        faux.unregister();
        rmSync(directory, { recursive: true, force: true });
    }
});
