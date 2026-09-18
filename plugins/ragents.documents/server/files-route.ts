import { lstat, readdir, readFile, realpath } from "node:fs/promises";
import path from "node:path";
import type { HttpRouteContribution } from "@aicontainer/ragents";
import { guardedJsonRoute, writeJson } from "@aicontainer/server/plugin-support/http.js";

export const documentsApiPrefix = "/api/plugins/ragents.documents";

const listPattern = /^\/api\/plugins\/ragents\.documents\/runs\/([A-Za-z0-9_-]{1,64})\/files$/;
const contentPattern = /^\/api\/plugins\/ragents\.documents\/runs\/([A-Za-z0-9_-]{1,64})\/files\/content$/;

const MAX_ENTRIES = 1000;

export interface RunFileEntry {
  path: string;
  size: number;
  modifiedAt: string;
}

export interface RunFilesListing {
  groups: Array<{ directory: string; files: RunFileEntry[] }>;
  loose: RunFileEntry[];
  truncated: boolean;
}

const mediaTypes: Record<string, string> = {
  ".md": "text/markdown; charset=utf-8",
  ".markdown": "text/markdown; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".htm": "text/html; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".log": "text/plain; charset=utf-8",
  ".csv": "text/csv; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
  ".pdf": "application/pdf",
};

const visibleEntries = async (directory: string) => {
  const entries = await readdir(directory, { withFileTypes: true });
  return entries
    .filter((entry) => !entry.name.startsWith(".") && !entry.isSymbolicLink())
    .sort((left, right) => left.name.localeCompare(right.name, "de"));
};

const collectFiles = async (
  directory: string,
  relative: string,
  budget: { remaining: number },
): Promise<RunFileEntry[]> => {
  const files: RunFileEntry[] = [];
  for (const entry of await visibleEntries(directory)) {
    if (budget.remaining <= 0) break;
    const absolute = path.join(directory, entry.name);
    const entryPath = relative ? `${relative}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      files.push(...await collectFiles(absolute, entryPath, budget));
    } else if (entry.isFile()) {
      const info = await lstat(absolute);
      files.push({ path: entryPath, size: info.size, modifiedAt: info.mtime.toISOString() });
      budget.remaining -= 1;
    }
  }
  return files;
};

const listingOf = async (root: string): Promise<RunFilesListing> => {
  const budget = { remaining: MAX_ENTRIES };
  const groups: RunFilesListing["groups"] = [];
  const loose: RunFileEntry[] = [];
  for (const entry of await visibleEntries(root)) {
    if (entry.name === "_apps") continue;
    const absolute = path.join(root, entry.name);
    if (entry.isDirectory()) {
      const files = await collectFiles(absolute, "", budget);
      if (files.length > 0) groups.push({ directory: entry.name, files });
    } else if (entry.isFile() && budget.remaining > 0) {
      const info = await lstat(absolute);
      loose.push({ path: entry.name, size: info.size, modifiedAt: info.mtime.toISOString() });
      budget.remaining -= 1;
    }
  }
  return { groups, loose, truncated: budget.remaining <= 0 };
};

const resolveInside = async (root: string, relative: string): Promise<string> => {
  if (!relative || relative.includes("\0") || relative.includes("\\") || path.isAbsolute(relative)
    || relative.split("/").some((segment) => segment === "" || segment === "." || segment === "..")) {
    throw new Error("Ungültiger Dateipfad");
  }
  const rootReal = await realpath(root);
  const real = await realpath(path.join(rootReal, relative));
  if (real !== rootReal && !real.startsWith(rootReal + path.sep)) throw new Error("Ungültiger Dateipfad");
  return real;
};

export const runFileExists = async (root: string, relative: string): Promise<boolean> => {
  try {
    return (await lstat(await resolveInside(root, relative))).isFile();
  } catch {
    return false;
  }
};

export interface FilesRouteOptions {
  filesFor: (runId: string) => Promise<string>;
  ensureSession: (runId: string) => void;
}

export const createFilesRoutes = (options: FilesRouteOptions): HttpRouteContribution[] => [
  {
    id: "ragents.documents.files",
    isApiPath: (pathname) => listPattern.test(pathname),
    matches: (request, url) => request.method === "GET" && listPattern.test(url.pathname),
    handle: async ({ response, request, url }) => {
      const match = url.pathname.match(listPattern);
      if (!match) throw new Error("Ungültige Dokumente-Route");
      const [, runId] = match;
      await guardedJsonRoute({
        response,
        request,
        ensureSession: () => options.ensureSession(runId),
        handle: async () => {
          writeJson(response, 200, await listingOf(await options.filesFor(runId)));
        },
      });
    },
  },
  {
    id: "ragents.documents.files-content",
    isApiPath: (pathname) => contentPattern.test(pathname),
    matches: (request, url) => request.method === "GET" && contentPattern.test(url.pathname),
    handle: async ({ response, request, url }) => {
      const match = url.pathname.match(contentPattern);
      if (!match) throw new Error("Ungültige Dokumente-Route");
      const [, runId] = match;
      await guardedJsonRoute({
        response,
        request,
        ensureSession: () => options.ensureSession(runId),
        errorStatus: 404,
        handle: async () => {
          const relative = url.searchParams.get("path") ?? "";
          const file = await resolveInside(await options.filesFor(runId), relative);
          const info = await lstat(file);
          if (!info.isFile()) throw new Error("Ungültiger Dateipfad");
          const content = await readFile(file);
          response.writeHead(200, {
            "Cache-Control": "no-store",
            "Content-Type": mediaTypes[path.extname(relative).toLowerCase()] ?? "application/octet-stream",
            "Content-Length": content.byteLength,
          });
          response.end(content);
        },
      });
    },
  },
];
