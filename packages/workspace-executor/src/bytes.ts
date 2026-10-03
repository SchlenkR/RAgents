import { lstat, mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { WorkspaceOperationError } from "./errors.js";
import { relativeWorkspacePath } from "./files.js";
import { allowedWorkspacePath } from "./paths.js";

/** The operations that carry the bytes of files between machines; writing shares the lock of the file tools. */
export const BYTE_OPERATIONS = {
  read: "bytes.read",
  write: "bytes.write",
} as const;

/** The bytes one call carries at most; as Base64 they stay below the 32 MiB message limit of a workstation's connection. */
export const FILE_BYTES_LIMIT = 16 * 1024 * 1024;

/** The files one call carries at most. */
export const FILE_COUNT_LIMIT = 1000;

/** A file below a copied folder: its path relative to the folder and its content as Base64. */
export interface FileBytesEntry {
  readonly path: string;
  readonly content: string;
}

/** A file or a folder with everything in it, as Base64; `directories` lists every folder below it, also empty ones. */
export type FileBytes =
  | { readonly kind: "file"; readonly content: string }
  | { readonly kind: "directory"; readonly directories: readonly string[]; readonly files: readonly FileBytesEntry[] };

const invalid = (message: string): WorkspaceOperationError => new WorkspaceOperationError("workspace-path-invalid", message, 400);

const tooLarge = (message: string): WorkspaceOperationError => new WorkspaceOperationError("workspace-file-too-large", message, 413);

const limitText = `one call carries at most ${FILE_BYTES_LIMIT / 1024 / 1024} MiB and ${FILE_COUNT_LIMIT} files`;

const fileTooLarge = (shown: string): WorkspaceOperationError => tooLarge(`${shown} is larger than ${FILE_BYTES_LIMIT / 1024 / 1024} MiB; ${limitText}`);

const folderTooLarge = (shown: string): WorkspaceOperationError => tooLarge(`The folder ${shown} is too large for one call; ${limitText}`);

const missing = (error: unknown): boolean => {
  const code = (error as NodeJS.ErrnoException).code;
  return code === "ENOENT" || code === "ENOTDIR";
};

const below = (shown: string, relative: string): string => `${shown.replace(/\/+$/, "")}/${relative}`;

/** A path within the given roots, resolved through every link; a message names it as the caller did. */
export const pathInRoots = async (absolute: string, shown: string, roots: readonly string[]): Promise<string> => {
  try {
    return await allowedWorkspacePath(absolute, roots);
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("Path outside the working directory")) throw invalid(`Path outside the working directory: ${shown}`);
    throw error;
  }
};

interface FoundFile {
  readonly path: string;
  readonly absolute: string;
}

interface FoundTree {
  readonly directories: readonly string[];
  readonly files: readonly FoundFile[];
  readonly size: number;
}

/** Collects a folder without following links; the limits apply before a single byte is read. */
const treeOf = async (directory: string, shown: string, relative: string, found: FoundTree): Promise<FoundTree> => {
  const entries = (await readdir(path.join(directory, ...relative.split("/").filter(Boolean)), { withFileTypes: true }))
    .sort((left, right) => left.name.localeCompare(right.name, "en"));
  let tree = found;
  for (const entry of entries) {
    const entryPath = relative ? `${relative}/${entry.name}` : entry.name;
    const absolute = path.join(directory, ...entryPath.split("/"));
    if (entry.isSymbolicLink()) throw invalid(`${below(shown, entryPath)} is a symbolic link; a folder is copied without following links`);
    if (entry.isDirectory()) {
      tree = await treeOf(directory, shown, entryPath, { ...tree, directories: [...tree.directories, entryPath] });
      continue;
    }
    if (!entry.isFile()) throw invalid(`${below(shown, entryPath)} is neither a file nor a folder`);
    const size = tree.size + (await lstat(absolute)).size;
    if (tree.files.length + 1 > FILE_COUNT_LIMIT || size > FILE_BYTES_LIMIT) throw folderTooLarge(shown);
    tree = { ...tree, files: [...tree.files, { path: entryPath, absolute }], size };
  }
  return tree;
};

/** The content of a file read just now; a file that grew past the limit since it was measured is an error as well. */
const contentOf = async (file: string, shown: string): Promise<Buffer> => {
  const content = await readFile(file);
  if (content.byteLength > FILE_BYTES_LIMIT) throw fileTooLarge(shown);
  return content;
};

/** Reads a resolved file, with `recursive` also a folder with everything in it; `shown` is the reference as the caller named it. */
export const readFileBytes = async (resolved: string, shown: string, recursive: boolean): Promise<FileBytes> => {
  let info;
  try {
    info = await lstat(resolved);
  } catch (error) {
    if (missing(error)) throw new WorkspaceOperationError("workspace-path-not-found", `Not found: ${shown}`, 404);
    throw error;
  }
  if (info.isFile()) {
    if (info.size > FILE_BYTES_LIMIT) throw fileTooLarge(shown);
    return { kind: "file", content: (await contentOf(resolved, shown)).toString("base64") };
  }
  if (!info.isDirectory()) throw invalid(`${shown} is neither a file nor a folder`);
  if (!recursive) throw invalid(`${shown} is a folder, not a file`);
  const tree = await treeOf(resolved, shown, "", { directories: [], files: [], size: 0 });
  // One file after the other, so that a full folder never runs into the limit of open files.
  const files: FileBytesEntry[] = [];
  for (const file of tree.files) files.push({ path: file.path, content: (await contentOf(file.absolute, below(shown, file.path))).toString("base64") });
  return { kind: "directory", directories: tree.directories, files };
};

const textField = (value: unknown, name: string): string => {
  if (typeof value !== "string") throw invalid(`The bytes to write need ${name} as text`);
  return value;
};

/** The bytes to write, checked against the limits; the paths of a folder stay below it. */
export const fileBytesOf = (value: unknown): FileBytes => {
  const content = (value ?? {}) as { kind?: unknown; content?: unknown; directories?: unknown; files?: unknown };
  if (content.kind === "file") return { kind: "file", content: textField(content.content, "content") };
  if (content.kind !== "directory" || !Array.isArray(content.directories) || !Array.isArray(content.files)) {
    throw invalid("The bytes to write are a file { kind: \"file\", content } or a folder { kind: \"directory\", directories, files }");
  }
  if (content.files.length > FILE_COUNT_LIMIT) throw folderTooLarge("to write");
  const directories = content.directories.map((entry) => relativeWorkspacePath(textField(entry, "a folder path")));
  const files = content.files.map((entry) => {
    const file = (entry ?? {}) as { path?: unknown; content?: unknown };
    return { path: relativeWorkspacePath(textField(file.path, "a file path")), content: textField(file.content, "content") };
  });
  if ([...directories, ...files.map((file) => file.path)].some((entry) => entry === "")) throw invalid("A path below the folder is empty");
  return { kind: "directory", directories, files };
};

const decoded = (content: string, shown: string): Buffer => {
  const bytes = Buffer.from(content, "base64");
  if (bytes.byteLength > FILE_BYTES_LIMIT) throw fileTooLarge(shown);
  return bytes;
};

const kindAt = async (target: string): Promise<"file" | "directory" | "other" | undefined> => {
  try {
    const info = await lstat(target);
    return info.isFile() ? "file" : info.isDirectory() ? "directory" : "other";
  } catch (error) {
    if (missing(error)) return undefined;
    throw error;
  }
};

/** Writes one file; an existing file is overwritten, a folder in its place is an error. */
const writeOne = async (target: string, shown: string, bytes: Buffer): Promise<void> => {
  const existing = await kindAt(target);
  if (existing === "directory") throw invalid(`${shown} is a folder; name the file to create`);
  if (existing === "other") throw invalid(`${shown} is neither a file nor a folder`);
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, bytes);
};

/** Writes bytes at a resolved destination within the writable roots; a folder is created with everything in it, and no link leads out of the roots. */
export const writeFileBytes = async (resolved: string, shown: string, content: FileBytes, writableRoots: readonly string[]): Promise<void> => {
  if (content.kind === "file") {
    await writeOne(resolved, shown, decoded(content.content, shown));
    return;
  }
  const files = content.files.map((file) => ({ ...file, bytes: decoded(file.content, below(shown, file.path)) }));
  if (files.reduce((sum, file) => sum + file.bytes.byteLength, 0) > FILE_BYTES_LIMIT) throw folderTooLarge(shown);
  const existing = await kindAt(resolved);
  if (existing !== undefined && existing !== "directory") throw invalid(`${shown} is a file; name the folder to create`);
  const inside = (relative: string): Promise<string> =>
    pathInRoots(path.join(resolved, ...relative.split("/")), below(shown, relative), writableRoots);
  await mkdir(resolved, { recursive: true });
  for (const directory of content.directories) {
    const target = await inside(directory);
    if (await kindAt(target) === "file") throw invalid(`${below(shown, directory)} is a file; name the folder to create`);
    await mkdir(target, { recursive: true });
  }
  for (const file of files) await writeOne(await inside(file.path), below(shown, file.path), file.bytes);
};
