import { typescriptAdapter } from "@ragents/workspace-executor";
import { createLanguageServerPlugin } from "@ragents/host/plugin-support/language-server/plugin.js";
import type { PluginModule } from "@ragents/host/plugin-support/plugin-module.js";

export const plugin: PluginModule = {
  create: () => createLanguageServerPlugin({ id: "ragents.lsp-typescript", adapter: typescriptAdapter }),
};
