import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, realpathSync, statSync } from "node:fs";
import path from "node:path";
import { ragentsDataRoot } from "../data-directory.js";
import { filesBelow } from "../folder-install.js";
import { HOST_API_VERSION, type HostApiHalf } from "../host-api.js";
import { hostRoot, type HostApiRecord } from "../host-version.js";
import { isCheckout } from "../host-web.js";
import { bundlesRoot, pluginIdOf } from "../plugin-support/plugins-root.js";

export const BUNDLE_MANIFEST_FILE = "ragents-bundle.json";
export const BUNDLE_FORMAT = 3;

/** The value names a half imports from each module of the host API. */
export type HostNames = Readonly<Record<string, readonly string[]>>;

/** The one entry point of a bundle, written by the build tool and never by hand. */
export interface BundleManifest {
  readonly format: typeof BUNDLE_FORMAT;
  readonly id: string;
  readonly api: number;
  /** The names of the host API the bundle uses, per half; a host that lacks one refuses the bundle. */
  readonly hostNames: Readonly<Record<HostApiHalf, HostNames>>;
  /** A hash over every file of the bundle; copies and the build tool check it. */
  readonly stand: string;
  /** A hash over the source folder and the host inputs of the build; a checkout compares it with its built-in plugins. */
  readonly sourceStand: string;
  readonly server: string;
  readonly web?: { readonly entry: string; readonly css?: string; readonly classes: string };
  readonly exports: Readonly<Record<HostApiHalf, Readonly<Record<string, string>>>>;
  readonly uses: readonly string[];
  readonly assets: readonly string[];
}

const MANIFEST_KEYS = new Set(["format", "id", "api", "hostNames", "stand", "sourceStand", "server", "web", "exports", "uses", "assets"]);
const SOURCE_MARKERS = ["ragents-plugin.json", "server/index.ts", "server/index.tsx"];

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isStringList = (value: unknown): value is readonly string[] =>
  Array.isArray(value) && value.every((entry) => typeof entry === "string");

const isPathRecord = (value: unknown): value is Readonly<Record<string, string>> =>
  isRecord(value) && Object.values(value).every((entry) => typeof entry === "string");

const isHostNames = (value: unknown): boolean =>
  isRecord(value) && [value.server, value.web].every((half) => isRecord(half) && Object.values(half).every(isStringList));

const isWeb = (value: unknown): boolean =>
  value === undefined || (isRecord(value) && typeof value.entry === "string" && typeof value.classes === "string"
    && (value.css === undefined || typeof value.css === "string"));

const realFolder = (folder: string): string | undefined =>
  existsSync(folder) ? realpathSync.native(folder) : undefined;

/** A built-in bundle lies directly in the host's bundles folder; everything else comes from its author. */
export const isBuiltInBundle = (folder: string, bundles = bundlesRoot): boolean => {
  const root = realFolder(bundles);
  return root !== undefined && path.dirname(realFolder(folder) ?? path.resolve(folder)) === root;
};

/** A bundle that ragents connect fetched lies below the remote folder of the data root; the server holds its sources. */
export const isFetchedBundle = (folder: string, dataRoot = ragentsDataRoot()): boolean =>
  path.resolve(folder).startsWith(path.join(dataRoot, "remote") + path.sep);

/** How the author, or for a fetched bundle its user, gets a bundle that fits this host again. */
export const rebuildHint = (folder: string): string => {
  if (isBuiltInBundle(folder)) return "im Checkout mit pnpm build:plugins neu bauen";
  if (isFetchedBundle(folder)) return "der Stand kommt von einem Server: mit ragents connect <server-url> neu holen, connect nennt die passende Host-Fassung";
  return "mit ragents plugin build <quellordner> neu bauen";
};

const SKIPPED_SOURCE_ENTRIES = new Set(["node_modules", ".DS_Store"]);

const sourceFiles = (folder: string, skipped: ReadonlySet<string>, prefix = ""): readonly string[] =>
  readdirSync(folder, { withFileTypes: true })
    .filter((entry) => !SKIPPED_SOURCE_ENTRIES.has(entry.name) && !skipped.has(path.join(folder, entry.name)))
    .sort((left, right) => left.name.localeCompare(right.name, "en"))
    .flatMap((entry) => {
      const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) return sourceFiles(path.join(folder, entry.name), skipped, relative);
      return entry.isFile() ? [relative] : [];
    });

const fileDigest = (file: string): string => createHash("sha256").update(readFileSync(file)).digest("hex");

/** Host files that shape every bundle besides its sources: the build tool, the host API and the versions of the bundled libraries. */
const buildInputsOf = (root: string): readonly string[] => [
  "apps/server/src/host-api.ts",
  "apps/server/src/host-api.json",
  "apps/server/src/plugin-build/build.ts",
  "apps/server/src/plugin-build/plugin-description.ts",
  isCheckout(root) ? "pnpm-lock.yaml" : "package.json",
];

/** A hash over every file of a plugin source folder except dependencies and the given output folders, together with the build inputs of the host. */
export const sourceStandOf = (folder: string, skipped: readonly string[] = [], root = hostRoot()): string => {
  const hash = createHash("sha256");
  for (const relative of sourceFiles(folder, new Set(skipped))) hash.update(`${relative}\0${fileDigest(path.join(folder, relative))}\n`);
  for (const input of buildInputsOf(root)) hash.update(`host:${input}\0${fileDigest(path.join(root, input))}\n`);
  return hash.digest("hex");
};

/** A hash over every file of the bundle except its manifest and what Finder leaves behind, stable across machines. */
export const bundleStand = (folder: string): string => {
  const hash = createHash("sha256");
  const files = filesBelow(folder).filter((name) => name !== BUNDLE_MANIFEST_FILE && path.posix.basename(name) !== ".DS_Store");
  for (const relative of files) hash.update(`${relative}\0${fileDigest(path.join(folder, relative))}\n`);
  return hash.digest("hex");
};

/** A copy of a bundle, from a package or an archive, must carry exactly the files it was built with. */
export const assertBundleStand = (folder: string, manifest: Pick<BundleManifest, "id" | "stand">): void => {
  if (bundleStand(folder) !== manifest.stand) {
    throw new Error(`Das Bundle ${manifest.id} in ${folder} hat nicht mehr die Dateien, mit denen es gebaut wurde (stand); ${rebuildHint(folder)}`);
  }
};

/** What a bundle needs from the host API that this host does not offer, one line per module. */
const missingHostNames = (manifest: Pick<BundleManifest, "hostNames">, record: HostApiRecord): readonly string[] =>
  (["server", "web"] as const).flatMap((half) => Object.entries(manifest.hostNames[half]).flatMap(([specifier, names]) => {
    const offered = record[half][specifier];
    if (!offered) return [`${half} ${specifier}`];
    const missing = names.filter((name) => !offered.includes(name));
    return missing.length > 0 ? [`${half} ${specifier}: ${missing.join(", ")}`] : [];
  }));

/** A bundle built against a newer host of the same number may use names this host lacks; that is a start error with its cause, never undefined at run time. */
export const assertHostNames = (folder: string, manifest: Pick<BundleManifest, "id" | "hostNames">, record: HostApiRecord): void => {
  const missing = missingHostNames(manifest, record);
  if (missing.length === 0) return;
  throw new Error(`Das Bundle ${manifest.id} braucht aus der Host-API ${record.version} Namen, die dieser Host nicht anbietet (${missing.join("; ")}); `
    + `es ist gegen einen neueren Host gebaut: den Host aktualisieren, sonst ${rebuildHint(folder)}`);
};

/** Reads and checks the manifest; format and host API must match this host exactly. */
export const readBundleManifest = (folder: string): BundleManifest => {
  const file = path.join(folder, BUNDLE_MANIFEST_FILE);
  if (!statSync(file, { throwIfNoEntry: false })?.isFile()) {
    if (SOURCE_MARKERS.some((marker) => existsSync(path.join(folder, marker)))) {
      throw new Error(`${folder} ist ein Quellordner, kein Bundle: mit ragents plugin build ${folder} bauen und im Profil den Bundle-Ordner nennen`);
    }
    throw new Error(`${folder} ist kein Bundle: ${BUNDLE_MANIFEST_FILE} fehlt`);
  }
  const id = pluginIdOf(folder);
  const raw = ((): unknown => {
    try {
      return JSON.parse(readFileSync(file, "utf8"));
    } catch (cause) {
      throw new Error(`${file} ist kein gültiges JSON: ${cause instanceof Error ? cause.message : String(cause)}`);
    }
  })();
  if (!isRecord(raw)) throw new Error(`${file} muss ein Objekt enthalten`);
  if (raw.format !== BUNDLE_FORMAT) {
    throw new Error(`Das Bundle ${id} hat das Format ${String(raw.format)}, dieser Host liest Format ${BUNDLE_FORMAT}; ${rebuildHint(folder)}`);
  }
  if (raw.id !== id) throw new Error(`Das Bundle in ${folder} meldet die Kennung ${String(raw.id)}; die Kennung ist der Ordnername ${id}`);
  if (raw.api !== HOST_API_VERSION) {
    throw new Error(`Das Bundle ${id} ist für Host-API ${String(raw.api)} gebaut, dieser Host bietet ${HOST_API_VERSION}; ${rebuildHint(folder)}`);
  }
  const unknown = Object.keys(raw).filter((key) => !MANIFEST_KEYS.has(key));
  if (unknown.length > 0) throw new Error(`${file}: unbekannte Felder ${unknown.join(", ")}; ${rebuildHint(folder)}`);
  const malformed = [
    ...(isHostNames(raw.hostNames) ? [] : ["hostNames"]),
    ...(typeof raw.stand === "string" ? [] : ["stand"]),
    ...(typeof raw.sourceStand === "string" ? [] : ["sourceStand"]),
    ...(typeof raw.server === "string" ? [] : ["server"]),
    ...(isWeb(raw.web) ? [] : ["web"]),
    ...(isRecord(raw.exports) && isPathRecord(raw.exports.server) && isPathRecord(raw.exports.web) ? [] : ["exports"]),
    ...(isStringList(raw.uses) ? [] : ["uses"]),
    ...(isStringList(raw.assets) ? [] : ["assets"]),
  ];
  if (malformed.length > 0) throw new Error(`${file}: ${malformed.join(", ")} fehlt oder hat die falsche Form; ${rebuildHint(folder)}`);
  const web = raw.web as BundleManifest["web"];
  const webFiles = web === undefined ? [] : [web.entry, web.classes, ...(web.css === undefined ? [] : [web.css])];
  const misplaced = webFiles.filter((entry) => !entry.startsWith("web/") || entry.split("/").includes(".."));
  if (misplaced.length > 0) throw new Error(`${file}: ${misplaced.join(", ")} liegt nicht unter web/; ${rebuildHint(folder)}`);
  for (const required of [raw.server as string, ...webFiles]) {
    if (!statSync(path.join(folder, required), { throwIfNoEntry: false })?.isFile()) throw new Error(`Dem Bundle ${id} fehlt ${required}; ${rebuildHint(folder)}`);
  }
  return raw as unknown as BundleManifest;
};
