import { statSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const PLUGIN_SERVER_FOLDER = "server";

export const pluginsRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)), "../../../../plugins");

export const isPluginPath = (entry: string): boolean => /^(\.{1,2}\/|\/|~\/)/.test(entry);

/** A profile names a plugin by id (a folder under plugins/) or by a path, relative to the profile file. */
export const pluginFolderFor = (entry: string, base: string, root = pluginsRoot): string => {
  if (!isPluginPath(entry)) return path.join(root, entry);
  const expanded = entry.startsWith("~/") ? path.join(homedir(), entry.slice(2)) : entry;
  return path.resolve(base, expanded);
};

export const pluginIdOf = (folder: string): string => path.basename(folder);

export const WEB_ENTRY_FILES = ["web/index.ts", "web/index.tsx"] as const;

export const webEntryOf = (folder: string): string | undefined =>
  WEB_ENTRY_FILES.map((name) => path.join(folder, name))
    .find((candidate) => statSync(candidate, { throwIfNoEntry: false })?.isFile() === true);

const folders = new Map<string, string>();

export const registerPluginFolder = (id: string, folder: string): void => {
  const known = folders.get(id);
  if (known && known !== folder) throw new Error(`Das Plugin ${id} liegt bereits unter ${known}, nicht unter ${folder}`);
  folders.set(id, folder);
};

export const pluginFolder = (pluginId: string): string => {
  const folder = folders.get(pluginId) ?? path.join(pluginsRoot, pluginId);
  const stats = statSync(folder, { throwIfNoEntry: false });
  if (!stats?.isDirectory()) throw new Error(`Das Plugin ${pluginId} hat keinen Ordner ${folder}`);
  return folder;
};
