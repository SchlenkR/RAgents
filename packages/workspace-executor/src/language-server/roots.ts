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
    throw new Error(`${requested} hat keine der Endungen ${extensions.join(", ")}`);
  }
  const info = await stat(absolute).catch(() => undefined);
  if (!info?.isFile()) throw new Error(`${requested} gibt es im Arbeitsverzeichnis nicht`);
  return absolute;
};

export const resolveRootDirectory = async (workspaceRoot: string, requested: string): Promise<string> => {
  const absolute = await allowedWorkspacePath(path.resolve(workspaceRoot, requested), [workspaceRoot]);
  const info = await stat(absolute).catch(() => undefined);
  if (!info?.isDirectory()) throw new Error(`${requested} ist kein Verzeichnis im Arbeitsverzeichnis`);
  return absolute;
};

export const dotnetCommand = (server: string, args: readonly string[]): { command: string; args: string[] } =>
  server.toLowerCase().endsWith(".dll")
    ? { command: "dotnet", args: [server, ...args] }
    : { command: server, args: [...args] };
