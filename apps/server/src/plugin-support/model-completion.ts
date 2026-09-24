import { createModels, getSupportedThinkingLevels, type Api, type Model } from "@ragents/ai";
import { openrouterProvider } from "@ragents/ai/providers/openrouter";
import type { ThinkingLevel } from "@ragents/engine";

/** One question to a model, without history and without tools. */
export interface TextCompletionRequest {
  readonly systemPrompt: string;
  readonly text: string;
  readonly thinking: ThinkingLevel;
  readonly temperature: number;
  readonly maxTokens: number;
  readonly timeoutMs: number;
  readonly signal: AbortSignal;
}

/** Text only when the model finished and answered with nothing but text; a cut, failed or aborted answer is unfinished. */
export type TextCompletion =
  | { readonly kind: "text"; readonly text: string }
  | { readonly kind: "unfinished" }
  | { readonly kind: "not-text" };

export interface CompletionModel {
  readonly id: string;
  readonly thinkingLevels: readonly ThinkingLevel[];
  readonly complete: (request: TextCompletionRequest) => Promise<TextCompletion>;
}

/** An OpenRouter model of the built-in catalog that answers over the fastest provider and never retries; the key comes from OPENROUTER_API_KEY. */
export const openRouterCompletionModel = (id: string): CompletionModel | undefined => {
  const models = createModels();
  models.setProvider(openrouterProvider());
  const selected = models.getModel("openrouter", id);
  if (!selected) return undefined;
  const model: Model<Api> = { ...selected, compat: { ...selected.compat,
    openRouterRouting: { ...selected.compat?.openRouterRouting, sort: "latency" },
  } };
  return {
    id,
    thinkingLevels: getSupportedThinkingLevels(selected),
    complete: async (request) => {
      const response = await models.completeSimple(model, {
        systemPrompt: request.systemPrompt,
        messages: [{ role: "user", content: request.text, timestamp: Date.now() }],
      }, {
        // An omitted effort is the off setting of the model; OpenRouter gets it explicitly.
        reasoning: request.thinking === "off" ? undefined : request.thinking,
        temperature: request.temperature,
        maxTokens: request.maxTokens,
        maxRetries: 0,
        timeoutMs: request.timeoutMs,
        signal: request.signal,
      });
      if (response.stopReason !== "stop") return { kind: "unfinished" };
      if (response.content.some((part) => part.type !== "text" && part.type !== "thinking")) return { kind: "not-text" };
      return { kind: "text", text: response.content.flatMap((part) => part.type === "text" ? [part.text] : []).join("") };
    },
  };
};
