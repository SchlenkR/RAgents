import { existsSync, readFileSync, realpathSync, statSync } from "node:fs";
import path from "node:path";
import type { HostApiHalf } from "../host-api.js";
import { pluginsRoot } from "../plugin-support/plugins-root.js";

export const PLUGIN_DESCRIPTION_FILE = "ragents-plugin.json";

/** What the author states about a plugin source folder; entries stay convention. */
export interface PluginDescription {
  readonly id: string;
  readonly exports: Readonly<Record<HostApiHalf, readonly string[]>>;
  readonly assets: readonly string[];
}

export interface PluginSource {
  readonly folder: string;
  readonly description: PluginDescription;
}

const ID_PATTERN = /^[a-z0-9]+(?:[.-][a-z0-9]+)*$/;
/** Places of the bundle the build tool writes itself; an asset there would overwrite its output or publish sources under /plugins/<id>/web/. */
const RESERVED_ASSET_ROOTS = new Set(["server", "web", "ragents-bundle.json"]);
const DESCRIPTION_KEYS = new Set(["id", "exports", "assets"]);
const HALVES = new Set(["server", "web"]);

const stringList = (value: unknown, where: string): readonly string[] => {
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== "string" || entry.length === 0)) {
    throw new Error(`${where} muss eine Liste von Pfaden sein`);
  }
  return value as readonly string[];
};

/** A relative path inside the plugin folder, written with forward slashes and without leaving the folder. */
const insidePath = (value: string, where: string): string => {
  if (path.isAbsolute(value) || value.includes("\\") || value.split("/").some((part) => part === ".." || part === "." || part === "")) {
    throw new Error(`${where}: ${value} ist kein relativer Pfad im Plugin-Ordner`);
  }
  return value;
};

/** The source file behind a module path without extension, the way a bundler finds it. */
export const sourceFileOf = (stem: string): string | undefined =>
  [`${stem}.ts`, `${stem}.tsx`, path.join(stem, "index.ts"), path.join(stem, "index.tsx")]
    .find((candidate) => statSync(candidate, { throwIfNoEntry: false })?.isFile() === true);

export const readPluginDescription = (folder: string): PluginDescription => {
  const file = path.join(folder, PLUGIN_DESCRIPTION_FILE);
  if (!existsSync(file)) {
    throw new Error(`${folder} hat keine ${PLUGIN_DESCRIPTION_FILE}; ein Plugin beschreibt sich dort mit { "id": "${path.basename(folder)}" }`);
  }
  const raw = JSON.parse(readFileSync(file, "utf8")) as unknown;
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) throw new Error(`${file} muss ein Objekt enthalten`);
  const record = raw as Record<string, unknown>;
  const unknown = Object.keys(record).filter((key) => !DESCRIPTION_KEYS.has(key));
  if (unknown.length > 0) throw new Error(`${file}: unbekannte Felder ${unknown.join(", ")}; erlaubt sind id, exports und assets`);
  const id = record.id;
  if (typeof id !== "string" || !ID_PATTERN.test(id)) throw new Error(`${file}: id muss eine Kennung wie acme.tickets sein`);
  if (id !== path.basename(folder)) throw new Error(`${file}: die Kennung ${id} weicht vom Ordnernamen ${path.basename(folder)} ab`);
  const exportsValue = record.exports ?? {};
  if (typeof exportsValue !== "object" || exportsValue === null || Array.isArray(exportsValue)) {
    throw new Error(`${file}: exports muss ein Objekt mit server und web sein`);
  }
  const halves = Object.keys(exportsValue).filter((half) => !HALVES.has(half));
  if (halves.length > 0) throw new Error(`${file}: exports kennt nur server und web, nicht ${halves.join(", ")}`);
  const exportsOf = (half: HostApiHalf): readonly string[] => {
    const names = stringList((exportsValue as Record<string, unknown>)[half] ?? [], `${file}: exports.${half}`)
      .map((name) => insidePath(name, `${file}: exports.${half}`));
    for (const name of names) {
      if (/\.(js|ts|tsx|mjs)$/.test(name)) throw new Error(`${file}: der Export ${name} wird ohne Endung genannt`);
      if (!sourceFileOf(path.join(folder, name))) throw new Error(`${file}: der Export ${name} für ${half} hat keine Quelldatei`);
    }
    return names;
  };
  const assets = stringList(record.assets ?? [], `${file}: assets`).map((name) => insidePath(name, `${file}: assets`));
  for (const name of assets) {
    if (RESERVED_ASSET_ROOTS.has(name.split("/")[0]!)) throw new Error(`${file}: das Asset ${name} liegt unter ${name.split("/")[0]}, das schreibt das Bauwerkzeug selbst`);
    if (!existsSync(path.join(folder, name))) throw new Error(`${file}: das Asset ${name} fehlt im Plugin-Ordner`);
  }
  return { id, exports: { server: exportsOf("server"), web: exportsOf("web") }, assets };
};

export const readPluginSource = (folder: string): PluginSource => {
  const given = path.resolve(folder);
  if (!statSync(given, { throwIfNoEntry: false })?.isDirectory()) throw new Error(`${given} ist kein Ordner`);
  const real = realpathSync.native(given);
  return { folder: real, description: readPluginDescription(real) };
};

/** The nearest plugin folder that contains a file, if the file belongs to a plugin at all. */
export const owningPluginFolder = (file: string): string | undefined => {
  const parts = path.dirname(file).split(path.sep);
  for (let length = parts.length; length > 1; length -= 1) {
    const candidate = parts.slice(0, length).join(path.sep) || path.sep;
    if (parts[length - 1] === "node_modules") return undefined;
    if (existsSync(path.join(candidate, PLUGIN_DESCRIPTION_FILE))) return candidate;
  }
  return undefined;
};

/** The export a file stands for in its plugin, for the given half. */
export const exportOfFile = (source: PluginSource, half: HostApiHalf, file: string): string | undefined =>
  source.description.exports[half].find((name) => sourceFileOf(path.join(source.folder, name)) === file);

/** Plugins a build may import by id: the siblings of the built folders first, then the host's own. */
export const pluginCatalog = (folders: readonly string[], builtIn = pluginsRoot): ((id: string) => PluginSource | undefined) => {
  const roots = [...new Set(folders.map((folder) => path.dirname(path.resolve(folder)))), builtIn];
  const known = new Map<string, PluginSource | undefined>();
  return (id) => {
    if (!ID_PATTERN.test(id)) return undefined;
    if (known.has(id)) return known.get(id);
    const found = roots.map((root) => path.join(root, id)).filter((folder) => existsSync(path.join(folder, PLUGIN_DESCRIPTION_FILE)));
    const distinct = [...new Set(found.map((folder) => realpathSync.native(folder)))];
    if (distinct.length > 1) throw new Error(`Das Plugin ${id} gibt es mehrfach: ${distinct.join(", ")}`);
    const source = distinct[0] ? readPluginSource(distinct[0]) : undefined;
    known.set(id, source);
    return source;
  };
};
