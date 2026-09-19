import { Type } from "typebox";
import { defineOperation } from "@aicontainer/ragents/src/rpc/contract";
import { openJson } from "@aicontainer/ragents/src/http/contracts";
import type { ProductModelDraft, ProductModelSettings } from "../../../../plugins/ragents.product/model-settings-contract.js";

const settings = openJson<ProductModelSettings>("ProductModelSettings");

/** Je Produktplugin ein Paar: die Modellvorgaben lesen und speichern. */
export const productModelSettingsContracts = (pluginId: string) => ({
  read: defineOperation({
    id: `${pluginId}.modelSettings.read`,
    description: "Die Modellvorgaben der Agentprofile mit dem verfügbaren Modellkatalog. Recht: settings.read.",
    rights: ["settings.read"],
    input: Type.Object({}, { additionalProperties: false }),
    result: settings,
  }),
  save: defineOperation({
    id: `${pluginId}.modelSettings.save`,
    description: "Die Modellvorgaben der Agentprofile speichern. Rechte: settings.read und settings.write.",
    rights: ["settings.read", "settings.write"],
    input: Type.Object({ value: openJson<ProductModelDraft>("ProductModelDraft") }, { additionalProperties: false }),
    result: settings,
  }),
});
