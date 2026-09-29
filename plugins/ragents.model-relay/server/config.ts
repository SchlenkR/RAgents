import { configuredModelAliases, type ModelAlias } from "@ragents/host/plugin-support/model-aliases.js";

/** Das Relay bietet die Aliasse des Profils an (MODEL_ALIASES im Abschnitt host), dieselben wie für die eigenen Runs. */
export const relayAliases = (aliases: readonly ModelAlias[]): readonly ModelAlias[] => {
  if (aliases.length === 0) throw new Error("ragents.model-relay needs MODEL_ALIASES in the host section, a list of { alias, model, thinking?, compaction }");
  return aliases;
};

export const modelRelayConfig = Object.freeze({
  aliases: () => relayAliases(configuredModelAliases()),
});
