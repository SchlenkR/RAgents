import { mkdir, rm } from "node:fs/promises";
import { WorkspaceOperationError } from "./errors.js";
import type { WorkspaceModuleFactory } from "./module.js";

export const RUN_FOLDER_OPERATIONS = {
  create: "runFolder.create",
  remove: "runFolder.remove",
} as const;

export interface RunFolderCreated {
  /** Ob der Ordner eben entstanden ist; ein schon vorhandener bleibt, wie er ist. */
  created: boolean;
}

/** Der neue Ordner je Run auf dieser Maschine; nur ein Executor, der einen Ordner für Runs kennt, legt ihn an, und nur diesen einen je Run. */
export const runFolderModule = (folderOf: ((runId: string) => string) | undefined): WorkspaceModuleFactory => () => {
  const folder = (runId: string): string => {
    if (!folderOf) {
      throw new WorkspaceOperationError("run-folder-unavailable", "Dieser Executor legt keine Ordner je Run an; auf dem Server tut das der Host", 409);
    }
    return folderOf(runId);
  };
  return {
    operations: {
      [RUN_FOLDER_OPERATIONS.create]: async ({ runId }): Promise<RunFolderCreated> =>
        ({ created: await mkdir(folder(runId), { recursive: true }) !== undefined }),
      [RUN_FOLDER_OPERATIONS.remove]: async ({ runId }): Promise<{ removed: true }> => {
        await rm(folder(runId), { recursive: true, force: true });
        return { removed: true };
      },
    },
  };
};
