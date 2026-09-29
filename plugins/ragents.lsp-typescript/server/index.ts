import { createLanguageServerPlugin } from "@ragents/host/plugin-support/language-server/plugin.js";
import type { PluginModule } from "@ragents/host/plugin-support/plugin-module.js";
import { typescriptLanguageServer } from "../executor.js";

export const plugin: PluginModule = {
  create: () => createLanguageServerPlugin({ id: "ragents.lsp-typescript", languageServer: typescriptLanguageServer }),
};
