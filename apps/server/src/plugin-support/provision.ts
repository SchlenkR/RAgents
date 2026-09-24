import { execFile } from "node:child_process";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { promisify } from "node:util";
import { readZipEntries, readZipNames } from "./zip.js";

export { readZipNames };

export type ProvisionState =
  | { readonly kind: "ready" }
  | { readonly kind: "gap"; readonly name: string; readonly instruction: string; readonly installable: boolean };

/** Was ein Plugin in `provision.ts` exportiert: der Werkzeugordner ist sein einziger Ablageort. */
export interface PluginProvision {
  readonly check: (target: string) => Promise<ProvisionState>;
  readonly apply: (target: string, log: (line: string) => void) => Promise<void>;
}

export const provisionReady: ProvisionState = { kind: "ready" };

const hostRequire = createRequire(import.meta.url);

/** The folder of a package the host provides, for tools a plugin starts as a separate process. */
export const hostPackageFolder = (name: string): string => path.dirname(hostRequire.resolve(`${name}/package.json`));

export const provisionGap = (name: string, instruction: string, installable: boolean): ProvisionState =>
  ({ kind: "gap", name, instruction, installable });

export const isPluginProvision = (value: unknown): value is PluginProvision =>
  typeof value === "object" && value !== null
  && typeof (value as PluginProvision).check === "function"
  && typeof (value as PluginProvision).apply === "function";

export type ArchiveDownload = (url: string) => Promise<Buffer>;

export const downloadArchive: ArchiveDownload = async (url) => {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${url} kommt nicht an: ${response.status} ${response.statusText}`);
  return Buffer.from(await response.arrayBuffer());
};

/** Legt die Einträge unterhalb von `prefix` als frischen Ordner `directory` im Werkzeugordner ab. */
export const unpackArchive = async (
  archive: Buffer,
  prefix: string,
  target: string,
  directory: string,
): Promise<number> => {
  const entries = readZipEntries(archive, (name) => name.startsWith(prefix));
  if (entries.length === 0) throw new Error(`Das Archiv enthält keine Einträge unter ${prefix}`);
  const destination = path.join(target, directory);
  await rm(destination, { recursive: true, force: true });
  for (const entry of entries) {
    const relative = entry.name.slice(prefix.length).split("/");
    if (relative.some((segment) => segment === "" || segment === "." || segment === "..")) {
      throw new Error(`Der Archiveintrag ${entry.name} verlässt den Werkzeugordner`);
    }
    const file = path.join(destination, ...relative);
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, entry.content);
  }
  return entries.length;
};

const STAMP_FILE = "provisioned.json";

export const readProvisionStamp = async (target: string): Promise<string | undefined> => {
  const raw = await readFile(path.join(target, STAMP_FILE), "utf8").catch(() => undefined);
  if (raw === undefined) return undefined;
  const parsed = JSON.parse(raw) as { version?: unknown };
  return typeof parsed.version === "string" ? parsed.version : undefined;
};

export const writeProvisionStamp = async (target: string, version: string): Promise<void> => {
  await mkdir(target, { recursive: true });
  await writeFile(path.join(target, STAMP_FILE), `${JSON.stringify({ version }, null, 2)}\n`);
};

const run = promisify(execFile);

/** Die Hauptversionen der installierten .NET-Laufzeiten, oder undefined, wenn es kein dotnet gibt. */
export const dotnetRuntimeMajors = async (): Promise<readonly number[] | undefined> => {
  const output = await run("dotnet", ["--list-runtimes"], { maxBuffer: 4 * 1024 * 1024 }).catch(() => undefined);
  if (!output) return undefined;
  const majors = [...output.stdout.matchAll(/^Microsoft\.NETCore\.App (\d+)\./gm)].map((match) => Number(match[1]));
  return [...new Set(majors)].sort((left, right) => left - right);
};

export const DOTNET_INSTRUCTION = "dotnet fehlt auf diesem Rechner; das .NET-SDK von https://dotnet.microsoft.com/download "
  + "installieren und dafür sorgen, dass dotnet im PATH steht";
