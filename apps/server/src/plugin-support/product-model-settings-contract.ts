import { Type } from "typebox";
import { defineOperation } from "@ragents/engine/src/rpc/contract";
import { openJson } from "@ragents/engine/src/http/contracts";
import type { ThinkingLevel } from "@ragents/engine/src/domain/driver";

export interface ProductModelDraft {
  profiles: { name: string; model: string; thinking: ThinkingLevel }[];
}

export interface ProductModelSettings {
  profiles: (ProductModelDraft["profiles"][number] & { description: string; provider: string })[];
  models: { id: string; provider: string; label: string; thinking: readonly ThinkingLevel[] }[];
}

const settings = openJson<ProductModelSettings>("ProductModelSettings");

/** One pair per product plugin: read and save the model defaults. */
export const productModelSettingsContracts = (pluginId: string) => ({
  read: defineOperation({
    id: `${pluginId}.modelSettings.read`,
    description: "The model defaults of the roles with the available model catalog. Right: settings.read.",
    rights: ["settings.read"],
    input: Type.Object({}, { additionalProperties: false }),
    result: settings,
  }),
  save: defineOperation({
    id: `${pluginId}.modelSettings.save`,
    description: "Save the model defaults of the roles. Rights: settings.read and settings.write.",
    rights: ["settings.read", "settings.write"],
    input: Type.Object({ value: openJson<ProductModelDraft>("ProductModelDraft") }, { additionalProperties: false }),
    result: settings,
  }),
});
