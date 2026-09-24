import { pluginStateKey, type JsonValue, type PluginStateScope, type RunState } from "@ragents/engine";
import { modelStartOptionId, systemPromptStartOptionId } from "../plugin-support/start-options-contract.js";

export { modelStartOptionId, systemPromptStartOptionId };

export const startOptionScope = Object.freeze({ kind: "run" } satisfies PluginStateScope);

export const storedStartOption = (state: RunState | null, optionId: string): JsonValue | undefined =>
  state?.pluginStates.get(pluginStateKey(optionId, startOptionScope))?.state;

export interface StoredSystemPrompt {
  readonly promptIds: readonly string[] | undefined;
  readonly shareWithAgents: boolean;
}

export const storedSystemPrompt = (state: RunState | null): StoredSystemPrompt => {
  const value = storedStartOption(state, systemPromptStartOptionId) as
    | { promptId?: unknown; promptIds?: unknown; shareWithAgents?: unknown }
    | undefined;
  const ids = Array.isArray(value?.promptIds)
    ? value.promptIds.filter((id): id is string => typeof id === "string")
    : typeof value?.promptId === "string" ? [value.promptId] : undefined;
  return {
    promptIds: ids,
    shareWithAgents: value?.shareWithAgents === true,
  };
};

export const storedModel = (state: RunState | null): string | undefined => {
  const value = (storedStartOption(state, modelStartOptionId) as { model?: unknown } | undefined)?.model;
  return typeof value === "string" && value ? value : undefined;
};

export const storedThinking = (state: RunState | null): string | undefined => {
  const value = (storedStartOption(state, modelStartOptionId) as { thinking?: unknown } | undefined)?.thinking;
  return typeof value === "string" && value ? value : undefined;
};
