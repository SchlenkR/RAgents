import { EventSourceParserStream, type EventSourceMessage } from "eventsource-parser/stream";

function isObject(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}

function omitNulls(value: Record<string, unknown>, fields: readonly string[]) {
	for (const field of fields) if (value[field] === null) delete value[field];
}

function normalizeCompletion(value: unknown): unknown {
	if (!isObject(value) || !Array.isArray(value.choices)) return value;
	for (const choice of value.choices) {
		if (!isObject(choice)) continue;
		for (const kind of ["delta", "message"] as const) {
			const message = choice[kind];
			if (!isObject(message)) continue;
			omitNulls(message, [
				"content", "reasoning", "reasoning_content", "reasoning_text", "reasoning_details",
				"tool_calls", "refusal", "audio", "function_call", "images", "annotations",
			]);
			if (kind === "delta") omitNulls(message, ["role"]);
			if (kind === "message" && message.reasoning === undefined && typeof message.reasoning_content === "string") {
				message.reasoning = message.reasoning_content;
			}
			if (!Array.isArray(message.tool_calls)) continue;
			for (const tool of message.tool_calls) {
				if (!isObject(tool)) continue;
				if (tool.type == null && isObject(tool.function)) tool.type = "function";
				if (isObject(tool.function)) omitNulls(tool.function, ["arguments"]);
			}
		}
	}
	return value;
}

export async function normalizeOpenAiResponse(response: Response): Promise<Response> {
	if (!response.ok || !response.body) return response;
	const contentType = response.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase();
	const headers = new Headers(response.headers);
	headers.delete("content-length");
	headers.delete("content-encoding");
	const init = { status: response.status, statusText: response.statusText, headers };
	if (contentType === "application/json") {
		return new Response(JSON.stringify(normalizeCompletion(await response.json())), init);
	}
	if (contentType !== "text/event-stream") return response;
	const body = response.body
		.pipeThrough(new TextDecoderStream())
		.pipeThrough(new EventSourceParserStream())
		.pipeThrough(new TransformStream<EventSourceMessage, string>({
			transform(event, controller) {
				const data = event.data.trim() === "[DONE]" ? "[DONE]" : JSON.stringify(normalizeCompletion(JSON.parse(event.data)));
				const metadata = `${event.id === undefined ? "" : `id: ${event.id}\n`}${event.event === undefined ? "" : `event: ${event.event}\n`}`;
				controller.enqueue(`${metadata}data: ${data}\n\n`);
			},
		}))
		.pipeThrough(new TextEncoderStream());
	return new Response(body, init);
}
