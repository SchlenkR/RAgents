import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { Type } from "typebox";
import { contextToolResults, toolResultLimit } from "@ragents/agent";
import { fauxAssistantMessage, fauxToolCall, type Context } from "@ragents/ai";
import { AgentRuntimeManager, Journal, Orchestration, defineRunFunction, type ToolScope } from "@ragents/engine";
import { journalHarness, turnOf, nativeTool, hooksOf, scriptedRuntime, withTokens, isSummary } from "../../../packages/ragents/tests/agent-runtime-fixture.ts";
import { executionFor, testServices } from "../../../packages/ragents/tests/support.ts";
import { compactionContribution } from "../../../plugins/ragents.compaction/server/index.ts";
import { createContextTools } from "../../../plugins/ragents.compaction/server/tools.ts";

test("file excerpts, pins, and recoverable originals survive compaction, restart, and an actor fork", async () => {
    const requests: Context[] = [];
    const original = `1\t${"x".repeat(2200)}\n2\tCritical exact file detail.`;
    let step = 0;
    const setup = scriptedRuntime("retained-files", (context) => {
        if (isSummary(context)) return fauxAssistantMessage("Continue the review with the original requirements.");
        requests.push({ ...(context.systemPrompt === undefined ? {} : { systemPrompt: context.systemPrompt }), messages: structuredClone(context.messages) });
        const calls = [
            fauxToolCall("read", { file_path: "src/example.ts" }, { id: "read-1" }),
            fauxToolCall("lookup", {}, { id: "lookup-1" }),
            fauxToolCall("context_list", { query: "Critical exact file detail" }, { id: "list-1" }),
            fauxToolCall("context_keep", { references: ["result-1"] }, { id: "keep-1" }),
            fauxToolCall("context_recall", { reference: "result-1", offset: 2000 }, { id: "recall-1" }),
        ];
        const call = calls[step++];
        return call ? withTokens(fauxAssistantMessage([call], { stopReason: "toolUse" }), step === 2 ? 5500 : 100)
            : withTokens(fauxAssistantMessage("Review complete."), 100);
    });
    const base = setup.faux.getModel();
    setup.modelRuntime.registerProvider(base.provider, {
        baseUrl: base.baseUrl, apiKey: "faux-key", api: setup.faux.api,
        models: [{ id: base.id, name: base.name, reasoning: false, input: base.input, cost: base.cost, maxTokens: base.maxTokens,
            contextWindow: 8000, compaction: { threshold: 6000, keepRecentTokens: 1500, summaryTokens: 800 } }],
    });
    const directory = mkdtempSync(join(tmpdir(), "ragents-retained-context-"));
    const harness = journalHarness(setup.selection, directory, [{ capability: "plugin.state.write", scope: { kind: "run" }, delegable: false }]);
    const manager = new AgentRuntimeManager({ modelRuntime: setup.modelRuntime, resolveHooks: hooksOf(compactionContribution(() => harness.runtime)) });
    const contextTools = createContextTools();
    const read = defineRunFunction({
        name: "read", label: "Read", description: "Read a source file.", schema: Type.Object({ file_path: Type.String() }),
        resultSchema: Type.String(), available: () => true, run: () => original,
    });
    try {
        const { result, request } = await turnOf(harness, manager, "Review the source.", {
            tools: [read, nativeTool("lookup"), ...contextTools],
            invoke: async (callId, name, input) => {
                if (name === "read") return original;
                if (name === "lookup") return "Large search output. ".repeat(250);
                const tool = contextTools.find((entry) => entry.name === name)!;
                const actor = harness.runtime.view(harness.runId).actors.find((entry) => entry.id === harness.agentId)!;
                assert.equal(actor.kind, "agent");
                assert.equal(actor.lifecycle.kind, "running");
                const turnId = actor.lifecycle.kind === "running" ? actor.lifecycle.turnId : null;
                const scope = {
                    runtime: harness.runtime, caller: { runId: harness.runId, actorId: harness.agentId, turnId },
                    context: () => ({ actorId: harness.agentId, commandId: `retention-tool:${callId}`, turnId }),
                } as unknown as ToolScope;
                return tool.run(scope, callId, input as never);
            },
        });
        assert.equal(result.failure, null);
        const compacted = harness.runtime.events(harness.runId).filter((event) => event.type === "context.compacted");
        assert.equal(compacted.length, 1);
        assert.equal(compacted[0]!.payload.retainedToolResultIds?.length, 1);
        const keptFile = requests[2]!.messages.filter((message) => message.role === "user" && Array.isArray(message.content));
        const retained = keptFile.flatMap((message) => Array.isArray(message.content)
            ? [message.content.filter((part) => part.type === "text").map((part) => part.text).join("")] : [])
            .find((text) => text.includes("Retained original tool result result-1"));
        assert.ok(retained);
        assert.match(retained, /Tool result truncated/);
        assert.ok(Buffer.byteLength(retained) <= toolResultLimit(8000));
        assert.deepEqual(requests.at(-1)!.messages.filter((message) => message.role === "toolResult" && message.isError), []);
        assert.match(JSON.stringify(requests.at(-1)!.messages), /Original result-1/);
        assert.match(JSON.stringify(requests.at(-1)!.messages), /Critical exact file detail/);
        const beforeRestart = harness.runtime.modelContext(harness.runId, harness.agentId);
        const indexedOriginal = contextToolResults(beforeRestart.entries)[0]!.message.content[0]!;
        assert.equal(indexedOriginal.type === "text" ? indexedOriginal.text : null, original);
        assert.deepEqual(contextToolResults(beforeRestart.entries).map((entry) => entry.reference), ["result-1", "result-2", "result-3", "result-4", "result-5"]);
        const pins = harness.runtime.view(harness.runId).pluginStates.find((entry) => entry.pluginId === "ragents.compaction")!;
        assert.deepEqual((pins.state as { kept: string[] }).kept, ["result-1"]);
        assert.equal(harness.runtime.view(harness.runId).turns.find((turn) => turn.id === request.turnId)!.status, "completed");
        harness.journal.close();
        const restarted = testServices();
        const services = { ...restarted, newId: (kind: string) => `restored-${restarted.newId(kind)}` };
        const journal = new Journal(directory, services);
        try {
            const restored = new Orchestration(journal, services);
            assert.deepEqual(restored.modelContext(harness.runId, harness.agentId), beforeRestart);
            assert.deepEqual(restored.view(harness.runId).pluginStates.find((entry) => entry.pluginId === "ragents.compaction")!.state, pins.state);
            const view = restored.spawnAgent({ actorId: restored.view(harness.runId).ownerId, commandId: "fork-retained" }, harness.runId, {
                handle: "fork", displayName: "Fork", prompt: "Continue.", forkOf: harness.agentId,
                execution: executionFor("agent", { profile: "agent" }), grants: [], toolNames: null,
            });
            const fork = view.actors.find((actor) => actor.handle === "fork")!;
            const forkContext = restored.modelContext(harness.runId, fork.id);
            assert.deepEqual(forkContext.messages, beforeRestart.messages);
            assert.deepEqual(contextToolResults(forkContext.entries).map((entry) => entry.reference), contextToolResults(beforeRestart.entries).map((entry) => entry.reference));
            const runFork = restored.forkRun({ commandId: "fork-run-retained" }, harness.runId, restored.view(harness.runId).revision);
            const runForkContext = restored.modelContext(runFork.id, harness.agentId);
            assert.deepEqual(runForkContext.messages, beforeRestart.messages);
            assert.equal(contextToolResults(runForkContext.entries)[0]!.message.content[0]!.type, "text");
        } finally {
            journal.close();
        }
    } finally {
        await manager.shutdown();
        harness.journal.close();
        setup.faux.unregister();
        rmSync(directory, { recursive: true, force: true });
    }
});
