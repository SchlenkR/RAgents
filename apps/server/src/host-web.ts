import { createHash } from "node:crypto";
import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { hostRoot } from "./host-version.js";

/** The file in the built web that names every source file the build read, each with its hash. */
export const HOST_WEB_RECORD = "host-web.json";

const HOST_WEB_PAGES = ["index.html", "run-panel.html"] as const;

export interface HostWebRecord {
  readonly inputs: Readonly<Record<string, string>>;
}

/** The built web of the host: one for every profile, built with the host by pnpm build:web. */
export const hostWebDirectory = (root = hostRoot()): string => path.join(root, "apps/web/dist");

/** Only a checkout has a git folder; there the sources of the built web and of the built-in bundles can change. */
export const isCheckout = (root = hostRoot()): boolean => existsSync(path.join(root, ".git"));

const fileHash = (file: string): string => createHash("sha256").update(readFileSync(file)).digest("hex");

const isFile = (file: string): boolean => statSync(file, { throwIfNoEntry: false })?.isFile() === true;

/** Records the source files a web build read, relative to the host root. */
export const hostWebRecordOf = (root: string, files: readonly string[]): HostWebRecord => ({
  inputs: Object.fromEntries([...new Set(files)]
    .map((file) => [path.relative(root, file).split(path.sep).join("/"), fileHash(file)] as const)
    .sort(([left], [right]) => left.localeCompare(right, "en"))),
});

const changedInputs = (record: HostWebRecord, root: string): readonly string[] =>
  Object.entries(record.inputs)
    .filter(([name, hash]) => !isFile(path.join(root, name)) || fileHash(path.join(root, name)) !== hash)
    .map(([name]) => name);

const readRecord = (file: string): HostWebRecord | undefined => {
  if (!isFile(file)) return undefined;
  const raw = JSON.parse(readFileSync(file, "utf8")) as { inputs?: unknown };
  const inputs = raw.inputs;
  if (typeof inputs !== "object" || inputs === null || Array.isArray(inputs)
    || Object.values(inputs).some((hash) => typeof hash !== "string")) {
    throw new Error(`${file} hat nicht die erwartete Form`);
  }
  return { inputs: inputs as Record<string, string> };
};

/** Why a built web cannot be served as it is; with sources, a checkout also compares it with the files it was built from. */
export const hostWebProblem = (directory: string, root: string, sources: boolean): string | undefined => {
  const missing = HOST_WEB_PAGES.filter((page) => !isFile(path.join(directory, page)));
  if (missing.length > 0) return `Das Web des Hosts fehlt unter ${directory} (${missing.join(", ")})`;
  if (!sources) return undefined;
  const record = readRecord(path.join(directory, HOST_WEB_RECORD));
  if (!record) return `Das Web des Hosts unter ${directory} hat keinen Quellstand (${HOST_WEB_RECORD})`;
  const changed = changedInputs(record, root);
  if (changed.length === 0) return undefined;
  const shown = changed.slice(0, 5).join(", ") + (changed.length > 5 ? ` und ${changed.length - 5} weitere` : "");
  return `Das Web des Hosts unter ${directory} passt nicht mehr zu seinen Quellen (geändert: ${shown})`;
};
