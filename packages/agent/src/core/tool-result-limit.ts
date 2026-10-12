import type { ImageContent, TextContent } from "@ragents/ai";

export const TOOL_RESULT_MAX_BYTES = 32_768;
export const TOOL_RESULT_CONTEXT_FRACTION = 1 / 8;
const IMAGE_CONTEXT_BYTES = 4_800;
const encoder = new TextEncoder();
const decoder = new TextDecoder();

export const toolResultLimit = (contextWindow?: number): number =>
	contextWindow === undefined ? TOOL_RESULT_MAX_BYTES : Math.min(TOOL_RESULT_MAX_BYTES, Math.floor(contextWindow * TOOL_RESULT_CONTEXT_FRACTION));

export function textPrefix(text: string, bytes: number): string {
	const encoded = encoder.encode(text);
	let end = Math.max(0, Math.min(bytes, encoded.length));
	while (end > 0 && end < encoded.length && (encoded[end]! & 0xc0) === 0x80) end--;
	return decoder.decode(encoded.subarray(0, end));
}

export function boundedText(text: string, bytes: number, note: string): string {
	if (encoder.encode(text).length <= bytes) return text;
	const suffix = `\n\n[${note}]`;
	return textPrefix(text, Math.max(0, bytes - encoder.encode(suffix).length)) + textPrefix(suffix, bytes);
}

export function boundedToolResult(
	content: readonly (TextContent | ImageContent)[],
	contextWindow?: number,
	readMore = "Read more with the tool's offset/limit or a narrower query.",
): (TextContent | ImageContent)[] {
	const limit = toolResultLimit(contextWindow);
	const size = content.reduce((sum, part) => sum + (part.type === "text" ? encoder.encode(part.text).length : IMAGE_CONTEXT_BYTES), 0);
	if (size <= limit) return [...content];
	const imageCount = content.filter((part) => part.type === "image").length;
	const text = content.filter((part) => part.type === "text").map((part) => part.text).join("\n");
	const note = `Tool result truncated: ${encoder.encode(text).length} text bytes${imageCount ? ` and ${imageCount} images` : ""}; limit ${limit} bytes. ${readMore}`;
	const suffix = `\n\n[${note}]`;
	let remaining = Math.max(0, limit - encoder.encode(suffix).length);
	const excerpt: (TextContent | ImageContent)[] = [];
	for (const part of content) {
		if (part.type === "image") {
			if (remaining >= IMAGE_CONTEXT_BYTES) {
				excerpt.push(part);
				remaining -= IMAGE_CONTEXT_BYTES;
			}
		} else if (remaining > 0) {
			const prefix = textPrefix(part.text, remaining);
			excerpt.push({ type: "text", text: prefix });
			remaining -= encoder.encode(prefix).length;
		}
	}
	return [{ type: "text", text: textPrefix(suffix, limit) }, ...excerpt];
}
