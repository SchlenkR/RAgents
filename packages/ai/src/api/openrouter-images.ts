import { convertDataContentToBase64String, generateText } from "ai";
import type {
	AssistantImages,
	ImagesContext,
	ImagesFunction,
	ImagesModel,
	ImagesOptions,
} from "../types.ts";
import { formatProviderError, normalizeProviderError } from "../utils/error-body.ts";
import { sanitizeSurrogates } from "../utils/sanitize-unicode.ts";
import { createSdkProvider } from "./ai-sdk-transport.ts";

export const generateImages: ImagesFunction<"openrouter-images", ImagesOptions> = async (
	model: ImagesModel<"openrouter-images">,
	context: ImagesContext,
	options?: ImagesOptions,
) => {
	const output: AssistantImages = {
		api: model.api,
		provider: model.provider,
		model: model.id,
		output: [],
		stopReason: "stop",
		timestamp: Date.now(),
	};

	try {
		const provider = createSdkProvider(model, options ?? {});
		const result = await generateText({
			model: provider.chat(model.id, {
				extraBody: {
					stream: false,
					modalities: model.output.includes("text") ? ["image", "text"] : ["image"],
				},
			}),
			messages: [{
				role: "user",
				content: context.input.map((item) => item.type === "text"
					? { type: "text" as const, text: sanitizeSurrogates(item.text) }
					: { type: "file" as const, data: item.data, mediaType: item.mimeType }),
			}],
			maxRetries: options?.maxRetries ?? 0,
			abortSignal: options?.signal,
			timeout: options?.timeoutMs,
		});
		if (result.files.length === 0) throw new Error("Image generation returned no images");
		const images = result.files.map((file) => ({
			type: "image" as const,
			mimeType: file.mediaType,
			data: convertDataContentToBase64String(file.uint8Array),
		}));
		output.responseId = result.response.id;
		const rawUsage = result.steps[0]?.usage.raw;
		if (rawUsage) {
			output.usage = parseUsage(rawUsage, model);
		}
		if (result.text.length > 0) {
			output.output.push({ type: "text", text: result.text });
		}
		output.output.push(...images);
		return output;
	} catch (error) {
		output.stopReason = options?.signal?.aborted ? "aborted" : "error";
		output.errorMessage = formatProviderError(normalizeProviderError(error));
		return output;
	}
};

function parseUsage(
	rawUsage: {
		prompt_tokens?: number;
		completion_tokens?: number;
		prompt_tokens_details?: { cached_tokens?: number; cache_write_tokens?: number };
	},
	model: ImagesModel<"openrouter-images">,
) {
	const promptTokens = rawUsage.prompt_tokens || 0;
	const cacheReadTokens = rawUsage.prompt_tokens_details?.cached_tokens || 0;
	const cacheWriteTokens = rawUsage.prompt_tokens_details?.cache_write_tokens || 0;
	const input = Math.max(0, promptTokens - cacheReadTokens - cacheWriteTokens);
	const output = rawUsage.completion_tokens || 0;
	const usage = {
		input,
		output,
		cacheRead: cacheReadTokens,
		cacheWrite: cacheWriteTokens,
		totalTokens: input + output + cacheReadTokens + cacheWriteTokens,
		cost: {
			input: (model.cost.input / 1000000) * input,
			output: (model.cost.output / 1000000) * output,
			cacheRead: (model.cost.cacheRead / 1000000) * cacheReadTokens,
			cacheWrite: (model.cost.cacheWrite / 1000000) * cacheWriteTokens,
			total: 0,
		},
	};
	usage.cost.total = usage.cost.input + usage.cost.output + usage.cost.cacheRead + usage.cost.cacheWrite;
	return usage;
}
