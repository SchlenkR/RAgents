import type { RAgentsPlugin } from "@ragents/engine";
import type { PluginModule } from "@ragents/host/plugin-support/plugin-module.js";
import { createTodoToolContributor } from "./tool-contributor.js";

const todoPlugin: RAgentsPlugin = {
  manifest: { id: "ragents.todo" },
  register: (host) => host.functions(createTodoToolContributor()),
};

export const plugin: PluginModule = { create: () => todoPlugin };
