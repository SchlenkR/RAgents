import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { Type } from "typebox";

import { ModelRuntime, type AgentMessage } from "@ragents/agent";
import {
    fauxAssistantMessage,
    fauxText,
    fauxThinking,
    fauxToolCall,
    registerFauxProvider,
    type Context,
    type FauxResponseStep,
} from "@ragents/ai";

import { resolveExecution, StaticModelCatalog, type CatalogModel } from "../src/agents/catalog.ts";
import { modelContextOf } from "../src/agents/model-context.ts";
import { ToolRegistry } from "../src/agents/plugins.ts";
import { TurnScheduler } from "../src/agents/scheduler.ts";
import { defineRunFunction, type RunFunction } from "../src/agents/tools.ts";
import type { Workspaces } from "../src/agents/workspaces.ts";
import { thinkingLevels } from "../src/domain/driver.ts";
import type { JsonValue } from "../src/domain/json.ts";
import type { CompletedModelStep } from "../src/runtime/decisions/turns.ts";
import { agentHookOf } from "../src/drivers/agent-hooks.ts";
import { AgentLoopDriver } from "../src/drivers/agent.ts";
import type { AgentContribution } from "../src/plugin-types.ts";
import { Journal } from "../src/runtime/journal.ts";
import { Orchestration } from "../src/runtime/orchestration.ts";
import { allGrants, deferred, testServices } from "./support.ts";

const attachmentWorkspaces = (directory: string): Workspaces => ({
    ensure: () => directory,
    description: () => undefined,
    storeAttachment: async (_runId, name, content) => {
        mkdirSync(join(directory, "attachments"), { recursive: true });
        writeFileSync(join(directory, "attachments", name), content);
        return name;
    },
});

type Harness = {
    runtime: Orchestration;
    journal: Journal;
    runId: string;
    ownerId: string;
    faux: ReturnType<typeof registerFauxProvider>;
    scheduler: TurnScheduler;
    driver: AgentLoopDriver;
    directory: string;
    spawn: (handle: string, options?: { forkOf?: string; toolNames?: string[] | null }) => string;
    post: (actorId: string, content: string, artifactIds?: string[]) => void;
    publish: (title: string, mediaType: string, content: Uint8Array | string) => string;
};

const harness = (
    name: string,
    options: {
        tools?: RunFunction[];
        hooks?: AgentContribution[];
        contextWindow?: number;
        compaction?: { reserveTokens: number; keepRecentTokens: number };
        tokensPerSecond?: number;
    } = {},
): Harness => {
    const directory = mkdtempSync(join(tmpdir(), `ragents-context-${name}-`));
    const faux = registerFauxProvider({
        api: "faux-context",
        models: [{ id: `context-${name}`, reasoning: false, input: ["text", "image"], contextWindow: options.contextWindow ?? 128_000 }],
        tokensPerSecond: options.tokensPerSecond ?? 1_000_000,
    });
    const modelRuntime = ModelRuntime.create();
    const model = faux.getModel();
    modelRuntime.registerProvider(model.provider, {
        baseUrl: model.baseUrl, apiKey: "faux-key", api: faux.api,
        models: faux.models.map((entry) => ({
            id: entry.id, name: entry.name, api: entry.api, reasoning: entry.reasoning, input: entry.input,
            cost: entry.cost, contextWindow: entry.contextWindow, maxTokens: entry.maxTokens, baseUrl: entry.baseUrl,
        })),
    });
    const models: CatalogModel[] = [{ driver: "agent", provider: model.provider, model: model.id, label: model.id, thinking: thinkingLevels }];
    const catalog = new StaticModelCatalog(models, [{
        name: "agent", description: "Faux", driver: "agent", provider: model.provider, model: model.id,
        turnTimeoutMs: 600_000, isolateWorkspace: false,
    }]);
    const services = testServices();
    const journal = new Journal(join(directory, "runs"), services);
    const runtime = new Orchestration(journal, services);
    const run = runtime.createRun({ commandId: "create" }, { title: name, ownerHandle: "owner", ownerDisplayName: "Owner" });
    const driver = new AgentLoopDriver({
        modelRuntime,
        ...(options.hooks ? {
            resolveHooks: (context) => options.hooks!.map((hook) => agentHookOf(hook, { ...context, audience: "agent" })),
        } : {}),
        ...(options.compaction ? { settings: { compaction: options.compaction } } : {}),
    });
    const tools = options.tools ?? [];
    const registry = new ToolRegistry().register({ name: "tools", dynamic: true, descriptors: [], tools: () => tools });
    const scheduler = new TurnScheduler(runtime, journal, {
        drivers: { agent: driver }, catalog, registry, workspaces: attachmentWorkspaces(directory),
    });
    let commands = 0;

    return {
        runtime, journal, runId: run.id, ownerId: run.ownerId, faux, scheduler, driver, directory,
        spawn: (handle, spawnOptions = {}) => runtime.spawnAgent({ actorId: run.ownerId, commandId: `spawn-${handle}` }, run.id, {
            handle, displayName: handle, prompt: `Du bist ${handle}.`,
            execution: resolveExecution(catalog, { profile: "agent", isolateWorkspace: false }, handle, models),
            grants: allGrants(), toolNames: spawnOptions.toolNames === undefined ? tools.map((tool) => tool.name) : spawnOptions.toolNames,
            ...(spawnOptions.forkOf ? { forkOf: spawnOptions.forkOf } : {}),
        }).actors.find((actor) => actor.handle === handle)!.id,
        post: (actorId, content, artifactIds) => {
            runtime.enqueueInput({ actorId: run.ownerId, commandId: `post-${++commands}` }, run.id, {
                actorId, content, ...(artifactIds ? { artifactIds } : {}),
            });
        },
        publish: (title, mediaType, content) => runtime.publishArtifact({ actorId: run.ownerId, commandId: `publish-${++commands}` }, run.id, {
            title, mediaType, content, previousVersionId: null,
        }).artifacts.at(-1)!.id,
    };
};

const close = async (setup: Harness) => {
    await setup.scheduler.stop();
    await setup.driver.shutdown().catch(() => undefined);
    setup.faux.unregister();
    setup.journal.close();
    rmSync(setup.directory, { recursive: true, force: true });
};

const withoutTimestamps = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(withoutTimestamps);
    if (!value || typeof value !== "object") return value;
    return Object.fromEntries(Object.entries(value)
        .filter(([key, entry]) => key !== "timestamp" && key !== "details" && entry !== undefined)
        .map(([key, entry]) => [key, withoutTimestamps(entry)]));
};

const projectedContextOf = (setup: Harness, actorId: string): AgentMessage[] =>
    [...modelContextOf(setup.runtime.events(setup.runId), actorId, (hash) => setup.runtime.mediaContent(hash)).messages];

const goldenPath = join(import.meta.dirname, "fixtures", "model-context-golden.json");
const golden = JSON.parse(readFileSync(goldenPath, "utf8")) as Record<string, unknown>;

const goldenFormOf = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(goldenFormOf);
    if (!value || typeof value !== "object") return value;
    return Object.fromEntries(Object.entries(value)
        .filter(([key, entry]) => key !== "timestamp" && key !== "usage" && entry !== undefined)
        .map(([key, entry]) => [key, goldenFormOf(entry)]));
};

/** Expected contexts from the replaced agent sessions, `fork/*` from the finished-turn copy; held and full projection must agree byte by byte. */
const assertGolden = (setup: Harness, actorId: string) => {
    const projected = projectedContextOf(setup, actorId);
    const view = setup.runtime.view(setup.runId);
    const key = `${view.title}/${view.actors.find((actor) => actor.id === actorId)!.handle}`;
    assert.deepEqual(goldenFormOf(JSON.parse(JSON.stringify(projected))), golden[key], `model context ${key}`);
    const full = modelContextOf(setup.runtime.events(setup.runId), actorId, (hash) => setup.runtime.mediaContent(hash));
    assert.equal(JSON.stringify(setup.runtime.modelContext(setup.runId, actorId)), JSON.stringify(full), `held model context ${key}`);
    return projected;
};

const tool = (name: string, run: () => JsonValue | Promise<JsonValue> = () => `${name} fertig`): RunFunction => defineRunFunction({
    name, label: name, description: `Werkzeug ${name}.`, nativeTool: true,
    schema: Type.Object({ value: Type.Optional(Type.String()) }, { additionalProperties: false }),
    resultSchema: Type.Unknown(), available: () => true, run,
}) as RunFunction;

const run = async (setup: Harness, responses: FauxResponseStep[], body: () => Promise<void>) => {
    setup.faux.setResponses(responses);
    setup.scheduler.start();
    await body();
    await setup.scheduler.waitForIdle();
};

test("model context: steps with thinking, text, parallel tool calls, a second turn and a structured output", async () => {
    const setup = harness("steps", { tools: [tool("lookup"), tool("count", () => ({ total: 3, items: ["a", null] }))] });
    try {
        const worker = setup.spawn("worker");
        await run(setup, [
            fauxAssistantMessage([fauxThinking("Ich prüfe zuerst."), fauxText("Ich sehe nach.\n"), fauxToolCall("lookup", { value: "x" }, { id: "call-1" }), fauxToolCall("count", {}, { id: "call-2" })], { stopReason: "toolUse" }),
            fauxAssistantMessage([fauxText("  Beides gefunden.  ")]),
            fauxAssistantMessage([fauxText("Zweiter Turn.")]),
        ], async () => {
            setup.post(worker, "Erster Auftrag.");
            await setup.scheduler.waitForIdle();
            setup.post(worker, "Zweiter Auftrag.");
        });
        const projected = assertGolden(setup, worker);
        assert.deepEqual(projected.map((message) => message.role), ["user", "assistant", "toolResult", "toolResult", "assistant", "user", "assistant"]);
    } finally {
        await close(setup);
    }
});

test("model context: steering after a tool result and the nudge after an empty answer", async () => {
    const started = deferred();
    const release = deferred();
    const setup = harness("steering", { tools: [tool("wait_tool", async () => { started.resolve(); await release.promise; return "gewartet"; })] });
    try {
        const worker = setup.spawn("worker");
        await run(setup, [
            fauxAssistantMessage([fauxToolCall("wait_tool", {}, { id: "wait" })], { stopReason: "toolUse" }),
            fauxAssistantMessage([fauxThinking("nur gedacht")]),
            fauxAssistantMessage([fauxText("Jetzt mit Antwort.")]),
        ], async () => {
            setup.post(worker, "Baue die Seite.");
            await started.promise;
            setup.post(worker, "Nimm Blau.");
            release.resolve();
        });
        const projected = assertGolden(setup, worker);
        assert.deepEqual(projected.map((message) => message.role), ["user", "assistant", "toolResult", "user", "assistant", "user", "assistant"]);
    } finally {
        await close(setup);
    }
});

test("model context: an unknown tool and a schema violation fail before running and stay in the context", async () => {
    const setup = harness("rejected", { tools: [tool("lookup")] });
    try {
        const worker = setup.spawn("worker");
        await run(setup, [
            fauxAssistantMessage([fauxToolCall("missing_tool", {}, { id: "unknown" }), fauxToolCall("lookup", { value: 3 }, { id: "invalid" })], { stopReason: "toolUse" }),
            fauxAssistantMessage([fauxText("Korrigiert.")]),
        ], async () => setup.post(worker, "Los."));
        assertGolden(setup, worker);
    } finally {
        await close(setup);
    }
});

test("model context: a provider error the runtime retries and an interrupted turn", async () => {
    const setup = harness("retry", { tokensPerSecond: 2_000 });
    try {
        const worker = setup.spawn("worker", { toolNames: [] });
        let abort: (() => void) | undefined;
        await run(setup, [
            fauxAssistantMessage([], { stopReason: "error", errorMessage: "503 Service Unavailable" }),
            fauxAssistantMessage([fauxText("Nach dem Wiederholen.")]),
            () => {
                setTimeout(() => abort?.(), 30);
                return fauxAssistantMessage([fauxText("Das wird abgebrochen und sehr lang ".repeat(40))]);
            },
            fauxAssistantMessage([fauxText("Weiter nach der Unterbrechung.")]),
        ], async () => {
            setup.post(worker, "Erster.");
            await setup.scheduler.waitForIdle();
            abort = () => void setup.scheduler.interruptTurn(setup.runId, worker, { context: { actorId: setup.ownerId, commandId: "interrupt" }, reason: "Test" });
            setup.post(worker, "Zweiter.");
            await setup.scheduler.waitForIdle();
            setup.post(worker, "Dritter.");
        });
        const types = setup.runtime.events(setup.runId).map((event) => event.type);
        assert.ok(types.includes("model.output.interrupted"), "der zweite Turn bricht mitten im Strom ab");
        assert.deepEqual(setup.runtime.view(setup.runId).turns.map((turn) => turn.status), ["completed", "interrupted", "completed"]);
        const steps = setup.runtime.events(setup.runId).filter((event) => event.type === "model.step.completed");
        assert.deepEqual(steps.map((event) => event.type === "model.step.completed" ? event.payload.stopReason : ""), ["error", "stop", "stop"]);
        assertGolden(setup, worker);
    } finally {
        await close(setup);
    }
});

test("model context: an abort in the middle of a parallel tool batch keeps the presented results and leaves the rest to the request's synthetic results", async () => {
    let abort: (() => void) | undefined;
    const slow = defineRunFunction({
        name: "slow", label: "slow", description: "Werkzeug slow.", nativeTool: true,
        schema: Type.Object({}, { additionalProperties: false }), resultSchema: Type.Unknown(), available: () => true,
        run: (scope) => new Promise<JsonValue>((_resolve, reject) => {
            scope.signal?.addEventListener("abort", () => reject(new Error("abgebrochen")), { once: true });
            setTimeout(() => abort?.(), 20);
        }),
    }) as RunFunction;
    const setup = harness("batch-abort", { tools: [tool("fast"), slow, tool("quick")] });
    try {
        const worker = setup.spawn("worker");
        abort = () => void setup.scheduler.interruptTurn(setup.runId, worker, { context: { actorId: setup.ownerId, commandId: "interrupt" }, reason: "Test" });
        let seen: Context | undefined;
        await run(setup, [
            fauxAssistantMessage([fauxToolCall("fast", {}, { id: "call-fast" }), fauxToolCall("slow", {}, { id: "call-slow" }), fauxToolCall("quick", {}, { id: "call-quick" })], { stopReason: "toolUse" }),
            (context: Context) => { seen = context; return fauxAssistantMessage([fauxText("Weiter.")]); },
        ], async () => {
            setup.post(worker, "Alles zugleich.");
            await setup.scheduler.waitForIdle();
            setup.post(worker, "Und jetzt?");
        });
        assert.deepEqual(setup.runtime.view(setup.runId).turns.map((turn) => turn.status), ["interrupted", "completed"]);
        const presented = setup.runtime.events(setup.runId).flatMap((event) => event.type === "model.tool-result.presented" ? [event.payload.toolCallId] : []);
        assert.ok(presented.includes("call-fast") && !presented.includes("call-slow"), `teilweise präsentiert: ${presented.join(", ")}`);
        const roles = seen!.messages.map((message) => message.role);
        const results = seen!.messages.flatMap((message) => message.role === "toolResult" ? [message.toolCallId] : []);
        assert.deepEqual(results, presented, "the model context holds exactly the presented results; transform-messages answers the others");
        assert.deepEqual(roles.slice(-2 - results.length), ["assistant", ...results.map(() => "toolResult"), "user"]);
        const full = modelContextOf(setup.runtime.events(setup.runId), worker, (hash) => setup.runtime.mediaContent(hash));
        assert.equal(JSON.stringify(setup.runtime.modelContext(setup.runId, worker)), JSON.stringify(full));
    } finally {
        await close(setup);
    }
});

test("model context: attachments as native media, embedded text and a stored file, and a hook that replaces a tool result with an image", async () => {
    const image = Buffer.from([137, 80, 78, 71, 1, 2, 3]).toString("base64");
    const hook: AgentContribution = {
        id: "test.image",
        afterToolCall: (_agent, outcome) => outcome.toolName === "shot"
            ? { content: [{ type: "text", text: "Aufnahme." }, { type: "image", data: image, mimeType: "image/png" }] }
            : undefined,
    };
    const setup = harness("attachments", { tools: [tool("shot"), tool("read")], hooks: [hook] });
    try {
        const worker = setup.spawn("worker", { toolNames: ["shot", "read"] });
        const picture = setup.publish("bild.png", "image/png", new Uint8Array([1, 2, 3, 4]));
        const notes = setup.publish("notizen.txt", "text/plain", "Zeile eins\nZeile zwei");
        const binary = setup.publish("daten.bin", "application/octet-stream", new Uint8Array([0, 1, 2]));
        await run(setup, [
            fauxAssistantMessage([fauxToolCall("shot", {}, { id: "shot-1" })], { stopReason: "toolUse" }),
            fauxAssistantMessage([fauxText("Gesehen.")]),
        ], async () => setup.post(worker, "Sieh Dir das an.", [picture, notes, binary]));
        const projected = assertGolden(setup, worker);
        const result = projected.find((message) => message.role === "toolResult");
        assert.deepEqual(result?.role === "toolResult" ? result.content.map((part) => part.type) : [], ["text", "image"]);
        const presented = setup.runtime.events(setup.runId).find((event) => event.type === "model.tool-result.presented");
        assert.ok(presented?.type === "model.tool-result.presented" && presented.payload.content?.some((part) => part.type === "image" && "hash" in part));
    } finally {
        await close(setup);
    }
});

test("model context: compaction on the threshold and after a context overflow, with an incremental summary", async () => {
    const setup = harness("compaction", { contextWindow: 4_000, compaction: { reserveTokens: 1_000, keepRecentTokens: 200 } });
    try {
        const worker = setup.spawn("worker", { toolNames: [] });
        const summaries: string[] = [];
        const answers = [
            () => fauxAssistantMessage("Antwort eins. ".repeat(900)),
            () => fauxAssistantMessage("Antwort zwei. ".repeat(100)),
            () => fauxAssistantMessage([], { stopReason: "error", errorMessage: "prompt is too long: 213462 tokens > 200000 maximum" }),
            () => fauxAssistantMessage("Antwort drei."),
        ];
        const respond: FauxResponseStep = (context: Context) => {
            if (context.systemPrompt?.startsWith("You are a context summarization assistant")) {
                const prompt = JSON.stringify(context.messages);
                summaries.push(prompt.includes("<previous-summary>") ? "update" : "initial");
                return fauxAssistantMessage(`## Goal\nZusammenfassung ${summaries.length}.`);
            }
            const answer = answers.shift();
            assert.ok(answer, "unerwartete Modellanfrage");
            return answer();
        };
        await run(setup, Array.from({ length: 12 }, () => respond), async () => {
            setup.post(worker, "Erster Auftrag.");
            await setup.scheduler.waitForIdle();
            setup.post(worker, "Zweiter Auftrag.");
            await setup.scheduler.waitForIdle();
            setup.post(worker, "Dritter Auftrag. ".repeat(100));
        });
        const compactions = setup.runtime.events(setup.runId).filter((event) => event.type === "context.compacted");
        assert.equal(answers.length, 0);
        assert.deepEqual(summaries, ["initial", "update", "initial", "update"]);
        assert.equal(compactions.length, 3);
        assertGolden(setup, worker);
    } finally {
        await close(setup);
    }
});

test("model context: a fork starts with an unchanged copy of its source's finished turns, reasoning included", async () => {
    const setup = harness("fork", { tools: [tool("lookup")] });
    try {
        const coordinator = setup.spawn("coordinator");
        await run(setup, [
            fauxAssistantMessage([fauxThinking("privat"), fauxToolCall("lookup", {}, { id: "look" })], { stopReason: "toolUse" }),
            fauxAssistantMessage([fauxText("Analyse fertig.")]),
        ], async () => setup.post(coordinator, "Analysiere."));
        const implementer = setup.spawn("implementer", { forkOf: coordinator });
        setup.faux.setResponses([fauxAssistantMessage([fauxText("Ich setze um.")])]);
        setup.post(implementer, "Setze um.");
        await setup.scheduler.waitForIdle();
        const projected = assertGolden(setup, implementer);
        const source = assertGolden(setup, coordinator);
        assert.deepEqual(projected.slice(0, source.length), source, "die Kopie der Quelle, unverändert");
        assert.deepEqual(projected.slice(source.length).map((message) => message.role), ["user", "assistant"]);
    } finally {
        await close(setup);
    }
});

const manualRun = () => {
    const services = testServices();
    const journal = new Journal(":memory:", services);
    const runtime = new Orchestration(journal, services);
    const run = runtime.createRun({ commandId: "create" }, { title: "Manual", ownerHandle: "owner", ownerDisplayName: "Owner" });
    const models: CatalogModel[] = [{ driver: "agent", provider: "faux", model: "manual", label: "manual", thinking: thinkingLevels }];
    const catalog = new StaticModelCatalog(models, [{
        name: "agent", description: "Faux", driver: "agent", provider: "faux", model: "manual", turnTimeoutMs: 600_000, isolateWorkspace: false,
    }]);
    let commands = 0;
    const spawn = (handle: string, forkOf?: string) => runtime.spawnAgent({ actorId: run.ownerId, commandId: `spawn-${handle}` }, run.id, {
        handle, displayName: handle, prompt: "", grants: [], toolNames: [],
        execution: resolveExecution(catalog, { profile: "agent", isolateWorkspace: false }, handle, models),
        ...(forkOf ? { forkOf } : {}),
    }).actors.find((actor) => actor.handle === handle)!.id;
    const turn = (actorId: string, content: string) => {
        const inputId = runtime.enqueueInput({ actorId: run.ownerId, commandId: `post-${++commands}` }, run.id, { actorId, content }).inputs.at(-1)!.id;
        const turnId = runtime.startTurn({ actorId, commandId: `start-${commands}` }, run.id, actorId, inputId).turns.at(-1)!.id;
        const context = () => ({ actorId, commandId: `command-${++commands}`, turnId });
        const step = (content: CompletedModelStep["content"], stopReason: CompletedModelStep["stopReason"] = "stop") =>
            runtime.completeModelStep(context(), run.id, actorId, { turnId, step: {
                api: "faux", provider: "faux", model: "manual", stopReason, timestamp: 1, content,
                usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
            } });
        runtime.presentModelInput(context(), run.id, actorId, { turnId, inputId, content: [{ type: "text", text: content }] });

        return {
            turnId,
            step,
            call: (toolCallId: string, output: JsonValue) => {
                runtime.startToolCall(context(), run.id, actorId, { turnId, toolCallId, name: "lookup", input: {} });
                runtime.completeToolCall(context(), run.id, actorId, { turnId, toolCallId, name: "lookup", output });
                runtime.presentToolResult(context(), run.id, actorId, { turnId, toolCallId, toolName: "lookup", isError: false, content: [{ type: "text", text: typeof output === "string" ? output : JSON.stringify(output) }] });
            },
            compact: (firstKeptEventId: string) => runtime.compactContext(context(), run.id, actorId, {
                turnId, summary: "## Goal\nKurz.", firstKeptEventId, tokensBefore: 10, provider: "faux", model: "manual", readFiles: [], modifiedFiles: [],
            }),
            finish: () => runtime.finishTurn(context(), run.id, actorId, { turnId, outcome: "completed" }),
        };
    };
    const contextOf = (actorId: string, runId = run.id) => modelContextOf(runtime.events(runId), actorId, (hash) => runtime.mediaContent(hash));

    return { runtime, journal, run, spawn, turn, contextOf };
};

test("model context: a fork spawned in the running turn of its source takes the finished turns only, nothing of the running one", () => {
    const setup = manualRun();
    try {
        const source = setup.spawn("source");
        const first = setup.turn(source, "Analysiere.");
        first.step([{ type: "thinking", thinking: "privat" }, { type: "text", text: "Ich lese." }, { type: "toolCall", id: "look", name: "lookup", arguments: {} }], "toolUse");
        first.call("look", "gelesen");
        first.step([{ type: "text", text: "Analyse fertig." }]);
        first.finish();
        const finished = setup.contextOf(source).messages;

        const second = setup.turn(source, "Erzeuge einen Worker.");
        second.step([{ type: "text", text: "Ich gebe ab." }, { type: "toolCall", id: "spawn", name: "agent_spawn", arguments: { handle: "fork" } }], "toolUse");
        const fork = setup.spawn("fork", source);
        second.call("spawn", { id: fork });
        second.step([{ type: "text", text: "Später, nur für die Quelle." }]);
        second.finish();

        const forked = setup.contextOf(fork).messages;
        assert.deepEqual(forked, finished, "eine unveränderte Kopie, samt Reasoning, ohne eingefügten Text");
        assert.match(JSON.stringify(forked), /privat/);
        assert.doesNotMatch(JSON.stringify(forked), /Erzeuge einen Worker|Ich gebe ab|Später/);
        assert.equal(setup.contextOf(source).messages.length, 8);
    } finally {
        setup.journal.close();
    }
});

test("model context: a source that has not finished a turn cannot be forked", () => {
    const setup = manualRun();
    try {
        const source = setup.spawn("source");
        assert.throws(() => setup.spawn("fork", source), { code: "fork-without-turn" });
        setup.turn(source, "Läuft noch.");
        assert.throws(() => setup.spawn("fork-running", source), /finished turns only, never of the running one/);
    } finally {
        setup.journal.close();
    }
});

test("model context: a source whose finished turns never reached the model cannot be forked, a fork of a fork can", () => {
    const setup = manualRun();
    try {
        const source = setup.spawn("source");
        const runId = setup.run.id;
        const inputId = setup.runtime.enqueueInput({ actorId: setup.run.ownerId, commandId: "early-post" }, runId, { actorId: source, content: "Los." }).inputs.at(-1)!.id;
        const turnId = setup.runtime.startTurn({ actorId: source, commandId: "early-start" }, runId, source, inputId).turns.at(-1)!.id;
        setup.runtime.finishTurn({ actorId: source, commandId: "early-end", turnId }, runId, source, { turnId, outcome: "failed", reason: "Scheiterte vor der Modellanfrage." });
        assert.throws(() => setup.spawn("fork", source), { code: "fork-without-turn" });

        const turn = setup.turn(source, "Jetzt richtig.");
        turn.step([{ type: "text", text: "Erledigt." }]);
        turn.finish();
        const fork = setup.spawn("fork", source);
        const grandchild = setup.spawn("grandchild", fork);
        assert.deepEqual(setup.contextOf(grandchild).messages, setup.contextOf(source).messages);
    } finally {
        setup.journal.close();
    }
});

test("model context: a held context lives only during a turn and comes back byte-equal afterwards", () => {
    const setup = manualRun();
    try {
        const agent = setup.spawn("agent");
        const runId = setup.run.id;
        const first = setup.turn(agent, "Los.");
        first.step([{ type: "text", text: "Erste Antwort." }]);
        assert.deepEqual(setup.runtime.modelContext(runId, agent), setup.contextOf(agent));
        assert.equal(setup.runtime.heldModelContexts(), 1);
        first.finish();
        assert.equal(setup.runtime.heldModelContexts(), 0, "ein ruhender Actor hält keinen Kontext");

        const second = setup.turn(agent, "Weiter.");
        second.step([{ type: "text", text: "Zweite Antwort." }]);
        assert.deepEqual(setup.runtime.modelContext(runId, agent), setup.contextOf(agent));
        assert.equal(setup.runtime.heldModelContexts(), 1);
        setup.runtime.interruptTurn({ actorId: setup.run.ownerId, commandId: "stop", turnId: second.turnId }, runId, agent, { turnId: second.turnId, reason: "Test" });
        assert.equal(setup.runtime.heldModelContexts(), 0, "auch eine Unterbrechung gibt ihn frei");
    } finally {
        setup.journal.close();
    }
});

test("model context: the journal refuses results for running calls, compactions without a context event and double inputs", () => {
    const setup = manualRun();
    try {
        const agent = setup.spawn("agent");
        const turn = setup.turn(agent, "Los.");
        const runId = setup.run.id;
        setup.runtime.startToolCall({ actorId: agent, commandId: "running-call", turnId: turn.turnId }, runId, agent, { turnId: turn.turnId, toolCallId: "open", name: "lookup", input: {} });
        assert.throws(() => setup.runtime.presentToolResult({ actorId: agent, commandId: "early", turnId: turn.turnId }, runId, agent, {
            turnId: turn.turnId, toolCallId: "open", toolName: "lookup", isError: false, content: [{ type: "text", text: "zu früh" }],
        }), /has no result yet/);
        const notContext = setup.runtime.events(runId).find((event) => event.type === "tool.call.started")!.eventId;
        assert.throws(() => turn.compact(notContext), /no model context event/);
        const inputId = setup.runtime.view(runId).inputs.at(-1)!.id;
        assert.throws(() => setup.runtime.presentModelInput({ actorId: agent, commandId: "again", turnId: turn.turnId }, runId, agent, {
            turnId: turn.turnId, inputId, content: "noch einmal",
        }), /already presented/);
    } finally {
        setup.journal.close();
    }
});

test("model context: a tool result the model saw exactly as recorded stores no second copy, and a replaced one does", () => {
    const setup = manualRun();
    try {
        const agent = setup.spawn("agent");
        const turn = setup.turn(agent, "Los.");
        turn.step([{ type: "toolCall", id: "one", name: "lookup", arguments: {} }], "toolUse");
        turn.call("one", { found: ["a", null] });
        const presented = setup.runtime.events(setup.run.id).filter((event) => event.type === "model.tool-result.presented");
        assert.equal(presented.length, 1);
        assert.equal(presented[0]!.type === "model.tool-result.presented" && presented[0]!.payload.content, undefined);
        const runId = setup.run.id;
        setup.runtime.startToolCall({ actorId: agent, commandId: "two-start", turnId: turn.turnId }, runId, agent, { turnId: turn.turnId, toolCallId: "two", name: "lookup", input: {} });
        setup.runtime.completeToolCall({ actorId: agent, commandId: "two-done", turnId: turn.turnId }, runId, agent, { turnId: turn.turnId, toolCallId: "two", name: "lookup", output: "roh" });
        setup.runtime.presentToolResult({ actorId: agent, commandId: "two-seen", turnId: turn.turnId }, runId, agent, {
            turnId: turn.turnId, toolCallId: "two", toolName: "lookup", isError: false, content: [{ type: "text", text: "Hinweis: ersetzt." }],
        });
        const results = setup.contextOf(agent).messages.filter((message) => message.role === "toolResult");
        assert.deepEqual(results.map((message) => message.role === "toolResult" ? message.content : []), [
            [{ type: "text", text: "{\"found\":[\"a\",null]}" }],
            [{ type: "text", text: "Hinweis: ersetzt." }],
        ]);
    } finally {
        setup.journal.close();
    }
});

test("model context: a run fork inherits the model contexts and rewrites the compaction's reference", () => {
    const setup = manualRun();
    try {
        const agent = setup.spawn("agent");
        const first = setup.turn(agent, "Erster.");
        first.step([{ type: "text", text: "Eins." }]);
        first.finish();
        const second = setup.turn(agent, "Zweiter.");
        const kept = setup.runtime.events(setup.run.id).filter((event) => event.type === "model.input.presented").at(-1)!.eventId;
        second.compact(kept);
        second.step([{ type: "text", text: "Zwei." }]);
        second.finish();

        const fork = setup.runtime.forkRun({ commandId: "fork" }, setup.run.id, setup.runtime.view(setup.run.id).revision);
        const original = setup.contextOf(agent);
        const inherited = setup.contextOf(agent, fork.id);
        assert.deepEqual(inherited.messages, original.messages);
        assert.notEqual(inherited.key, original.key);
        const compaction = setup.runtime.events(fork.id).find((event) => event.type === "context.compacted");
        assert.ok(compaction?.type === "context.compacted");
        assert.ok(setup.runtime.events(fork.id).some((event) => event.eventId === compaction.payload.firstKeptEventId));
    } finally {
        setup.journal.close();
    }
});

test("model context: the held context grows with every event exactly like the full projection", () => {
    const setup = manualRun();
    try {
        const agent = setup.spawn("agent");
        const held = () => JSON.stringify(setup.runtime.modelContext(setup.run.id, agent));
        const full = () => JSON.stringify(setup.contextOf(agent));
        assert.equal(held(), full());
        const first = setup.turn(agent, "Erster.");
        assert.equal(held(), full());
        first.step([{ type: "thinking", thinking: "Plan." }, { type: "text", text: "Ich sehe nach." }, { type: "toolCall", id: "look", name: "lookup", arguments: {} }], "toolUse");
        assert.equal(held(), full());
        first.call("look", { found: [1, null] });
        assert.equal(held(), full());
        first.step([{ type: "text", text: "  Fertig.  " }]);
        first.finish();
        const second = setup.turn(agent, "Zweiter.");
        const kept = setup.runtime.events(setup.run.id).filter((event) => event.type === "model.input.presented").at(-1)!.eventId;
        const before = setup.runtime.modelContext(setup.run.id, agent).key;
        second.compact(kept);
        assert.notEqual(setup.runtime.modelContext(setup.run.id, agent).key, before);
        assert.equal(held(), full());
        const fork = setup.spawn("fork", agent);
        assert.equal(JSON.stringify(setup.runtime.modelContext(setup.run.id, fork)), JSON.stringify(setup.contextOf(fork)));
        const context = setup.runtime.modelContext(setup.run.id, agent);
        assert.equal(setup.runtime.modelContext(setup.run.id, agent), context, "without new events the same object");
        assert.throws(() => { (context.messages[0] as { timestamp: number }).timestamp = 0; }, TypeError, "the held context cannot be changed");
    } finally {
        setup.journal.close();
    }
});

test("model context: a run removed from the journal and created again under the same ID starts a new held context", () => {
    const setup = manualRun();
    try {
        const agent = setup.spawn("agent");
        const turn = setup.turn(agent, "Alt.");
        turn.step([{ type: "text", text: "Alte Antwort." }]);
        turn.finish();
        assert.match(JSON.stringify(setup.runtime.modelContext(setup.run.id, agent)), /Alte Antwort/);

        setup.journal.forget(setup.run.id);
        const again = setup.runtime.createRun({ commandId: "create-again" }, { runId: setup.run.id, title: "Neu", ownerHandle: "owner", ownerDisplayName: "Owner" });
        assert.equal(again.id, setup.run.id);
        assert.deepEqual(setup.runtime.modelContext(setup.run.id, agent).messages, []);
        assert.equal(setup.runtime.forgetRun(setup.run.id), true);
        assert.deepEqual(setup.runtime.modelContext(setup.run.id, agent).messages, []);
    } finally {
        setup.journal.close();
    }
});
