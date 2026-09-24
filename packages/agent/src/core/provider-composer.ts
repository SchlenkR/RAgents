import {
	type Api,
	type ApiKeyAuth,
	type AssistantMessageEventStream,
	type Context,
	getApiProvider,
	type InputModality,
	lazyStream,
	type Model,
	type Provider,
	type SimpleStreamOptions,
	type StreamOptions,
} from "@ragents/ai";

/** A provider registered at runtime: its models and a literal API key, over the built-in provider of the same id. */
export interface ProviderConfigInput {
	name?: string;
	baseUrl?: string;
	/** The key itself; it is sent as given, never read from the environment or a command. */
	apiKey?: string;
	api?: Api;
	models?: Array<{
		id: string;
		name: string;
		api?: Api;
		baseUrl?: string;
		reasoning: boolean;
		thinkingLevelMap?: Model<Api>["thinkingLevelMap"];
		input: InputModality[];
		cost: Model<Api>["cost"];
		contextWindow: number;
		maxTokens: number;
		compat?: Model<Api>["compat"];
	}>;
}

function registeredModels(
	providerId: string,
	models: readonly Model<Api>[],
	config: ProviderConfigInput,
): Model<Api>[] {
	if (!config.models) {
		return config.baseUrl ? models.map((model) => ({ ...model, baseUrl: config.baseUrl! })) : [...models];
	}
	return config.models.map((definition) => {
		const defaults = models.find((model) => model.id === definition.id) ?? models[0];
		const api = definition.api ?? config.api ?? defaults?.api;
		if (!api) {
			throw new Error(
				`Provider ${providerId}, model ${definition.id}: no "api" specified. Set at provider or model level.`,
			);
		}
		const baseUrl = definition.baseUrl ?? config.baseUrl ?? defaults?.baseUrl;
		if (!baseUrl) throw new Error(`Provider ${providerId}: "baseUrl" is required when defining custom models.`);
		return {
			...definition,
			api,
			provider: providerId,
			baseUrl,
			headers: undefined,
		};
	});
}

function registeredApiKeyAuth(base: Provider | undefined, apiKey: string | undefined): ApiKeyAuth | undefined {
	const inherited = base?.auth.apiKey;
	if (apiKey === undefined) return inherited;
	return {
		name: inherited?.name ?? "API key",
		check: async () => ({ type: "api_key", source: "configured API key" }),
		resolve: async (input) =>
			inherited
				? inherited.resolve({ ...input, credential: { type: "api_key", key: apiKey } })
				: { auth: { apiKey }, source: "configured API key" },
	};
}

/** Composes the built-in provider of the same id, if any, with a runtime registration. */
export function composeModelProvider(
	providerId: string,
	base: Provider | undefined,
	config: ProviderConfigInput,
): Provider {
	const getModels = () => registeredModels(providerId, base?.getModels() ?? [], config);
	getModels();
	const apiKey = registeredApiKeyAuth(base, config.apiKey);
	if (!apiKey) throw new Error(`Provider ${providerId}: no API key configured.`);

	const supportsBaseApi = (model: Model<Api>) => base?.getModels().some((entry) => entry.api === model.api) ?? false;
	const streamWith = (
		model: Model<Api>,
		context: Context,
		options: StreamOptions | undefined,
		simple: boolean,
	): AssistantMessageEventStream =>
		lazyStream(model, async () => {
			if (base && supportsBaseApi(model)) {
				return simple
					? base.streamSimple(model, context, options as SimpleStreamOptions)
					: base.stream(model, context, options);
			}
			const api = getApiProvider(model.api);
			if (!api) throw new Error(`No API provider registered for api: ${model.api}`);
			return simple
				? api.streamSimple(model, context, options as SimpleStreamOptions)
				: api.stream(model, context, options);
		});

	return {
		id: providerId,
		name: config.name ?? base?.name ?? providerId,
		baseUrl: config.baseUrl ?? base?.baseUrl,
		headers: base?.headers,
		auth: { apiKey },
		getModels,
		stream: (model, context, options) => streamWith(model, context, options, false),
		streamSimple: (model, context, options) => streamWith(model, context, options, true),
	};
}
