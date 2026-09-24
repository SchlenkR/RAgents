import { aiSdkApi } from "../api/ai-sdk.lazy.ts";
import { envApiKeyAuth } from "../auth/helpers.ts";
import { createProvider, type Provider } from "../models.ts";
import { OPENROUTER_MODELS } from "./openrouter.models.ts";

export function openrouterProvider(): Provider<"openai-completions"> {
	return createProvider({
		id: "openrouter",
		name: "OpenRouter",
		baseUrl: "https://openrouter.ai/api/v1",
		auth: { apiKey: envApiKeyAuth("OpenRouter API key", ["OPENROUTER_API_KEY"]) },
		models: Object.values(OPENROUTER_MODELS),
		api: aiSdkApi(),
	});
}
