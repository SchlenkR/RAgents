import { lstat, readdir } from "node:fs/promises";
import path from "node:path";
import { DomainError, implement, type AccessContext, type HttpRouteContribution, type MethodContribution } from "@ragents/engine";
import { BYTE_OPERATIONS, type FileBytes } from "@ragents/workspace-executor";
import { guardedJsonRoute, withAbort } from "@ragents/host/plugin-support/http.js";
import type { SandboxServices } from "@ragents/host/plugin-support/workspace-sandbox-host.js";
import { documentsContracts, rootOfReference, type RunFileEntry, type RunFilesListing } from "../contract.js";
import type { DocumentGrants } from "./grants.js";

/** A file by reference, after `raw/` with the request's sign-in or after `grant/<grant>/` with a grant in the path. */
const contentPattern = /^\/api\/plugins\/ragents\.documents\/runs\/([A-Za-z0-9_-]{1,64})\/(?:raw|grant\/([A-Za-z0-9_-]{43}))\/(.+)$/;

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

/** A segment that decodes to a separator or climbs with `..` never comes from an address a document resolves; it would leave the root it starts with. */
const crafted = (segment: string): boolean => segment.includes("/") || segment.split("\\").some((part) => part === "..");

interface ContentAddress {
  runId: string;
  grant: string | undefined;
  reference: string | undefined;
}

/** The reference of an address, one decoded segment per path segment; a malformed or crafted one has none. */
const addressIn = (pathname: string): ContentAddress | undefined => {
  const match = contentPattern.exec(pathname);
  if (!match) return undefined;
  const runId = match[1]!;
  const grant = match[2];
  try {
    const segments = match[3]!.split("/").map(decodeURIComponent);
    return { runId, grant, reference: segments.some(crafted) ? undefined : segments.join("/") };
  } catch {
    return { runId, grant, reference: undefined };
  }
};

/** A server root needs what the store always needed, the run's root what its workspace needs. */
const rightsOf = (root: string): readonly string[] => root === "" ? ["runs.read", "runs.inspect"] : ["runs.read"];

/** A server root is named by its alias; every other reference, also one that names no file, lies in the run's root, wherever the run works. */
const rootOf = (reference: string | undefined): string => reference === undefined ? "" : rootOfReference(reference);

export interface ContentAccessOptions {
  ensureSession: (runId: string) => void;
  ensureWorkspaceAccess: (access: AccessContext, runId: string) => void;
}

const ensureRootAccess = (options: ContentAccessOptions, access: AccessContext, runId: string, root: string): void =>
  root === "" ? options.ensureWorkspaceAccess(access, runId) : options.ensureSession(runId);

export interface ContentRouteOptions extends ContentAccessOptions {
  execute: SandboxServices["execute"];
  grants: DocumentGrants;
}

/** A grant reaches what the content route serves its caller at that moment, for one root of the run. */
export const createGrantMethod = (options: ContentAccessOptions & { grants: DocumentGrants }): MethodContribution =>
  implement(documentsContracts.grant, ({ runId, root }, { access }) => {
    const missing = rightsOf(root).find((right) => !access.can(right));
    if (missing) throw new DomainError("access-denied", `The right ${missing} is missing.`, 403);
    ensureRootAccess(options, access, runId, root);
    return { grant: options.grants.issue(access, runId, root) };
  });

/** The bytes of a file by reference, read now at the machine that holds its root; a grant in the address stands in for the sign-in of whoever asked for it. */
export const createContentRoute = (options: ContentRouteOptions): HttpRouteContribution => ({
  id: "ragents.documents.content",
  isApiPath: (pathname) => contentPattern.test(pathname),
  matches: (request, url) => request.method === "GET" && contentPattern.test(url.pathname),
  requiredRights: (_request, url) => rightsOf(rootOf(addressIn(url.pathname)?.reference)),
  accessFromAddress: (_request, url) => {
    const found = addressIn(url.pathname);
    return found?.grant === undefined ? undefined : options.grants.accessFor(found.runId, found.grant, found.reference);
  },
  handle: async ({ response, request, url, access }) => {
    const found = addressIn(url.pathname);
    if (!found) throw new Error("Invalid documents route");
    const { runId, reference } = found;
    await guardedJsonRoute({
      response,
      request,
      ensureSession: () => ensureRootAccess(options, access, runId, rootOf(reference)),
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
