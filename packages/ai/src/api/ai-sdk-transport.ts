import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import type { ImagesModel, Model, ProviderHeaders } from "../types.ts";
import { headersToRecord } from "../utils/headers.ts";

interface SdkOptions<TModel> {
	apiKey?: string;
	headers?: ProviderHeaders;
	onPayload?: (payload: unknown, model: TModel) => unknown | Promise<unknown>;
	onResponse?: (response: { status: number; headers: Record<string, string> }, model: TModel) => void | Promise<void>;
}

export function createSdkProvider<TModel extends Model<string> | ImagesModel<string>>(model: TModel, options?: SdkOptions<TModel>) {
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
	return createOpenRouter({
		baseURL: model.baseUrl,
		apiKey: options?.apiKey ?? "unused",
		headers: headersToRecord(headers),
		compatibility: "strict",
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
				return response;
			} catch (error) {
				await response.body?.cancel();
				throw error;
			}
		},
	});
}
