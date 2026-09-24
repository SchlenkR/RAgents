import { getSupportedThinkingLevels, type Api, type Model } from "@ragents/ai";
import { getBuiltinModels, type BuiltinProvider } from "@ragents/ai/providers/all";
import { isThinkingLevel, thinkingLevels, type ThinkingLevel } from "@ragents/engine";
import type { DeclaredEnvironment } from "./plugin-config.js";

export type ModelCatalogSource = () => readonly Model<Api>[];

/** Der eingebaute Katalog eines Anbieters; ein Plugin kann einen eigenen Katalog liefern, etwa den eines Relays. */
export const builtinCatalog = (provider: string): ModelCatalogSource => () => getBuiltinModels(provider as BuiltinProvider);

export const modelThinkingOptions = (provider: string, model: string, catalog: ModelCatalogSource = builtinCatalog(provider)): readonly ThinkingLevel[] => {
  const metadata = catalog().find((entry) => entry.id === model);
  if (!metadata) throw new Error(`Das Modell ${provider}/${model} fehlt im Modellkatalog`);
  return getSupportedThinkingLevels(metadata);
};

export interface ModelChoice {
  readonly options: readonly string[];
  readonly defaultModel: string;
  readonly provider: string;
  readonly selectable: boolean;
  thinkingOptionsFor(model: string | null): readonly ThinkingLevel[];
}

export const modelChoiceEnvDescriptors = [
  { key: "AGENT_MODELS", source: "environment" },
  { key: "AGENT_MODEL_REASONING", source: "environment" },
  { key: "MODEL_SELECTABLE", source: "environment" },
] as const;

type ModelChoiceEnvironment = DeclaredEnvironment<(typeof modelChoiceEnvDescriptors)[number]["key"]>;

export const modelChoiceFromEnvironment = (
  env: ModelChoiceEnvironment,
  defaults: {
    selectable: boolean;
    provider: string;
    defaultModel: () => string;
    fallback: () => readonly string[];
    catalog?: ModelCatalogSource;
  },
): ModelChoice => {
  const catalog = defaults.catalog ?? builtinCatalog(defaults.provider);
  const raw = env.optional("MODEL_SELECTABLE");
  if (raw !== undefined && raw !== "" && raw !== "0" && raw !== "1") {
    throw new Error(`MODEL_SELECTABLE muss "0" oder "1" sein, nicht "${raw}"`);
  }
  const released = raw === undefined || raw === "" ? defaults.selectable : raw === "1";
  let resolvedOptions: readonly string[] | undefined;
  const options = (): readonly string[] => {
    if (resolvedOptions) return resolvedOptions;
    const configured = env.list("AGENT_MODELS");
    const duplicate = configured.find((model, index) => configured.indexOf(model) !== index);
    if (duplicate) throw new Error(`AGENT_MODELS nennt ${duplicate} mehrfach`);
    // Ohne AGENT_MODELS gelten die Modelle des Profils, und Agent und Koordinator dürfen dasselbe haben.
    const list = configured.length > 0 ? configured : [...new Set(defaults.fallback())];
    resolvedOptions = Object.freeze([...list]);
    return resolvedOptions;
  };
  let resolvedDefault: string | undefined;
  const defaultModel = (): string => {
    if (resolvedDefault) return resolvedDefault;
    const configured = defaults.defaultModel();
    if (!options().includes(configured))
      throw new Error(`Das Koordinator-Modell ${configured} steht nicht in AGENT_MODELS`);
    resolvedDefault = configured;
    return resolvedDefault;
  };
  let reasoning: ReadonlyMap<string, readonly ThinkingLevel[]> | undefined;
  const reasoningMap = (): ReadonlyMap<string, readonly ThinkingLevel[]> => {
    if (reasoning) return reasoning;
    const map = new Map<string, readonly ThinkingLevel[]>();
    for (const entry of env.list("AGENT_MODEL_REASONING")) {
      const separator = entry.indexOf(":");
      if (separator < 0) throw new Error(`AGENT_MODEL_REASONING: "${entry}" hat kein "<modell>: <stufen>"-Format`);
      const model = entry.slice(0, separator).trim();
      const levels = entry.slice(separator + 1).trim().split(/[\s,]+/).filter(Boolean);
      if (!options().includes(model)) throw new Error(`AGENT_MODEL_REASONING nennt ${model}, das nicht in AGENT_MODELS steht`);
      if (map.has(model)) throw new Error(`AGENT_MODEL_REASONING nennt ${model} mehrfach`);
      if (levels.length === 0) throw new Error(`AGENT_MODEL_REASONING: ${model} nennt keine Stufe`);
      const invalid = levels.find((level) => !isThinkingLevel(level));
      if (invalid) throw new Error(`AGENT_MODEL_REASONING: ${invalid} ist keine Stufe (gültig: ${thinkingLevels.join(", ")})`);
      const supported = modelThinkingOptions(defaults.provider, model, catalog);
      const unsupported = levels.find((level) => !supported.includes(level as ThinkingLevel));
      if (unsupported) throw new Error(`AGENT_MODEL_REASONING: ${unsupported} ist für ${defaults.provider}/${model} nicht verfügbar (gültig: ${supported.join(", ")})`);
      if (new Set(levels).size !== levels.length) throw new Error(`AGENT_MODEL_REASONING: ${model} nennt eine Stufe mehrfach`);
      map.set(model, Object.freeze(levels as ThinkingLevel[]));
    }
    reasoning = map;
    return reasoning;
  };
  return Object.freeze({
    get options() {
      const configured = options();
      defaultModel();
      return configured;
    },
    get defaultModel() {
      return defaultModel();
    },
    provider: defaults.provider,
    get selectable() {
      return released && options().length > 1;
    },
    thinkingOptionsFor: (model: string | null) => {
      const selected = model ?? defaultModel();
      return reasoningMap().get(selected) ?? modelThinkingOptions(defaults.provider, selected, catalog);
    },
  });
};
