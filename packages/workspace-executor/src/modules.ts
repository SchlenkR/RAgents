import { commandModule } from "./commands.js";
import type { WorkspaceExecutorParts } from "./contributions.js";
import { fileModule } from "./files.js";
import { languageServerModule } from "./language-server/module.js";
import type { WorkspaceModuleFactory } from "./module.js";
import { processModule } from "./processes/module.js";
import { runFolderModule } from "./run-folders.js";
import { sandboxToolsModule } from "./sandbox-tools.js";

export interface WorkspaceExecutorModuleOptions {
  /** The new folder of a run on this machine; only a workspace knows it, on the server the host creates it. */
  runFolder?: (runId: string) => string;
  /** The contributions of the plugins, built for this machine; server and workspace get the same ones. */
  contributions: readonly WorkspaceExecutorParts[];
}

/** The modules of an executor: its own and what the contributions of the plugins add. */
export const workspaceExecutorModules = (options: WorkspaceExecutorModuleOptions): readonly WorkspaceModuleFactory[] => [
  sandboxToolsModule,
  languageServerModule(options.contributions.flatMap((parts) => parts.languageServers ?? [])),
  fileModule,
  processModule(),
  commandModule(),
  ...options.contributions.flatMap((parts) => parts.modules ?? []),
  runFolderModule(options.runFolder),
];
