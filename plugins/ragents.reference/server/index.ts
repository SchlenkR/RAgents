import type { RAgentsPlugin } from "@ragents/engine";
import type { PluginModule } from "@ragents/host/plugin-support/plugin-module.js";

const referencePlugin: RAgentsPlugin = {
  manifest: { id: "ragents.reference" },
  register: () => undefined,
};

export const plugin: PluginModule = {
  requires: ["ragents.orchestration", "ragents.actor-programs"],
  create: () => referencePlugin,
};
