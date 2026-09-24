import type { ProviderEnv } from "../types.ts";
import type { AuthContext, AuthResult, ProviderAuth } from "./types.ts";

export type ModelsErrorCode = "provider" | "stream" | "auth";

export interface AuthResolutionOverrides {
	apiKey?: string;
	env?: ProviderEnv;
}

export class ModelsError extends Error {
	readonly code: ModelsErrorCode;

	constructor(code: ModelsErrorCode, message: string, options?: { cause?: unknown }) {
		super(message, options);
		this.name = "ModelsError";
		this.code = code;
	}
}

/** Auth resolution of the `Models` collection: an explicit request key wins, otherwise the provider resolves its key. */
export async function resolveProviderAuth(
	provider: { id: string; auth: ProviderAuth },
	authContext: AuthContext,
	overrides?: AuthResolutionOverrides,
): Promise<AuthResult | undefined> {
	const ctx = overrides?.env ? overlayEnvAuthContext(authContext, overrides.env) : authContext;
	const credential =
		overrides?.apiKey !== undefined ? { type: "api_key" as const, key: overrides.apiKey, env: overrides.env } : undefined;
	try {
		return await provider.auth.apiKey.resolve({ ctx, credential });
	} catch (error) {
		throw new ModelsError("auth", `API key auth failed for provider ${provider.id}`, { cause: error });
	}
}

function overlayEnvAuthContext(base: AuthContext, env: ProviderEnv): AuthContext {
	return {
		env: async (name) => env[name] || (await base.env(name)),
	};
}
