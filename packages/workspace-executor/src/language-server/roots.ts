import { stat } from "node:fs/promises";
import path from "node:path";
import { allowedWorkspacePath } from "../paths.js";

export const resolveRootFile = async (
  workspaceRoot: string,
  requested: string,
  extensions: readonly string[],
): Promise<string> => {
  const absolute = await allowedWorkspacePath(path.resolve(workspaceRoot, requested), [workspaceRoot]);
  if (!extensions.includes(path.extname(absolute).toLowerCase())) {
    throw new Error(`${requested} has none of the extensions ${extensions.join(", ")}`);
  }
  const info = await stat(absolute).catch(() => undefined);
  if (!info?.isFile()) throw new Error(`${requested} does not exist in the working directory`);
  return absolute;
};

export const resolveRootDirectory = async (workspaceRoot: string, requested: string): Promise<string> => {
  const absolute = await allowedWorkspacePath(path.resolve(workspaceRoot, requested), [workspaceRoot]);
  const info = await stat(absolute).catch(() => undefined);
  if (!info?.isDirectory()) throw new Error(`${requested} is not a directory in the working directory`);
  return absolute;
};
