import type { RAgentsPlugin } from "@aicontainer/ragents";
import type { PluginModule } from "@aicontainer/server/plugin-support/plugin-module.js";

const referencePlugin: RAgentsPlugin = {
  manifest: { id: "ragents.reference" },
  register: () => undefined,
};

export const plugin: PluginModule = {
  requires: ["ragents.orchestration", "ragents.actor-programs"],
  create: () => referencePlugin,
};
