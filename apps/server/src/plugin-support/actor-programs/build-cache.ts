import { createHash, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { mkdir, readdir, readFile, rename, rm, stat, utimes, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { canonicalHash } from "@ragents/engine";
import { hostRoot } from "../../host-version.js";
import { isCheckout } from "../../host-web.js";
import { awaitWithSignal } from "../await-with-signal.js";

export interface BuildCacheLimits {
  readonly entries: number;
  readonly bytes: number;
}

export interface BuildCacheStats {
  readonly hits: number;
  readonly shared: number;
  readonly builds: number;
}

export interface Built<T> {
  readonly value: T;
  readonly reusable: boolean;
  readonly dependencies?: readonly string[];
}

interface Outcome {
  readonly text: string;
  readonly reusable: boolean;
}

const ABANDONED_WRITE_MS = 10 * 60 * 1000;

const isMissing = (error: unknown): boolean => (error as NodeJS.ErrnoException).code === "ENOENT";

const digest = (content: string | Buffer): string => createHash("sha256").update(content).digest("hex");

const digestOf = async (file: string): Promise<string | null> => {
  try {
    return digest(await readFile(file));
  } catch (error) {
    if (isMissing(error)) return null;
    throw error;
  }
};

const isDependencies = (value: unknown): value is Record<string, string | null> =>
  typeof value === "object" && value !== null && !Array.isArray(value) && Object.values(value).every((entry) => entry === null || typeof entry === "string");

export class ProgramBuildCache {
  readonly #directory: string;
  readonly #limits: BuildCacheLimits;
  readonly #running = new Map<string, Promise<Outcome>>();
  readonly #counts = new Map<string, { hits: number; shared: number; builds: number }>();

  constructor(directory: string, limits: BuildCacheLimits) {
    this.#directory = directory;
    this.#limits = limits;
  }

  stats(kind: string): BuildCacheStats {
    return { hits: 0, shared: 0, builds: 0, ...this.#counts.get(kind) };
  }

  async through<T>(kind: string, key: string, build: () => Promise<Built<T>>, signal?: AbortSignal): Promise<T> {
    const counts = this.#counts.get(kind) ?? { hits: 0, shared: 0, builds: 0 };
    this.#counts.set(kind, counts);
    const running = this.#running.get(`${kind}-${key}`);
    if (running) {
      const shared = await awaitWithSignal(running.catch(() => undefined), signal);
      if (shared?.reusable) {
        counts.shared += 1;
        return JSON.parse(shared.text) as T;
      }
    }
    const own = this.#resolve(kind, key, build, counts);
    if (!running) this.#running.set(`${kind}-${key}`, own);
    try {
      return JSON.parse((await own).text) as T;
    } finally {
      if (this.#running.get(`${kind}-${key}`) === own) this.#running.delete(`${kind}-${key}`);
    }
  }

  async #resolve<T>(kind: string, key: string, build: () => Promise<Built<T>>, counts: { hits: number; builds: number }): Promise<Outcome> {
    const stored = await this.#read(kind, key);
    if (stored) {
      counts.hits += 1;
      return { text: JSON.stringify(stored.value), reusable: true };
    }
    counts.builds += 1;
    const built = await build();
    const text = JSON.stringify(built.value);
    if (built.reusable) await this.#write(kind, key, text, built.dependencies ?? []);
    return { text, reusable: built.reusable };
  }

  #file(kind: string, key: string): string {
    return path.join(this.#directory, `${kind}-${key}.json`);
  }

  async #read(kind: string, key: string): Promise<{ readonly value: unknown } | undefined> {
    const file = this.#file(kind, key);
    let text: string;
    try {
      text = await readFile(file, "utf8");
    } catch (error) {
      if (isMissing(error)) return undefined;
      throw error;
    }
    let entry: { version?: unknown; key?: unknown; dependencies?: unknown; value?: unknown };
    try {
      entry = JSON.parse(text) as typeof entry;
    } catch {
      return undefined;
    }
    if (entry.version !== 1 || entry.key !== key || !("value" in entry) || !isDependencies(entry.dependencies)) return undefined;
    for (const [dependency, expected] of Object.entries(entry.dependencies))
      if (await digestOf(dependency) !== expected) return undefined;
    const now = new Date();
    await utimes(file, now, now).catch((error: unknown) => {
      if (!isMissing(error)) throw error;
    });
    return { value: entry.value };
  }

  async #write(kind: string, key: string, text: string, dependencies: readonly string[]): Promise<void> {
    await mkdir(this.#directory, { recursive: true });
    const file = this.#file(kind, key);
    const staged = `${file}.${randomUUID()}.tmp`;
    const digests = Object.fromEntries(await Promise.all(dependencies.map(async (dependency) => [dependency, await digestOf(dependency)])));
    await writeFile(staged, `{"version":1,"key":${JSON.stringify(key)},"dependencies":${JSON.stringify(digests)},"value":${text}}`);
    await rename(staged, file);
    await this.#evict();
  }

  async #evict(): Promise<void> {
    const entries = (await Promise.all((await readdir(this.#directory)).map(async (name) => {
      const file = path.join(this.#directory, name);
      const info = await stat(file).catch((error: unknown) => {
        if (isMissing(error)) return undefined;
        throw error;
      });
      return info ? { name, file, size: info.size, modified: info.mtimeMs } : undefined;
    }))).filter((entry) => entry !== undefined);
    for (const entry of entries)
      if (entry.name.endsWith(".tmp") && Date.now() - entry.modified > ABANDONED_WRITE_MS) await rm(entry.file, { force: true });
    const kept = entries.filter((entry) => entry.name.endsWith(".json")).sort((left, right) => left.modified - right.modified);
    let bytes = kept.reduce((total, entry) => total + entry.size, 0);
    for (const [index, entry] of kept.entries()) {
      if (kept.length - index <= this.#limits.entries && bytes <= this.#limits.bytes) break;
      await rm(entry.file, { force: true });
      bytes -= entry.size;
    }
  }
}

const IMPLEMENTATION = ["app-project.ts", "build-cache.ts", "client-compiler.ts", "program-guards.ts", "runtime-libraries.ts", "server-typecheck.ts", "view-hooks.ts"] as const;

let identity: string | undefined;

export const hostBuildIdentity = (): string => identity ??= canonicalHash({
  typescript: ts.version,
  libraries: digest(readFileSync(path.join(hostRoot(), isCheckout() ? "pnpm-lock.yaml" : "package.json"))),
  implementation: IMPLEMENTATION.map((name) => digest(readFileSync(fileURLToPath(new URL(`./${name}`, import.meta.url))))),
});

const installedFiles = async (directory: string, prefix = ""): Promise<{ path: string; digest: string }[]> => {
  const entries = await readdir(path.join(directory, prefix), { withFileTypes: true }).catch((error: unknown) => {
    if (isMissing(error)) return [];
    throw error;
  });
  return (await Promise.all(entries.map(async (entry) => {
    const relative = path.join(prefix, entry.name);
    return entry.isDirectory() ? installedFiles(directory, relative) : [{ path: relative, digest: digest(await readFile(path.join(directory, relative))) }];
  }))).flat().sort((left, right) => left.path.localeCompare(right.path));
};

export const projectCacheKey = async (directory: string, request: {
  readonly kind: string;
  readonly files: readonly { readonly path: string; readonly content: string }[];
  readonly sdk: readonly string[];
  readonly extra: Readonly<Record<string, unknown>>;
}): Promise<string> => canonicalHash({
  kind: request.kind,
  host: hostBuildIdentity(),
  sdk: await Promise.all(request.sdk.map(async (name) => [name, await installedFiles(path.join(directory, "node_modules/@ragents"), name)])),
  files: request.files,
  extra: request.extra,
});

export const outsideReads = (directories: readonly string[], files: readonly { readonly path: string }[], inspected: readonly string[]): { readonly hostFiles: string[]; readonly foreign: boolean } => {
  const [directory = ""] = directories;
  const own = new Set(directories.flatMap((root) => files.map((file) => path.resolve(root, file.path))));
  const outside = [...new Set(inspected.map((name) => path.resolve(directory, name)))]
    .filter((name) => !own.has(name) && !name.split(path.sep).includes("node_modules"));
  const hostFiles = outside.filter((name) => name.startsWith(`${hostRoot()}${path.sep}`));
  return { hostFiles, foreign: hostFiles.length < outside.length };
};
