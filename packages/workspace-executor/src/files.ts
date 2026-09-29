import { watch } from "node:fs";
import { lstat, mkdir, readdir, readFile, realpath, writeFile } from "node:fs/promises";
import path from "node:path";
import { WorkspaceOperationError } from "./errors.js";
import type { WorkspaceModuleFactory, WorkspaceOperation } from "./module.js";
import { aliasOf, aliasedRoot, containsWorkspacePath, unknownAliasError, type OperationFootprint } from "./paths.js";

export const FILE_LIST_LIMIT = 500;

export const FILE_READ_LIMIT = 256 * 1024;

const WATCH_DEBOUNCE_MS = 150;

export const FILE_OPERATIONS = {
  list: "files.list",
  read: "files.read",
  watch: "files.watch",
  attach: "files.attach",
} as const;

/** The subfolder of the root in which attached files of a run are stored. */
export const ATTACHMENT_DIRECTORY = "attachments";

export interface FileEntry {
  name: string;
  kind: "directory" | "file";
  size: number;
  modifiedAt: string;
}

export interface FileListing {
  /** The real path of the root on this machine. */
  location: string;
  path: string;
  entries: FileEntry[];
  truncated: boolean;
}

export type FileText =
  | { path: string; size: number; previewable: true; content: string }
  | { path: string; size: number; previewable: false; reason: string };

/** First `ready` once the watch is in place, then `changed` per debounced change. */
export type FileWatchProgress = { kind: "ready" } | { kind: "changed" };

export interface FileWatchListener {
  onChange: () => void;
  onError: (error: Error) => void;
}

const invalid = (message: string): WorkspaceOperationError => new WorkspaceOperationError("workspace-path-invalid", message, 400);

const notFound = (message: string): WorkspaceOperationError => new WorkspaceOperationError("workspace-path-not-found", message, 404);

const missing = (error: unknown): boolean => {
  const code = (error as NodeJS.ErrnoException).code;
  return code === "ENOENT" || code === "ENOTDIR";
};

/** A path below a root: relative, separated by `/` and without `..`; `.` and empty segments are dropped. */
export const relativeWorkspacePath = (value: string): string => {
  const segments = value.split("/").filter((segment) => segment !== "" && segment !== ".");
  if (value.includes("\0") || value.includes("\\") || path.isAbsolute(value) || segments.includes("..")) {
    throw invalid(`Invalid path: ${value}`);
  }
  return segments.join("/");
};

const realRoot = async (root: string): Promise<string> => {
  try {
    return await realpath(root);
  } catch (error) {
    if (missing(error)) throw notFound(`The folder ${root} does not exist`);
    throw error;
  }
};

/** Resolves a checked relative path; a symlink must not lead out of the root. */
const inside = async (base: string, relative: string): Promise<string> => {
  let real: string;
  try {
    real = await realpath(relative ? path.join(base, ...relative.split("/")) : base);
  } catch (error) {
    if (missing(error)) throw notFound(`Not found: ${relative || "."}`);
    throw error;
  }
  if (!containsWorkspacePath(base, real)) throw invalid(`Path outside the working directory: ${relative}`);
  return real;
};

/** An entry that disappears between listing and querying no longer belongs to the folder. */
const entryOf = async (directory: string, name: string, isDirectory: boolean): Promise<FileEntry | undefined> => {
  try {
    const info = await lstat(path.join(directory, name));
    return { name, kind: isDirectory ? "directory" : "file", size: info.size, modifiedAt: info.mtime.toISOString() };
  } catch (error) {
    if (missing(error)) return undefined;
    throw error;
  }
};

const byKindThenName = (left: FileEntry, right: FileEntry): number =>
  (left.kind === right.kind ? 0 : left.kind === "directory" ? -1 : 1)
  || left.name.localeCompare(right.name, "en");

const directoryIn = async (base: string, checked: string): Promise<string> => {
  const directory = await inside(base, checked);
  if (!(await lstat(directory)).isDirectory()) throw invalid(`Not a directory: ${checked || "."}`);
  return directory;
};

/** The real path of a folder below the root, checked like every path of this module. */
export const workspaceDirectory = async (root: string, relative: string): Promise<string> =>
  directoryIn(await realRoot(root), relativeWorkspacePath(relative));

/** Lists a folder below the root: folders first, then alphabetically, at most `FILE_LIST_LIMIT` entries. */
export const listDirectory = async (root: string, relative: string): Promise<FileListing> => {
  const checked = relativeWorkspacePath(relative);
  const base = await realRoot(root);
  const directory = await directoryIn(base, checked);
  const found = await readdir(directory, { withFileTypes: true });
  const entries = (await Promise.all(found.map((entry) => entryOf(directory, entry.name, entry.isDirectory()))))
    .filter((entry): entry is FileEntry => entry !== undefined)
    .sort(byKindThenName);
  return {
    location: base,
    path: checked,
    entries: entries.slice(0, FILE_LIST_LIMIT),
    truncated: entries.length > FILE_LIST_LIMIT,
  };
};

/** Reads a text file below the root; a file that is too large or binary names the reason instead of the content. */
export const readTextFile = async (root: string, relative: string): Promise<FileText> => {
  const checked = relativeWorkspacePath(relative);
  const file = await inside(await realRoot(root), checked);
  const info = await lstat(file);
  if (!info.isFile()) throw invalid(`Not a file: ${checked || "."}`);
  const described = { path: checked, size: info.size };
  if (info.size > FILE_READ_LIMIT) {
    return { ...described, previewable: false, reason: `The file is larger than ${FILE_READ_LIMIT / 1024} KB and is not read` };
  }
  const content = await readFile(file);
  if (content.includes(0)) return { ...described, previewable: false, reason: "The file is binary" };
  return { ...described, previewable: true, content: content.toString("utf8") };
};

/** Stores an attached file under a free name in `attachments` below the root, never over an existing one. */
export const storeAttachment = async (root: string, original: string, content: Uint8Array): Promise<string> => {
  const directory = path.join(await realRoot(root), ATTACHMENT_DIRECTORY);
  await mkdir(directory, { recursive: true, mode: 0o755 });
  if (!(await lstat(directory)).isDirectory()) throw invalid("The attachments directory is not a regular directory.");
  const name = path.basename(original).replace(/[^a-zA-Z0-9._-]/g, "_") || "attachment";
  for (let index = 1; index <= 10000; index += 1) {
    const candidate = index === 1 ? name : `${index}-${name}`;
    try {
      await writeFile(path.join(directory, candidate), content, { mode: 0o644, flag: "wx" });
      return candidate;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    }
  }
  throw invalid("The attachments directory has too many files with the same name.");
};

/** Watches a folder recursively and reports changes debounced; the return value ends the watch. */
export const watchDirectory = async (root: string, listener: FileWatchListener): Promise<() => void> => {
  const directory = await realRoot(root);
  let debounce: NodeJS.Timeout | undefined;
  const watcher = watch(directory, { recursive: true }, () => {
    if (debounce) return;
    debounce = setTimeout(() => {
      debounce = undefined;
      listener.onChange();
    }, WATCH_DEBOUNCE_MS);
  });
  watcher.on("error", listener.onError);
  return () => {
    if (debounce) clearTimeout(debounce);
    watcher.close();
  };
};

const pathOf = (input: unknown): string => {
  const value = (input as { path?: unknown } | null)?.path;
  if (typeof value !== "string") throw invalid("The input needs a path as text");
  return value;
};

/** With an alias the input addresses its root, otherwise the one of the run. */
const aliasFootprint = (input: unknown): OperationFootprint => {
  const alias = (input as { alias?: unknown } | null)?.alias;
  return { roots: typeof alias === "string" ? { aliases: [aliasOf(alias) ?? alias], runRoot: false } : { aliases: [], runRoot: true } };
};

/** Watches until aborted; a failed watch ends the operation with its cause. */
const watchUntilAborted = (root: string, signal: AbortSignal, progress: (value: FileWatchProgress) => void): Promise<null> =>
  new Promise((resolve, reject) => {
    let close: (() => void) | undefined;
    let finished = false;
    const finish = (error?: Error): void => {
      if (finished) return;
      finished = true;
      signal.removeEventListener("abort", aborted);
      close?.();
      if (error) reject(error);
      else resolve(null);
    };
    const aborted = (): void => finish();
    signal.addEventListener("abort", aborted, { once: true });
    watchDirectory(root, { onChange: () => progress({ kind: "changed" }), onError: finish }).then((stop) => {
      if (finished || signal.aborted) {
        stop();
        finish();
        return;
      }
      close = stop;
      progress({ kind: "ready" });
    }, finish);
  });

/** Files of the run on this machine: list, read text, watch and store attachments, relative to the root of the run or of an alias. */
export const fileModule: WorkspaceModuleFactory = (host) => {
  /** The open watches per run; stop and shutdown end them, even if their caller never aborts. */
  const watches = new Map<string, Set<AbortController>>();
  let closed = false;
  const endWatches = (runId: string): void => {
    for (const controller of watches.get(runId) ?? []) controller.abort();
    watches.delete(runId);
  };
  /** Alias and path together form a location; under a shared alias like `@skills` the path names the folder of the root first. */
  const locate = async (runId: string, input: unknown): Promise<{ root: string; path: string }> => {
    const context = await host.contextFor(runId);
    const alias = (input as { alias?: unknown } | null)?.alias;
    const requested = pathOf(input);
    if (alias === undefined) return { root: context.root, path: requested };
    const aliases = context.workspaceAliases ?? {};
    const location = requested === "" ? String(alias) : `${String(alias)}/${requested}`;
    const found = typeof alias === "string" ? aliasedRoot(location, aliases) : undefined;
    if (!found) throw unknownAliasError(location, aliases);
    return { root: found.directory, path: found.rest };
  };
  const list: WorkspaceOperation = async ({ runId, input }) => {
    const { root, path: requested } = await locate(runId, input);
    return listDirectory(root, requested);
  };
  const attach: WorkspaceOperation = async ({ runId, input }) => {
    const { name, content } = (input ?? {}) as { name?: unknown; content?: unknown };
    if (typeof name !== "string" || typeof content !== "string") throw invalid("An attachment needs name and content (Base64) as text");
    return { name: await storeAttachment((await host.contextFor(runId)).root, name, Buffer.from(content, "base64")) };
  };
  const read: WorkspaceOperation = async ({ runId, input }) => {
    const { root, path: requested } = await locate(runId, input);
    return readTextFile(root, requested);
  };
  const watchFiles: WorkspaceOperation = async ({ runId, signal, progress }) => {
    if (!signal || !progress) throw new Error(`${FILE_OPERATIONS.watch} runs until aborted and needs an abort signal and progress`);
    if (closed) throw new Error("The file module has ended and watches nothing anymore");
    const own = new AbortController();
    const running = watches.get(runId) ?? new Set<AbortController>();
    watches.set(runId, running.add(own));
    try {
      const root = (await host.contextFor(runId)).root;
      return await watchUntilAborted(root, AbortSignal.any([signal, own.signal]), progress);
    } finally {
      running.delete(own);
      if (running.size === 0 && watches.get(runId) === running) watches.delete(runId);
    }
  };
  return {
    operations: {
      [FILE_OPERATIONS.list]: list,
      [FILE_OPERATIONS.read]: read,
      [FILE_OPERATIONS.watch]: watchFiles,
      [FILE_OPERATIONS.attach]: attach,
    },
    footprints: {
      [FILE_OPERATIONS.list]: aliasFootprint,
      [FILE_OPERATIONS.read]: aliasFootprint,
    },
    stopRun: async (runId) => endWatches(runId),
    shutdown: async () => {
      closed = true;
      for (const runId of [...watches.keys()]) endWatches(runId);
    },
  };
};
