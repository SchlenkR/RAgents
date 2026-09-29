import { isThinkingLevel, thinkingLevels, type ThinkingLevel } from "@ragents/engine";
import { modelDefaultThinking } from "./model-aliases.js";

export const checkedThinkingLevel = (value: string, label: string): ThinkingLevel => {
  if (!isThinkingLevel(value)) {
    throw new Error(`${label} has the unknown thinking level "${value}"; allowed are ${thinkingLevels.join(", ")}.`);
  }
  return value;
};

/** The thinking level of a role: its key, otherwise the thinking level the alias of its model brings along, otherwise high. */
export const roleThinkingLevel = (configured: string | undefined, label: string, provider: string, model: string): ThinkingLevel =>
  checkedThinkingLevel(configured || modelDefaultThinking(provider, model) || "high", label);
