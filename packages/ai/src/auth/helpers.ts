import type { ApiKeyAuth } from "./types.ts";

/** Standard api-key auth: an explicitly given key wins, otherwise the first set env var resolves. */
export function envApiKeyAuth(name: string, envVars: readonly string[]): ApiKeyAuth {
	return {
		name,
		resolve: async ({ ctx, credential }) => {
			if (credential?.key) return { auth: { apiKey: credential.key }, source: "explicit key" };
			for (const envVar of envVars) {
				const value = await ctx.env(envVar);
				if (value) return { auth: { apiKey: value }, source: envVar };
			}
			return undefined;
		},
	};
}
