import { watch } from "node:fs";
import { lstat, readdir, readFile, realpath } from "node:fs/promises";
import path from "node:path";
import type { HttpRouteContribution } from "@aicontainer/ragents";
import type { EventChannelProvider } from "@aicontainer/server/event-hub.js";
import { guardedJsonRoute, writeJson } from "@aicontainer/server/plugin-support/http.js";
import {
  BROWSE_ENTRY_LIMIT,
  BROWSE_PREVIEW_LIMIT,
  browseChannelOf,
  browseRootOf,
  type BrowseEntry,
  type BrowseListing,
  type BrowsePreview,
  type BrowseRoot,
} from "../contract.js";

export const workspaceApiPrefix = "/api/plugins/ragents.workspace";

const listPattern = /^\/api\/plugins\/ragents\.workspace\/runs\/([A-Za-z0-9_-]{1,64})\/browse$/;
const previewPattern = /^\/api\/plugins\/ragents\.workspace\/runs\/([A-Za-z0-9_-]{1,64})\/browse\/file$/;

const rootOf = (url: URL): BrowseRoot => {
  const root = browseRootOf(url.searchParams.get("root") ?? "workspace");
  if (!root) throw new Error("Unbekannte Wurzel; erlaubt sind workspace und files");
  return root;
};

const relativeOf = (url: URL): string => {
  const value = url.searchParams.get("path") ?? "";
  const segments = value.split("/").filter((segment) => segment !== "");
  if (value.includes("\0") || value.includes("\\") || path.isAbsolute(value)
    || segments.some((segment) => segment === "." || segment === "..")) {
    throw new Error("Ungültiger Pfad");
  }
  return segments.join("/");
};

const realOf = async (target: string, missing: string): Promise<string> => {
  try {
    return await realpath(target);
  } catch {
    throw new Error(missing);
  }
};

const resolveInside = async (root: string, relative: string): Promise<string> => {
  const rootReal = await realOf(root, "Der Lauf hat dieses Verzeichnis nicht");
  const real = await realOf(
    relative ? path.join(rootReal, relative) : rootReal,
    `Nicht gefunden: ${relative || "."}`,
  );
  if (real !== rootReal && !real.startsWith(rootReal + path.sep)) throw new Error("Ungültiger Pfad");
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
  if (!(await lstat(directory)).isDirectory()) throw new Error(`Kein Verzeichnis: ${relative || "."}`);
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
  if (!info.isFile()) throw new Error(`Keine Datei: ${relative || "."}`);
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

const runIdOf = (url: URL, pattern: RegExp): string => {
  const match = url.pathname.match(pattern);
  if (!match) throw new Error("Ungültige Datei-Route");
  return match[1];
};

export interface BrowseRouteOptions {
  rootFor: (runId: string, root: BrowseRoot) => Promise<string>;
  ensureSession: (runId: string) => void;
}

export const createBrowseRoutes = (options: BrowseRouteOptions): HttpRouteContribution[] => [
  {
    id: "ragents.workspace.browse",
    requiredRights: ["runs.read", "runs.inspect"],
    isApiPath: (pathname) => listPattern.test(pathname),
    matches: (request, url) => request.method === "GET" && listPattern.test(url.pathname),
    handle: async ({ request, response, url }) => {
      const runId = runIdOf(url, listPattern);
      await guardedJsonRoute({
        request,
        response,
        ensureSession: () => options.ensureSession(runId),
        handle: async () => {
          const root = rootOf(url);
          writeJson(response, 200, await listingOf(await options.rootFor(runId, root), relativeOf(url), root));
        },
      });
    },
  },
  {
    id: "ragents.workspace.browse-file",
    requiredRights: ["runs.read", "runs.inspect"],
    isApiPath: (pathname) => previewPattern.test(pathname),
    matches: (request, url) => request.method === "GET" && previewPattern.test(url.pathname),
    handle: async ({ request, response, url }) => {
      const runId = runIdOf(url, previewPattern);
      await guardedJsonRoute({
        request,
        response,
        ensureSession: () => options.ensureSession(runId),
        handle: async () => {
          const root = rootOf(url);
          writeJson(response, 200, await previewOf(await options.rootFor(runId, root), relativeOf(url), root));
        },
      });
    },
  },
];

export const createBrowseChannel = (options: Pick<BrowseRouteOptions, "ensureSession" | "rootFor">): EventChannelProvider => ({
  id: "ragents.workspace.browse",
  matches: (channel) => browseChannelOf(channel) !== undefined,
  requiredRights: () => ["runs.read", "runs.inspect"],
  open: async (channel, emit) => {
    const { runId, root } = browseChannelOf(channel)!;
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
  },
});
