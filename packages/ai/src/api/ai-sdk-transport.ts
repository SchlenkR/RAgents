import { createMistral } from "@ai-sdk/mistral";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import type { LanguageModel } from "ai";
import { isModelSdk, MODEL_SDKS } from "../models.ts";
import type { Model, ModelSdk, ProviderHeaders } from "../types.ts";
import { headersToRecord } from "../utils/headers.ts";
import { normalizeOpenAiResponse } from "./openai-compatible-response.ts";

interface SdkOptions<TModel> {
	apiKey?: string;
	headers?: ProviderHeaders;
	onPayload?: (payload: unknown, model: TModel) => unknown | Promise<unknown>;
	onResponse?: (response: { status: number; headers: Record<string, string> }, model: TModel) => void | Promise<void>;
}

interface SdkConnection {
	apiKey: string;
	headers: Record<string, string>;
	fetch: typeof globalThis.fetch;
}

/** The chat model of each sdk a configured provider can name; a model without an sdk goes through the OpenRouter provider. */
const SDK_CHAT_MODELS: Readonly<Record<ModelSdk, (modelId: string, baseURL: string, connection: SdkConnection) => LanguageModel>> = {
	mistral: (modelId, baseURL, connection) => createMistral({ baseURL, ...connection }).chat(modelId),
	"openai-compatible": (modelId, baseURL, connection) =>
		createOpenAICompatible({ baseURL, name: "openaiCompatible", includeUsage: true, ...connection }).chatModel(modelId),
};

/** Key, headers and a fetch that runs the payload hook before sending and the response hook before the body is read. */
function connectionOf<TModel extends Model<string>>(model: TModel, options: SdkOptions<TModel> | undefined, normalize: boolean): SdkConnection {
	const headers = new Headers();
	const suppressedHeaders = new Set<string>();
	for (const source of [model.headers, options?.headers]) {
		for (const [name, value] of Object.entries(source ?? {})) {
			if (value === null) {
				headers.delete(name);
				suppressedHeaders.add(name.toLowerCase());
			} else {
				headers.set(name, value);
				suppressedHeaders.delete(name.toLowerCase());
			}
		}
	}
	if (!options?.apiKey && !headers.has("authorization")) {
		throw new Error(`No API key for provider: ${model.provider}`);
	}
	return {
		apiKey: options?.apiKey ?? "unused",
		headers: headersToRecord(headers),
		fetch: async (input, init) => {
			const requestHeaders = new Headers(init?.headers);
			for (const name of suppressedHeaders) requestHeaders.delete(name);
			const payload = JSON.parse(String(init?.body));
			const replacement = await options?.onPayload?.(payload, model);
			const response = await globalThis.fetch(input, {
				...init,
				headers: requestHeaders,
				body: JSON.stringify(replacement === undefined ? payload : replacement),
			});
			try {
				await options?.onResponse?.({ status: response.status, headers: headersToRecord(response.headers) }, model);
				return normalize ? await normalizeOpenAiResponse(response) : response;
			} catch (error) {
				if (!response.body?.locked) await response.body?.cancel();
				throw error;
			}
		},
	};
}

/** The OpenRouter provider; responses of another address are normalized for its strict schemas. */
export function createSdkProvider<TModel extends Model<string>>(model: TModel, options?: SdkOptions<TModel>) {
	const normalize = !!model.baseUrl && new URL(model.baseUrl).hostname !== "openrouter.ai";
	return createOpenRouter({ baseURL: model.baseUrl, compatibility: "strict", ...connectionOf(model, options, normalize) });
}

/** The chat model that serves a model: the package of its sdk, without one the OpenRouter provider. */
export function createChatModel<TModel extends Model<string>>(model: TModel, options?: SdkOptions<TModel>): LanguageModel {
	if (model.sdk === undefined) return createSdkProvider(model, options).chat(model.id);
	if (!isModelSdk(model.sdk)) {
		throw new Error(`Model ${model.provider}/${model.id} names the unknown sdk "${String(model.sdk)}"; supported are ${MODEL_SDKS.join(", ")}`);
	}
	return SDK_CHAT_MODELS[model.sdk](model.id, model.baseUrl, connectionOf(model, options, false));
}
