import type { RAgentsPlugin } from "@aicontainer/ragents";
import type { PluginModule } from "@aicontainer/server/plugin-support/plugin-module.js";
import { createTodoToolContributor } from "./tool-contributor.js";

const todoPlugin: RAgentsPlugin = {
  manifest: { id: "ragents.todo" },
  register: (host) => host.functions(createTodoToolContributor()),
};

export const plugin: PluginModule = { create: () => todoPlugin };
