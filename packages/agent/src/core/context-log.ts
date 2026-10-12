import type { AgentMessage } from "../loop/index.ts";
import { createCompactionSummaryMessage } from "./messages.ts";
import { contextToolResults, retainedToolResultMessage } from "./tool-results.ts";
import { boundedToolResult } from "./tool-result-limit.ts";

/** A compaction replaces every entry before its first kept entry with its summary. */
export interface ContextCompaction {
	kind: "compaction";
	id: string;
	summary: string;
	firstKeptId: string;
	tokensBefore: number;
	timestamp: number;
	readFiles: string[];
	modifiedFiles: string[];
	retainedToolResultIds?: string[];
}

/** One entry of an agent's model context in the order the conversation produced it. */
export type ContextLogEntry = { kind: "message"; id: string; message: AgentMessage } | ContextCompaction;

export function latestCompaction(entries: readonly ContextLogEntry[]): ContextCompaction | undefined {
	for (let index = entries.length - 1; index >= 0; index--) {
		const entry = entries[index];
		if (entry.kind === "compaction") return entry;
	}
	return undefined;
}

/** The entries the model sees: the latest compaction, the entries it keeps, and everything after it. */
export function activeContextEntries(entries: readonly ContextLogEntry[], contextWindow?: number): ContextLogEntry[] {
	const compaction = latestCompaction(entries);
	if (!compaction) return [...entries];
	const compactionIndex = entries.indexOf(compaction);
	const firstKeptIndex = entries.findIndex((entry, index) => index < compactionIndex && entry.id === compaction.firstKeptId);
	const retained = new Set(compaction.retainedToolResultIds ?? []);
	const results = retained.size === 0 ? [] : contextToolResults(entries.slice(0, firstKeptIndex < 0 ? compactionIndex : firstKeptIndex));
	const preserved = results.filter((result) => retained.has(result.entryId));
	if (preserved.length !== retained.size) throw new Error("Compaction names a retained tool result outside its archived context.");
	return [
		compaction,
		...preserved.map((result): ContextLogEntry => {
			const message = retainedToolResultMessage(result);
			return { kind: "message", id: result.entryId, message: { ...message, content: boundedToolResult(message.content, contextWindow) } };
		}),
		...(firstKeptIndex < 0 ? [] : entries.slice(firstKeptIndex, compactionIndex)),
		...entries.slice(compactionIndex + 1),
	];
}

export function contextEntryMessages(entry: ContextLogEntry): AgentMessage[] {
	return entry.kind === "message"
		? [entry.message]
		: [createCompactionSummaryMessage(entry.summary, entry.tokensBefore, entry.timestamp)];
}

/** The messages of the model context, compaction-aware; the order is the order of the log. */
export function contextMessages(entries: readonly ContextLogEntry[], contextWindow?: number): AgentMessage[] {
	return activeContextEntries(entries, contextWindow).flatMap(contextEntryMessages).map((message) => message.role === "toolResult"
		? { ...message, content: boundedToolResult(message.content, contextWindow) }
		: message);
}
