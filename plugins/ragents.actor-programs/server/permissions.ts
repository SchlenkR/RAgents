import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { open, realpath, stat } from "node:fs/promises";
import path from "node:path";
import { Type } from "typebox";
import { defineRunFunction, defineToolAvailability, DomainError, type AccessContext, type Actor, type RunFunction, type ToolContributor } from "@ragents/engine";
import { allowedWorkspacePath, containsWorkspacePath, resolvedWorkspacePath } from "@ragents/workspace-executor";
import { toolDescriptorFrom } from "@ragents/host/plugin-support/agent-tool.js";
import type { AppPermissions } from "@ragents/host/plugin-support/actor-programs/contract.js";

const MAX_BYTES = 250000;
const fail = (code: string, message: string, status = 409): never => { throw new DomainError(code, message, status); };

/** Who grants a program its permissions: the activating actor, its run owner's access and that run's workspace folders. */
export interface PermissionGrantor {
  readonly actor: Actor;
  readonly access: AccessContext;
  readonly roots: () => Promise<{ readonly read: readonly string[]; readonly write: readonly string[] }>;
}

const existingFolder = async (folder: string, kind: string): Promise<string> => {
  if (!path.isAbsolute(folder) || folder.includes("\0")) fail("program-folder-invalid", `${kind} need absolute server folders.`, 400);
  const directory = await realpath(folder).catch(() => fail("program-folder-invalid", `${kind} need existing folders: ${folder}.`, 400));
  if (!(await stat(directory)).isDirectory()) fail("program-folder-invalid", `${kind} need existing folders: ${folder}.`, 400);
  return directory;
};

const grantedFolder = async (grantor: PermissionGrantor, folder: string, mode: "read" | "write"): Promise<string> => {
  const right = mode === "write" ? "runs.write" : "runs.read";
  if (!grantor.access.can(right)) fail("access-denied", `Missing permission ${right}.`, 403);
  const directory = await existingFolder(folder, "File permissions");
  const candidates = grantor.actor.grants.filter((grant) => grant.capability === "workspace.use" && grant.usable !== false && grant.delegable);
  const delegable = (await Promise.all(candidates.map(async (grant) => grant.scope.kind === "run"
    || containsWorkspacePath(await resolvedWorkspacePath(grant.scope.path), directory)))).some(Boolean);
  if (!delegable)
    fail("program-folder-denied", `The activating actor cannot delegate access to ${directory}.`, 403);
  if (!grantor.access.can("*")) await allowedWorkspacePath(directory, (await grantor.roots())[mode]);
  return directory;
};

const permittedHost = (host: string): string => {
  const url = new URL(`https://${host}`);
  const port = host.slice(url.hostname.length);
  if (host !== url.hostname + (port ? `:${Number(port.slice(1))}` : "") || (port && !/^:\d+$/.test(port)) || url.pathname !== "/" || url.username || url.password || url.search || url.hash || host.includes("*") || host.includes("/"))
    fail("program-host-invalid", "HTTP permissions need exact lowercase hosts, with an optional port.", 400);
  return host;
};

/** The canonical permissions the grantor can give; anything beyond its rights or delegable grants is an error. */
export const grantedPermissions = async (requested: AppPermissions, grantor: PermissionGrantor): Promise<AppPermissions> => {
  const folders = async (requestedFolders: readonly string[], mode: "read" | "write") => [...new Set(await Promise.all(requestedFolders.map((folder) => grantedFolder(grantor, folder, mode))))];
  const read = await folders(requested.files?.read ?? [], "read");
  const write = await folders(requested.files?.write ?? [], "write");
  const http = (requested.http ?? []).map(permittedHost);
  return {
    ...read.length || write.length ? { files: { ...read.length ? { read } : {}, ...write.length ? { write } : {} } } : {},
    ...http.length ? { http } : {},
  };
};

/** Watched folders must lie within the program's file permissions. */
export const watchedFolders = (folders: readonly string[], permissions: AppPermissions): Promise<string[]> => Promise.all(folders.map(async (folder) => {
  const directory = await existingFolder(folder, "File triggers");
  await allowedWorkspacePath(directory, [...permissions.files?.read ?? [], ...permissions.files?.write ?? []]);
  return directory;
}));

const helperPermissions = {
  program_file_read: { label: "files.read", granted: (permissions: AppPermissions) => Boolean(permissions.files?.read?.length) },
  program_file_write: { label: "files.write", granted: (permissions: AppPermissions) => Boolean(permissions.files?.write?.length) },
  program_http_request: { label: "http", granted: (permissions: AppPermissions) => Boolean(permissions.http?.length) },
} as const;

/** Declared helper capabilities whose permission the package does not request. */
export const ungrantedHelpers = (capabilities: readonly string[], permissions: AppPermissions): string[] => capabilities.flatMap((id) => {
  const helper = helperPermissions[id as keyof typeof helperPermissions];
  return helper && !helper.granted(permissions) ? [`${id} needs permissions.${helper.label} in package.json`] : [];
});

/** The canonical path of a file within the program's permitted folders for this mode; anything else is an error. */
export const permittedFile = async (permissions: AppPermissions, filename: string, mode: "read" | "write"): Promise<string> => {
  if (!path.isAbsolute(filename)) fail("program-file-invalid", "Program file paths must be absolute.", 400);
  const roots = permissions.files?.[mode] ?? [];
  if (roots.length === 0) fail("program-file-denied", `This program has no file ${mode} permission.`, 403);
  for (const root of roots) if (await realpath(root) !== root) fail("program-folder-changed", "A permitted folder changed its target.");
  return allowedWorkspacePath(await resolvedWorkspacePath(filename), roots);
};

/** The SHA-256 of a permitted file's content, null while it does not exist; content changes count, not modification times. */
export const permittedFileHash = async (permissions: AppPermissions, filename: string): Promise<string | null> => {
  const target = await permittedFile(permissions, filename, "read");
  const handle = await open(target, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return null;
    throw error;
  });
  if (!handle) return null;
  try {
    if (!(await handle.stat()).isFile()) fail("program-file-invalid", `A watched path must be a regular file: ${filename}.`, 400);
    const hash = createHash("sha256");
    for await (const chunk of handle.createReadStream({ autoClose: false })) hash.update(chunk as Buffer);
    return hash.digest("hex");
  } finally { await handle.close(); }
};

/** The permitted read folder a watched file lies in, for the folder watch that wakes its program. */
export const watchedFolderOf = async (permissions: AppPermissions, filename: string): Promise<string> => {
  const target = await permittedFile(permissions, filename, "read");
  const roots = await Promise.all((permissions.files?.read ?? []).map(resolvedWorkspacePath));
  return roots.find((root) => containsWorkspacePath(root, target)) ?? fail("program-file-denied", `${filename} is outside the program's read permissions.`, 403);
};

export interface PermissionFunctionOptions {
  /** The permissions of the caller's own active program; undefined without one. */
  readonly permissionsOf: (runId: string, actorId: string) => AppPermissions | undefined;
  readonly ownerAccess: (runId: string) => AccessContext;
}

const fileSchema = Type.Object({ path: Type.String({ minLength: 1, description: "Absolute path within a permitted server folder" }) }, { additionalProperties: false });
const writeSchema = Type.Object({ path: fileSchema.properties.path, content: Type.String({ maxLength: MAX_BYTES }) }, { additionalProperties: false });
const httpSchema = Type.Object({
  url: Type.String({ minLength: 1, maxLength: 4096 }),
  method: Type.Optional(Type.Union([Type.Literal("GET"), Type.Literal("POST"), Type.Literal("PUT"), Type.Literal("PATCH"), Type.Literal("DELETE")])),
  headers: Type.Optional(Type.Record(Type.String(), Type.String())),
  body: Type.Optional(Type.String({ maxLength: MAX_BYTES })),
}, { additionalProperties: false });
const httpResultSchema = Type.Object({ status: Type.Integer(), body: Type.String() }, { additionalProperties: false });

export const programPermissionFunctions = (options: PermissionFunctionOptions): ToolContributor => {
  const available = defineToolAvailability({
    availability: "conditional",
    availabilityDetail: "Snippet-only for actor programs; a call needs the matching permission of the caller's own program.",
  }, (actor) => actor.kind !== "human");
  const permitted = (runId: string, actorId: string, right: "runs.read" | "runs.write"): AppPermissions => {
    const permissions = options.permissionsOf(runId, actorId) ?? fail("program-permission-denied", "Only an actor program with permissions in its package.json can use this function.", 403);
    if (!options.ownerAccess(runId).can(right)) fail("access-denied", `The run owner lacks ${right}.`, 403);
    return permissions;
  };
  const functions: RunFunction[] = [
    defineRunFunction({
      name: "program_file_read",
      label: "Read program file",
      description: "Read a UTF-8 file of at most 250000 bytes within the program's permitted server folders.",
      schema: fileSchema,
      resultSchema: Type.String(),
      available,
      nativeTool: false,
      run: async ({ caller }, _id, input) => {
        const target = await permittedFile(permitted(caller.runId, caller.actorId, "runs.read"), input.path, "read");
        const handle = await open(target, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
        try {
          const info = await handle.stat();
          if (!info.isFile() || info.size > MAX_BYTES) fail("program-file-limit", `A program reads regular files of at most ${MAX_BYTES} bytes.`);
          const content = await handle.readFile("utf8");
          if (Buffer.byteLength(content) > MAX_BYTES) fail("program-file-limit", `A program reads at most ${MAX_BYTES} bytes.`);
          return content;
        } finally { await handle.close(); }
      },
    }),
    defineRunFunction({
      name: "program_file_write",
      label: "Write program file",
      description: "Write a UTF-8 file within the program's permitted server folders. The parent must exist.",
      schema: writeSchema,
      resultSchema: Type.Object({ written: Type.Literal(true) }, { additionalProperties: false }),
      available,
      nativeTool: false,
      run: async ({ caller }, _id, input) => {
        if (Buffer.byteLength(input.content) > MAX_BYTES) fail("program-file-limit", `A program writes at most ${MAX_BYTES} bytes.`);
        const target = await permittedFile(permitted(caller.runId, caller.actorId, "runs.write"), input.path, "write");
        const handle = await open(target, constants.O_WRONLY | constants.O_CREAT | constants.O_NOFOLLOW | constants.O_NONBLOCK, 0o600);
        try {
          if (!(await handle.stat()).isFile()) fail("program-file-limit", "A program writes only regular files.");
          await handle.truncate(0);
          await handle.writeFile(input.content, "utf8");
        } finally { await handle.close(); }
        return { written: true as const };
      },
    }),
    defineRunFunction({
      name: "program_http_request",
      label: "Program HTTP request",
      description: "Make an HTTP(S) request to a host the program's permissions name, without following redirects; bodies of at most 250000 bytes.",
      schema: httpSchema,
      resultSchema: httpResultSchema,
      available,
      nativeTool: false,
      run: async ({ caller, signal }, _id, input) => {
        const permissions = permitted(caller.runId, caller.actorId, "runs.write");
        const url = new URL(input.url);
        const allowed = (permissions.http ?? []).some((host) => {
          const target = new URL(`https://${host}`);
          const port = host.slice(target.hostname.length + 1);
          return target.hostname === url.hostname && (port ? Number(port) === Number(url.port || (url.protocol === "https:" ? 443 : 80)) : url.port === "");
        });
        if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || !allowed) fail("program-http-denied", "This HTTP destination is not permitted.", 403);
        if (Object.keys(input.headers ?? {}).some((name) => name.toLowerCase() === "host")) fail("program-http-denied", "Program HTTP requests cannot override the destination host.", 403);
        if (input.body && Buffer.byteLength(input.body) > MAX_BYTES) fail("program-http-limit", `A program HTTP body may contain at most ${MAX_BYTES} bytes.`);
        const response = await fetch(url, { method: input.method ?? "GET", headers: input.headers, body: input.body, redirect: "manual", signal: AbortSignal.any([...(signal ? [signal] : []), AbortSignal.timeout(30000)]) });
        if (response.status >= 300 && response.status < 400) {
          await response.body?.cancel();
          fail("program-http-redirect", "Program HTTP requests do not follow redirects.");
        }
        const reader = response.body?.getReader();
        if (!reader) return { status: response.status, body: "" };
        const chunks: Uint8Array[] = [];
        try {
          for (;;) {
            const chunk = await reader.read();
            if (chunk.done) break;
            if (chunks.reduce((count, part) => count + part.byteLength, 0) + chunk.value.byteLength > MAX_BYTES) fail("program-http-limit", `A program HTTP response may contain at most ${MAX_BYTES} bytes.`);
            chunks.push(chunk.value);
          }
          return { status: response.status, body: Buffer.concat(chunks).toString("utf8") };
        } finally { await reader.cancel(); }
      },
    }),
  ];
  return { name: "ragents.actor-programs.permissions", descriptors: functions.map((fn) => toolDescriptorFrom(fn, fn.available)), tools: () => functions };
};
