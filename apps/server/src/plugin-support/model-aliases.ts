import { aliasedModel, type ModelAlias as RuntimeModelAlias } from "@ragents/agent";
import { getSupportedThinkingLevels, type Api, type Model } from "@ragents/ai";
import { getBuiltinModels, type BuiltinProvider } from "@ragents/ai/providers/all";
import { isThinkingLevel, type ThinkingLevel } from "@ragents/engine";
import { declaredEnvironment } from "./plugin-config.js";

/** Ein Alias des Profils mit seinem Ziel und optional der Denktiefe, die gilt, solange niemand eine andere wählt. */
export interface ModelAlias extends RuntimeModelAlias {
  readonly thinking?: ThinkingLevel;
}

/** Der Anbieter, unter dem die Aliasse des Profils stehen; er ist kein echter Anbieter und erscheint in keiner Anzeige. */
export const ALIAS_PROVIDER = "alias";

export const modelAliasEnvDescriptors = [
  { key: "MODEL_ALIASES", source: "environment" },
] as const;

const ALIAS = /^[a-z0-9][a-z0-9._-]{0,63}$/;

/** MODEL_ALIASES: eine Liste "alias=anbieter/modell" oder "alias=anbieter/modell@denktiefe"; der Alias ist der einzige Name, den Oberfläche, Journal und Relay-Clients sehen. */
export const parseModelAliases = (entries: readonly string[]): readonly ModelAlias[] => {
  const aliases = entries.map((entry): ModelAlias => {
    const separator = entry.indexOf("=");
    const alias = separator > 0 ? entry.slice(0, separator).trim() : "";
    const rest = separator > 0 ? entry.slice(separator + 1).trim() : "";
    const at = rest.lastIndexOf("@");
    const target = at < 0 ? rest : rest.slice(0, at);
    const thinking = at < 0 ? undefined : rest.slice(at + 1);
    const slash = target.indexOf("/");
    if (!ALIAS.test(alias) || slash <= 0 || slash === target.length - 1) {
      throw new Error(`MODEL_ALIASES: "${entry}" hat nicht das Format "alias=anbieter/modell" oder "alias=anbieter/modell@denktiefe"`);
    }
    if (thinking !== undefined && !isThinkingLevel(thinking)) throw new Error(`MODEL_ALIASES: "${entry}" nennt die unbekannte Denktiefe "${thinking}"`);
    return { alias, upstream: target.slice(0, slash), model: target.slice(slash + 1), ...(thinking === undefined ? {} : { thinking }) };
  });
  const duplicate = aliases.find((entry, index) => aliases.findIndex((other) => other.alias === entry.alias) !== index);
  if (duplicate) throw new Error(`MODEL_ALIASES nennt den Alias ${duplicate.alias} mehrfach`);
  return aliases;
};

const env = declaredEnvironment(modelAliasEnvDescriptors);

export const configuredModelAliases = (): readonly ModelAlias[] => parseModelAliases(env.list("MODEL_ALIASES"));

/** Der Katalog der Aliasse aus den eingebauten Katalogen ihrer Anbieter, so wie die Modelllaufzeit sie anbietet. */
export const aliasCatalog = (aliases: readonly ModelAlias[] = configuredModelAliases()): readonly Model<Api>[] => {
  if (aliases.length === 0) throw new Error(`Der Anbieter ${ALIAS_PROVIDER} braucht MODEL_ALIASES im Abschnitt host`);
  return aliases.map((entry) => {
    const target = getBuiltinModels(entry.upstream as BuiltinProvider).find((model) => model.id === entry.model);
    if (!target) throw new Error(`MODEL_ALIASES: das Modell ${entry.model} hinter ${entry.alias} fehlt im Katalog von ${entry.upstream}`);
    const supported = getSupportedThinkingLevels(target);
    if (entry.thinking !== undefined && !supported.includes(entry.thinking)) {
      throw new Error(`MODEL_ALIASES: die Denktiefe ${entry.thinking} gibt es für ${entry.alias} nicht (gültig: ${supported.join(", ")})`);
    }
    return aliasedModel(ALIAS_PROVIDER, entry.alias, target);
  });
};

/** Die Aliasse des Profils, geprüft gegen die Kataloge ihrer Ziele samt Denktiefe. */
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
