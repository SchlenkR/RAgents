import { aiSdkApi } from "./api/ai-sdk.lazy.ts";
import { getEnvApiKey } from "./env-api-keys.ts";
import { builtinModels } from "./providers/all.ts";
import { createFauxCore, type FauxProviderRegistration, type RegisterFauxProviderOptions } from "./providers/faux.ts";
import type {
	Api,
	ApiStreamOptions,
	AssistantMessage,
	AssistantMessageEventStream,
	Context,
	Model,
	ProviderStreamOptions,
	ProviderStreams,
	SimpleStreamOptions,
	StreamFunction,
	StreamOptions,
} from "./types.ts";

export type ApiStreamFunction = (
	model: Model<Api>,
	context: Context,
	options?: StreamOptions,
) => AssistantMessageEventStream;

export type ApiStreamSimpleFunction = (
	model: Model<Api>,
	context: Context,
	options?: SimpleStreamOptions,
) => AssistantMessageEventStream;

export interface ApiProvider<TApi extends Api = Api, TOptions extends StreamOptions = StreamOptions> {
	api: TApi;
	stream: StreamFunction<TApi, TOptions>;
	streamSimple: StreamFunction<TApi, SimpleStreamOptions>;
}

interface ApiProviderInternal {
	api: Api;
	stream: ApiStreamFunction;
	streamSimple: ApiStreamSimpleFunction;
}

type RegisteredApiProvider = {
	provider: ApiProviderInternal;
	sourceId?: string;
};

const apiProviderRegistry = new Map<string, RegisteredApiProvider>();

function wrapStream<TApi extends Api, TOptions extends StreamOptions>(
	api: TApi,
	stream: StreamFunction<TApi, TOptions>,
): ApiStreamFunction {
	return (model, context, options) => {
		if (model.api !== api) {
			throw new Error(`Mismatched api: ${model.api} expected ${api}`);
		}
		return stream(model as Model<TApi>, context, options as TOptions);
	};
}

function wrapStreamSimple<TApi extends Api>(
	api: TApi,
	streamSimple: StreamFunction<TApi, SimpleStreamOptions>,
): ApiStreamSimpleFunction {
	return (model, context, options) => {
		if (model.api !== api) {
			throw new Error(`Mismatched api: ${model.api} expected ${api}`);
		}
		return streamSimple(model as Model<TApi>, context, options);
	};
}

export function registerApiProvider<TApi extends Api, TOptions extends StreamOptions>(
	provider: ApiProvider<TApi, TOptions>,
	sourceId?: string,
): void {
	apiProviderRegistry.set(provider.api, {
		provider: {
			api: provider.api,
			stream: wrapStream(provider.api, provider.stream),
			streamSimple: wrapStreamSimple(provider.api, provider.streamSimple),
		},
		sourceId,
	});
}

export function getApiProvider(api: Api): ApiProviderInternal | undefined {
	return apiProviderRegistry.get(api)?.provider;
}

export function unregisterApiProviders(sourceId: string): void {
	for (const [api, entry] of apiProviderRegistry.entries()) {
		if (entry.sourceId === sourceId) {
			apiProviderRegistry.delete(api);
		}
	}
}

export function registerFauxProvider(options: RegisterFauxProviderOptions = {}): FauxProviderRegistration {
	const core = createFauxCore(options);
	const sourceId = `faux-provider-${Math.random().toString(36).slice(2, 10)}`;
	registerApiProvider({ api: core.api, stream: core.stream, streamSimple: core.streamSimple }, sourceId);
	return {
		api: core.api,
		models: core.models,
		getModel: core.getModel,
		state: core.state,
		setResponses: core.setResponses,
		appendResponses: core.appendResponses,
		getPendingResponseCount: core.getPendingResponseCount,
		unregister() {
			unregisterApiProviders(sourceId);
		},
	};
}

const BUILTIN_APIS: [Api, ProviderStreams][] = [["openai-completions", aiSdkApi()]];

const builtinApiProviderInstances = new Map<Api, ReturnType<typeof getApiProvider>>();

// Registriert die eingebauten APIs, ohne bereits registrierte Overrides zu überschreiben.
export function registerBuiltInApiProviders(): void {
	for (const [api, streams] of BUILTIN_APIS) {
		if (!getApiProvider(api)) {
			registerApiProvider({ api, stream: streams.stream, streamSimple: streams.streamSimple });
		}
		builtinApiProviderInstances.set(api, getApiProvider(api));
	}
}

registerBuiltInApiProviders();

const registryModels = builtinModels();
const AMBIENT_AUTH_MARKER = "<authenticated>";

function hasExplicitApiKey(apiKey: string | undefined): apiKey is string {
	return typeof apiKey === "string" && apiKey.trim().length > 0;
}

function withEnvApiKey<TOptions extends StreamOptions>(
	model: Model<Api>,
	options: TOptions | undefined,
): TOptions | undefined {
	if (hasExplicitApiKey(options?.apiKey)) return options;
	const apiKey = getEnvApiKey(model.provider, options?.env);
	if (!apiKey || apiKey === AMBIENT_AUTH_MARKER) return options;
	return { ...options, apiKey } as TOptions;
}

function hasResolvedCloudflareAuth(options: StreamOptions | undefined): boolean {
	return hasExplicitApiKey(options?.apiKey) || typeof options?.headers?.["cf-aig-authorization"] === "string";
}

function getBuiltinProviderForModel(model: Model<Api>) {
	if (getApiProvider(model.api) !== builtinApiProviderInstances.get(model.api)) return undefined;
	const provider = registryModels.getProvider(model.provider);
	return provider?.getModels().some((candidate) => candidate.api === model.api) ? provider : undefined;
}

function resolveApiProvider(api: Api) {
	const provider = getApiProvider(api);
	if (!provider) {
		throw new Error(`No API provider registered for api: ${api}`);
	}
	return provider;
}

export function stream<TApi extends Api>(
	model: Model<TApi>,
	context: Context,
	options?: ProviderStreamOptions,
): AssistantMessageEventStream {
	const builtinProvider = getBuiltinProviderForModel(model);
	if (builtinProvider) {
		if (model.provider.startsWith("cloudflare-") && !hasResolvedCloudflareAuth(options)) {
			return registryModels.stream(model, context, options as ApiStreamOptions<TApi> | undefined);
		}
		return builtinProvider.stream(model, context, withEnvApiKey(model, options) as ApiStreamOptions<TApi>);
	}
	const provider = resolveApiProvider(model.api);
	return provider.stream(model, context, withEnvApiKey(model, options) as StreamOptions);
}

export async function complete<TApi extends Api>(
	model: Model<TApi>,
	context: Context,
	options?: ProviderStreamOptions,
): Promise<AssistantMessage> {
	return stream(model, context, options).result();
}

export function streamSimple<TApi extends Api>(
	model: Model<TApi>,
	context: Context,
	options?: SimpleStreamOptions,
): AssistantMessageEventStream {
	const builtinProvider = getBuiltinProviderForModel(model);
	if (builtinProvider) {
		if (model.provider.startsWith("cloudflare-") && !hasResolvedCloudflareAuth(options)) {
			return registryModels.streamSimple(model, context, options);
		}
		return builtinProvider.streamSimple(model, context, withEnvApiKey(model, options));
	}
	const provider = resolveApiProvider(model.api);
	return provider.streamSimple(model, context, withEnvApiKey(model, options));
}

export async function completeSimple<TApi extends Api>(
	model: Model<TApi>,
	context: Context,
	options?: SimpleStreamOptions,
): Promise<AssistantMessage> {
	return streamSimple(model, context, options).result();
}
