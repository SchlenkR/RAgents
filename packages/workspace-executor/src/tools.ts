import { homedir } from "node:os";
import path from "node:path";

/** On Windows the data lives in `%LOCALAPPDATA%\ragents`, otherwise under `~/.local/share/ragents`. */
export const ragentsDataRoot = (
  home = homedir(),
  platform: NodeJS.Platform = process.platform,
  environment: NodeJS.ProcessEnv = process.env,
): string => {
  if (platform !== "win32") return path.resolve(home, ".local/share/ragents");
  const local = environment.LOCALAPPDATA;
  if (!local) throw new Error("LOCALAPPDATA is not set; on Windows the data folder is in %LOCALAPPDATA%\\ragents.");
  return path.join(local, "ragents");
};

/** The tools folder of a plugin: what its provisioning puts on this machine. */
export const pluginToolsDirectory = (dataDirectory: string, pluginId: string): string =>
  path.join(dataDirectory, "tools", pluginId);

/** A workspace has no profile; its tools live in a data folder of its own next to those of the profiles. */
export const workspaceDataDirectory = (home = homedir()): string => path.join(ragentsDataRoot(home), "workspace");

/** The data folder of this process: DATA_DIR as on the server, otherwise the one of the workspace without a profile. */
export const hostDataDirectory = (environment: NodeJS.ProcessEnv = process.env): string =>
  path.resolve(environment.DATA_DIR ?? workspaceDataDirectory());
