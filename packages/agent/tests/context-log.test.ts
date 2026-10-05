import assert from "node:assert/strict";
import test from "node:test";
import { activeContextEntries, type ContextLogEntry, contextMessages } from "../src/core/context-log.ts";
import { estimateContextTokens, prepareCompaction } from "../src/core/compaction/compaction.ts";
import { fauxAssistantMessage, fauxToolCall } from "../../ai/src/providers/faux.ts";

const message = (id: string, text: string): ContextLogEntry => ({ kind: "message", id, message: { role: "user", content: text, timestamp: 1 } });
const compaction = (id: string, firstKeptId: string, summary: string): ContextLogEntry => ({
	kind: "compaction", id, summary, firstKeptId, tokensBefore: 10, timestamp: 2, readFiles: [], modifiedFiles: [],
});

test("the latest compaction replaces everything before its first kept entry, earlier compactions included", () => {
	const log = [
		message("a", "one"),
		message("b", "two"),
		compaction("c1", "b", "first"),
		message("d", "three"),
		message("e", "four"),
		compaction("c2", "e", "second"),
		message("f", "five"),
	];
	assert.deepEqual(activeContextEntries(log).map((entry) => entry.id), ["c2", "e", "f"]);
	assert.deepEqual(contextMessages(log).map((entry) => entry.role === "compactionSummary" ? entry.summary : entry.role === "user" ? entry.content : ""), ["second", "four", "five"]);
});

test("without a compaction the whole log is the context", () => {
	assert.deepEqual(activeContextEntries([message("a", "one"), message("b", "two")]).map((entry) => entry.id), ["a", "b"]);
});

test("context estimates ignore retained usage from before compaction and include new tool results", () => {
	const retained = fauxAssistantMessage("Kept.");
	retained.usage = { ...retained.usage, input: 100_000, output: 2, totalTokens: 100_002 };
	const log: ContextLogEntry[] = [
		message("a", "Task."),
		{ kind: "message", id: "b", message: retained },
		compaction("c", "b", "Summary."),
		message("d", "New input."),
	];
	const projected = contextMessages(log);
	const estimate = estimateContextTokens(projected, 2);
	assert.equal(estimate.lastUsageIndex, null);
	assert.ok(estimate.tokens < 100);
	const response = fauxAssistantMessage("Next.");
	response.usage = { ...response.usage, input: 100, output: 2, totalTokens: 102 };
	const withResult = estimateContextTokens([
		...projected, response,
		{ role: "toolResult", toolCallId: "call", toolName: "lookup", content: [{ type: "text", text: "x".repeat(800) }], isError: false, timestamp: 3 },
	], 2);
	assert.equal(withResult.lastUsageIndex, 3);
	assert.equal(withResult.usageTokens, 102);
	assert.ok(withResult.tokens >= 302);
});

test("compaction keeps the call with a trailing tool result larger than the recent token budget", () => {
	const input = message("input", "Look up the details.");
	const call: ContextLogEntry = {
		kind: "message", id: "call", message: fauxAssistantMessage([fauxToolCall("lookup", {}, { id: "lookup-1" })], { stopReason: "toolUse" }),
	};
	const result: ContextLogEntry = {
		kind: "message", id: "result", message: {
			role: "toolResult", toolCallId: "lookup-1", toolName: "lookup",
			content: [{ type: "text", text: "x".repeat(1_600) }], isError: false, timestamp: 1,
		},
	};
	const prepared = prepareCompaction([input, call, result], { threshold: 3_000, keepRecentTokens: 200, summaryTokens: 800 });
	assert.ok(prepared);
	assert.equal(prepared.firstKeptId, "call");
	assert.equal(prepared.isSplitTurn, true);
	assert.deepEqual(prepared.turnPrefixMessages, [input.message]);
});
