import { configuredModelAliases, type ModelAlias } from "@ragents/host/plugin-support/model-aliases.js";
import { configuredModelProviders } from "@ragents/host/plugin-support/model-providers.js";
import type { ModelUpstream } from "@ragents/host/plugin-support/model-upstreams.js";

/** The relay offers the profile's aliases (MODEL_ALIASES in the host section), the same as for its own runs. */
export const relayAliases = (aliases: readonly ModelAlias[]): readonly ModelAlias[] => {
  if (aliases.length === 0) throw new Error("ragents.model-relay needs MODEL_ALIASES in the host section, a list of { alias, model, thinking?, thinkingLevels?, compaction }");
  return aliases;
};

export const modelRelayConfig = Object.freeze({
  aliases: () => relayAliases(configuredModelAliases()),
  /** The profile's own providers (MODEL_PROVIDERS in the host section) next to those of the product. */
  upstreams: (product: readonly ModelUpstream[]): readonly ModelUpstream[] => [...product, ...configuredModelProviders()],
});
