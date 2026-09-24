import { statSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const pluginsRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)), "../../../../plugins");

/** The built-in plugins as bundles, built by pnpm build:plugins; an id in PLUGINS names a folder here. */
export const bundlesRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)), "../../../../bundles");

export const isPluginPath = (entry: string): boolean => /^(\.{1,2}\/|\/|~\/)/.test(entry);

/** A profile names a plugin by id (a folder under bundles/) or by a path, relative to the profile file. */
export const pluginFolderFor = (entry: string, base: string, root = bundlesRoot): string => {
  if (!isPluginPath(entry)) return path.join(root, entry);
  const expanded = entry.startsWith("~/") ? path.join(homedir(), entry.slice(2)) : entry;
  return path.resolve(base, expanded);
};

export const pluginIdOf = (folder: string): string => path.basename(folder);

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
