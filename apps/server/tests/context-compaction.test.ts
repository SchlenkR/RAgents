import assert from "node:assert/strict";
import test from "node:test";
import { Value } from "typebox/value";
import { contextToolResults, type Actor, type ContextToolResult, type JsonValue, type RunView, type ToolScope } from "@ragents/engine";
import type { ContextLogEntry } from "@ragents/agent";
import { fauxAssistantMessage, fauxToolCall } from "@ragents/ai";
import { COMPACTION_PLUGIN_ID, recalledContent, recoveryNotes, retainedResults } from "../../../plugins/ragents.compaction/server/context.ts";
import { createContextTools } from "../../../plugins/ragents.compaction/server/tools.ts";
import { compactionContribution } from "../../../plugins/ragents.compaction/server/index.ts";

const originalResults = (): ContextToolResult[] => {
  const entries: ContextLogEntry[] = [];
  for (const [index, file] of ["src/first.ts", "src/second.ts", "src/first.ts"].entries()) {
    entries.push(
      { kind: "message", id: `call-${index}`, message: fauxAssistantMessage([fauxToolCall("read", { file_path: file }, { id: `read-${index}` })]) },
      { kind: "message", id: `result-${index}`, message: { role: "toolResult", toolCallId: `read-${index}`, toolName: "read", isError: false, timestamp: index, content: [{ type: "text", text: `Source text ${index}.\n${"x".repeat(2300)}\nOriginal detail at the end ${index}.` }] } },
    );
  }
  return contextToolResults(entries);
};

const toolsHarness = (results = originalResults()) => {
  let state: JsonValue = { budgetTokens: 2000, modelReadsImages: true, kept: [] };
  const entries: ContextLogEntry[] = results.map((result) => ({ kind: "message", id: result.entryId, message: result.message }));
  for (const result of [...results].reverse()) {
    if (result.call) entries.unshift({ kind: "message", id: `call-${result.reference}`, message: fauxAssistantMessage([result.call]) });
  }
  const scope = {
    caller: { runId: "run", actorId: "worker", turnId: "turn" },
    runtime: {
      modelContext: (_run: string, actor: string) => ({ entries: actor === "worker" ? entries : [], messages: [], key: "context" }),
      view: () => ({ pluginStates: [{ pluginId: COMPACTION_PLUGIN_ID, scope: { kind: "actor", actorId: "worker" }, state }] }),
      replacePluginState: (_context: unknown, _run: string, input: { state: JsonValue }) => { state = input.state; },
    },
    context: () => ({}),
  } as unknown as ToolScope;
  const invoke = (name: string, input: JsonValue, target = scope): JsonValue => {
    const tool = createContextTools().find((entry) => entry.name === name)!;
    assert.equal(Value.Check(tool.schema, input), true);
    const output = tool.run(target, "tool-call", input as never);
    assert.equal(output instanceof Promise, false);
    assert.equal(Value.Check(tool.resultSchema, output), true);
    return output as JsonValue;
  };
  return { scope, invoke, entries, state: () => state };
};

test("search and recall need no state write grant, while pinning follows plugin.state.write", () => {
  const actor = { kind: "agent", execution: { driver: { kind: "agent" } }, grants: [] } as unknown as Actor;
  const tools = createContextTools();
  assert.deepEqual(tools.filter((tool) => tool.available(actor, {} as RunView)).map((tool) => tool.name), ["context_list", "context_recall"]);
  const granted = { ...actor, grants: [{ capability: "plugin.state.write" as const, scope: { kind: "run" as const }, delegable: false }] };
  assert.equal(tools.find((tool) => tool.name === "context_keep")!.available(granted, {} as RunView), true);
});

test("context_list searches complete originals and pages only this actor's results with stable short references", () => {
  const harness = toolsHarness();
  const first = harness.invoke("context_list", { query: "Original detail at the end", limit: 2 }) as { results: { reference: string }[]; next: string };
  assert.deepEqual(first.results.map((entry) => entry.reference), ["result-3", "result-2"]);
  assert.equal(first.next, "result-2");
  const next = harness.invoke("context_list", { before: first.next }) as { results: { reference: string }[] };
  assert.deepEqual(next.results.map((entry) => entry.reference), ["result-1"]);
  const foreign = { ...harness.scope, caller: { ...harness.scope.caller, actorId: "other" } };
  assert.deepEqual(harness.invoke("context_list", {}, foreign), { results: [] });
  assert.throws(() => harness.invoke("context_recall", { reference: "result-1" }, foreign), /Unknown tool result/);
});

test("context_recall restores exact text past the old truncation, supports paging, and rejects an invalid offset", () => {
  const harness = toolsHarness();
  const text = harness.invoke("context_recall", { reference: "result-1", offset: 2200 }) as string;
  assert.match(text, /Original detail at the end 0/);
  const first = harness.invoke("context_recall", { reference: "result-1", limit: 1200 }) as string;
  assert.match(first, /Continue with offset=1200/);
  const second = harness.invoke("context_recall", { reference: "result-1", offset: 1200, limit: 1200 }) as string;
  assert.match(second, /Characters 1200-/);
  assert.deepEqual(harness.state(), { budgetTokens: 2000, modelReadsImages: true, kept: [] });
  assert.throws(() => harness.invoke("context_recall", { reference: "result-1", offset: 99999 }), /exceeds the result/);
});

test("context_keep persists pins, enforces the model budget, and releases only the requested results", () => {
  const harness = toolsHarness();
  assert.deepEqual(harness.invoke("context_keep", { references: ["result-1", "result-2"] }), { keptCount: 2 });
  assert.deepEqual(harness.invoke("context_keep", { references: ["result-1"], keep: false }), { keptCount: 1 });
  assert.throws(() => harness.invoke("context_keep", { references: ["missing"] }), /context_list/);
  const results = originalResults();
  assert.throws(() => retainedResults(results, { budgetTokens: 1, modelReadsImages: true, kept: ["result-1"] }, 1), /allows 1/);
});

test("the automatic working set keeps the latest file excerpt, honors pins, and invalidates reads before successful edits", () => {
  const results = originalResults();
  const state = { budgetTokens: 2000, modelReadsImages: true, kept: [] };
  assert.deepEqual(retainedResults(results, state, 2000).map((entry) => entry.reference), ["result-3", "result-2"]);
  assert.ok(retainedResults(results, { ...state, kept: ["result-1"] }, 2000).some((entry) => entry.reference === "result-1"));
  const edited = [...results, {
    reference: "result-4", entryId: "edit", call: fauxToolCall("edit", { file_path: "src/first.ts", old_string: "old", new_string: "new" }),
    message: { role: "toolResult" as const, toolCallId: "edit", toolName: "edit", isError: false, timestamp: 4, content: [{ type: "text" as const, text: "Updated." }] }, tokens: 10,
  }];
  assert.deepEqual(retainedResults(edited, state, 2000).map((entry) => entry.reference), ["result-2"]);
  assert.deepEqual(retainedResults(results, state, 1), []);
  assert.ok(recoveryNotes(results, 100).length <= 400);
});

test("native recall restores image pixels from the original result and rejects models without image input", async () => {
  const results = originalResults();
  const image = { type: "image" as const, data: "aW1hZ2U=", mimeType: "image/png" };
  results[0]!.message.content.push(image);
  const state = { budgetTokens: 2000, modelReadsImages: false, kept: [] };
  assert.ok(retainedResults(results, state, 2000).every((entry) => entry.reference !== "result-1"));
  assert.throws(() => retainedResults(results, { ...state, kept: ["result-1"] }, 2000), /does not accept/);
  const harness = toolsHarness(results);
  harness.entries.push({ kind: "message", id: "recall", message: fauxAssistantMessage([fauxToolCall("context_recall", { reference: "result-1" }, { id: "recall-1" })]) });
  const contribution = compactionContribution(() => harness.scope.runtime);
  const agent = { runId: "run", agentId: "worker", audience: "agent" as const, workspace: "." };
  const outcome = { toolName: "context_recall", isError: false, toolCallId: "recall-1" };
  const restored = await contribution.afterToolCall!(agent, outcome, { signal: undefined, modelReadsImages: true });
  assert.deepEqual(restored?.content, recalledContent(results[0]!));
  assert.ok(restored?.content.some((part) => part.type === "image" && part.data === image.data));
  const rejected = await contribution.afterToolCall!(agent, outcome, { signal: undefined, modelReadsImages: false });
  assert.equal(rejected?.isError, true);
});
