import type { AssistantModelMessage, FilePart, JSONValue, ModelMessage, ToolResultPart, UserContent as SdkUserContent } from "ai";
import type { Api, AssistantMessage, Context, Model, UserContent } from "../types.ts";
import { sanitizeSurrogates } from "../utils/sanitize-unicode.ts";
import { transformMessages } from "./transform-messages.ts";

type CacheControl = { type: "ephemeral"; ttl?: "1h" };

function userContent(part: UserContent): Exclude<SdkUserContent, string>[number] {
	if (part.type === "text") return { type: "text", text: sanitizeSurrogates(part.text) };
	return {
		type: "file",
		data: part.data,
		mediaType: part.mimeType,
		...(part.type === "file" ? { filename: part.filename } : {}),
	};
}

function signatureDetails(signature: string | undefined): JSONValue[] {
	if (!signature || !/^[\s]*[\[{]/.test(signature)) return [];
	const parsed: JSONValue = JSON.parse(signature);
	const details = Array.isArray(parsed) ? parsed : [parsed];
	if (details.some((detail) => !detail || typeof detail !== "object" || Array.isArray(detail)
		|| typeof detail.type !== "string" || !detail.type.startsWith("reasoning."))) {
		throw new Error("Invalid stored OpenRouter reasoning details.");
	}
	return details;
}

function assistantMessage(message: AssistantMessage): AssistantModelMessage | undefined {
	const storedDetails = message.content.flatMap((part) => signatureDetails(
		part.type === "thinking" ? part.thinkingSignature : part.type === "toolCall" ? part.thoughtSignature : undefined,
	));
	const uniqueDetails = [...new Map(storedDetails.map((detail) => [JSON.stringify(detail), detail])).values()];
	const reasoningDetails = uniqueDetails.length > 0 ? uniqueDetails : message.content.flatMap((part) =>
		part.type === "thinking" && part.thinking.trim().length > 0 && !part.redacted
			? [{ type: "reasoning.text", text: part.thinking, format: "unknown" }]
			: [],
	);
	const content: Exclude<AssistantModelMessage["content"], string> = [];
	for (const part of message.content) {
		if (part.type === "text" && part.text.trim().length > 0) {
			content.push({ type: "text", text: sanitizeSurrogates(part.text) });
		} else if (part.type === "thinking" && (part.thinking.length > 0 || reasoningDetails.length > 0)) {
			content.push({ type: "reasoning", text: part.redacted ? "" : sanitizeSurrogates(part.thinking) });
		} else if (part.type === "toolCall") {
			content.push({ type: "tool-call", toolCallId: part.id, toolName: part.name, input: part.arguments });
		}
	}
	if (content.length === 0) return undefined;
	return {
		role: "assistant",
		content,
		...(reasoningDetails.length > 0 ? { providerOptions: { openrouter: { reasoning_details: reasoningDetails } } } : {}),
	};
}

/** The breakpoint sits on the last lasting block; on a part, because the SDK merges tool messages and copies a message mark onto every result. */
function markCacheBoundary(message: ModelMessage | undefined, cacheControl: CacheControl): void {
	if (!message || message.role === "system") return;
	const lastPart = message.role === "tool" ? message.content.filter((part): part is ToolResultPart => part.type === "tool-result").at(-1)
		: message.role === "user" && Array.isArray(message.content) ? message.content.at(-1) : undefined;
	const target = lastPart ?? message;
	target.providerOptions = { ...target.providerOptions, openrouter: { ...target.providerOptions?.openrouter, cacheControl } };
}

export function convertMessages(context: Context, model: Model<Api>, cacheControl?: CacheControl): ModelMessage[] {
	const result: ModelMessage[] = [];
	if (context.systemPrompt) result.push({ role: "system", content: sanitizeSurrogates(context.systemPrompt),
		...(cacheControl ? { providerOptions: { openrouter: { cacheControl } } } : {}),
	});
	const messages = transformMessages(context.messages, model);
	let boundary: ModelMessage | undefined;
	for (let index = 0; index < messages.length; index += 1) {
		const message = messages[index]!;
		if (message.role === "user") {
			const content = typeof message.content === "string" ? sanitizeSurrogates(message.content)
				: message.content.filter((part) => part.type !== "text" || part.text.length > 0).map(userContent);
			if (typeof content === "string" || content.length > 0) result.push({ role: "user", content });
			if (!message.transient) boundary = result.at(-1);
		} else if (message.role === "assistant") {
			const converted = assistantMessage(message);
			if (converted) result.push(converted);
			boundary = result.at(-1);
		} else {
			const images: FilePart[] = [];
			while (messages[index]?.role === "toolResult") {
				const toolMessage = messages[index]!;
				if (toolMessage.role !== "toolResult") break;
				const text = toolMessage.content.filter((part) => part.type === "text").map((part) => part.text).join("\n");
				const toolImages = toolMessage.content.filter((part) => part.type === "image");
				const value = sanitizeSurrogates(text || (toolImages.length > 0 ? "(see attached image)" : "(no tool output)"));
				result.push({
					role: "tool",
					content: [{ type: "tool-result", toolCallId: toolMessage.toolCallId, toolName: toolMessage.toolName,
						output: { type: toolMessage.isError ? "error-text" : "text", value } }],
				});
				images.push(...toolImages.map((part): FilePart => ({ type: "file", data: part.data, mediaType: part.mimeType })));
				index += 1;
			}
			index -= 1;
			if (images.length > 0) result.push({ role: "user", content: [{ type: "text", text: "Attached image(s) from tool result:" }, ...images] });
			boundary = result.at(-1);
		}
	}
	if (cacheControl) markCacheBoundary(boundary, cacheControl);
	return result;
}
