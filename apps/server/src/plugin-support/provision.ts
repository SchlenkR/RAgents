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

/** What a plugin exports in `provision.ts`: the tool folder is its only storage location. */
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
  if (!response.ok) throw new Error(`${url} does not arrive: ${response.status} ${response.statusText}`);
  return Buffer.from(await response.arrayBuffer());
};

/** Stores the entries below `prefix` as a fresh folder `directory` in the tool folder. */
export const unpackArchive = async (
  archive: Buffer,
  prefix: string,
  target: string,
  directory: string,
): Promise<number> => {
  const entries = readZipEntries(archive, (name) => name.startsWith(prefix));
  if (entries.length === 0) throw new Error(`The archive contains no entries under ${prefix}`);
  const destination = path.join(target, directory);
  await rm(destination, { recursive: true, force: true });
  for (const entry of entries) {
    const relative = entry.name.slice(prefix.length).split("/");
    if (relative.some((segment) => segment === "" || segment === "." || segment === "..")) {
      throw new Error(`The archive entry ${entry.name} leaves the tool folder`);
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

/** The major versions of the installed .NET runtimes, or undefined when there is no dotnet. */
export const dotnetRuntimeMajors = async (): Promise<readonly number[] | undefined> => {
  const output = await run("dotnet", ["--list-runtimes"], { maxBuffer: 4 * 1024 * 1024 }).catch(() => undefined);
  if (!output) return undefined;
  const majors = [...output.stdout.matchAll(/^Microsoft\.NETCore\.App (\d+)\./gm)].map((match) => Number(match[1]));
  return [...new Set(majors)].sort((left, right) => left - right);
};

export const DOTNET_INSTRUCTION = "dotnet is missing on this machine; install the .NET SDK from https://dotnet.microsoft.com/download "
  + "and make sure dotnet is on the PATH";
