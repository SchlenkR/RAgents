import { readdirSync, statSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { isPluginModule, type PluginModule } from "../plugin-support/plugin-module.js";
import {
  isPluginPath,
  PLUGIN_SERVER_FOLDER,
  pluginFolderFor,
  pluginIdOf,
  pluginsRoot,
  registerPluginFolder,
} from "../plugin-support/plugins-root.js";

const ENTRY_FILES = ["index.ts", "index.js"] as const;

const entryFile = (folder: string): string | undefined =>
  ENTRY_FILES
    .map((name) => path.join(folder, PLUGIN_SERVER_FOLDER, name))
    .find((candidate) => statSync(candidate, { throwIfNoEntry: false })?.isFile() === true);

const assertEntryFile = (folder: string): string => {
  const entry = entryFile(folder);
  if (entry) return entry;
  throw new Error(
    `Der Plugin-Ordner ${folder} hat keinen Einstiegspunkt; erwartet wird `
    + `${ENTRY_FILES.map((name) => `${PLUGIN_SERVER_FOLDER}/${name}`).join(" oder ")} `
    + "mit \"export const plugin: PluginModule\"");
};

export const discoverPluginIds = (root = pluginsRoot): readonly string[] => {
  const folders = readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
  for (const id of folders) assertEntryFile(path.join(root, id));
  return folders;
};

export interface ResolvedPlugin {
  readonly id: string;
  readonly folder: string;
}

/** Resolves the profile's entries to folders; ids come from plugins/, paths from anywhere on disk. */
export const resolvePluginEntries = (
  entries: readonly string[],
  base = process.cwd(),
  root = pluginsRoot,
): readonly ResolvedPlugin[] => {
  const known = discoverPluginIds(root);
  const resolved = entries.map((entry) => {
    if (!isPluginPath(entry) && !known.includes(entry)) {
      throw new Error(`Unbekanntes Plugin ${entry}; gefunden wurden: ${known.join(", ")}`);
    }
    const folder = pluginFolderFor(entry, base, root);
    if (!statSync(folder, { throwIfNoEntry: false })?.isDirectory()) {
      throw new Error(`Das Plugin ${entry} hat keinen Ordner ${folder}`);
    }
    assertEntryFile(folder);
    return { id: pluginIdOf(folder), folder };
  });
  const duplicate = resolved.find((plugin, index) => resolved.findIndex((other) => other.id === plugin.id) !== index);
  if (duplicate) throw new Error(`Plugin ${duplicate.id} steht mehrfach in der Pluginliste`);
  return resolved;
};

const loadPluginModule = async (folder: string): Promise<PluginModule> => {
  const entry = assertEntryFile(folder);
  const loaded = await import(pathToFileURL(entry).href) as Record<string, unknown>;
  const module = loaded.plugin;
  if (!isPluginModule(module)) {
    throw new Error(
      `${entry} exportiert keinen gültigen Einstiegspunkt; erwartet wird `
      + "\"export const plugin: PluginModule\" mit einer create-Funktion");
  }
  return module;
};

const assertRequires = (ids: readonly string[], modules: ReadonlyMap<string, PluginModule>): void => {
  const positions = new Map(ids.map((id, index) => [id, index]));
  for (const [index, id] of ids.entries()) {
    for (const dependency of modules.get(id)?.requires ?? []) {
      const position = positions.get(dependency);
      if (position === undefined) throw new Error(`Plugin ${id} benötigt das fehlende Plugin ${dependency}`);
      if (position >= index) throw new Error(`Plugin ${dependency} muss vor ${id} registriert werden`);
    }
  }
};

export interface LoadedPlugins {
  readonly known: readonly string[];
  readonly ids: readonly string[];
  readonly modules: ReadonlyMap<string, PluginModule>;
}

export const loadPlugins = async (
  entries: readonly string[],
  root = pluginsRoot,
  base = process.cwd(),
): Promise<LoadedPlugins> => {
  const plugins = resolvePluginEntries(entries, base, root);
  const discovered = discoverPluginIds(root);
  const known = [...discovered, ...plugins.map((plugin) => plugin.id).filter((id) => !discovered.includes(id))];
  const modules = new Map<string, PluginModule>();
  for (const plugin of plugins) {
    registerPluginFolder(plugin.id, plugin.folder);
    modules.set(plugin.id, await loadPluginModule(plugin.folder));
  }
  const ids = plugins.map((plugin) => plugin.id);
  assertRequires(ids, modules);
  return { known, ids, modules };
};
