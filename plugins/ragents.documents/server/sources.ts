import path from "node:path";

/** Where the two document tools find files: the run's file store on the server and the files of its workspace, read where the workspace lies. */
export interface DocumentSources {
  storeFor: (runId: string) => Promise<string>;
  /** The whole text of a file named like the file tools name it; a file that cannot be shown as text is an error with its reason. */
  workspaceText: (runId: string, filePath: string, call?: { toolCallId?: string; signal?: AbortSignal }) => Promise<string>;
}

/** A path in the file store: relative, without a leading slash and without `..`; a leading `./` is dropped. */
export const relativeStorePath = (value: string): string => {
  const normalized = value.replace(/^\.\//, "");
  if (path.isAbsolute(normalized) || normalized.split("/").includes("..") || normalized.trim() === "") {
    throw new Error("storePath must be relative to the file store, without a leading / and without ..");
  }
  return normalized;
};
