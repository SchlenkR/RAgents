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
} from "@aicontainer/agent";
import { fauxAssistantMessage, fauxText, fauxThinking, fauxToolCall, registerFauxProvider, type InputModality } from "@aicontainer/ai";

import {
    createTurnAbortLatch,
    forkableBranch,
    AgentRuntimeManager,
} from "../src/drivers/agent-runtime.ts";
import { AgentSessionDriver } from "../src/drivers/agent.ts";
import { defineRunFunction } from "../src/agents/tools.ts";
import type { TurnRequest } from "../src/drivers/types.ts";

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
        lifecycle: { kind: "claimed", turnId: "turn-2" },
        event: null,
    },
    prompt: "Original input.",
    selection: { provider: "faux", model: "unconfigured" },
    systemPrompt: "System contract.",
    workspace: process.cwd(),
    tools: [],
    workspaceTools: [],
    allowedToolNames: null,
    invoke: async () => ({ output: null, ignoredFields: [] }),
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
    const modelRuntime = await ModelRuntime.create({
        authPath: join(directory, "auth.json"),
        modelsPath: null,
    });
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
        const manager = new AgentRuntimeManager({ agentDir: directory, modelRuntime });
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
    const manager = new AgentRuntimeManager({ agentDir: directory, modelRuntime });
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
    const manager = new AgentRuntimeManager({ agentDir: directory, modelRuntime });
    const driver = new AgentSessionDriver({ agentDir: directory, modelRuntime });
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
    const manager = new AgentRuntimeManager({ agentDir: directory, modelRuntime });
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

test("The agent runtime delivers attachment-only images, video and PDF as native model content", async () => {
    const directory = mkdtempSync(join(tmpdir(), "ragents-native-attachments-"));
    const { faux, modelRuntime, selection } = await fauxModelRuntime(directory, "native-attachments", 0, ["text", "image", "video", "file"]);
    const manager = new AgentRuntimeManager({ agentDir: directory, modelRuntime });
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
    const manager = new AgentRuntimeManager({ agentDir: process.cwd(), modelRuntime: unavailable });
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
            agent.getActiveTools();
            lateEffect = true;
        } catch (error) {
            lateApiError = error;
        }
    };

    try {
        const modelRuntime = await ModelRuntime.create({
            authPath: join(directory, "auth.json"),
            modelsPath: null,
        });
        const manager = new AgentRuntimeManager({
            agentDir: directory,
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
        assert.throws(() => extensionApi?.getActiveTools(), /Extension creation was aborted/);
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

test("The agent runtime bounds hanging session shutdown handlers and invalidates their API", async () => {
    const directory = mkdtempSync(join(tmpdir(), "ragents-agent-shutdown-deadline-"));
    let extensionApi: ExtensionAPI | undefined;
    let shutdownCalls = 0;
    let lateShutdownCalls = 0;
    let releaseShutdown: () => void = () => undefined;
    const shutdownRelease = new Promise<void>((resolveShutdown) => {
        releaseShutdown = resolveShutdown;
    });
    const extension: InlineExtension = (agent) => {
        extensionApi = agent;
        agent.on("session_shutdown", async () => {
            shutdownCalls++;
            await shutdownRelease;
        });
        agent.on("session_shutdown", () => {
            lateShutdownCalls++;
        });
    };

    try {
        const { modelRuntime, selection } = await fauxModelRuntime(directory, "shutdown-deadline", 1);
        const manager = new AgentRuntimeManager({
            agentDir: directory,
            modelRuntime,
            extensionFactories: [extension],
            sessionShutdownTimeoutMs: 20,
        });
        const request = { ...requestFor(), workspace: directory, selection };

        await manager.runTurn(request, new AbortController().signal);
        await within(manager.haltRun(request.runId));
        const settlement = manager.waitForRunSettlement(request.runId);

        assert.equal(shutdownCalls, 1);
        assert.ok(settlement);
        assert.throws(
            () => extensionApi?.getActiveTools(),
            /stale after session replacement or reload/,
        );

        let settled = false;
        void settlement.then(() => {
            settled = true;
        });
        await new Promise<void>((resolveImmediate) => setImmediate(resolveImmediate));
        assert.equal(settled, false);
        assert.equal(lateShutdownCalls, 0);

        releaseShutdown();
        await within(settlement);
        assert.equal(lateShutdownCalls, 1);
        await manager.shutdown();
    } finally {
        releaseShutdown();
        rmSync(directory, { recursive: true, force: true });
    }
});

test("The agent runtime manager shutdown waits beyond the session deadline for actual settlement", async () => {
    const directory = mkdtempSync(join(tmpdir(), "ragents-agent-global-shutdown-settlement-"));
    let releaseShutdown: () => void = () => undefined;
    const shutdownRelease = new Promise<void>((resolve) => {
        releaseShutdown = resolve;
    });
    let markShutdownStarted: () => void = () => undefined;
    const shutdownStarted = new Promise<void>((resolve) => {
        markShutdownStarted = resolve;
    });
    const extension: InlineExtension = (agent) => {
        agent.on("session_shutdown", async () => {
            markShutdownStarted();
            await shutdownRelease;
        });
    };

    try {
        const { modelRuntime, selection } = await fauxModelRuntime(directory, "global-shutdown", 1);
        const manager = new AgentRuntimeManager({
            agentDir: directory,
            modelRuntime,
            extensionFactories: [extension],
            sessionShutdownTimeoutMs: 20,
        });
        const request = { ...requestFor(), workspace: directory, selection };

        await manager.runTurn(request, new AbortController().signal);
        const shutdown = manager.shutdown();
        await within(shutdownStarted);
        const state = await Promise.race([
            shutdown.then(() => "settled" as const),
            new Promise<"pending">((resolve) => setTimeout(() => resolve("pending"), 50)),
        ]);
        assert.equal(state, "pending");

        releaseShutdown();
        await within(shutdown);
    } finally {
        releaseShutdown();
        rmSync(directory, { recursive: true, force: true });
    }
});

test("The agent runtime halt quarantines a turn whose extension callback ignores abort", async () => {
    const directory = mkdtempSync(join(tmpdir(), "ragents-agent-turn-abort-deadline-"));
    const faux = registerFauxProvider({ models: [{ id: "abort-deadline", reasoning: false }] });
    faux.setResponses([fauxAssistantMessage("Late answer that must not run.")]);
    const controller = new AbortController();
    let manager: AgentRuntimeManager | undefined;
    let extensionApi: ExtensionAPI | undefined;
    let lateApiError: unknown;
    let shutdownCalls = 0;
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
        agent.on("input", async () => {
            markStarted();
            await inputRelease;

            try {
                agent.getActiveTools();
            } catch (error) {
                lateApiError = error;
            }

            throw new Error("Late input failure.");
        });
        agent.on("session_shutdown", () => {
            shutdownCalls++;
        });
    };
    const emitted: unknown[] = [];
    const published: unknown[] = [];

    try {
        const modelRuntime = await ModelRuntime.create({
            authPath: join(directory, "auth.json"),
            modelsPath: null,
        });
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
            agentDir: directory,
            modelRuntime,
            extensionFactories: [extension],
            sessionShutdownTimeoutMs: 20,
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
        assert.equal(shutdownCalls, 1);
        assert.ok(settlement);
        assert.throws(() => extensionApi?.getActiveTools(), /stale after session replacement or reload/);

        let settled = false;
        void settlement.then(() => {
            settled = true;
        });
        await new Promise<void>((resolveImmediate) => setImmediate(resolveImmediate));
        assert.equal(settled, false);

        releaseInput();
        await within(settlement);
        await new Promise<void>((resolveImmediate) => setImmediate(resolveImmediate));
        assert.match(lateApiError instanceof Error ? lateApiError.message : String(lateApiError), /stale after session replacement or reload/);
        assert.deepEqual(emitted, []);
        assert.deepEqual(published, []);
        assert.equal(faux.getPendingResponseCount(), 1);
    } finally {
        controller.abort(new Error("Test cleanup."));
        releaseInput();
        await manager?.shutdown().catch(() => undefined);
        faux.unregister();
        rmSync(directory, { recursive: true, force: true });
    }
});

test("The agent runtime applies the configured session shutdown timeout during reload", async () => {
    const directory = mkdtempSync(join(tmpdir(), "ragents-agent-reload-deadline-"));
    const reloadController = new AbortController();
    let manager: AgentRuntimeManager | undefined;
    let reloadTurn: ReturnType<AgentRuntimeManager["runTurn"]> | undefined;
    let reloadShutdowns = 0;
    let releaseReloadShutdown: () => void = () => undefined;
    const reloadShutdownRelease = new Promise<void>((resolveShutdown) => {
        releaseReloadShutdown = resolveShutdown;
    });
    const extension: InlineExtension = (agent) => {
        agent.on("session_shutdown", async (event) => {
            if (event.reason !== "reload")
                return;

            reloadShutdowns++;
            await reloadShutdownRelease;
        });
    };
    const reloadProbe = defineRunFunction({
        name: "reload_probe",
        nativeTool: true,
        label: "Reload probe",
        description: "Forces the agent runtime to reload a removed managed tool.",
        schema: Type.Object({}, { additionalProperties: false }),
        resultSchema: Type.Null(),
        available: () => true,
        run: () => null,
    });

    try {
        const { modelRuntime, selection } = await fauxModelRuntime(directory, "reload-deadline", 2);
        manager = new AgentRuntimeManager({
            agentDir: directory,
            modelRuntime,
            extensionFactories: [extension],
            sessionShutdownTimeoutMs: 20,
        });
        const request = { ...requestFor(), workspace: directory, selection, tools: [reloadProbe] };

        await manager.runTurn(request, new AbortController().signal);
        reloadTurn = manager.runTurn({
            ...request,
            turnId: "turn-3",
            tools: [],
            workspaceTools: [reloadProbe.name],
        }, reloadController.signal);
        const result = await within(reloadTurn, 2_000);
        await within(manager.haltRun(request.runId));
        const settlement = manager.waitForRunSettlement(request.runId);

        assert.equal(reloadShutdowns, 1);
        assert.match(result.failure ?? "", /agent tools are not registered: reload_probe/);
        assert.ok(settlement);

        let settled = false;
        void settlement.then(() => {
            settled = true;
        });
        await new Promise<void>((resolveImmediate) => setImmediate(resolveImmediate));
        assert.equal(settled, false);

        releaseReloadShutdown();
        await within(settlement);
    } finally {
        reloadController.abort(new Error("Test cleanup."));
        releaseReloadShutdown();
        await reloadTurn?.catch(() => undefined);
        await manager?.shutdown().catch(() => undefined);
        rmSync(directory, { recursive: true, force: true });
    }
});

test("The agent runtime halt shuts down extensions but allows the run to create a fresh runtime", async () => {
    const directory = mkdtempSync(join(tmpdir(), "ragents-agent-halt-"));
    const lifecycle: string[] = [];
    const extension: InlineExtension = (agent) => {
        agent.on("session_start", () => {
            lifecycle.push("start");
        });
        agent.on("session_shutdown", (event) => {
            lifecycle.push(`shutdown:${event.reason}`);
        });
    };

    try {
        const { modelRuntime, selection } = await fauxModelRuntime(directory, "halt-fresh", 2);
        const manager = new AgentRuntimeManager({
            agentDir: directory,
            modelRuntime,
            extensionFactories: [extension],
        });
        const request = { ...requestFor(), workspace: directory, selection };

        await manager.runTurn(request, new AbortController().signal);
        await manager.haltRun(request.runId);
        await manager.runTurn({ ...request, turnId: "turn-3" }, new AbortController().signal);
        await manager.disposeRun(request.runId);

        assert.deepEqual(lifecycle, ["start", "shutdown:quit", "start", "shutdown:quit"]);
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
        const modelRuntime = await ModelRuntime.create({
            authPath: join(directory, "auth.json"),
            modelsPath: null,
        });
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
            agentDir: directory,
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
    ] as unknown as import("@aicontainer/agent").SessionEntry[];

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
        const modelRuntime = await ModelRuntime.create({ authPath: join(directory, "auth.json"), modelsPath: null });
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
            agentDir: directory, modelRuntime,
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
