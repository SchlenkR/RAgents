import assert from "node:assert/strict";
import test from "node:test";
import { activeContextEntries, type ContextLogEntry, contextMessages } from "../src/core/context-log.ts";

const message = (id: string, text: string): ContextLogEntry => ({ kind: "message", id, message: { role: "user", content: text, timestamp: 1 } });
const compaction = (id: string, firstKeptId: string, summary: string): ContextLogEntry => ({
	kind: "compaction", id, summary, firstKeptId, tokensBefore: 10, timestamp: 2, readFiles: [], modifiedFiles: [],
});

test("the latest compaction replaces everything before its first kept entry, earlier compactions included", () => {
	const log = [
		message("a", "eins"),
		message("b", "zwei"),
		compaction("c1", "b", "erste"),
		message("d", "drei"),
		message("e", "vier"),
		compaction("c2", "e", "zweite"),
		message("f", "fünf"),
	];
	assert.deepEqual(activeContextEntries(log).map((entry) => entry.id), ["c2", "e", "f"]);
	assert.deepEqual(contextMessages(log).map((entry) => entry.role === "compactionSummary" ? entry.summary : entry.role === "user" ? entry.content : ""), ["zweite", "vier", "fünf"]);
});

test("without a compaction the whole log is the context", () => {
	assert.deepEqual(activeContextEntries([message("a", "eins"), message("b", "zwei")]).map((entry) => entry.id), ["a", "b"]);
});
