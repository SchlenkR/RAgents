import assert from "node:assert/strict";
import test from "node:test";
import { activeContextEntries, type ContextLogEntry, contextMessages } from "../src/core/context-log.ts";

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
