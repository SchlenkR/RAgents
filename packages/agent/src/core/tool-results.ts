import type { ToolCall, ToolResultMessage, UserMessage } from "@ragents/ai";
import type { ContextLogEntry } from "./context-log.ts";
import { estimateTokens } from "./compaction/compaction.ts";

export interface ContextToolResult {
	reference: string;
	entryId: string;
	call: ToolCall | undefined;
	message: ToolResultMessage;
	tokens: number;
}

export function contextToolResults(entries: readonly ContextLogEntry[]): ContextToolResult[] {
	const calls = new Map<string, ToolCall>();
	const results: ContextToolResult[] = [];
	for (const entry of entries) {
		if (entry.kind !== "message") continue;
		if (entry.message.role === "assistant") {
			for (const block of entry.message.content) {
				if (block.type === "toolCall") calls.set(block.id, block);
			}
		} else if (entry.message.role === "toolResult") {
			const result: ContextToolResult = {
				reference: `result-${results.length + 1}`,
				entryId: entry.id,
				call: calls.get(entry.message.toolCallId),
				message: entry.message,
				tokens: 0,
			};
			results.push({ ...result, tokens: estimateTokens(retainedToolResultMessage(result)) });
		}
	}
	return results;
}

export function retainedToolResultMessage(result: ContextToolResult): UserMessage & { content: ToolResultMessage["content"] } {
	const file = result.call?.arguments.file_path;
	const source = typeof file === "string" ? `, file ${file}` : "";
	return {
		role: "user",
		content: [
			{ type: "text", text: `Retained original tool result ${result.reference}: ${result.message.toolName}${source}. Historical snapshot; read the file again for its current contents.` },
			...result.message.content,
		],
		timestamp: result.message.timestamp,
	};
}
