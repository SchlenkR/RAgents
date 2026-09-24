import type { KnownProvider, ProviderEnv } from "./types.ts";
import { getProviderEnvValue } from "./utils/provider-env.ts";

/** Environment variable that carries the API key of each shipped provider. */
const API_KEY_ENV_VARS: Readonly<Record<KnownProvider, string>> = {
	openrouter: "OPENROUTER_API_KEY",
};

const envVarFor = (provider: string): string | undefined =>
	Object.prototype.hasOwnProperty.call(API_KEY_ENV_VARS, provider)
		? API_KEY_ENV_VARS[provider as KnownProvider]
		: undefined;

/**
 * Get the API key for a provider from its known environment variable, e.g. OPENROUTER_API_KEY.
 * Unknown providers and empty values yield undefined.
 */
export function getEnvApiKey(provider: KnownProvider, env?: ProviderEnv): string | undefined;
export function getEnvApiKey(provider: string, env?: ProviderEnv): string | undefined;
export function getEnvApiKey(provider: string, env?: ProviderEnv): string | undefined {
	const envVar = envVarFor(provider);
	if (!envVar) return undefined;
	return getProviderEnvValue(envVar, env) || undefined;
}
