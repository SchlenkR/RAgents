import type { ModelRuntime } from "@ragents/agent";
import { createModels, getSupportedThinkingLevels, type Api, type AssistantMessage, type Context, type Model, type SimpleStreamOptions } from "@ragents/ai";
import { openrouterProvider } from "@ragents/ai/providers/openrouter";
import { serviceToken, type ServiceToken, type ThinkingLevel } from "@ragents/engine";
import { ALIAS_PROVIDER, aliasCatalog, configuredModelAliases } from "./model-aliases.js";

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

type Completer = (model: Model<Api>, context: Context, options: SimpleStreamOptions) => Promise<AssistantMessage>;

const completionModel = (id: string, model: Model<Api>, levels: Model<Api>, completeSimple: Completer): CompletionModel => ({
  id,
  thinkingLevels: getSupportedThinkingLevels(levels),
  complete: async (request) => {
    const response = await completeSimple(model, {
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
});

/** An OpenRouter model of the built-in catalog that answers over the fastest provider and never retries; the key comes from OPENROUTER_API_KEY. */
export const openRouterCompletionModel = (id: string): CompletionModel | undefined => {
  const models = createModels();
  models.setProvider(openrouterProvider());
  const selected = models.getModel("openrouter", id);
  if (!selected) return undefined;
  const model: Model<Api> = { ...selected, compat: { ...selected.compat,
    openRouterRouting: { ...selected.compat?.openRouterRouting, sort: "latency" },
  } };
  return completionModel(id, model, selected, (target, context, options) => models.completeSimple(target, context, options));
};

/** A profile alias (MODEL_ALIASES) over the server's model runtime, with the levels the alias offers; none for an unknown alias. */
export const aliasCompletionModel = (runtime: () => Promise<ModelRuntime>, alias: string): CompletionModel | undefined => {
  if (!configuredModelAliases().some((entry) => entry.alias === alias)) return undefined;
  const offered = aliasCatalog().find((model) => model.id === alias)!;
  return completionModel(alias, offered, offered, async (_model, context, options) => {
    const models = await runtime();
    const model = models.getModel(ALIAS_PROVIDER, alias);
    if (!model) throw new Error(`The model runtime offers no alias ${alias}`);
    return models.completeSimple(model, context, options);
  });
};

/** Resolves a profile alias to a completion model over the server's model runtime; plugins take it with host.service(...) and call it at any time. */
export const aliasCompletionModelToken: ServiceToken<(alias: string) => CompletionModel | undefined> = serviceToken("host.alias-completion-model");
