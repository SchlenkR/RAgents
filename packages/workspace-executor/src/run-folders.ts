import { mkdir, rm } from "node:fs/promises";
import { WorkspaceOperationError } from "./errors.js";
import type { WorkspaceModuleFactory } from "./module.js";

export const RUN_FOLDER_OPERATIONS = {
  create: "runFolder.create",
  remove: "runFolder.remove",
} as const;

export interface RunFolderCreated {
  /** Whether the folder was just created; an existing one stays as it is. */
  created: boolean;
}

/** The new folder per run on this machine; only an executor that knows a folder for runs creates it, and only this one per run. */
export const runFolderModule = (folderOf: ((runId: string) => string) | undefined): WorkspaceModuleFactory => () => {
  const folder = (runId: string): string => {
    if (!folderOf) {
      throw new WorkspaceOperationError("run-folder-unavailable", "This executor creates no folders per run; on the server the host does that", 409);
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
