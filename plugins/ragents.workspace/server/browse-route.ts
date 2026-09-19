import { watch } from "node:fs";
import { lstat, readdir, readFile, realpath } from "node:fs/promises";
import path from "node:path";
import {
  DomainError,
  implement,
  implementChannel,
  type ChannelContribution,
  type MethodContribution,
} from "@aicontainer/ragents";
import {
  BROWSE_ENTRY_LIMIT,
  BROWSE_PREVIEW_LIMIT,
  workspaceContracts,
  type BrowseEntry,
  type BrowseListing,
  type BrowsePreview,
  type BrowseRoot,
} from "../contract.js";

const invalid = (message: string): DomainError => new DomainError("browse-path-invalid", message, 400);

const relativeOf = (value: string): string => {
  const segments = value.split("/").filter((segment) => segment !== "");
  if (value.includes("\0") || value.includes("\\") || path.isAbsolute(value)
    || segments.some((segment) => segment === "." || segment === "..")) {
    throw invalid("Ungültiger Pfad");
  }
  return segments.join("/");
};

const realOf = async (target: string, missing: string): Promise<string> => {
  try {
    return await realpath(target);
  } catch {
    throw new DomainError("browse-not-found", missing, 404);
  }
};

const resolveInside = async (root: string, relative: string): Promise<string> => {
  const rootReal = await realOf(root, "Der Lauf hat dieses Verzeichnis nicht");
  const real = await realOf(
    relative ? path.join(rootReal, relative) : rootReal,
    `Nicht gefunden: ${relative || "."}`,
  );
  if (real !== rootReal && !real.startsWith(rootReal + path.sep)) throw invalid("Ungültiger Pfad");
  return real;
};

const entryOf = async (directory: string, name: string, isDirectory: boolean): Promise<BrowseEntry> => {
  const info = await lstat(path.join(directory, name));
  return {
    name,
    kind: isDirectory ? "directory" : "file",
    size: info.size,
    modifiedAt: info.mtime.toISOString(),
  };
};

const byKindThenName = (left: BrowseEntry, right: BrowseEntry): number =>
  (left.kind === right.kind ? 0 : left.kind === "directory" ? -1 : 1)
  || left.name.localeCompare(right.name, "de");

const listingOf = async (root: string, relative: string, kind: BrowseRoot): Promise<BrowseListing> => {
  const directory = await resolveInside(root, relative);
  if (!(await lstat(directory)).isDirectory()) throw invalid(`Kein Verzeichnis: ${relative || "."}`);
  const found = await readdir(directory, { withFileTypes: true });
  const entries = (await Promise.all(found.map((entry) => entryOf(directory, entry.name, entry.isDirectory()))))
    .sort(byKindThenName);
  return {
    root: kind,
    location: root,
    path: relative,
    entries: entries.slice(0, BROWSE_ENTRY_LIMIT),
    truncated: entries.length > BROWSE_ENTRY_LIMIT,
  };
};

const previewOf = async (root: string, relative: string, kind: BrowseRoot): Promise<BrowsePreview> => {
  const file = await resolveInside(root, relative);
  const info = await lstat(file);
  if (!info.isFile()) throw invalid(`Keine Datei: ${relative || "."}`);
  const described = { root: kind, path: relative, size: info.size };
  if (info.size > BROWSE_PREVIEW_LIMIT) {
    return {
      ...described,
      previewable: false,
      reason: `Die Datei ist größer als ${BROWSE_PREVIEW_LIMIT / 1024} KB und wird nicht angezeigt`,
    };
  }
  const content = await readFile(file);
  if (content.includes(0)) return { ...described, previewable: false, reason: "Die Datei ist binär" };
  return { ...described, previewable: true, content: content.toString("utf8") };
};

export interface BrowseOptions {
  rootFor: (runId: string, root: BrowseRoot) => Promise<string>;
  ensureSession: (runId: string) => void;
}

export const createBrowseMethods = (options: BrowseOptions): MethodContribution[] => [
  implement(workspaceContracts.browse.list, async ({ runId, root, path: target }) => {
    options.ensureSession(runId);
    return listingOf(await options.rootFor(runId, root), relativeOf(target), root);
  }),
  implement(workspaceContracts.browse.preview, async ({ runId, root, path: target }) => {
    options.ensureSession(runId);
    return previewOf(await options.rootFor(runId, root), relativeOf(target), root);
  }),
];

export const createBrowseChannel = (options: BrowseOptions): ChannelContribution =>
  implementChannel(workspaceContracts.channels.browse, async ({ runId, root }, emit) => {
    options.ensureSession(runId);
    const directory = await options.rootFor(runId, root);
    let debounce: NodeJS.Timeout | undefined;
    const changed = () => {
      if (debounce) return;
      debounce = setTimeout(() => {
        debounce = undefined;
        emit({ changed: true });
      }, 150);
    };
    let watcher: ReturnType<typeof watch> | undefined;
    try {
      watcher = watch(directory, { recursive: true }, changed);
      watcher.on("error", changed);
    } catch {
    }
    return () => {
      if (debounce) clearTimeout(debounce);
      watcher?.close();
    };
  });
