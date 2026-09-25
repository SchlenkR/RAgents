import { Type } from "typebox";
import { DomainError, isThinkingLevel, type StartOptionContribution, type ThinkingLevel } from "@ragents/engine";
import { displayProvider } from "./model-aliases.js";
import type { ModelChoice } from "./model-choice.js";
import type { SystemPromptCatalog } from "./system-prompts.js";
import { modelStartOptionId, systemPromptStartOptionId } from "../ragents/start-option-state.js";

export interface ModelStartOptionValue {
  model: string;
  thinking?: ThinkingLevel;
}

export interface SystemPromptStartOptionValue {
  promptIds: readonly string[];
  shareWithAgents: boolean;
}

const modelSchema = Type.Object({
  model: Type.String({ minLength: 1 }),
  thinking: Type.Optional(Type.String({ minLength: 1 })),
}, { additionalProperties: false });

const systemPromptSchema = Type.Object({
  promptIds: Type.Array(Type.String({ minLength: 1 })),
  shareWithAgents: Type.Boolean(),
}, { additionalProperties: false });

export const modelStartOption = (choice: ModelChoice, preferredThinking: ThinkingLevel | (() => ThinkingLevel)): StartOptionContribution => {
  const resolved = (model: string, wanted: string | undefined): ModelStartOptionValue => {
    if (!choice.options.includes(model)) {
      throw new DomainError("model-unknown", `Das Modell ${model} steht nicht zur Wahl.`, 404);
    }
    const allowed = choice.thinkingOptionsFor(model);
    if (wanted !== undefined) {
      if (!isThinkingLevel(wanted) || !allowed.includes(wanted)) {
        throw new DomainError(
          "thinking-unknown",
          `Das Reasoning ${wanted} steht für dieses Modell nicht zur Wahl (gültig: ${allowed.join(", ")}).`,
          400,
        );
      }
      return { model, thinking: wanted };
    }
    const coordinatorThinking = typeof preferredThinking === "function" ? preferredThinking() : preferredThinking;
    const preferred = model === choice.defaultModel ? coordinatorThinking : choice.defaultThinkingFor?.(model) ?? coordinatorThinking;
    const thinking = allowed.includes(preferred) ? preferred : allowed[0];
    return thinking ? { model, thinking } : { model };
  };
  return {
    id: modelStartOptionId,
    schema: modelSchema,
    rights: ["runs.inspect"],
    changeable: true,
    selectable: () => choice.selectable,
    defaultValue: () => ({ ...resolved(choice.defaultModel, undefined) }),
    accept: (value) => {
      const { model, thinking } = value as unknown as ModelStartOptionValue;
      return { ...resolved(model, thinking) };
    },
    describe: (value) => {
      const { model } = value as unknown as ModelStartOptionValue;
      return {
        kind: "model",
        provider: displayProvider(choice.provider),
        options: [...choice.options],
        thinkingOptions: [...choice.thinkingOptionsFor(model)],
      };
    },
  };
};

export const systemPromptStartOption = (catalog: () => SystemPromptCatalog): StartOptionContribution => ({
  id: systemPromptStartOptionId,
  schema: systemPromptSchema,
  rights: ["runs.inspect"],
  selectable: () => catalog().mode === "selectable" && catalog().options.length > 0,
  defaultValue: () => ({ promptIds: [...catalog().defaultIds], shareWithAgents: catalog().shareDefault }),
  accept: (value) => {
    const { promptIds, shareWithAgents } = value as unknown as SystemPromptStartOptionValue;
    const current = catalog();
    for (const promptId of promptIds) {
      if (!current.options.some((option) => option.id === promptId)) {
        throw new DomainError("prompt-unknown", `Der Systemprompt ${promptId} ist nicht konfiguriert.`, 404);
      }
    }
    const duplicate = promptIds.find((id, index) => promptIds.indexOf(id) !== index);
    if (duplicate) throw new DomainError("prompt-duplicate", `Der Systemprompt ${duplicate} steht doppelt.`, 400);
    return { promptIds: [...promptIds], shareWithAgents };
  },
  describe: () => {
    const current = catalog();
    return {
      kind: "system-prompt",
      mode: current.mode,
      options: current.options.map((option) => ({ id: option.id, label: option.label, text: option.text })),
    };
  },
});

export interface ProductStartOptionSources {
  modelChoice: ModelChoice;
  coordinatorThinking: ThinkingLevel | (() => ThinkingLevel);
  systemPrompts: () => SystemPromptCatalog;
}

export const productStartOptions = (sources: ProductStartOptionSources): StartOptionContribution[] => [
  ...(sources.systemPrompts().options.length > 0 ? [systemPromptStartOption(sources.systemPrompts)] : []),
  modelStartOption(sources.modelChoice, sources.coordinatorThinking),
];
