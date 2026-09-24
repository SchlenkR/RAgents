import { existsSync, readdirSync, realpathSync, statSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import type { PluginWebAddresses } from "@ragents/engine";
import { announceBundles } from "../host-resolution.js";
import { checkedHostApiRecord } from "../host-version.js";
import { isPluginModule, type PluginModule } from "../plugin-support/plugin-module.js";
import {
  bundlesRoot,
  isPluginPath,
  pluginFolderFor,
  pluginIdOf,
  pluginsRoot,
  registerPluginFolder,
} from "../plugin-support/plugins-root.js";
import { assertHostNames, BUNDLE_MANIFEST_FILE, isBuiltInBundle, readBundleManifest, sourceStandOf, type BundleManifest } from "./bundle-manifest.js";

/** The built-in bundles; build folders of the build tool start with a dot and do not count. */
export const discoverPluginIds = (root = bundlesRoot): readonly string[] => {
  if (!existsSync(root)) return [];
  const folders = readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith("."))
    .map((entry) => entry.name)
    .sort();
  for (const id of folders) {
    if (!existsSync(path.join(root, id, BUNDLE_MANIFEST_FILE))) throw new Error(`${path.join(root, id)} ist kein Bundle: ${BUNDLE_MANIFEST_FILE} fehlt`);
  }
  return folders;
};

export interface ResolvedPlugin {
  readonly id: string;
  readonly folder: string;
  readonly manifest: BundleManifest;
}

const builtInFolder = (id: string, root: string): string => {
  const folder = path.join(root, id);
  if (statSync(folder, { throwIfNoEntry: false })?.isDirectory()) return folder;
  if (existsSync(path.join(pluginsRoot, id, "ragents-plugin.json"))) {
    throw new Error(`Das eingebaute Plugin ${id} ist nicht gebaut: ${folder} fehlt; im Checkout mit pnpm build:plugins bauen`);
  }
  throw new Error(`Unbekanntes Plugin ${id}; eingebaut sind: ${discoverPluginIds(root).join(", ")}`);
};

/** Resolves the profile's entries to bundles; ids come from bundles/, paths from anywhere on disk. */
export const resolvePluginEntries = (
  entries: readonly string[],
  base = process.cwd(),
  root = bundlesRoot,
): readonly ResolvedPlugin[] => {
  const record = checkedHostApiRecord();
  const resolved = entries.map((entry) => {
    const folder = isPluginPath(entry) ? pluginFolderFor(entry, base, root) : builtInFolder(entry, root);
    if (!statSync(folder, { throwIfNoEntry: false })?.isDirectory()) {
      throw new Error(`Das Plugin ${entry} hat keinen Ordner ${folder}`);
    }
    const manifest = readBundleManifest(folder);
    assertHostNames(folder, manifest, record);
    return { id: pluginIdOf(folder), folder, manifest };
  });
  const duplicate = resolved.find((plugin, index) => resolved.findIndex((other) => other.id === plugin.id) !== index);
  if (duplicate) throw new Error(`Plugin ${duplicate.id} steht mehrfach in der Pluginliste`);
  return resolved;
};

/** The addresses of a web half: the host serves each bundle's web folder under /plugins/<id>/web/. */
export const webAddressesOf = (plugin: ResolvedPlugin): PluginWebAddresses | undefined => {
  const web = plugin.manifest.web;
  if (web === undefined) return undefined;
  const address = (file: string): string => `/plugins/${plugin.id}/${file}`;
  return { entry: address(web.entry), ...(web.css === undefined ? {} : { css: address(web.css) }) };
};

/** The built-in bundles of the profile whose plugin sources changed since they were built; only a checkout has those sources. */
export const staleBuiltInBundles = (plugins: readonly ResolvedPlugin[], sources = pluginsRoot, root = bundlesRoot): readonly string[] =>
  plugins.filter((plugin) => isBuiltInBundle(plugin.folder, root)
    && existsSync(path.join(sources, plugin.id, "ragents-plugin.json"))
    && sourceStandOf(path.join(sources, plugin.id)) !== plugin.manifest.sourceStand)
    .map((plugin) => plugin.id);

const assertUsesInProfile = (plugins: readonly ResolvedPlugin[]): void => {
  const ids = new Set(plugins.map((plugin) => plugin.id));
  for (const plugin of plugins) {
    const missing = plugin.manifest.uses.find((used) => !ids.has(used));
    if (missing !== undefined) throw new Error(`Plugin ${plugin.id} benötigt das fehlende Plugin ${missing}; sein Bundle importiert dessen Exporte`);
  }
};

/** Imports the server entry of every bundle; the loader thread learns their folders first, so cross imports resolve. */
export const importBundles = async (plugins: readonly ResolvedPlugin[]): Promise<ReadonlyMap<string, Readonly<Record<string, unknown>>>> => {
  assertUsesInProfile(plugins);
  await announceBundles(new Map(plugins.map((plugin) => [plugin.id, realpathSync.native(plugin.folder)])));
  const loaded = new Map<string, Readonly<Record<string, unknown>>>();
  for (const plugin of plugins) {
    registerPluginFolder(plugin.id, plugin.folder);
    const entry = realpathSync.native(path.join(plugin.folder, plugin.manifest.server));
    try {
      loaded.set(plugin.id, await import(pathToFileURL(entry).href) as Record<string, unknown>);
    } catch (cause) {
      const reason = cause instanceof Error ? cause.message : String(cause);
      throw new Error(`Das Bundle ${plugin.id} lädt nicht: ${reason}`, { cause });
    }
  }
  return loaded;
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

const assertUsesRequired = (plugins: readonly ResolvedPlugin[], modules: ReadonlyMap<string, PluginModule>): void => {
  for (const plugin of plugins) {
    const requires = modules.get(plugin.id)?.requires ?? [];
    const undeclared = plugin.manifest.uses.filter((used) => !requires.includes(used));
    if (undeclared.length > 0) {
      throw new Error(`Das Bundle ${plugin.id} importiert Exporte von ${undeclared.join(", ")}, nennt es aber nicht in requires seines Modulvertrags`);
    }
  }
};

export interface LoadedPlugins {
  readonly known: readonly string[];
  readonly ids: readonly string[];
  readonly modules: ReadonlyMap<string, PluginModule>;
  readonly bundles: readonly ResolvedPlugin[];
  /** The plugins whose bundle carries a web half, with the addresses the browser loads it from. */
  readonly web: ReadonlyMap<string, PluginWebAddresses>;
}

export const loadPlugins = async (
  entries: readonly string[],
  root = bundlesRoot,
  base = process.cwd(),
): Promise<LoadedPlugins> => {
  const plugins = resolvePluginEntries(entries, base, root);
  const discovered = discoverPluginIds(root);
  const known = [...discovered, ...plugins.map((plugin) => plugin.id).filter((id) => !discovered.includes(id))];
  const imported = await importBundles(plugins);
  const modules = new Map(plugins.map((plugin) => {
    const module = imported.get(plugin.id)?.plugin;
    if (!isPluginModule(module)) {
      throw new Error(
        `Das Bundle ${plugin.id} exportiert in ${plugin.manifest.server} keinen gültigen Einstiegspunkt; erwartet wird `
        + "\"export const plugin: PluginModule\" mit einer create-Funktion");
    }
    return [plugin.id, module] as const;
  }));
  const ids = plugins.map((plugin) => plugin.id);
  assertRequires(ids, modules);
  assertUsesRequired(plugins, modules);
  const web = new Map(plugins.flatMap((plugin) => {
    const addresses = webAddressesOf(plugin);
    return addresses === undefined ? [] : [[plugin.id, addresses] as const];
  }));
  return { known, ids, modules, bundles: plugins, web };
};
