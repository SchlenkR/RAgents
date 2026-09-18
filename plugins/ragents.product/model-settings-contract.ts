import type { ThinkingLevel } from "../../packages/ragents/src/domain/driver.js";

export interface ProductModelDraft {
  profiles: { name: string; model: string; thinking: ThinkingLevel }[];
}

export interface ProductModelSettings {
  profiles: (ProductModelDraft["profiles"][number] & { description: string; provider: string })[];
  models: { id: string; provider: string; label: string; thinking: readonly ThinkingLevel[] }[];
}
