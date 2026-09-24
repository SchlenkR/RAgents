import { lazyStream } from "./api/lazy.ts";
import { defaultProviderAuthContext } from "./auth/context.ts";
import { type AuthResolutionOverrides, ModelsError, resolveProviderAuth } from "./auth/resolve.ts";
import type { AuthCheck, AuthContext, AuthResult, ProviderAuth } from "./auth/types.ts";
import type {
	Api,
	ApiStreamOptions,
	AssistantMessage,
	AssistantMessageEventStream,
	Context,
	Model,
	ModelCostRates,
	ModelThinkingLevel,
	ProviderHeaders,
	ProviderStreams,
	SimpleStreamOptions,
	StreamOptions,
	Usage,
} from "./types.ts";

export { ModelsError, type ModelsErrorCode } from "./auth/resolve.ts";

/**
 * A provider is the concrete runtime unit. It owns id/name/base metadata,
 * API-key auth, the model list, and stream behavior.
 */
export interface Provider<TApi extends Api = Api> {
	readonly id: string;
	readonly name: string;

	readonly baseUrl?: string;
	readonly headers?: ProviderHeaders;

	/** Every provider resolves an API key, even from ambient sources; unresolved means unconfigured. */
	readonly auth: ProviderAuth;

	/** The models of the provider. Must not throw; `Models` treats a throwing implementation as having no models. */
	getModels(): readonly Model<TApi>[];

	stream<T extends TApi>(
		model: Model<T>,
		context: Context,
		options?: ApiStreamOptions<T>,
	): AssistantMessageEventStream;

	streamSimple(model: Model<TApi>, context: Context, options?: SimpleStreamOptions): AssistantMessageEventStream;
}

/**
 * Runtime collection of providers plus auth application and stream
 * convenience. Providers own stream behavior; `Models` resolves auth and
 * delegates each request to the provider that owns the model.
 */
export interface Models {
	getProvider(id: string): Provider | undefined;

	/** Models of one provider or of all providers; a provider whose `getModels()` throws yields none. */
	getModels(provider?: string): readonly Model<Api>[];

	getModel(provider: string, id: string): Model<Api> | undefined;

	/** Whether a provider resolves an API key. */
	checkAuth(providerId: string): Promise<AuthCheck | undefined>;

	/**
	 * Resolve provider auth by provider id, or provider auth plus static model
	 * headers when passed a model. Resolves `undefined` when the provider is
	 * unknown or unconfigured, rejects with `ModelsError` code "auth" when
	 * the key cannot be resolved.
	 */
	getAuth(providerId: string, overrides?: AuthResolutionOverrides): Promise<AuthResult | undefined>;
	getAuth(model: Model<Api>, overrides?: AuthResolutionOverrides): Promise<AuthResult | undefined>;

	stream<TApi extends Api>(model: Model<TApi>, context: Context, options?: ApiStreamOptions<TApi>): AssistantMessageEventStream;

	complete<TApi extends Api>(model: Model<TApi>, context: Context, options?: ApiStreamOptions<TApi>): Promise<AssistantMessage>;

	streamSimple(model: Model<Api>, context: Context, options?: SimpleStreamOptions): AssistantMessageEventStream;
	completeSimple(model: Model<Api>, context: Context, options?: SimpleStreamOptions): Promise<AssistantMessage>;
}

export interface MutableModels extends Models {
	/** Upsert/replace by provider.id. Provider ids are unique. */
	setProvider(provider: Provider): void;
}

function mergeHeaders(
	base: ProviderHeaders | undefined,
	override: ProviderHeaders | undefined,
): ProviderHeaders | undefined {
	if (!base && !override) return undefined;
	const merged = { ...base };
	for (const [name, value] of Object.entries(override ?? {})) {
		const lowerName = name.toLowerCase();
		for (const existingName of Object.keys(merged)) {
			if (existingName.toLowerCase() === lowerName) delete merged[existingName];
		}
		merged[name] = value;
	}
	return merged;
}

class ModelsImpl implements MutableModels {
	private readonly providers = new Map<string, Provider>();
	private readonly authContext: AuthContext = defaultProviderAuthContext();

	setProvider(provider: Provider): void {
		this.providers.set(provider.id, provider);
	}

	getProvider(id: string): Provider | undefined {
		return this.providers.get(id);
	}

	getModels(provider?: string): readonly Model<Api>[] {
		const entries = provider !== undefined ? [this.providers.get(provider)] : [...this.providers.values()];
		return entries.flatMap((entry) => {
			if (!entry) return [];
			try {
				return entry.getModels();
			} catch {
				return [];
			}
		});
	}

	getModel(provider: string, id: string): Model<Api> | undefined {
		return this.getModels(provider).find((model) => model.id === id);
	}

	async checkAuth(providerId: string): Promise<AuthCheck | undefined> {
		const provider = this.providers.get(providerId);
		if (!provider) return undefined;
		const apiKey = provider.auth.apiKey;
		if (apiKey.check) {
			try {
				return await apiKey.check({ ctx: this.authContext });
			} catch (error) {
				throw new ModelsError("auth", `API key auth check failed for provider ${provider.id}`, { cause: error });
			}
		}
		const resolution = await resolveProviderAuth(provider, this.authContext);
		return resolution ? { source: resolution.source, type: "api_key" } : undefined;
	}

	getAuth(providerId: string, overrides?: AuthResolutionOverrides): Promise<AuthResult | undefined>;
	getAuth(model: Model<Api>, overrides?: AuthResolutionOverrides): Promise<AuthResult | undefined>;
	async getAuth(
		providerOrModel: string | Model<Api>,
		overrides?: AuthResolutionOverrides,
	): Promise<AuthResult | undefined> {
		const providerId = typeof providerOrModel === "string" ? providerOrModel : providerOrModel.provider;
		const provider = this.providers.get(providerId);
		if (!provider) return undefined;
		const result = await resolveProviderAuth(provider, this.authContext, overrides);
		if (!result || typeof providerOrModel === "string" || !providerOrModel.headers) return result;
		return {
			...result,
			auth: {
				...result.auth,
				headers: mergeHeaders(result.auth.headers, providerOrModel.headers),
			},
		};
	}

	private requireProvider(model: Model<Api>): Provider {
		const provider = this.providers.get(model.provider);
		if (!provider) {
			throw new ModelsError("provider", `Unknown provider: ${model.provider}`);
		}
		return provider;
	}

	private async applyAuth<TOptions extends StreamOptions>(
		model: Model<Api>,
		options: TOptions | undefined,
	): Promise<{ requestModel: Model<Api>; requestOptions: StreamOptions | undefined }> {
		this.requireProvider(model);
		const resolution = await this.getAuth(model, {
			apiKey: options?.apiKey,
			env: options?.env,
		});
		if (!resolution) {
			throw new ModelsError("auth", `Provider is not configured: ${model.provider}`);
		}
		const auth = resolution.auth;

		// Explicit request options win per-field.
		const apiKey = options?.apiKey ?? auth.apiKey;
		const headers = mergeHeaders(auth.headers, options?.headers);
		const env = resolution.env || options?.env ? { ...(resolution.env ?? {}), ...(options?.env ?? {}) } : undefined;
		const requestModel = auth.baseUrl ? { ...model, baseUrl: auth.baseUrl } : model;
		const requestOptions = { ...options, apiKey, headers, env } as StreamOptions;

		return { requestModel, requestOptions };
	}

	stream<TApi extends Api>(
		model: Model<TApi>,
		context: Context,
		options?: ApiStreamOptions<TApi>,
	): AssistantMessageEventStream {
		return lazyStream(model, async () => {
			const provider = this.requireProvider(model);
			const { requestModel, requestOptions } = await this.applyAuth(model, options as ApiStreamOptions<Api> | undefined);
			return provider.stream(requestModel as Model<TApi>, context, requestOptions as ApiStreamOptions<TApi>);
		});
	}

	async complete<TApi extends Api>(
		model: Model<TApi>,
		context: Context,
		options?: ApiStreamOptions<TApi>,
	): Promise<AssistantMessage> {
		return this.stream(model, context, options).result();
	}

	streamSimple(model: Model<Api>, context: Context, options?: SimpleStreamOptions): AssistantMessageEventStream {
		return lazyStream(model, async () => {
			const provider = this.requireProvider(model);
			const { requestModel, requestOptions } = await this.applyAuth(model, options);
			return provider.streamSimple(requestModel, context, requestOptions as SimpleStreamOptions);
		});
	}

	async completeSimple(model: Model<Api>, context: Context, options?: SimpleStreamOptions): Promise<AssistantMessage> {
		return this.streamSimple(model, context, options).result();
	}
}

export function createModels(): MutableModels {
	return new ModelsImpl();
}

export interface CreateProviderOptions<TApi extends Api = Api> {
	id: string;
	/** Display name. Default: `id`. */
	name?: string;
	baseUrl?: string;
	headers?: ProviderHeaders;
	auth: ProviderAuth;
	models: readonly Model<TApi>[];
	/** Single implementation, or map keyed by `model.api` for mixed-API providers. */
	api: ProviderStreams | Partial<Record<TApi, ProviderStreams>>;
}

/**
 * Builds a provider from parts. A single `api` streams all models; an `api`
 * map dispatches on `model.api`, and a model whose api has no entry produces
 * a stream error.
 */
export function createProvider<TApi extends Api = Api>(input: CreateProviderOptions<TApi>): Provider<TApi> {
	const single =
		typeof (input.api as ProviderStreams).stream === "function" ? (input.api as ProviderStreams) : undefined;
	const byApi = single ? undefined : (input.api as Partial<Record<string, ProviderStreams>>);

	const apiFor = (model: Model<Api>): ProviderStreams | undefined => single ?? byApi?.[model.api];

	const dispatch = (
		model: Model<Api>,
		run: (streams: ProviderStreams) => AssistantMessageEventStream,
	): AssistantMessageEventStream => {
		const streams = apiFor(model);
		if (!streams) {
			return lazyStream(model, async () => {
				throw new ModelsError("stream", `Provider ${input.id} has no API implementation for "${model.api}"`);
			});
		}
		return run(streams);
	};

	return {
		id: input.id,
		name: input.name ?? input.id,
		baseUrl: input.baseUrl,
		headers: input.headers,
		auth: input.auth,
		getModels: () => input.models,
		stream: (model, context, options) => dispatch(model, (streams) => streams.stream(model, context, options)),
		streamSimple: (model, context, options) =>
			dispatch(model, (streams) => streams.streamSimple(model, context, options)),
	};
}

export function calculateCost<TApi extends Api>(model: Model<TApi>, usage: Usage): Usage["cost"] {
	const inputTokens = usage.input + usage.cacheRead + usage.cacheWrite;
	let rates: ModelCostRates = model.cost;
	let matchedThreshold = -1;
	for (const tier of model.cost.tiers ?? []) {
		if (inputTokens > tier.inputTokensAbove && tier.inputTokensAbove > matchedThreshold) {
			rates = tier;
			matchedThreshold = tier.inputTokensAbove;
		}
	}

	// Anthropic charges 2x base input for 1h cache writes.
	const longWrite = usage.cacheWrite1h ?? 0;
	const shortWrite = usage.cacheWrite - longWrite;
	usage.cost.input = (rates.input / 1000000) * usage.input;
	usage.cost.output = (rates.output / 1000000) * usage.output;
	usage.cost.cacheRead = (rates.cacheRead / 1000000) * usage.cacheRead;
	usage.cost.cacheWrite = (rates.cacheWrite * shortWrite + rates.input * 2 * longWrite) / 1000000;
	usage.cost.total = usage.cost.input + usage.cost.output + usage.cost.cacheRead + usage.cost.cacheWrite;
	return usage.cost;
}

const EXTENDED_THINKING_LEVELS: ModelThinkingLevel[] = ["off", "minimal", "low", "medium", "high", "xhigh", "max"];

export function getSupportedThinkingLevels<TApi extends Api>(model: Model<TApi>): ModelThinkingLevel[] {
	if (!model.reasoning) return ["off"];

	return EXTENDED_THINKING_LEVELS.filter((level) => {
		const mapped = model.thinkingLevelMap?.[level];
		if (mapped === null) return false;
		if (level === "xhigh" || level === "max") return mapped !== undefined;
		return true;
	});
}

export function clampThinkingLevel<TApi extends Api>(
	model: Model<TApi>,
	level: ModelThinkingLevel,
): ModelThinkingLevel {
	const availableLevels = getSupportedThinkingLevels(model);
	if (availableLevels.includes(level)) return level;

	const requestedIndex = EXTENDED_THINKING_LEVELS.indexOf(level);
	if (requestedIndex === -1) return availableLevels[0] ?? "off";

	for (let i = requestedIndex; i < EXTENDED_THINKING_LEVELS.length; i++) {
		const candidate = EXTENDED_THINKING_LEVELS[i];
		if (availableLevels.includes(candidate)) return candidate;
	}
	for (let i = requestedIndex - 1; i >= 0; i--) {
		const candidate = EXTENDED_THINKING_LEVELS[i];
		if (availableLevels.includes(candidate)) return candidate;
	}
	return availableLevels[0] ?? "off";
}
