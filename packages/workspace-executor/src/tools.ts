import { homedir } from "node:os";
import path from "node:path";

/** Unter Windows liegen die Daten in `%LOCALAPPDATA%\ragents`, sonst unter `~/.local/share/ragents`. */
export const ragentsDataRoot = (
  home = homedir(),
  platform: NodeJS.Platform = process.platform,
  environment: NodeJS.ProcessEnv = process.env,
): string => {
  if (platform !== "win32") return path.resolve(home, ".local/share/ragents");
  const local = environment.LOCALAPPDATA;
  if (!local) throw new Error("LOCALAPPDATA ist nicht gesetzt; unter Windows liegt der Datenordner in %LOCALAPPDATA%\\ragents.");
  return path.join(local, "ragents");
};

/** Der Werkzeugordner eines Plugins: was seine Provisionierung auf diese Maschine legt. */
export const pluginToolsDirectory = (dataDirectory: string, pluginId: string): string =>
  path.join(dataDirectory, "tools", pluginId);

/** Ein Arbeitsplatz hat kein Profil; seine Werkzeuge liegen in einem eigenen Datenordner neben denen der Profile. */
export const workspaceDataDirectory = (home = homedir()): string => path.join(ragentsDataRoot(home), "workspace");

/** Der Datenordner dieses Prozesses: DATA_DIR wie beim Server, sonst der des Arbeitsplatzes ohne Profil. */
export const hostDataDirectory = (environment: NodeJS.ProcessEnv = process.env): string =>
  path.resolve(environment.DATA_DIR ?? workspaceDataDirectory());

export const hostToolFile = (pluginId: string, relative: string): string =>
  path.join(pluginToolsDirectory(hostDataDirectory(), pluginId), ...relative.split("/"));
