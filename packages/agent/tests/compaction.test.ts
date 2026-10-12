import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import { createAssistantMessageEventStream, fauxAssistantMessage, fauxToolCall, registerFauxProvider, type AssistantMessage, type Context } from "../../ai/src/index.ts";
import { compact, generateSummary, prepareCompaction } from "../src/core/compaction/compaction.ts";
import { collectUserAttachments, computeFileLists, createFileOps, extractFileOpsFromMessage, serializeConversation } from "../src/core/compaction/utils.ts";
import { activeContextEntries, contextMessages, type ContextLogEntry } from "../src/core/context-log.ts";
import { contextToolResults } from "../src/core/tool-results.ts";

const user = (id: string, content: string): Extract<ContextLogEntry, { kind: "message" }> => ({ kind: "message", id, message: { role: "user", content, timestamp: 1 } });
const assistant = (id: string, message: AssistantMessage): ContextLogEntry => ({ kind: "message", id, message });
const result = (id: string, call: string, text: string): ContextLogEntry => ({
	kind: "message", id, message: { role: "toolResult", toolCallId: call, toolName: "read", content: [{ type: "text", text }], isError: false, timestamp: 1 },
});
const values = { threshold: 6000, keepRecentTokens: 1000, summaryTokens: 800 };
const modelFor = (t: TestContext) => {
	const faux = registerFauxProvider({ models: [{ id: "compaction-unit", input: ["text", "image"] }] });
	t.after(() => faux.unregister());
	return faux.getModel();
};
const streamFor = (response: AssistantMessage, requests: Context[] = [], budgets: number[] = []) => (_model: unknown, context: Context, options?: { maxTokens?: number }) => {
	requests.push(structuredClone(context));
	budgets.push(options?.maxTokens ?? 0);
	const stream = createAssistantMessageEventStream();
	stream.end(response);
	return stream;
};

test("summarization sees the complete original file result, including details past character 2000 and tool images", async (t) => {
	const model = modelFor(t);
	const content = `${"x".repeat(2200)}\nCritical detail at the end.`;
	const entry = result("result", "read-1", content);
	assert.equal(entry.kind, "message");
	if (entry.kind !== "message" || entry.message.role !== "toolResult") throw new Error("Invalid test fixture.");
	const image = { type: "image" as const, mimeType: "image/png", data: "aW1hZ2U=" };
	entry.message.content.push(image);
	const requests: Context[] = [];
	await generateSummary([entry.message], model, 800, "faux-key", undefined, undefined, undefined, undefined, undefined,
		streamFor(fauxAssistantMessage("Complete summary."), requests));
	assert.match(serializeConversation(requests[0]!.messages), /Critical detail at the end/);
	assert.deepEqual(collectUserAttachments(requests[0]!.messages), [image]);
});

test("file inventories use file_path and separate read-only from modified files", () => {
	const operations = createFileOps();
	extractFileOpsFromMessage(fauxAssistantMessage([
		fauxToolCall("read", { file_path: "src/read.ts" }),
		fauxToolCall("read", { file_path: "src/edit.ts" }),
		fauxToolCall("write", { file_path: "src/write.ts", content: "New content." }),
		fauxToolCall("edit", { file_path: "src/edit.ts", old_string: "old", new_string: "new" }),
	]), operations);
	assert.deepEqual(computeFileLists(operations), { readFiles: ["src/read.ts"], modifiedFiles: ["src/edit.ts", "src/write.ts"] });
});

test("recompacting a split turn preserves the previous checkpoint even without additional history", async (t) => {
	const model = modelFor(t);
	const previous = "Preserve the original requirement.";
	const entries: ContextLogEntry[] = [
		user("old", "Original task."),
		user("active", "Inspect the files."),
		{ kind: "compaction", id: "previous", firstKeptId: "active", summary: previous, tokensBefore: 7000, timestamp: 2, readFiles: [], modifiedFiles: [] },
		assistant("first-call", fauxAssistantMessage([fauxToolCall("read", { file_path: "src/first.ts" }, { id: "first" })])),
		result("first-result", "first", "a".repeat(1200)),
		assistant("second-call", fauxAssistantMessage([fauxToolCall("read", { file_path: "src/second.ts" }, { id: "second" })])),
		result("second-result", "second", "b".repeat(1600)),
	];
	const prepared = prepareCompaction(entries, { ...values, keepRecentTokens: 200 })!;
	assert.equal(prepared.messagesToSummarize.length, 0);
	assert.equal(prepared.isSplitTurn, true);
	const requests: Context[] = [];
	const compacted = await compact(prepared, model, "faux-key", undefined, undefined, undefined, undefined, streamFor(fauxAssistantMessage("Updated checkpoint."), requests));
	assert.equal(requests.length, 1);
	assert.match(serializeConversation(requests[0]!.messages), /<previous-summary>\nPreserve the original requirement/);
	assert.doesNotMatch(compacted.summary, /No prior history/);
});

for (const response of [
	fauxAssistantMessage("Incomplete checkpoint", { stopReason: "length" }),
	fauxAssistantMessage([], { stopReason: "stop" }),
	fauxAssistantMessage([{ type: "thinking", thinking: "Still thinking." }]),
	fauxAssistantMessage("Cancelled", { stopReason: "aborted" }),
]) {
	test(`an incomplete or empty checkpoint cannot replace context (${response.stopReason}, ${response.content[0]?.type ?? "empty"})`, async (t) => {
		await assert.rejects(generateSummary([user("task", "Keep these constraints.").message], modelFor(t), 800, "faux-key",
			undefined, undefined, undefined, undefined, undefined, streamFor(response)), /failed:.*(incomplete|empty)/);
	});
}

test("retained excerpts remain exact, references stay stable, and their tokens reduce the recent-message budget", async (t) => {
	const model = modelFor(t);
	const original = `1\t${"x".repeat(2100)}\n2\tCritical exact file detail.`;
	const entries: ContextLogEntry[] = [
		user("task", "Inspect the source."),
		assistant("read-call", fauxAssistantMessage([fauxToolCall("read", { file_path: "src/example.ts" }, { id: "read-1" })])),
		result("file-result", "read-1", original),
		user("middle", "Earlier follow-up. ".repeat(100)),
		user("recent", "Continue. ".repeat(200)),
	];
	const prepared = prepareCompaction(entries, values, { toolResultIds: ["file-result"], contextNotes: "Recall original results with context_recall." })!;
	assert.deepEqual(prepared.retainedToolResultIds, ["file-result"]);
	const compacted = await compact(prepared, model, "faux-key", undefined, undefined, undefined, undefined, streamFor(fauxAssistantMessage("A checkpoint.")));
	const log: ContextLogEntry[] = [...entries, { kind: "compaction", id: "compact", timestamp: 3, ...compacted }];
	const projected = contextMessages(log);
	assert.ok(projected.some((message) => message.role === "user" && Array.isArray(message.content)
		&& message.content.some((part) => part.type === "text" && part.text === original)));
	assert.match(JSON.stringify(projected), /Recall original results/);
	assert.equal(projected.some((message) => message.role === "toolResult"), false);
	assert.deepEqual(contextToolResults(log).map((entry) => entry.reference), ["result-1"]);
	assert.equal(contextToolResults(log)[0]!.message.content[0]!.type, "text");
	assert.deepEqual(activeContextEntries(log).map((entry) => entry.id), ["compact", "file-result", "recent"]);
	assert.throws(() => prepareCompaction(entries, { ...values, keepRecentTokens: 100 }, { toolResultIds: ["file-result"] }), /exceed.*budget/);
	assert.throws(() => prepareCompaction(entries, values, { toolResultIds: ["unknown"] }), /unknown tool result/);
	const later = [...log, user("later", "Another follow-up. ".repeat(200))];
	const repeated = await compact(prepareCompaction(later, values, { toolResultIds: ["file-result"] })!, model, "faux-key",
		undefined, undefined, undefined, undefined, streamFor(fauxAssistantMessage("Later checkpoint.")));
	const repeatedLog: ContextLogEntry[] = [...later, { kind: "compaction", id: "compact-again", timestamp: 4, ...repeated }];
	assert.deepEqual(repeated.retainedToolResultIds, ["file-result"]);
	assert.equal(JSON.stringify(contextMessages(repeatedLog)).split("Critical exact file detail.").length, 2);
});

test("split-turn summaries share the configured output budget", async (t) => {
	const entries: ContextLogEntry[] = [
		user("old-task", "Old task."),
		assistant("old-answer", fauxAssistantMessage("Old answer.")),
		user("active-task", "New task."),
		assistant("call", fauxAssistantMessage([fauxToolCall("read", { file_path: "src/source.ts" }, { id: "read-1" })])),
		result("result", "read-1", "x".repeat(1600)),
	];
	const prepared = prepareCompaction(entries, { ...values, keepRecentTokens: 200 })!;
	const budgets: number[] = [];
	await compact(prepared, modelFor(t), "faux-key", undefined, undefined, undefined, undefined, streamFor(fauxAssistantMessage("Summary."), [], budgets));
	assert.equal(budgets.length, 2);
	assert.equal(budgets.reduce((sum, budget) => sum + budget, 0), values.summaryTokens);
	const tiny = prepareCompaction(entries, { ...values, keepRecentTokens: 200, summaryTokens: 1 })!;
	const tinyBudgets: number[] = [];
	await compact(tiny, modelFor(t), "faux-key", undefined, undefined, undefined, undefined, streamFor(fauxAssistantMessage("Summary."), [], tinyBudgets));
	assert.deepEqual(tinyBudgets, [1]);
});

test("an overfull history and a multi-MB message compact through requests below the model window", async (t) => {
	const model = { ...modelFor(t), contextWindow: 8_000, maxTokens: 800 };
	const huge = result("huge", "lookup", "generated conflict\n".repeat(200_000));
	const entries = [user("task", "Inspect."), huge, ...Array.from({ length: 60 }, (_, index) => user(`part-${index}`, `marker-${index} ${"x".repeat(1000)}`)), user("recent", "Continue.")];
	const prepared = prepareCompaction(entries, { threshold: 6000, keepRecentTokens: 10, summaryTokens: 800 })!;
	assert.ok(prepared.tokensBefore > model.contextWindow);
	const requests: Context[] = [];
	const budgets: number[] = [];
	const stream = (_model: unknown, context: Context, options?: { maxTokens?: number }) => {
		const input = Buffer.byteLength(context.systemPrompt ?? "") + Buffer.byteLength(serializeConversation(context.messages));
		assert.ok(input + (options?.maxTokens ?? 0) < model.contextWindow, "fake provider rejects any request above its window");
		return streamFor(fauxAssistantMessage(`Checkpoint ${requests.length + 1}.`), requests, budgets)(_model, context, options);
	};
	const compacted = await compact(prepared, model, "faux-key", undefined, undefined, undefined, undefined, stream);
	assert.ok(requests.length > 2);
	assert.match(JSON.stringify(requests), /Message truncated for summarization/);
	assert.match(JSON.stringify(requests.at(-1)), /marker-59/);
	assert.match(JSON.stringify(requests.at(-1)), /<previous-summary>/);
	assert.equal(compacted.summary, `Checkpoint ${requests.length}.`);
	assert.equal(compacted.firstKeptId, "recent");
});

test("a multi-MB turn prefix and previous checkpoint fit the summarizer, with explicit media omissions", async (t) => {
	const model = { ...modelFor(t), contextWindow: 8_000, maxTokens: 800 };
	const entry = result("huge-result", "read-1", "x".repeat(3_500_000));
	if (entry.kind !== "message" || entry.message.role !== "toolResult") throw new Error("Invalid test fixture.");
	entry.message.content.push(...Array.from({ length: 20 }, () => ({ type: "image" as const, mimeType: "image/png", data: "aW1hZ2U=" })));
	const requests: Context[] = [];
	const stream = (_model: unknown, context: Context, options?: { maxTokens?: number }) => {
		assert.ok(Buffer.byteLength(context.systemPrompt ?? "") + Buffer.byteLength(serializeConversation(context.messages)) + (options?.maxTokens ?? 0) < model.contextWindow);
		return streamFor(fauxAssistantMessage("Small checkpoint."), requests)(_model, context, options);
	};
	await generateSummary([entry.message], model, 800, "faux-key", undefined, undefined, undefined, "Previous requirement. ".repeat(200_000), undefined, stream);
	assert.match(JSON.stringify(requests[0]), /Previous summary truncated/);
	const prepared = prepareCompaction([user("task", "Inspect."), entry,
		assistant("call", fauxAssistantMessage([fauxToolCall("read", {}, { id: "read-2" })])), result("last", "read-2", "Done.")], { ...values, keepRecentTokens: 1 })!;
	await compact(prepared, model, "faux-key", undefined, undefined, undefined, undefined, stream);
	assert.ok(requests.some((request) => JSON.stringify(request).includes("PREFIX of a turn")));
	assert.deepEqual(collectUserAttachments(requests[0]!.messages), []);
});
