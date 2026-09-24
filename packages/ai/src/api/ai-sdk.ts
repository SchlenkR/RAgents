import { jsonSchema, streamText, stepCountIs, type LanguageModelUsage, type ProviderMetadata } from "ai";
import { calculateCost, clampThinkingLevel } from "../models.ts";
import type { AssistantMessage, Context, Model, SimpleStreamOptions, StreamFunction, StreamOptions, ToolCall } from "../types.ts";
import { formatProviderError, normalizeProviderError } from "../utils/error-body.ts";
import { AssistantMessageEventStream } from "../utils/event-stream.ts";
import { parseStreamingJson } from "../utils/json-parse.ts";
import { getProviderEnvValue } from "../utils/provider-env.ts";
import { convertMessages } from "./ai-sdk-messages.ts";
import { createSdkProvider } from "./ai-sdk-transport.ts";
import { buildBaseOptions } from "./simple-options.ts";

export interface OpenRouterOptions extends StreamOptions {
	toolChoice?: "auto" | "none" | "required" | { type: "function"; function: { name: string } };
	reasoningEffort?: "minimal" | "low" | "medium" | "high" | "xhigh" | "max";
}

export const stream: StreamFunction<"openai-completions", OpenRouterOptions> = (model, context, options) => {
	const events = new AssistantMessageEventStream();
	void runStream(model, context, options, events);
	return events;
};

async function runStream(model: Model<"openai-completions">, context: Context, options: OpenRouterOptions | undefined, events: AssistantMessageEventStream) {
	const output: AssistantMessage = {
		role: "assistant",
		content: [],
		api: model.api,
		provider: model.provider,
		model: model.id,
		usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
		stopReason: "stop",
		timestamp: Date.now(),
	};
	const controller = new AbortController();
	const signal = options?.signal ? AbortSignal.any([options.signal, controller.signal]) : controller.signal;
	try {
		const retention = options?.cacheRetention ?? (getProviderEnvValue("AGENT_CACHE_RETENTION", options?.env) === "long" ? "long" : "short");
		const cacheControl = retention !== "none" && (model.compat?.cacheControlFormat === "anthropic" || model.id.startsWith("anthropic/"))
			? { type: "ephemeral" as const, ...(retention === "long" ? { ttl: "1h" as const } : {}) }
			: undefined;
		const messages = convertMessages(context, model, cacheControl);
		const provider = createSdkProvider(model, {
			...options,
			headers: { ...(retention !== "none" && options?.sessionId ? { "x-session-id": options.sessionId } : {}), ...options?.headers },
			onPayload: async (payload, target) => {
				applyRequestCompatibility(payload, model, cacheControl);
				return options?.onPayload?.(payload, target);
			},
		});
		const effort = options?.reasoningEffort;
		const offEffort = model.thinkingLevelMap?.off;
		const reasoning = effort ? { effort: model.thinkingLevelMap?.[effort] ?? effort }
			: typeof offEffort === "string" ? { effort: offEffort } : { enabled: false };
		const hasPdf = context.messages.some((message) => message.role === "user" && Array.isArray(message.content)
			&& message.content.some((part) => part.type === "file" && part.mimeType === "application/pdf"));
		const result = streamText({
			model: provider.chat(model.id),
			instructions: messages.filter((message) => message.role === "system"),
			messages: messages.filter((message) => message.role !== "system"),
			tools: Object.fromEntries((context.tools ?? []).map((tool) => [tool.name, {
				description: tool.description,
				inputSchema: jsonSchema(tool.parameters, { validate: async (value) => ({ success: true as const, value }) }),
			}])),
			toolChoice: typeof options?.toolChoice === "object" ? { type: "tool", toolName: options.toolChoice.function.name } : options?.toolChoice,
			temperature: options?.temperature,
			maxOutputTokens: options?.maxTokens,
			maxRetries: options?.maxRetries ?? 0,
			streamRetries: 0,
			abortSignal: signal,
			timeout: options?.timeoutMs,
			stopWhen: stepCountIs(1),
			includeRawChunks: true,
			onError: () => {},
			providerOptions: { openrouter: {
				...(model.reasoning ? { reasoning } : {}),
				...(model.compat?.openRouterRouting ? { provider: { ...model.compat.openRouterRouting } } : {}),
				...(hasPdf ? { plugins: [{ id: "file-parser", pdf: { engine: "native" } }] } : {}),
			} },
		});
		const indices = new Map<string, number>();
		const argumentsById = new Map<string, string>();
		const rawTools = new Map<number, { id?: string; name?: string; input: string }>();
		let rawThinkingIndex: number | undefined;
		let hasFinishReason = false;
		let finished = false;
		for await (const part of result.fullStream) {
			switch (part.type) {
				case "raw": {
					const chunk = part.rawValue as { id?: string; model?: string; choices?: Array<{ finish_reason?: string | null; delta?: {
						reasoning?: string; reasoning_content?: string; reasoning_text?: string; reasoning_details?: unknown[];
						tool_calls?: Array<{ index: number; id?: string; function?: { name?: string; arguments?: string } }>;
					} }> };
					if (chunk.id) output.responseId = chunk.id;
					if (chunk.model) output.responseModel = chunk.model;
					if (chunk.choices?.[0]?.finish_reason != null) hasFinishReason = true;
					const delta = chunk.choices?.[0]?.delta;
					for (const fragment of delta?.tool_calls ?? []) {
						const tool = rawTools.get(fragment.index) ?? { input: "" };
						tool.id ??= fragment.id;
						tool.name ??= fragment.function?.name;
						tool.input += fragment.function?.arguments ?? "";
						rawTools.set(fragment.index, tool);
						if (tool.id && tool.name && !indices.has(tool.id)) {
							const contentIndex = output.content.length;
							indices.set(tool.id, contentIndex);
							argumentsById.set(tool.id, "");
							output.content.push({ type: "toolCall", id: tool.id, name: tool.name, arguments: {} });
							events.push({ type: "toolcall_start", contentIndex, partial: output });
						}
					}
					const thinking = delta?.reasoning_content || delta?.reasoning_text;
					if (!thinking || delta?.reasoning || delta?.reasoning_details?.length) break;
					if (rawThinkingIndex === undefined) {
						rawThinkingIndex = output.content.length;
						output.content.push({ type: "thinking", thinking: "" });
						events.push({ type: "thinking_start", contentIndex: rawThinkingIndex, partial: output });
					}
					const block = output.content[rawThinkingIndex];
					if (block.type === "thinking") block.thinking += thinking;
					events.push({ type: "thinking_delta", contentIndex: rawThinkingIndex, delta: thinking, partial: output });
					break;
				}
				case "start-step":
					events.push({ type: "start", partial: output });
					break;
				case "text-start":
				case "reasoning-start": {
					const contentIndex = output.content.length;
					indices.set(part.id, contentIndex);
					output.content.push(part.type === "text-start" ? { type: "text", text: "" } : { type: "thinking", thinking: "" });
					events.push({ type: part.type === "text-start" ? "text_start" : "thinking_start", contentIndex, partial: output });
					break;
				}
				case "text-delta":
				case "reasoning-delta": {
					const contentIndex = requireIndex(indices, part.id);
					const block = output.content[contentIndex];
					if (block.type === "text") block.text += part.text;
					if (block.type === "thinking") block.thinking += part.text;
					events.push({ type: part.type === "text-delta" ? "text_delta" : "thinking_delta", contentIndex, delta: part.text, partial: output });
					break;
				}
				case "text-end":
				case "reasoning-end": {
					const contentIndex = requireIndex(indices, part.id);
					const block = output.content[contentIndex];
					if (block.type === "text") events.push({ type: "text_end", contentIndex, content: block.text, partial: output });
					if (block.type === "thinking") {
						const details = reasoningDetails(part.providerMetadata);
						if (details) block.thinkingSignature = JSON.stringify(details);
						events.push({ type: "thinking_end", contentIndex, content: block.thinking, partial: output });
					}
					break;
				}
				case "tool-input-start": {
					if (indices.has(part.id)) break;
					const contentIndex = output.content.length;
					indices.set(part.id, contentIndex);
					argumentsById.set(part.id, "");
					output.content.push({ type: "toolCall", id: part.id, name: part.toolName, arguments: {} });
					events.push({ type: "toolcall_start", contentIndex, partial: output });
					break;
				}
				case "tool-input-delta": {
					const contentIndex = requireIndex(indices, part.id);
					const input = (argumentsById.get(part.id) ?? "") + part.delta;
					argumentsById.set(part.id, input);
					(output.content[contentIndex] as ToolCall).arguments = parseStreamingJson(input);
					events.push({ type: "toolcall_delta", contentIndex, delta: part.delta, partial: output });
					break;
				}
				case "tool-call": {
					const contentIndex = requireIndex(indices, part.toolCallId);
					const toolCall = output.content[contentIndex] as ToolCall;
					const rawTool = [...rawTools.values()].find((tool) => tool.id === part.toolCallId);
					if (rawTool) toolCall.arguments = parseStreamingJson(rawTool.input);
					const details = reasoningDetails(part.providerMetadata);
					if (details) toolCall.thoughtSignature = JSON.stringify(details);
					events.push({ type: "toolcall_end", contentIndex, toolCall, partial: output });
					break;
				}
				case "finish-step": {
					output.responseId = part.response.id;
					output.responseModel = part.response.modelId;
					output.usage = convertUsage(part.usage, model);
					const details = reasoningDetails(part.providerMetadata);
					if (details) {
						const block = output.content.find((item) => item.type === "thinking");
						if (block) block.thinkingSignature = JSON.stringify(details);
						else {
							const tool = output.content.find((item) => item.type === "toolCall");
							if (tool) tool.thoughtSignature = JSON.stringify(details);
							else output.content.push({ type: "thinking", thinking: "", redacted: true, thinkingSignature: JSON.stringify(details) });
						}
					}
					break;
				}
				case "finish":
					if (part.finishReason === "stop") output.stopReason = "stop";
					else if (part.finishReason === "length") output.stopReason = "length";
					else if (part.finishReason === "tool-calls") output.stopReason = "toolUse";
					else throw new Error(`Provider finish_reason: ${part.rawFinishReason ?? part.finishReason}`);
					finished = true;
					break;
				case "abort": throw new Error(part.reason ?? "Request aborted");
				case "error": throw part.error;
			}
		}
		if (signal.aborted) throw new Error("Request aborted");
		if (!finished || !hasFinishReason) throw new Error("Provider stream ended without a finish reason");
		if (rawThinkingIndex !== undefined) {
			const block = output.content[rawThinkingIndex];
			if (block.type === "thinking") events.push({ type: "thinking_end", contentIndex: rawThinkingIndex, content: block.thinking, partial: output });
		}
		events.push({ type: "done", reason: output.stopReason as "stop" | "length" | "toolUse", message: output });
	} catch (error) {
		controller.abort();
		output.stopReason = options?.signal?.aborted ? "aborted" : "error";
		output.errorMessage = formatProviderError(normalizeProviderError(error), model.provider === "relay" ? `Relay ${model.baseUrl}` : undefined);
		events.push({ type: "error", reason: output.stopReason, error: output });
	} finally {
		events.end();
	}
}

function requireIndex(indices: Map<string, number>, id: string): number {
	const index = indices.get(id);
	if (index === undefined) throw new Error(`Provider emitted a delta without a start: ${id}`);
	return index;
}

function reasoningDetails(metadata: ProviderMetadata | undefined) {
	const details = metadata?.openrouter?.reasoning_details;
	return Array.isArray(details) && details.length > 0 ? details : undefined;
}

function convertUsage(usage: LanguageModelUsage, model: Model<"openai-completions">): AssistantMessage["usage"] {
	const cacheRead = usage.inputTokenDetails.cacheReadTokens ?? 0;
	const cacheWrite = usage.inputTokenDetails.cacheWriteTokens ?? 0;
	const input = Math.max(0, (usage.inputTokens ?? 0) - cacheRead - cacheWrite);
	const output = usage.outputTokens ?? 0;
	const result = {
		input,
		output,
		cacheRead,
		cacheWrite,
		reasoning: usage.outputTokenDetails.reasoningTokens ?? 0,
		totalTokens: input + output + cacheRead + cacheWrite,
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
	};
	calculateCost(model, result);
	return result;
}

function applyRequestCompatibility(payload: unknown, model: Model<"openai-completions">, cacheControl: { type: "ephemeral"; ttl?: "1h" } | undefined) {
	const body = payload as { messages: Array<{ role: string; reasoning?: string; reasoning_content?: string }>; tools?: Array<{ cache_control?: unknown }> };
	if (model.compat?.requiresReasoningContentOnAssistantMessages) {
		for (const message of body.messages) {
			if (message.role === "assistant") message.reasoning_content = message.reasoning ?? "";
		}
	}
	if (cacheControl && body.tools?.length) body.tools[body.tools.length - 1].cache_control = cacheControl;
	if (!body.tools && body.messages.some((message) => message.role === "tool")) body.tools = [];
}

export const streamSimple: StreamFunction<"openai-completions", SimpleStreamOptions> = (model, context, options) => {
	const reasoning = options?.reasoning ? clampThinkingLevel(model, options.reasoning) : undefined;
	return stream(model, context, {
		...buildBaseOptions(model, context, options, options?.apiKey),
		reasoningEffort: reasoning === "off" ? undefined : reasoning,
		toolChoice: (options as OpenRouterOptions | undefined)?.toolChoice,
	});
};
