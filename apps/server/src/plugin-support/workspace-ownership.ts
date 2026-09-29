import { chmod, chown, lstat, readdir, realpath } from "node:fs/promises";
import path from "node:path";
import { containsWorkspacePath } from "@ragents/workspace-executor";

export interface WorkspaceIdentity {
  uid?: number;
  gid?: number;
  storageRoot?: string;
}

/** Whatever vanishes during the sync, such as a renamed package from staging, no longer needs rights. */
const unlessVanished = (error: NodeJS.ErrnoException): undefined => {
  if (error.code === "ENOENT") return undefined;
  throw error;
};

export const syncWorkspaceOwnership = async (directory: string, identity: WorkspaceIdentity): Promise<void> => {
  if (identity.uid === undefined && identity.gid === undefined) return;
  if (identity.uid === undefined || identity.gid === undefined || !identity.storageRoot) {
    throw new Error("Private working files are missing a UID, GID or the run storage boundary.");
  }
  if ((await lstat(directory)).isSymbolicLink()) throw new Error("The private working directory must not be a symlink.");
  const [root, target] = await Promise.all([realpath(identity.storageRoot), realpath(directory)]);
  if (!containsWorkspacePath(root, target) || target === root) throw new Error("The private working directory lies outside its run storage boundary.");
  const { uid, gid } = identity;
  const visit = async (file: string): Promise<void> => {
    const info = await lstat(file).catch(unlessVanished);
    if (!info || info.isSymbolicLink() || !info.isDirectory() && !info.isFile()) return;
    if (info.uid !== uid || info.gid !== gid) await chown(file, uid, gid).catch(unlessVanished);
    const mode = info.isDirectory() ? 0o700 : (info.mode & 0o100) | 0o600;
    if ((info.mode & 0o7777) !== mode) await chmod(file, mode).catch(unlessVanished);
    if (info.isDirectory()) for (const entry of await readdir(file).catch(unlessVanished) ?? []) await visit(path.join(file, entry));
  };
  await visit(target);
  for (let ancestor = path.dirname(target); containsWorkspacePath(root, ancestor); ancestor = path.dirname(ancestor)) {
    const info = await lstat(ancestor);
    if (!info.isDirectory()) throw new Error("An ancestor of the working directory is not a directory.");
    const mode = (info.mode & 0o7777) | 0o111;
    if ((info.mode & 0o7777) !== mode) await chmod(ancestor, mode);
    if (ancestor === root) break;
  }
};
