import { isThinkingLevel, thinkingLevels, type ThinkingLevel } from "@aicontainer/ragents";

export const checkedThinkingLevel = (value: string, label: string): ThinkingLevel => {
  if (!isThinkingLevel(value)) {
    throw new Error(`${label} hat die unbekannte Denktiefe "${value}"; erlaubt sind ${thinkingLevels.join(", ")}.`);
  }
  return value;
};
