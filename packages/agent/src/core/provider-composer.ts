import {
	type Api,
	type ApiKeyAuth,
	type AssistantMessageEventStream,
	type Context,
	getApiProvider,
	type InputModality,
	lazyStream,
	reasoningReplayProblem,
	type Model,
	type ModelCompaction,
	type Provider,
	type SimpleStreamOptions,
	type StreamOptions,
} from "@ragents/ai";
import { compactionProblem } from "./compaction/compaction.ts";

/** A provider registered at runtime with its models and a literal API key. */
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
		sdk?: Model<Api>["sdk"];
		reasoning: boolean;
		thinkingLevelMap?: Model<Api>["thinkingLevelMap"];
		input: InputModality[];
		cost: Model<Api>["cost"];
		contextWindow: number;
		maxTokens: number;
		compaction?: ModelCompaction;
		reasoningReplay?: Model<Api>["reasoningReplay"];
		compat?: Model<Api>["compat"];
	}>;
}

function registeredModels(
	providerId: string,
	config: ProviderConfigInput,
): Model<Api>[] {
	if (!config.models?.length) throw new Error(`Provider ${providerId}: "models" needs at least one configured model.`);
	return config.models.map((definition) => {
		const api = definition.api ?? config.api;
		if (!api) {
			throw new Error(
				`Provider ${providerId}, model ${definition.id}: no "api" specified. Set at provider or model level.`,
			);
		}
		const baseUrl = definition.baseUrl ?? config.baseUrl;
		if (!baseUrl) throw new Error(`Provider ${providerId}: "baseUrl" is required when defining custom models.`);
		const problem = reasoningReplayProblem(definition.reasoningReplay)
			?? (definition.compaction === undefined ? undefined : compactionProblem(definition.compaction, definition));
		if (problem) throw new Error(`Provider ${providerId}, model ${definition.id}: ${problem}.`);
		return {
			...definition,
			api,
			provider: providerId,
			baseUrl,
			headers: undefined,
		};
	});
}

function registeredApiKeyAuth(apiKey: string): ApiKeyAuth {
	return {
		name: "API key",
		check: async () => ({ type: "api_key", source: "configured API key" }),
		resolve: async () => ({ auth: { apiKey }, source: "configured API key" }),
	};
}

/** Composes a configured provider without inherited models or credentials. */
export function composeModelProvider(providerId: string, config: ProviderConfigInput): Provider {
	const models = registeredModels(providerId, config);
	if (!config.apiKey) throw new Error(`Provider ${providerId}: no API key configured.`);
	const apiKey = registeredApiKeyAuth(config.apiKey);
	const streamWith = (
		model: Model<Api>,
		context: Context,
		options: StreamOptions | undefined,
		simple: boolean,
	): AssistantMessageEventStream =>
		lazyStream(model, async () => {
			const api = getApiProvider(model.api);
			if (!api) throw new Error(`No API provider registered for api: ${model.api}`);
			return simple
				? api.streamSimple(model, context, options as SimpleStreamOptions)
				: api.stream(model, context, options);
		});

	return {
		id: providerId,
		name: config.name ?? providerId,
		baseUrl: config.baseUrl,
		auth: { apiKey },
		getModels: () => models,
		stream: (model, context, options) => streamWith(model, context, options, false),
		streamSimple: (model, context, options) => streamWith(model, context, options, true),
	};
}
