import type { RAgentsPlugin } from "@aicontainer/ragents";
import type { PluginModule } from "@aicontainer/server/plugin-support/plugin-module.js";

const activityPlugin: RAgentsPlugin = {
  manifest: { id: "ragents.activity" },
  register: () => {},
};

export const plugin: PluginModule = { create: () => activityPlugin };
