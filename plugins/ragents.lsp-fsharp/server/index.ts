import { createLanguageServerPlugin } from "@ragents/host/plugin-support/language-server/plugin.js";
import type { PluginModule } from "@ragents/host/plugin-support/plugin-module.js";
import { fsharpLanguageServer, FSHARP_SERVER_VARIABLE } from "../executor.js";

export const fsharpConfigDescriptors = [
  { key: FSHARP_SERVER_VARIABLE, source: "environment" },
] as const;

export const plugin: PluginModule = {
  create: () => createLanguageServerPlugin({
    id: "ragents.lsp-fsharp",
    languageServer: fsharpLanguageServer,
    tabLabel: "F#",
    configDescriptors: fsharpConfigDescriptors,
  }),
};
