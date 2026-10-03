import { lstat, readdir } from "node:fs/promises";
import path from "node:path";
import { DomainError, implement, type AccessContext, type HttpRouteContribution, type MethodContribution } from "@ragents/engine";
import { BYTE_OPERATIONS, type FileBytes } from "@ragents/workspace-executor";
import { guardedJsonRoute, withAbort } from "@ragents/host/plugin-support/http.js";
import type { SandboxServices } from "@ragents/host/plugin-support/workspace-sandbox-host.js";
import { documentsContracts, type RunFileEntry, type RunFilesListing } from "../contract.js";

const contentPattern = /^\/api\/plugins\/ragents\.documents\/runs\/([A-Za-z0-9_-]{1,64})\/raw\/(.+)$/;

const MAX_ENTRIES = 1000;

const mediaTypes: Record<string, string> = {
  ".md": "text/markdown; charset=utf-8",
  ".markdown": "text/markdown; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".htm": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
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
    .sort((left, right) => left.name.localeCompare(right.name, "en-US"));
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

export interface FilesRouteOptions {
  filesFor: (runId: string) => Promise<string>;
  ensureSession: (runId: string) => void;
}

export const createFilesMethod = (options: FilesRouteOptions): MethodContribution =>
  implement(documentsContracts.files, async ({ runId }) => {
    options.ensureSession(runId);
    return listingOf(await options.filesFor(runId));
  });

/** The reference after `raw/`, one decoded segment per path segment; a malformed one has none. */
const referenceIn = (pathname: string): { runId: string; reference: string | undefined } | undefined => {
  const match = contentPattern.exec(pathname);
  if (!match) return undefined;
  try {
    return { runId: match[1]!, reference: match[2]!.split("/").map(decodeURIComponent).join("/") };
  } catch {
    return { runId: match[1]!, reference: undefined };
  }
};

/** A server root is named by its alias; every other reference lies in the run's root, wherever the run works. */
const onServerRoot = (reference: string | undefined): boolean => reference?.startsWith("@") === true;

export interface ContentRouteOptions {
  ensureSession: (runId: string) => void;
  ensureWorkspaceAccess: (access: AccessContext, runId: string) => void;
  execute: SandboxServices["execute"];
}

/** The bytes of a file by reference, read now at the machine that holds its root; a server root needs what the store needed, the run's root what the workspace needs. */
export const createContentRoute = (options: ContentRouteOptions): HttpRouteContribution => ({
  id: "ragents.documents.content",
  isApiPath: (pathname) => contentPattern.test(pathname),
  matches: (request, url) => request.method === "GET" && contentPattern.test(url.pathname),
  requiredRights: (_request, url) => onServerRoot(referenceIn(url.pathname)?.reference) ? ["runs.read"] : ["runs.read", "runs.inspect"],
  handle: async ({ response, request, url, access }) => {
    const found = referenceIn(url.pathname);
    if (!found) throw new Error("Invalid documents route");
    const { runId, reference } = found;
    await guardedJsonRoute({
      response,
      request,
      ensureSession: () => onServerRoot(reference) ? options.ensureSession(runId) : options.ensureWorkspaceAccess(access, runId),
      handle: async () => {
        if (reference === undefined) throw new DomainError("document-reference-invalid", "The address does not name a file", 400);
        const bytes = await withAbort(request, response, (signal) =>
          options.execute(runId, BYTE_OPERATIONS.read, { path: reference }, { signal })) as FileBytes;
        if (bytes.kind !== "file") throw new DomainError("document-reference-invalid", `${reference} is a folder, not a file`, 400);
        const content = Buffer.from(bytes.content, "base64");
        response.writeHead(200, {
          "Cache-Control": "no-store",
          "Content-Type": mediaTypes[path.posix.extname(reference).toLowerCase()] ?? "application/octet-stream",
          "Content-Length": content.byteLength,
          "Content-Security-Policy": "sandbox",
          "X-Content-Type-Options": "nosniff",
        });
        response.end(content);
      },
    });
  },
});
