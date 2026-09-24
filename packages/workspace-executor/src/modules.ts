import { browserModule } from "./browser/module.js";
import { commandModule } from "./commands.js";
import { fileModule } from "./files.js";
import { workspaceLanguageServers } from "./language-server/adapters/index.js";
import { languageServerModule } from "./language-server/module.js";
import type { WorkspaceModuleFactory } from "./module.js";
import { processModule } from "./processes/module.js";
import { sandboxToolsModule } from "./sandbox-tools.js";

/** Die Module jedes Executors, im Server wie auf dem Arbeitsplatz dieselben. */
export const workspaceExecutorModules = (): readonly WorkspaceModuleFactory[] => [
  sandboxToolsModule,
  languageServerModule(workspaceLanguageServers),
  fileModule,
  processModule(),
  commandModule(),
  browserModule(),
];
