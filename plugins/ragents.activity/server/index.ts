import type { RAgentsPlugin } from "@ragents/engine";
import type { PluginModule } from "@ragents/host/plugin-support/plugin-module.js";

const activityPlugin: RAgentsPlugin = {
  manifest: { id: "ragents.activity" },
  register: () => {},
};

export const plugin: PluginModule = { create: () => activityPlugin };
