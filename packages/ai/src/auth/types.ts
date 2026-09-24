import type { ProviderEnv, ProviderHeaders } from "../types.ts";

/**
 * Request auth for a single model request. If a value cannot be expressed as
 * `apiKey`, `headers`, or `baseUrl`, it is provider config, not auth.
 */
export interface ModelAuth {
	apiKey?: string;
	headers?: ProviderHeaders;
	baseUrl?: string;
}

/** An explicitly given API key, with provider-scoped environment values. */
export interface ApiKeyCredential {
	type: "api_key";
	key?: string;
	env?: ProviderEnv;
}

/** Environment access for auth resolution. Injectable for tests and browsers. */
export interface AuthContext {
	env(name: string): Promise<string | undefined>;
}

/** Result of resolving auth for a model. */
export interface AuthResult {
	auth: ModelAuth;
	/** Provider-scoped environment/config values resolved from the credential and ambient context. */
	env?: ProviderEnv;
	/** Human-readable label of the key source, e.g. "OPENROUTER_API_KEY". */
	source?: string;
}

export interface AuthCheck {
	source?: string;
	type: "api_key";
}

/** Api-key auth: an explicitly given key, otherwise ambient sources such as environment variables. */
export interface ApiKeyAuth {
	/** Display name, e.g. "OpenRouter API key". */
	name: string;

	/** Optional side-effect-free availability check; missing means Models resolves the key. */
	check?(input: { ctx: AuthContext; credential?: ApiKeyCredential }): Promise<AuthCheck | undefined>;

	/** Resolve auth from the given credential and/or ambient sources; undefined = not configured. */
	resolve(input: { ctx: AuthContext; credential?: ApiKeyCredential }): Promise<AuthResult | undefined>;
}

export interface ProviderAuth {
	apiKey: ApiKeyAuth;
}
