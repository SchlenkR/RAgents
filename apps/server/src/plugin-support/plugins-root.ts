import { statSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const pluginsRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)), "../../../../plugins");

/** The built-in plugins as bundles, built by pnpm build:plugins; an id in PLUGINS names a folder here. */
export const bundlesRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)), "../../../../bundles");

export const isPluginPath = (entry: string): boolean => path.isAbsolute(entry) || /^(\.{1,2}|~)[\\/]/.test(entry);

/** A profile names a plugin by id (a folder under bundles/) or by a path, relative to the profile file. */
export const pluginFolderFor = (entry: string, base: string, root = bundlesRoot): string => {
  if (!isPluginPath(entry)) return path.join(root, entry);
  const expanded = /^~[\\/]/.test(entry) ? path.join(homedir(), entry.slice(2)) : entry;
  return path.resolve(base, expanded);
};

export const pluginIdOf = (folder: string): string => path.basename(folder);

const folders = new Map<string, string>();

export const registerPluginFolder = (id: string, folder: string): void => {
  const known = folders.get(id);
  if (known && known !== folder) throw new Error(`The plugin ${id} already lives under ${known}, not under ${folder}`);
  folders.set(id, folder);
};

export const pluginFolder = (pluginId: string): string => {
  const folder = folders.get(pluginId) ?? path.join(pluginsRoot, pluginId);
  const stats = statSync(folder, { throwIfNoEntry: false });
  if (!stats?.isDirectory()) throw new Error(`The plugin ${pluginId} has no folder ${folder}`);
  return folder;
};
