import { aliasedModel, compactionProblem, thinkingLevelsProblem, type ModelAlias as RuntimeModelAlias } from "@ragents/agent";
import { getSupportedThinkingLevels, type Api, type Model } from "@ragents/ai";
import { getBuiltinModels, type BuiltinProvider } from "@ragents/ai/providers/all";
import { isThinkingLevel, type ThinkingLevel } from "@ragents/engine";
import { configuredModelProviders } from "./model-providers.js";
import { declaredEnvironment } from "./plugin-config.js";

/** An alias of the profile with target and compaction values and optionally the thinking level that applies as long as nobody chooses another one. */
export interface ModelAlias extends RuntimeModelAlias {
  readonly thinking?: ThinkingLevel;
}

/** The provider under which the profile's aliases are listed; it is not a real provider and appears in no display. */
export const ALIAS_PROVIDER = "alias";

export const modelAliasEnvDescriptors = [
  { key: "MODEL_ALIASES", source: "environment" },
] as const;

const ALIAS = /^[a-z0-9][a-z0-9._-]{0,63}$/;
const ENTRY_KEYS: readonly string[] = ["alias", "model", "thinking", "thinkingLevels", "compaction"];

const aliasOf = (value: unknown, index: number): ModelAlias => {
  const location = `MODEL_ALIASES[${index}]`;
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${location} must be an object with alias, model, compaction and optionally thinking and thinkingLevels`);
  }
  const entry = value as Record<string, unknown>;
  const unknown = Object.keys(entry).find((key) => !ENTRY_KEYS.includes(key));
  if (unknown) throw new Error(`${location}.${unknown} is not supported; allowed are ${ENTRY_KEYS.join(", ")}`);
  if (typeof entry.alias !== "string" || !ALIAS.test(entry.alias)) {
    throw new Error(`${location}.alias needs 1 to 64 lowercase letters, digits, dots, underscores or hyphens`);
  }
  const target = typeof entry.model === "string" ? entry.model : "";
  const slash = target.indexOf("/");
  if (slash <= 0 || slash === target.length - 1) throw new Error(`${location}.model of ${entry.alias} needs the form "provider/model"`);
  if (entry.thinking !== undefined && !isThinkingLevel(entry.thinking)) {
    throw new Error(`${location}.thinking of ${entry.alias} names the unknown thinking level "${String(entry.thinking)}"`);
  }
  const problem = thinkingLevelsProblem(entry.thinkingLevels) ?? compactionProblem(entry.compaction);
  if (problem) throw new Error(`${location}, ${entry.alias}: ${problem}`);
  return {
    alias: entry.alias,
    upstream: target.slice(0, slash),
    model: target.slice(slash + 1),
    ...(entry.thinking === undefined ? {} : { thinking: entry.thinking }),
    ...(entry.thinkingLevels === undefined ? {} : { thinkingLevels: entry.thinkingLevels as ModelAlias["thinkingLevels"] }),
    compaction: entry.compaction as ModelAlias["compaction"],
  };
};

/** MODEL_ALIASES: a list of { alias, model: "provider/model", thinking?, thinkingLevels?, compaction }; the alias is the only name that the UI, the journal and relay clients see. */
export const parseModelAliases = (entries: unknown): readonly ModelAlias[] => {
  if (!Array.isArray(entries)) throw new Error("MODEL_ALIASES must be a list of aliases");
  const aliases = entries.map(aliasOf);
  const duplicate = aliases.find((entry, index) => aliases.findIndex((other) => other.alias === entry.alias) !== index);
  if (duplicate) throw new Error(`MODEL_ALIASES names the alias ${duplicate.alias} more than once`);
  return aliases;
};

const env = declaredEnvironment(modelAliasEnvDescriptors);

/** The profile's aliases; the environment holds MODEL_ALIASES as JSON of the list from the profile file. */
export const configuredModelAliases = (): readonly ModelAlias[] => {
  const value = env.optional("MODEL_ALIASES");
  if (value === undefined || value === "") return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new Error("MODEL_ALIASES is no JSON list of aliases");
  }
  return parseModelAliases(parsed);
};

/** The model the alias offers over its target, checked against the target's thinking levels and limits; the default thinking level must be an offered level. */
export const validatedAliasModel = (entry: ModelAlias, target: Model<Api>): Model<Api> => {
  const problem = thinkingLevelsProblem(entry.thinkingLevels, target) ?? compactionProblem(entry.compaction, target);
  if (problem) throw new Error(`MODEL_ALIASES: ${entry.alias} on ${entry.upstream}/${entry.model}: ${problem}`);
  const offered = aliasedModel(ALIAS_PROVIDER, entry, target);
  const levels = getSupportedThinkingLevels(offered);
  if (entry.thinking !== undefined && !levels.includes(entry.thinking)) {
    throw new Error(`MODEL_ALIASES: the thinking level ${entry.thinking} does not exist for ${entry.alias} (valid: ${levels.join(", ")})`);
  }
  return offered;
};

/** The catalog of the aliases from the catalogs of their providers (MODEL_PROVIDERS, otherwise built in), as the model runtime offers them. */
export const aliasCatalog = (aliases: readonly ModelAlias[] = configuredModelAliases()): readonly Model<Api>[] => {
  if (aliases.length === 0) throw new Error(`The provider ${ALIAS_PROVIDER} needs MODEL_ALIASES in the host section`);
  const providers = configuredModelProviders();
  return aliases.map((entry) => {
    const catalog = providers.find((provider) => provider.id === entry.upstream)?.models ?? getBuiltinModels(entry.upstream as BuiltinProvider);
    const target = catalog.find((model) => model.id === entry.model);
    if (!target) throw new Error(`MODEL_ALIASES: the model ${entry.model} behind ${entry.alias} is missing from the catalog of ${entry.upstream}`);
    return validatedAliasModel(entry, target);
  });
};

/** The profile's aliases, checked against the catalogs of their targets including thinking level and compaction values. */
export const validatedModelAliases = (): readonly ModelAlias[] => {
  const aliases = configuredModelAliases();
  if (aliases.length > 0) aliasCatalog(aliases);
  return aliases;
};

/** The thinking level the alias brings along; other providers and aliases without one have none. */
export const modelDefaultThinking = (provider: string, model: string): ThinkingLevel | undefined =>
  provider === ALIAS_PROVIDER ? configuredModelAliases().find((entry) => entry.alias === model)?.thinking : undefined;

/** The provider as a display names it: none for aliases. */
export const displayProvider = (provider: string): string => provider === ALIAS_PROVIDER ? "" : provider;

export const modelLabel = (provider: string, model: string): string => {
  const shown = displayProvider(provider);
  return shown ? `${shown}/${model}` : model;
};
