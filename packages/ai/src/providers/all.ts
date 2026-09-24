import { MODELS } from "../models.generated.ts";
import { createModels, type MutableModels, type Provider } from "../models.ts";
import type { Api, Model } from "../types.ts";
import { openrouterProvider } from "./openrouter.ts";

/** Providers present in the generated catalog. */
export type BuiltinProvider = keyof typeof MODELS;

type BuiltinModelApi<
	TProvider extends BuiltinProvider,
	TModelId extends keyof (typeof MODELS)[TProvider],
> = (typeof MODELS)[TProvider][TModelId] extends { api: infer TApi } ? (TApi extends Api ? TApi : never) : never;

export function getBuiltinModels<TProvider extends BuiltinProvider>(
	provider: TProvider,
): Model<BuiltinModelApi<TProvider, keyof (typeof MODELS)[TProvider]>>[] {
	const models = MODELS[provider] as Record<string, Model<Api>> | undefined;
	return models
		? (Object.values(models) as Model<BuiltinModelApi<TProvider, keyof (typeof MODELS)[TProvider]>>[])
		: [];
}

/** All built-in providers, freshly constructed. */
export function builtinProviders(): Provider[] {
	return [openrouterProvider()];
}

/** A `Models` collection with every built-in provider registered. */
export function builtinModels(): MutableModels {
	const models = createModels();
	for (const provider of builtinProviders()) {
		models.setProvider(provider);
	}
	return models;
}

