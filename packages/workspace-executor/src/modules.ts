import { browserModule } from "./browser/module.js";
import { commandModule } from "./commands.js";
import { fileModule } from "./files.js";
import { workspaceLanguageServers } from "./language-server/adapters/index.js";
import { languageServerModule } from "./language-server/module.js";
import type { WorkspaceModuleFactory } from "./module.js";
import { processModule } from "./processes/module.js";
import { runFolderModule } from "./run-folders.js";
import { sandboxToolsModule } from "./sandbox-tools.js";

export interface WorkspaceExecutorModuleOptions {
  /** Der neue Ordner eines Runs auf dieser Maschine; nur ein Arbeitsplatz kennt ihn, auf dem Server legt ihn der Host an. */
  runFolder?: (runId: string) => string;
}

/** Die Module jedes Executors, im Server wie auf dem Arbeitsplatz dieselben. */
export const workspaceExecutorModules = (options: WorkspaceExecutorModuleOptions = {}): readonly WorkspaceModuleFactory[] => [
  sandboxToolsModule,
  languageServerModule(workspaceLanguageServers),
  fileModule,
  processModule(),
  commandModule(),
  browserModule(),
  runFolderModule(options.runFolder),
];
