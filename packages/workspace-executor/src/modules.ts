import { commandModule } from "./commands.js";
import type { WorkspaceExecutorParts } from "./contributions.js";
import { fileModule } from "./files.js";
import { languageServerModule } from "./language-server/module.js";
import type { WorkspaceModuleFactory } from "./module.js";
import { processModule } from "./processes/module.js";
import { runFolderModule } from "./run-folders.js";
import { sandboxToolsModule } from "./sandbox-tools.js";

export interface WorkspaceExecutorModuleOptions {
  /** Der neue Ordner eines Runs auf dieser Maschine; nur ein Arbeitsplatz kennt ihn, auf dem Server legt ihn der Host an. */
  runFolder?: (runId: string) => string;
  /** Die Beiträge der Plugins, gebaut für diese Maschine; Server und Arbeitsplatz bekommen dieselben. */
  contributions: readonly WorkspaceExecutorParts[];
}

/** Die Module eines Executors: die eigenen und was die Beiträge der Plugins hinzufügen. */
export const workspaceExecutorModules = (options: WorkspaceExecutorModuleOptions): readonly WorkspaceModuleFactory[] => [
  sandboxToolsModule,
  languageServerModule(options.contributions.flatMap((parts) => parts.languageServers ?? [])),
  fileModule,
  processModule(),
  commandModule(),
  ...options.contributions.flatMap((parts) => parts.modules ?? []),
  runFolderModule(options.runFolder),
];
