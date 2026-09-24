import { watch } from "node:fs";
import { lstat, mkdir, readdir, readFile, realpath, writeFile } from "node:fs/promises";
import path from "node:path";
import { WorkspaceOperationError } from "./errors.js";
import type { WorkspaceModuleFactory, WorkspaceOperation } from "./module.js";
import { containsWorkspacePath } from "./paths.js";

export const FILE_LIST_LIMIT = 500;

export const FILE_READ_LIMIT = 256 * 1024;

const WATCH_DEBOUNCE_MS = 150;

export const FILE_OPERATIONS = {
  list: "files.list",
  read: "files.read",
  watch: "files.watch",
  attach: "files.attach",
} as const;

/** Der Unterordner der Wurzel, in dem angehängte Dateien eines Runs liegen. */
export const ATTACHMENT_DIRECTORY = "attachments";

export interface FileEntry {
  name: string;
  kind: "directory" | "file";
  size: number;
  modifiedAt: string;
}

export interface FileListing {
  /** Der echte Pfad der Wurzel auf dieser Maschine. */
  location: string;
  path: string;
  entries: FileEntry[];
  truncated: boolean;
}

export type FileText =
  | { path: string; size: number; previewable: true; content: string }
  | { path: string; size: number; previewable: false; reason: string };

/** Erst `ready`, sobald die Beobachtung steht, danach je entprellter Änderung `changed`. */
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

/** Ein Pfad unterhalb einer Wurzel: relativ, mit `/` getrennt und ohne `..`; `.` und leere Abschnitte fallen weg. */
export const relativeWorkspacePath = (value: string): string => {
  const segments = value.split("/").filter((segment) => segment !== "" && segment !== ".");
  if (value.includes("\0") || value.includes("\\") || path.isAbsolute(value) || segments.includes("..")) {
    throw invalid(`Ungültiger Pfad: ${value}`);
  }
  return segments.join("/");
};

const realRoot = async (root: string): Promise<string> => {
  try {
    return await realpath(root);
  } catch (error) {
    if (missing(error)) throw notFound(`Den Ordner ${root} gibt es nicht`);
    throw error;
  }
};

/** Löst einen geprüften relativen Pfad auf; ein Symlink darf nicht aus der Wurzel führen. */
const inside = async (base: string, relative: string): Promise<string> => {
  let real: string;
  try {
    real = await realpath(relative ? path.join(base, ...relative.split("/")) : base);
  } catch (error) {
    if (missing(error)) throw notFound(`Nicht gefunden: ${relative || "."}`);
    throw error;
  }
  if (!containsWorkspacePath(base, real)) throw invalid(`Pfad außerhalb des Arbeitsverzeichnisses: ${relative}`);
  return real;
};

/** Ein Eintrag, der zwischen Auflisten und Abfragen verschwindet, gehört nicht mehr zum Ordner. */
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
  || left.name.localeCompare(right.name, "de");

const directoryIn = async (base: string, checked: string): Promise<string> => {
  const directory = await inside(base, checked);
  if (!(await lstat(directory)).isDirectory()) throw invalid(`Kein Verzeichnis: ${checked || "."}`);
  return directory;
};

/** Der echte Pfad eines Ordners unterhalb der Wurzel, geprüft wie jeder Pfad dieses Moduls. */
export const workspaceDirectory = async (root: string, relative: string): Promise<string> =>
  directoryIn(await realRoot(root), relativeWorkspacePath(relative));

/** Listet einen Ordner unterhalb der Wurzel: Ordner zuerst, dann alphabetisch, höchstens `FILE_LIST_LIMIT` Einträge. */
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

/** Liest eine Textdatei unterhalb der Wurzel; eine zu große oder binäre Datei nennt statt des Inhalts den Grund. */
export const readTextFile = async (root: string, relative: string): Promise<FileText> => {
  const checked = relativeWorkspacePath(relative);
  const file = await inside(await realRoot(root), checked);
  const info = await lstat(file);
  if (!info.isFile()) throw invalid(`Keine Datei: ${checked || "."}`);
  const described = { path: checked, size: info.size };
  if (info.size > FILE_READ_LIMIT) {
    return { ...described, previewable: false, reason: `Die Datei ist größer als ${FILE_READ_LIMIT / 1024} KB und wird nicht gelesen` };
  }
  const content = await readFile(file);
  if (content.includes(0)) return { ...described, previewable: false, reason: "Die Datei ist binär" };
  return { ...described, previewable: true, content: content.toString("utf8") };
};

/** Legt eine angehängte Datei unter einem freien Namen in `attachments` unterhalb der Wurzel ab, nie über eine vorhandene. */
export const storeAttachment = async (root: string, original: string, content: Uint8Array): Promise<string> => {
  const directory = path.join(await realRoot(root), ATTACHMENT_DIRECTORY);
  await mkdir(directory, { recursive: true, mode: 0o755 });
  if (!(await lstat(directory)).isDirectory()) throw invalid("Das Anhangsverzeichnis ist kein normales Verzeichnis.");
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
  throw invalid("Im Anhangsverzeichnis sind zu viele gleichnamige Dateien.");
};

/** Beobachtet einen Ordner rekursiv und meldet Änderungen entprellt; der Rückgabewert beendet die Beobachtung. */
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
  if (typeof value !== "string") throw invalid("Die Eingabe braucht einen Pfad als Text");
  return value;
};

/** Beobachtet bis zum Abbruch; eine gescheiterte Beobachtung beendet die Operation mit ihrer Ursache. */
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

/** Dateien des Runs auf dieser Maschine: auflisten, Text lesen, beobachten und Anhänge ablegen, relativ zur Wurzel des Runs oder eines Alias. */
export const fileModule: WorkspaceModuleFactory = (host) => {
  /** Die offenen Beobachtungen je Run; Stopp und Shutdown beenden sie, auch wenn ihr Aufrufer nie abbricht. */
  const watches = new Map<string, Set<AbortController>>();
  let closed = false;
  const endWatches = (runId: string): void => {
    for (const controller of watches.get(runId) ?? []) controller.abort();
    watches.delete(runId);
  };
  const rootOf = async (runId: string, input: unknown): Promise<string> => {
    const context = await host.contextFor(runId);
    const alias = (input as { alias?: unknown } | null)?.alias;
    if (alias === undefined) return context.root;
    const aliases = context.workspaceAliases ?? {};
    const directory = typeof alias === "string" ? aliases[alias] : undefined;
    if (directory === undefined) {
      const known = Object.keys(aliases);
      throw new WorkspaceOperationError(
        "workspace-alias-unknown",
        `Unbekannter Arbeitsverzeichnis-Alias: ${String(alias)} (bekannt: ${known.length > 0 ? known.join(", ") : "keine"})`,
        400,
      );
    }
    return directory;
  };
  const list: WorkspaceOperation = async ({ runId, input }) => listDirectory(await rootOf(runId, input), pathOf(input));
  const attach: WorkspaceOperation = async ({ runId, input }) => {
    const { name, content } = (input ?? {}) as { name?: unknown; content?: unknown };
    if (typeof name !== "string" || typeof content !== "string") throw invalid("Ein Anhang braucht name und content (Base64) als Text");
    return { name: await storeAttachment((await host.contextFor(runId)).root, name, Buffer.from(content, "base64")) };
  };
  const read: WorkspaceOperation = async ({ runId, input }) => readTextFile(await rootOf(runId, input), pathOf(input));
  const watchFiles: WorkspaceOperation = async ({ runId, signal, progress }) => {
    if (!signal || !progress) throw new Error(`${FILE_OPERATIONS.watch} läuft bis zum Abbruch und braucht Abbruchsignal und Fortschritt`);
    if (closed) throw new Error("Das Dateimodul ist beendet und beobachtet nichts mehr");
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
    stopRun: async (runId) => endWatches(runId),
    shutdown: async () => {
      closed = true;
      for (const runId of [...watches.keys()]) endWatches(runId);
    },
  };
};
