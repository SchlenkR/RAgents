import assert from "node:assert/strict";
import test from "node:test";
import { boundedToolResult, toolResultLimit, TOOL_RESULT_MAX_BYTES } from "../src/core/tool-result-limit.ts";
import { contextMessages, type ContextLogEntry } from "../src/core/context-log.ts";

test("one limit covers the whole result, including Unicode text, multiple blocks and images", () => {
	const original = [{ type: "text" as const, text: "äöü".repeat(500_000) }, { type: "text" as const, text: "tail" },
		...Array.from({ length: 30 }, () => ({ type: "image" as const, mimeType: "image/png", data: "aW1hZ2U=" }))];
	const bounded = boundedToolResult(original, 16_000);
	const text = bounded.filter((part) => part.type === "text").map((part) => part.text).join("");
	assert.ok(Buffer.byteLength(text) <= toolResultLimit(16_000));
	assert.match(text, /Tool result truncated: 3000005 text bytes and 30 images/);
	assert.match(text, /offset\/limit/);
	assert.equal(text.includes("\uFFFD"), false);
	assert.equal(original[0]!.text!.length, 1_500_000);
	assert.equal(toolResultLimit(1_048_576), TOOL_RESULT_MAX_BYTES);
});

test("replay and retained snapshots bound a legacy result while keeping the original log intact", () => {
	const original = "generated conflict\n".repeat(200_000);
	const entries: ContextLogEntry[] = [{ kind: "message", id: "result", message: {
		role: "toolResult", toolCallId: "call", toolName: "lookup", content: [{ type: "text", text: original }], isError: false, timestamp: 1,
	} }];
	const result = contextMessages(entries)[0]!;
	assert.equal(result.role, "toolResult");
	assert.ok(Buffer.byteLength(result.role === "toolResult" ? result.content.filter((part) => part.type === "text").map((part) => part.text).join("") : "") <= TOOL_RESULT_MAX_BYTES);
	entries.push({ kind: "compaction", id: "checkpoint", firstKeptId: "checkpoint", summary: "Keep working.", tokensBefore: 900_000,
		timestamp: 2, readFiles: [], modifiedFiles: [], retainedToolResultIds: ["result"] });
	const retained = JSON.stringify(contextMessages(entries, 16_000));
	for (const message of contextMessages(entries, 16_000)) {
		if (message.role === "user" && Array.isArray(message.content)) {
			assert.ok(Buffer.byteLength(message.content.filter((part) => part.type === "text").map((part) => part.text).join("")) <= toolResultLimit(16_000));
		}
	}
	assert.match(retained, /Retained original tool result result-1/);
	assert.match(retained, /Tool result truncated/);
	assert.ok(retained.length < toolResultLimit(16_000) * 2);
	assert.equal(entries[0]!.kind === "message" && entries[0]!.message.role === "toolResult" && entries[0]!.message.content[0]!.type === "text"
		&& entries[0]!.message.content[0]!.text, original);
});
