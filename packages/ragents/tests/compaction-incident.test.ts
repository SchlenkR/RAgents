import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { estimateContextUsage, estimateTokens, ModelRuntime } from "@ragents/agent";
import { createAssistantMessageEventStream, fauxAssistantMessage, fauxToolCall, registerFauxProvider, type AssistantMessage, type Context, type Model } from "@ragents/ai";
import { AgentRuntimeManager } from "../src/drivers/agent-runtime.ts";
import { Journal } from "../src/runtime/journal.ts";
import { Orchestration } from "../src/runtime/orchestration.ts";
import { harnessOver, isSummary, journalHarness, nativeTool, turnOf } from "./agent-runtime-fixture.ts";
import { executionFor, testServices } from "./support.ts";
import type { CompletedModelStep } from "../src/runtime/decisions/turns.ts";

const incidentUsage = (message: AssistantMessage, input: number, cacheRead: number, output: number, reasoning = output): AssistantMessage => ({
    ...message, usage: { ...message.usage, input, cacheRead, output, reasoning, totalTokens: input + cacheRead + output },
});

const snapshot = (context: Context): Context => ({ ...(context.systemPrompt ? { systemPrompt: context.systemPrompt } : {}), messages: structuredClone(context.messages) });

const setupFor = (respond: (context: Context, outputLimit: number) => AssistantMessage, reasoningReplay?: Model<string>["reasoningReplay"]) => {
    const faux = registerFauxProvider({ models: [{ id: "reasoning-loop", reasoning: true, contextWindow: 264_000, maxTokens: 131_072 }] });
    const model = faux.getModel();
    const modelRuntime = ModelRuntime.create();
    modelRuntime.registerProvider(model.provider, { apiKey: "faux-key", api: faux.api, models: [{ ...model, ...(reasoningReplay ? { reasoningReplay } : {}), thinkingLevelMap: { xhigh: "xhigh" },
        compaction: { threshold: 239_424, keepRecentTokens: 24_000, summaryTokens: 12_000 } }] });
    const getModel = modelRuntime.getModel.bind(modelRuntime);
    modelRuntime.getModel = (provider, id) => {
        const selected = getModel(provider, id);
        return selected ? { ...selected, compaction: { ...selected.compaction!, threshold: 250_000 } } : undefined;
    };
    modelRuntime.streamSimple = (requestModel, context, options) => {
        const response = respond(context, options?.maxTokens ?? requestModel.maxTokens);
        const message = { ...response, api: requestModel.api, provider: requestModel.provider, model: requestModel.id };
        const stream = createAssistantMessageEventStream();
        stream.push(message.stopReason === "error" || message.stopReason === "aborted"
            ? { type: "error", reason: message.stopReason, error: message }
            : { type: "done", reason: message.stopReason, message });
        stream.end(message);
        return stream;
    };
    return { faux, modelRuntime, selection: { provider: model.provider, model: model.id } };
};

for (const failSummary of [false, true]) {
    test(`253263 tokens in the same tool loop trigger compaction before the 253739-token request (${failSummary ? "summary fails" : "summary succeeds"})`, async () => {
        const order: string[] = [];
        const ordinary: Context[] = [];
        const thought = { type: "thinking" as const, thinking: "r".repeat(13_016), thinkingSignature: JSON.stringify([{ type: "reasoning.text", text: "r".repeat(13_016), format: "unknown", index: 0 }]) };
        const setup = setupFor((context, limit) => {
            order.push(isSummary(context) ? "summary" : "step");
            if (isSummary(context)) {
                assert.ok(limit > 16_400, "reasoning must leave room for the checkpoint text");
                assert.ok(Math.ceil(JSON.stringify(context).length / 4) + limit < 264_000);
                return failSummary ? fauxAssistantMessage([{ type: "thinking", thinking: "Reasoning" }], { stopReason: "length" }) : fauxAssistantMessage("Task checkpoint");
            }
            ordinary.push(snapshot(context));
            return ordinary.length === 1 ? incidentUsage(fauxAssistantMessage([thought, fauxToolCall("lookup", {}, { id: "lookup-1" })], { stopReason: "toolUse" }), 20_390, 229_376, 3_497, 3_254)
                : incidentUsage(fauxAssistantMessage("Continued"), 1000, 0, 5, 0);
        });
        const harness = journalHarness(setup.selection);
        const diagnostics: string[] = [];
        const manager = new AgentRuntimeManager({ modelRuntime: setup.modelRuntime, thinkingLevel: "xhigh", onDiagnostic: ({ message }) => diagnostics.push(message) });
        try {
            const first = await turnOf(harness, manager, "Requirement. ".repeat(12_000), { tools: [nativeTool("lookup")], invoke: async () => "x".repeat(2_204) });
            const events = harness.runtime.events(harness.runId);
            const step = events.find((event) => event.type === "model.step.completed")!;
            assert.ok(step.type === "model.step.completed");
            assert.equal(step.payload.usage.totalTokens, 253_263);
            if (failSummary) {
                assert.deepEqual(order, ["step", "summary"]);
                assert.match(first.result.failure!, /summary reached the output token limit/);
                assert.equal(events.some((event) => event.type === "context.compacted"), false);
                assert.ok(diagnostics.some((message) => message.includes("incomplete response (length)")));
                assert.equal(estimateContextUsage(harness.runtime.modelContext(harness.runId, harness.agentId).entries).tokens, 253_814);
                const later = await turnOf(harness, manager, "Continue");
                assert.match(later.result.failure!, /summary reached the output token limit/);
                assert.equal(later.result.usage.inputTokens, 0);
                assert.equal(ordinary.length, 1);
            } else {
                assert.equal(first.result.failure, null);
                assert.deepEqual(order, ["step", "summary", "step"]);
                const kept = ordinary[1]!.messages.flatMap((message) => message.role === "assistant" ? message.content : []).find((part) => part.type === "thinking");
                assert.deepEqual(kept, thought);
                assert.ok(ordinary[1]!.messages.reduce((sum, message) => sum + estimateTokens(message), 0) < 24_000);
                const checkpoint = events.find((event) => event.type === "context.compacted")!;
                assert.ok(checkpoint.type === "context.compacted");
                assert.deepEqual(checkpoint.payload.threshold, { tokens: 250_000, source: "model" });
                assert.equal(events.filter((event) => event.type === "turn.started").length, 1);
            }
        } finally {
            await manager.shutdown();
            harness.journal.close();
            setup.faux.unregister();
        }
    });
}

test("two small calls from another actor cannot lower the implementer's incident usage or act as its checkpoint", async () => {
    const setup = setupFor(() => { throw new Error("No provider request expected"); });
    const harness = journalHarness(setup.selection);
    try {
        const request = harness.request("Implement");
        request.recordContext({ kind: "input", inputId: request.input.id, content: "Implement" });
        const record = (target: typeof request, response: AssistantMessage) => {
            const { role: _role, ...step } = response;
            target.recordContext({ kind: "step", step: { ...step, api: setup.faux.api, provider: setup.selection.provider, model: setup.selection.model } as unknown as CompletedModelStep });
        };
        record(request, incidentUsage(fauxAssistantMessage("Progress"), 20_390, 229_376, 3_497));
        record(request, incidentUsage(fauxAssistantMessage([{ type: "thinking", thinking: "r".repeat(23_672) }], { stopReason: "length" }), 8_747, 244_992, 5_918));
        harness.finish(request, { failure: "Output limit", usage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, costUsd: 0 } });
        const otherId = harness.runtime.spawnAgent({ actorId: harness.runtime.view(harness.runId).ownerId, commandId: "spawn-other" }, harness.runId, {
            handle: "coordinator", displayName: "Coordinator", prompt: "Coordinate", execution: executionFor("agent", { profile: "agent", isolateWorkspace: false }), grants: [], toolNames: null,
        }).actors.find((actor) => actor.handle === "coordinator")!.id;
        const other = harnessOver(setup.selection, harness.journal, harness.runtime, harness.runId, otherId, "other-");
        const small = other.request("Coordinate");
        small.recordContext({ kind: "input", inputId: small.input.id, content: "Coordinate" });
        record(small, incidentUsage(fauxAssistantMessage("Coordinate"), 22_586, 0, 163));
        record(small, incidentUsage(fauxAssistantMessage("Done"), 9_320, 13_440, 115));
        assert.equal(estimateContextUsage(harness.runtime.modelContext(harness.runId, otherId).entries).usageTokens, 22_875);
        const next = harness.request("Continue");
        next.recordContext({ kind: "input", inputId: next.input.id, content: "Continue" });
        record(next, incidentUsage(fauxAssistantMessage([{ type: "thinking", thinking: "Let" }], { stopReason: "length" }), 40_424, 219_328, 1));
        const context = harness.runtime.modelContext(harness.runId, harness.agentId);
        assert.equal(estimateContextUsage(context.entries).usageTokens, 259_753);
        assert.equal(context.entries.some((entry) => entry.kind === "compaction"), false);
        assert.equal(context.messages.some((message) => message.role === "assistant" && message.usage.totalTokens === 22_875), false);
    } finally {
        harness.journal.close();
        setup.faux.unregister();
    }
});

test("successive oversized signed tool rounds are summarized completely inside one turn and replay after restart", async () => {
    const requests: Context[] = [];
    let checkpoints = 0;
    const opaque = JSON.stringify([{ type: "reasoning.encrypted", data: "x".repeat(1_100_000), format: "google-gemini-v1", index: 0 }]);
    const setup = setupFor((context) => {
        if (isSummary(context)) return fauxAssistantMessage(`Checkpoint ${++checkpoints}`);
        requests.push(snapshot(context));
        return requests.length <= 2 ? fauxAssistantMessage([
            { type: "thinking", thinking: "", redacted: true, thinkingSignature: opaque },
            fauxToolCall("lookup", {}, { id: `lookup-${requests.length}` }),
        ], { stopReason: "toolUse" }) : fauxAssistantMessage("Finished");
    });
    const directory = mkdtempSync(join(tmpdir(), "ragents-reasoning-loop-"));
    const harness = journalHarness(setup.selection, directory);
    const manager = new AgentRuntimeManager({ modelRuntime: setup.modelRuntime, thinkingLevel: "xhigh" });
    try {
        const finished = await turnOf(harness, manager, "Complete this task", { tools: [nativeTool("lookup")], invoke: async () => "Result" });
        assert.equal(finished.result.failure, null);
        assert.equal(checkpoints, 2);
        assert.equal(requests.length, 3);
        assert.ok(requests.slice(1).every((request) => JSON.stringify(request).length < 2000));
        const events = harness.runtime.events(harness.runId);
        assert.equal(events.filter((event) => event.type === "turn.started").length, 1);
        assert.equal(events.filter((event) => event.type === "model.tool-result.presented").length, 2);
        assert.equal(events.filter((event) => event.type === "context.compacted").length, 2);
        const projected = harness.runtime.modelContext(harness.runId, harness.agentId);
        assert.equal(projected.entries.filter((entry) => entry.kind === "message" && entry.message.role === "assistant" && entry.message.content.some((part) => part.type === "thinking" && part.thinkingSignature === opaque)).length, 2);
        harness.journal.close();
        const replay = new Journal(directory, testServices());
        try {
            const restored = new Orchestration(replay, testServices());
            assert.deepEqual(restored.modelContext(harness.runId, harness.agentId), projected);
        } finally {
            replay.close();
        }
    } finally {
        await manager.shutdown();
        harness.journal.close();
        setup.faux.unregister();
        rmSync(directory, { recursive: true, force: true });
    }
});

test("the saved 259752-token length failure recovers with a smaller request after restart", async () => {
    const requests: Context[] = [];
    const setup = setupFor((context, limit) => {
        if (isSummary(context)) {
            assert.ok(Math.ceil(JSON.stringify(context).length / 4) + limit < 264_000);
            return fauxAssistantMessage("Preserved requirements and progress");
        }
        requests.push(snapshot(context));
        return incidentUsage(fauxAssistantMessage("Recovered"), 1000, 0, 5, 0);
    });
    const directory = mkdtempSync(join(tmpdir(), "ragents-incident-restart-"));
    const harness = journalHarness(setup.selection, directory);
    const record = (request: ReturnType<typeof harness.request>, response: AssistantMessage) => {
        const { role: _role, ...step } = response;
        request.recordContext({ kind: "step", step: { ...step, api: setup.faux.api, provider: setup.selection.provider, model: setup.selection.model } as unknown as CompletedModelStep });
    };
    const usage = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, costUsd: 0 };
    try {
        const original = harness.request("Original task");
        original.recordContext({ kind: "input", inputId: original.input.id, content: "Detailed requirement. ".repeat(8_000) });
        record(original, incidentUsage(fauxAssistantMessage("Progress"), 20_390, 229_376, 3_497));
        record(original, incidentUsage(fauxAssistantMessage([{ type: "thinking", thinking: "r".repeat(23_672) }], { stopReason: "length" }), 8_747, 244_992, 5_918));
        harness.finish(original, { failure: "Output limit", usage });
        const overflow = harness.request("Continue");
        overflow.recordContext({ kind: "input", inputId: overflow.input.id, content: "Continue" });
        record(overflow, incidentUsage(fauxAssistantMessage([{ type: "thinking", thinking: "Let" }], { stopReason: "length" }), 40_424, 219_328, 1));
        harness.finish(overflow, { failure: "Context overflow recovery failed: the summary could not be completed.", usage });
        const saved = harness.runtime.modelContext(harness.runId, harness.agentId);
        assert.equal(estimateContextUsage(saved.entries).usageTokens, 259_753);
        harness.journal.close();
        const fresh = testServices(13);
        const services = { ...fresh, newId: (kind: string) => `resumed-${fresh.newId(kind)}` };
        const journal = new Journal(directory, services);
        const runtime = new Orchestration(journal, services);
        const resumed = harnessOver(setup.selection, journal, runtime, harness.runId, harness.agentId, "resumed-");
        const manager = new AgentRuntimeManager({ modelRuntime: setup.modelRuntime, thinkingLevel: "xhigh" });
        try {
            assert.deepEqual(runtime.modelContext(harness.runId, harness.agentId), saved);
            const recovered = await turnOf(resumed, manager, "Continue the task");
            assert.equal(recovered.result.failure, null);
            assert.equal(requests.length, 1);
            assert.ok(requests[0]!.messages.reduce((sum, message) => sum + estimateTokens(message), 0) < 24_000);
            assert.ok(JSON.stringify(requests[0]).includes("Preserved requirements"));
            assert.equal(runtime.events(harness.runId).filter((event) => event.type === "context.compacted").length, 1);
        } finally {
            await manager.shutdown();
            journal.close();
        }
    } finally {
        harness.journal.close();
        setup.faux.unregister();
        rmSync(directory, { recursive: true, force: true });
    }
});

test("a completed summary that still fills the window cannot commit a checkpoint or dispatch a retry", async () => {
    let steps = 0;
    const setup = setupFor((context) => {
        if (isSummary(context)) return fauxAssistantMessage("x".repeat(1_060_000));
        steps++;
        return incidentUsage(fauxAssistantMessage([fauxToolCall("lookup", {}, { id: "lookup" })], { stopReason: "toolUse" }), 20_390, 229_376, 3_497);
    });
    const harness = journalHarness(setup.selection);
    const manager = new AgentRuntimeManager({ modelRuntime: setup.modelRuntime, thinkingLevel: "xhigh" });
    try {
        const failed = await turnOf(harness, manager, "Requirement. ".repeat(12_000), { tools: [nativeTool("lookup")] });
        assert.match(failed.result.failure!, /do not reduce the request enough to fit/);
        assert.equal(steps, 1);
        assert.equal(harness.runtime.events(harness.runId).some((event) => event.type === "context.compacted"), false);
    } finally {
        await manager.shutdown();
        harness.journal.close();
        setup.faux.unregister();
    }
});

for (const replay of [undefined, "all", "current-turn"] as const) {
    test(`reasoning replay ${replay ?? "default"} preserves the current turn through tool calls, hooks and steering`, async () => {
        const requests: Context[] = [];
        const setup = setupFor((context) => {
            requests.push(snapshot(context));
            return requests.length === 2 ? fauxAssistantMessage([{ type: "thinking", thinking: "Current thought", thinkingSignature: "current-signature" }, fauxToolCall("lookup", {}, { id: "lookup" })], { stopReason: "toolUse" })
                : fauxAssistantMessage([{ type: "thinking", thinking: requests.length === 1 ? "Prior thought" : "Done thinking", thinkingSignature: "signature" }, { type: "text", text: "Done" }]);
        }, replay);
        const harness = journalHarness(setup.selection);
        const manager = new AgentRuntimeManager({ modelRuntime: setup.modelRuntime, thinkingLevel: "xhigh", resolveHooks: () => [{ id: "test.note", beforeModelCall: async () => "Transient note" }] });
        try {
            assert.equal((await turnOf(harness, manager, "First task")).result.failure, null);
            let steered = false;
            const request = harness.request("Second task", { tools: [nativeTool("lookup")] });
            const requestRecord = request.recordContext;
            const result = await manager.runTurn({ ...request, claimSteering: () => {
                if (requests.length !== 2 || steered) return [];
                steered = true;
                return [{ input: { ...request.input, id: "steered", content: "Steering" }, prompt: "Steering", orientation: "", attachments: [] }];
            }, recordContext: (entry) => {
                requestRecord(entry.kind === "input" && entry.inputId === "steered" ? { ...entry, inputId: null } : entry);
            } }, new AbortController().signal);
            assert.equal(harness.finish(request, result).failure, null);
            const prior = requests[1]!.messages.flatMap((message) => message.role === "assistant" ? message.content.filter((part) => part.type === "thinking") : []);
            assert.equal(prior.length, replay === "current-turn" ? 0 : 1);
            assert.ok(requests[2]!.messages.some((message) => message.role === "assistant" && message.content.some((part) => part.type === "thinking" && part.thinking === "Current thought" && part.thinkingSignature === "current-signature")));
            assert.ok(JSON.stringify(requests[2]).includes("Steering"));
            assert.ok(harness.runtime.modelContext(harness.runId, harness.agentId).entries.some((entry) => entry.kind === "message" && entry.message.role === "assistant" && entry.message.content.some((part) => part.type === "thinking" && part.thinking === "Prior thought")));
        } finally {
            await manager.shutdown();
            harness.journal.close();
            setup.faux.unregister();
        }
    });
}
