import { isThinkingLevel, thinkingLevels, type ThinkingLevel } from "@ragents/engine";
import { modelDefaultThinking } from "./model-aliases.js";

export const checkedThinkingLevel = (value: string, label: string): ThinkingLevel => {
  if (!isThinkingLevel(value)) {
    throw new Error(`${label} hat die unbekannte Denktiefe "${value}"; erlaubt sind ${thinkingLevels.join(", ")}.`);
  }
  return value;
};

/** Die Denktiefe einer Rolle: ihr Schlüssel, sonst die Denktiefe, die der Alias ihres Modells mitbringt, sonst high. */
export const roleThinkingLevel = (configured: string | undefined, label: string, provider: string, model: string): ThinkingLevel =>
  checkedThinkingLevel(configured || modelDefaultThinking(provider, model) || "high", label);
