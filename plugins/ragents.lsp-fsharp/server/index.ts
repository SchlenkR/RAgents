import { fsharpAdapter, FSHARP_SERVER_VARIABLE } from "@ragents/workspace-executor";
import { createLanguageServerPlugin } from "@ragents/host/plugin-support/language-server/plugin.js";
import type { PluginModule } from "@ragents/host/plugin-support/plugin-module.js";

export const fsharpConfigDescriptors = [
  { key: FSHARP_SERVER_VARIABLE, source: "environment" },
] as const;

export const plugin: PluginModule = {
  create: () => createLanguageServerPlugin({
    id: "ragents.lsp-fsharp",
    adapter: fsharpAdapter,
    tabLabel: "F#",
    configDescriptors: fsharpConfigDescriptors,
  }),
};
