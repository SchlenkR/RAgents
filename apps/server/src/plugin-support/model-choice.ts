import { getSupportedThinkingLevels, type Api, type Model } from "@ragents/ai";
import { isThinkingLevel, thinkingLevels, type ThinkingLevel } from "@ragents/engine";
import { ALIAS_PROVIDER, aliasCatalog, modelDefaultThinking } from "./model-aliases.js";
import { configuredModelProviders } from "./model-providers.js";
import type { DeclaredEnvironment } from "./plugin-config.js";

export type ModelCatalogSource = () => readonly Model<Api>[];

/** The configured models of a provider or the profile's aliases. */
export const providerCatalog = (provider: string, key = "AGENT_PROVIDER"): ModelCatalogSource => () => {
  if (provider === ALIAS_PROVIDER) return aliasCatalog();
  const configured = configuredModelProviders().find((entry) => entry.id === provider);
  if (!configured) throw new Error(`${key}: provider ${provider} is not configured; declare it in MODEL_PROVIDERS or set ${key} to a configured provider`);
  return configured.models;
};

export const modelThinkingOptions = (provider: string, model: string, catalog: ModelCatalogSource = providerCatalog(provider)): readonly ThinkingLevel[] => {
  const metadata = catalog().find((entry) => entry.id === model);
  if (!metadata) throw new Error(`The model ${provider}/${model} is missing from the model catalog`);
  return getSupportedThinkingLevels(metadata);
};

export interface ModelChoice {
  readonly options: readonly string[];
  readonly defaultModel: string;
  readonly provider: string;
  readonly selectable: boolean;
  thinkingOptionsFor(model: string | null): readonly ThinkingLevel[];
  /** The thinking level a model brings along when it is chosen; without one the coordinator's applies. */
  defaultThinkingFor?(model: string): ThinkingLevel | undefined;
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
    catalog?: ModelCatalogSource;
  },
): ModelChoice => {
  const catalog = defaults.catalog ?? providerCatalog(defaults.provider);
  const raw = env.optional("MODEL_SELECTABLE");
  if (raw !== undefined && raw !== "" && raw !== "0" && raw !== "1") {
    throw new Error(`MODEL_SELECTABLE must be "0" or "1", not "${raw}"`);
  }
  const released = raw === undefined || raw === "" ? defaults.selectable : raw === "1";
  let resolvedOptions: readonly string[] | undefined;
  const options = (): readonly string[] => {
    if (resolvedOptions) return resolvedOptions;
    const configured = env.list("AGENT_MODELS");
    const duplicate = configured.find((model, index) => configured.indexOf(model) !== index);
    if (duplicate) throw new Error(`AGENT_MODELS names ${duplicate} more than once`);
    const available = catalog().map((model) => model.id);
    const unknown = configured.find((model) => !available.includes(model));
    if (unknown) throw new Error(`AGENT_MODELS: model ${unknown} is not configured for provider ${defaults.provider}; configured model ids: ${available.join(", ")}`);
    const list = configured.length > 0 ? configured : available;
    resolvedOptions = Object.freeze([...list]);
    return resolvedOptions;
  };
  let resolvedDefault: string | undefined;
  const defaultModel = (): string => {
    if (resolvedDefault) return resolvedDefault;
    const configured = defaults.defaultModel();
    if (!options().includes(configured))
      throw new Error(`The coordinator model ${configured} is not in AGENT_MODELS`);
    resolvedDefault = configured;
    return resolvedDefault;
  };
  let reasoning: ReadonlyMap<string, readonly ThinkingLevel[]> | undefined;
  const reasoningMap = (): ReadonlyMap<string, readonly ThinkingLevel[]> => {
    if (reasoning) return reasoning;
    const map = new Map<string, readonly ThinkingLevel[]>();
    for (const entry of env.list("AGENT_MODEL_REASONING")) {
      const separator = entry.indexOf(":");
      if (separator < 0) throw new Error(`AGENT_MODEL_REASONING: "${entry}" does not have the "<model>: <levels>" format`);
      const model = entry.slice(0, separator).trim();
      const levels = entry.slice(separator + 1).trim().split(/[\s,]+/).filter(Boolean);
      if (!options().includes(model)) throw new Error(`AGENT_MODEL_REASONING names ${model}, which is not in AGENT_MODELS`);
      if (map.has(model)) throw new Error(`AGENT_MODEL_REASONING names ${model} more than once`);
      if (levels.length === 0) throw new Error(`AGENT_MODEL_REASONING: ${model} names no level`);
      const invalid = levels.find((level) => !isThinkingLevel(level));
      if (invalid) throw new Error(`AGENT_MODEL_REASONING: ${invalid} is not a level (valid: ${thinkingLevels.join(", ")})`);
      const supported = modelThinkingOptions(defaults.provider, model, catalog);
      const unsupported = levels.find((level) => !supported.includes(level as ThinkingLevel));
      if (unsupported) throw new Error(`AGENT_MODEL_REASONING: ${unsupported} is not available for ${defaults.provider}/${model} (valid: ${supported.join(", ")})`);
      if (new Set(levels).size !== levels.length) throw new Error(`AGENT_MODEL_REASONING: ${model} names a level more than once`);
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
    defaultThinkingFor: (model: string) => modelDefaultThinking(defaults.provider, model),
  });
};
