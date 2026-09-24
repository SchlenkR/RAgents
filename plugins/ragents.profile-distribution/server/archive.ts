import { createHash } from "node:crypto";
import { readdirSync, statSync, lstatSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { create as createTar } from "tar";
import { hostConfigKeys } from "@ragents/host/config.js";
import { isEnvironmentReference, isProvisionedReference } from "@ragents/host/config-definition.js";
import { resolveAnonymousUser, resolveProfileUsers, SECRET_KEY_PATTERN } from "@ragents/host/config-file.js";
import { discoverPluginIds, resolvePluginEntries, type ResolvedPlugin } from "@ragents/host/profile/plugin-discovery.js";
import { bundlesRoot, isPluginPath } from "@ragents/host/plugin-support/plugins-root.js";

export interface ClientProfilePlugin extends ResolvedPlugin {
  readonly source: "host" | "archive";
}

export interface InspectedClientProfile {
  readonly profile: string;
  readonly source: string;
  readonly root: string;
  readonly file: string;
  readonly plugins: readonly ClientProfilePlugin[];
}

export interface PackedClientProfile {
  readonly archive: Buffer;
  readonly version: string;
  readonly entries: readonly string[];
}

const PROFILE_FILE = /^ragents\.config\.([a-z0-9]+(?:-[a-z0-9]+)*)\.ts$/;

const commonRoot = (first: string, others: readonly string[]): string => {
  let root = first;
  for (const folder of others) {
    while (folder !== root && !folder.startsWith(root + path.sep)) {
      const parent = path.dirname(root);
      if (parent === root) throw new Error(`Profildatei und Plugin ${folder} haben keinen gemeinsamen Ordner`);
      root = parent;
    }
  }
  return root;
};

const posixRelative = (root: string, target: string): string => path.relative(root, target).split(path.sep).join("/");

// Jeder Name ist frei, damit ein Passwort- oder Token-Verweis auch ohne die Client-Umgebung prüfbar ist.
const placeholderEnvironment: Readonly<Record<string, string | undefined>> = new Proxy({}, { get: () => "client-placeholder-value" });

const checkSections = (source: string, raw: Record<string, unknown>, pluginIds: ReadonlySet<string>): void => {
  for (const [section, value] of Object.entries(raw)) {
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${source}: die Sektion ${section} ist kein Objekt`);
    if (section !== "host" && !pluginIds.has(section)) throw new Error(`${source}: die Sektion ${section} gehört zu keinem Plugin aus host.PLUGINS`);
    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
      if (section === "host" && !hostConfigKeys.includes(key)) throw new Error(`${source}: host.${key} ist kein Host-Schlüssel`);
      if (isEnvironmentReference(entry) || isProvisionedReference(entry)) continue;
      if (SECRET_KEY_PATTERN.test(key)) throw new Error(`${source}: ${section}.${key} ist ein Secret und muss als env("...") stehen`);
      const valid = typeof entry === "string" || typeof entry === "number" || typeof entry === "boolean"
        || (Array.isArray(entry) && entry.every((item) => typeof item === "string"));
      if (!valid) throw new Error(`${source}: ${section}.${key} hat keinen gültigen Wert`);
      if (typeof entry === "string" && /^\$\{[A-Za-z_][A-Za-z0-9_]*\}$/.test(entry)) throw new Error(`${source}: ${section}.${key} verweist als Text auf die Umgebung; env("...") verwenden`);
    }
  }
};

/** Prüft die Client-Profildatei ohne ihre Umgebung und bestimmt, welche Plugins ins Archiv gehören. */
export const inspectClientProfile = async (source: string, root = bundlesRoot): Promise<InspectedClientProfile> => {
  const name = PROFILE_FILE.exec(path.basename(source));
  if (!name) throw new Error(`Die Client-Profildatei muss ragents.config.<profil>.ts heißen: ${source}`);
  if (!statSync(source, { throwIfNoEntry: false })?.isFile()) throw new Error(`Die Client-Profildatei ${source} fehlt`);
  const profile = name[1]!;
  const module = await import(pathToFileURL(source).href) as Record<string, unknown>;
  const raw = module.config;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error(`${source} exportiert keine Konstante config`);
  const host = (raw as Record<string, unknown>).host as Record<string, unknown> | undefined;
  const entries = host?.PLUGINS;
  if (!Array.isArray(entries) || entries.length === 0 || !entries.every((entry) => typeof entry === "string" && entry)) {
    throw new Error(`${source}: host.PLUGINS muss eine nicht leere Liste sein`);
  }
  if (host?.PRODUCT_PROFILE !== profile) throw new Error(`${source}: host.PRODUCT_PROFILE muss ${profile} sein`);
  const directory = path.dirname(source);
  const unportable = (entries as string[]).filter((entry) => isPluginPath(entry) && !/^\.{1,2}\//.test(entry));
  if (unportable.length > 0) {
    throw new Error(`${source}: ${unportable.join(", ")} nennt ein Bundle absolut oder mit ~/; der Client löst diesen Pfad auf seinem eigenen Rechner auf und fände dort nicht das gelieferte Bundle. Im Client-Profil jedes Bundle relativ zur Profildatei nennen (./ oder ../)`);
  }
  const plugins = ((): readonly ClientProfilePlugin[] => {
    try {
      return resolvePluginEntries(entries as string[], directory, root)
        .map((plugin, index) => ({ ...plugin, source: isPluginPath((entries as string[])[index]!) ? "archive" : "host" }));
    } catch (cause) {
      throw new Error(`${source}: ${cause instanceof Error ? cause.message : String(cause)}`, { cause });
    }
  })();
  checkSections(source, raw as Record<string, unknown>, new Set([...discoverPluginIds(root), ...plugins.map((plugin) => plugin.id)]));
  const users = resolveProfileUsers(source, module.users, placeholderEnvironment);
  const anonymous = resolveAnonymousUser(source, module.anonymousUser);
  if (users && anonymous) throw new Error(`${source}: users und anonymousUser schließen einander aus`);
  const archived = plugins.filter((plugin) => plugin.source === "archive").map((plugin) => plugin.folder);
  const commonDirectory = commonRoot(directory, archived);
  return { profile, source, root: commonDirectory, file: posixRelative(commonDirectory, source), plugins };
};

const collectFiles = (folder: string, root: string): string[] => {
  const files: string[] = [];
  for (const entry of readdirSync(folder, { withFileTypes: true }).sort((left, right) => left.name.localeCompare(right.name, "en"))) {
    const absolute = path.join(folder, entry.name);
    if (entry.isSymbolicLink()) throw new Error(`Das Client-Profil enthält einen symbolischen Link, den das Archiv nicht abbildet: ${absolute}`);
    if (entry.isDirectory()) {
      files.push(...collectFiles(absolute, root));
    } else if (entry.isFile()) {
      files.push(posixRelative(root, absolute));
    }
  }
  return files;
};

/** Die Einträge des Archivs: die Profildatei und die Dateien der Bundles, die sie per Pfad nennt; das Web hat der Client selbst. */
export const clientProfileEntries = (inspected: InspectedClientProfile): readonly string[] => {
  const entries = [inspected.file, ...inspected.plugins.filter((plugin) => plugin.source === "archive").flatMap((plugin) => collectFiles(plugin.folder, inspected.root))];
  for (const entry of entries) {
    if (!lstatSync(path.join(inspected.root, entry)).isFile()) throw new Error(`Der Archiveintrag ${entry} ist keine Datei`);
  }
  return entries;
};

/** Packt die Einträge deterministisch aus ihrem gemeinsamen Ordner; der Stand ist der SHA-256 des Archivs. */
export const packClientProfile = async (inspected: InspectedClientProfile): Promise<PackedClientProfile> => {
  const entries = clientProfileEntries(inspected);
  const chunks: Buffer[] = [];
  for await (const chunk of createTar({ gzip: { level: 9 }, cwd: inspected.root, portable: true, noMtime: true }, [...entries])) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  const archive = Buffer.concat(chunks);
  return { archive, version: createHash("sha256").update(archive).digest("hex"), entries };
};
