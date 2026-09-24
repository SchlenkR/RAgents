import { declaredEnvironment } from "@ragents/host/plugin-support/plugin-config.js";

export const modelRelayConfigDescriptors = [
  { key: "RELAY_MODELS", source: "environment" },
] as const;

const env = declaredEnvironment(modelRelayConfigDescriptors);

export interface RelayAlias {
  readonly alias: string;
  readonly upstream: string;
  readonly model: string;
}

const ALIAS = /^[a-z0-9][a-z0-9._-]{0,63}$/;

/** RELAY_MODELS: eine Liste "alias=anbieter/modell"; der Alias ist der einzige Name, den ein Client sieht. */
export const parseRelayAliases = (entries: readonly string[]): readonly RelayAlias[] => {
  if (entries.length === 0) throw new Error("RELAY_MODELS nennt kein Modell; erwartet wird eine Liste \"alias=anbieter/modell\"");
  const aliases = entries.map((entry) => {
    const separator = entry.indexOf("=");
    const alias = separator > 0 ? entry.slice(0, separator).trim() : "";
    const target = separator > 0 ? entry.slice(separator + 1).trim() : "";
    const slash = target.indexOf("/");
    if (!ALIAS.test(alias) || slash <= 0 || slash === target.length - 1) {
      throw new Error(`RELAY_MODELS: "${entry}" hat nicht das Format "alias=anbieter/modell"`);
    }
    return { alias, upstream: target.slice(0, slash), model: target.slice(slash + 1) };
  });
  const duplicate = aliases.find((entry, index) => aliases.findIndex((other) => other.alias === entry.alias) !== index);
  if (duplicate) throw new Error(`RELAY_MODELS nennt den Alias ${duplicate.alias} mehrfach`);
  return aliases;
};

export const modelRelayConfig = Object.freeze({
  aliases: () => parseRelayAliases(env.list("RELAY_MODELS")),
});
