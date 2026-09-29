import { aliasedModel, compactionProblem, type ModelAlias as RuntimeModelAlias } from "@ragents/agent";
import { getSupportedThinkingLevels, type Api, type Model } from "@ragents/ai";
import { getBuiltinModels, type BuiltinProvider } from "@ragents/ai/providers/all";
import { isThinkingLevel, type ThinkingLevel } from "@ragents/engine";
import { declaredEnvironment } from "./plugin-config.js";

/** Ein Alias des Profils mit Ziel und Kompaktierungswerten und optional der Denktiefe, die gilt, solange niemand eine andere wählt. */
export interface ModelAlias extends RuntimeModelAlias {
  readonly thinking?: ThinkingLevel;
}

/** Der Anbieter, unter dem die Aliasse des Profils stehen; er ist kein echter Anbieter und erscheint in keiner Anzeige. */
export const ALIAS_PROVIDER = "alias";

export const modelAliasEnvDescriptors = [
  { key: "MODEL_ALIASES", source: "environment" },
] as const;

const ALIAS = /^[a-z0-9][a-z0-9._-]{0,63}$/;
const ENTRY_KEYS: readonly string[] = ["alias", "model", "thinking", "compaction"];

const aliasOf = (value: unknown, index: number): ModelAlias => {
  const location = `MODEL_ALIASES[${index}]`;
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${location} must be an object with alias, model, compaction and optionally thinking`);
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
  const problem = compactionProblem(entry.compaction);
  if (problem) throw new Error(`${location}, ${entry.alias}: ${problem}`);
  return {
    alias: entry.alias,
    upstream: target.slice(0, slash),
    model: target.slice(slash + 1),
    ...(entry.thinking === undefined ? {} : { thinking: entry.thinking }),
    compaction: entry.compaction as ModelAlias["compaction"],
  };
};

/** MODEL_ALIASES: eine Liste von { alias, model: "anbieter/modell", thinking?, compaction }; der Alias ist der einzige Name, den Oberfläche, Journal und Relay-Clients sehen. */
export const parseModelAliases = (entries: unknown): readonly ModelAlias[] => {
  if (!Array.isArray(entries)) throw new Error("MODEL_ALIASES must be a list of aliases");
  const aliases = entries.map(aliasOf);
  const duplicate = aliases.find((entry, index) => aliases.findIndex((other) => other.alias === entry.alias) !== index);
  if (duplicate) throw new Error(`MODEL_ALIASES names the alias ${duplicate.alias} more than once`);
  return aliases;
};

const env = declaredEnvironment(modelAliasEnvDescriptors);

/** Die Aliasse des Profils; in der Umgebung steht MODEL_ALIASES als JSON der Liste aus der Profildatei. */
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

/** Der Katalog der Aliasse aus den eingebauten Katalogen ihrer Anbieter, so wie die Modelllaufzeit sie anbietet. */
export const aliasCatalog = (aliases: readonly ModelAlias[] = configuredModelAliases()): readonly Model<Api>[] => {
  if (aliases.length === 0) throw new Error(`The provider ${ALIAS_PROVIDER} needs MODEL_ALIASES in the host section`);
  return aliases.map((entry) => {
    const target = getBuiltinModels(entry.upstream as BuiltinProvider).find((model) => model.id === entry.model);
    if (!target) throw new Error(`MODEL_ALIASES: the model ${entry.model} behind ${entry.alias} is missing from the catalog of ${entry.upstream}`);
    const supported = getSupportedThinkingLevels(target);
    if (entry.thinking !== undefined && !supported.includes(entry.thinking)) {
      throw new Error(`MODEL_ALIASES: the thinking level ${entry.thinking} does not exist for ${entry.alias} (valid: ${supported.join(", ")})`);
    }
    const problem = compactionProblem(entry.compaction, target);
    if (problem) throw new Error(`MODEL_ALIASES: ${entry.alias} on ${entry.upstream}/${entry.model}: ${problem}`);
    return aliasedModel(ALIAS_PROVIDER, entry, target);
  });
};

/** Die Aliasse des Profils, geprüft gegen die Kataloge ihrer Ziele samt Denktiefe und Kompaktierungswerten. */
export const validatedModelAliases = (): readonly ModelAlias[] => {
  const aliases = configuredModelAliases();
  if (aliases.length > 0) aliasCatalog(aliases);
  return aliases;
};

/** Die Denktiefe, die der Alias mitbringt; andere Anbieter und Aliasse ohne Angabe haben keine. */
export const modelDefaultThinking = (provider: string, model: string): ThinkingLevel | undefined =>
  provider === ALIAS_PROVIDER ? configuredModelAliases().find((entry) => entry.alias === model)?.thinking : undefined;

/** Der Anbieter, wie eine Anzeige ihn nennt: bei Aliassen keiner. */
export const displayProvider = (provider: string): string => provider === ALIAS_PROVIDER ? "" : provider;

export const modelLabel = (provider: string, model: string): string => {
  const shown = displayProvider(provider);
  return shown ? `${shown}/${model}` : model;
};
