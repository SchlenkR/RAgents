import { readFile } from "node:fs/promises";
import path from "node:path";
import { compile, optimize } from "@tailwindcss/node";
import { Scanner } from "@tailwindcss/oxide";
import { rebuildHint } from "./profile/bundle-manifest.js";
import type { ResolvedPlugin } from "./profile/plugin-discovery.js";
import { etagOf } from "./web-bundles.js";

/** The one stylesheet the web links as /ragents.css: theme, base and every utility the host and the web bundles use. */
export const STYLESHEET_PATH = "/ragents.css";

export interface Stylesheet {
  readonly css: string;
  readonly etag: string;
}

const stylesheetEntry = (root: string): string => path.join(root, "apps/web/src/ui/tailwind.css");

/** The Tailwind candidates of the host web, found in its sources. */
export const hostWebClasses = (root: string): readonly string[] =>
  new Scanner({ sources: [{ base: path.join(root, "apps/web/src"), pattern: "**/*", negated: false }] }).scan();

const classListFile = (plugin: ResolvedPlugin): string | undefined =>
  plugin.manifest.web === undefined ? undefined : path.join(plugin.folder, plugin.manifest.web.classes);

const readClassList = async (plugin: ResolvedPlugin, file: string): Promise<string> =>
  readFile(file, "utf8").catch((cause: unknown) => {
    throw new Error(`Das Bundle ${plugin.id} hat keine lesbare Klassenliste ${file}; ${rebuildHint(plugin.folder)}`, { cause });
  });

const parsedClasses = (plugin: ResolvedPlugin, file: string, text: string): readonly string[] => {
  const classes = JSON.parse(text) as unknown;
  if (!Array.isArray(classes) || classes.some((entry) => typeof entry !== "string")) {
    throw new Error(`Die Klassenliste ${file} des Bundles ${plugin.id} ist keine Liste von Texten; ${rebuildHint(plugin.folder)}`);
  }
  return classes as readonly string[];
};

/** Compiles the host's Tailwind entry for the given candidates; the order of the utilities stays Tailwind's. */
export const compileStylesheet = async (root: string, candidates: readonly string[], minify: boolean): Promise<Stylesheet> => {
  const entry = stylesheetEntry(root);
  const compiler = await compile(await readFile(entry, "utf8"), { base: path.dirname(entry), onDependency: () => {} });
  const built = compiler.build([...new Set(candidates)]);
  const css = minify ? optimize(built, { minify: true }).code : built;
  return { css, etag: etagOf(css) };
};

export interface StylesheetSource {
  readonly root: string;
  readonly bundles: readonly ResolvedPlugin[];
  /** Dev mode compiles anew for every request, so that new classes in host code appear without a restart. */
  readonly dev: boolean;
}

interface ClassLists {
  /** The raw text of every class list, so that a rebuilt bundle shows as a change. */
  readonly texts: string;
  readonly candidates: readonly string[];
}

const readClassLists = async (bundles: readonly ResolvedPlugin[]): Promise<ClassLists> => {
  const lists = await Promise.all(bundles.map(async (plugin) => {
    const file = classListFile(plugin);
    if (file === undefined) return { text: "", classes: [] as readonly string[] };
    const text = await readClassList(plugin, file);
    return { text, classes: parsedClasses(plugin, file, text) };
  }));
  return { texts: lists.map((list) => list.text).join("\0"), candidates: lists.flatMap((list) => list.classes) };
};

/** Compiles the stylesheet at start and again whenever a bundle's class list changed, so that a rebuilt web half needs only a reload; dev mode also rescans the host sources. */
export const createStylesheet = async (source: StylesheetSource): Promise<() => Promise<Stylesheet>> => {
  const hostClasses = hostWebClasses(source.root);
  const compileFrom = (lists: ClassLists): Promise<Stylesheet> =>
    compileStylesheet(source.root, [...(source.dev ? hostWebClasses(source.root) : hostClasses), ...lists.candidates], !source.dev);
  const initial = await readClassLists(source.bundles);
  let current = { texts: initial.texts, stylesheet: await compileFrom(initial) };
  return async () => {
    const lists = await readClassLists(source.bundles);
    if (!source.dev && lists.texts === current.texts) return current.stylesheet;
    const stylesheet = await compileFrom(lists);
    if (!source.dev) current = { texts: lists.texts, stylesheet };
    return stylesheet;
  };
};
