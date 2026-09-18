import { chmod, chown, lstat, readdir, realpath } from "node:fs/promises";
import path from "node:path";
import { containsWorkspacePath } from "./workspace-paths.js";

export interface WorkspaceIdentity {
  uid?: number;
  gid?: number;
  storageRoot?: string;
}

export const syncWorkspaceOwnership = async (directory: string, identity: WorkspaceIdentity): Promise<void> => {
  if (identity.uid === undefined && identity.gid === undefined) return;
  if (identity.uid === undefined || identity.gid === undefined || !identity.storageRoot) {
    throw new Error("Für private Arbeitsdateien fehlen UID, GID oder die Run-Speichergrenze.");
  }
  if ((await lstat(directory)).isSymbolicLink()) throw new Error("Das private Arbeitsverzeichnis darf kein Symlink sein.");
  const [root, target] = await Promise.all([realpath(identity.storageRoot), realpath(directory)]);
  if (!containsWorkspacePath(root, target) || target === root) throw new Error("Das private Arbeitsverzeichnis liegt außerhalb seiner Run-Speichergrenze.");
  const { uid, gid } = identity;
  const visit = async (file: string): Promise<void> => {
    const info = await lstat(file);
    if (info.isSymbolicLink() || !info.isDirectory() && !info.isFile()) return;
    if (info.uid !== uid || info.gid !== gid) await chown(file, uid, gid);
    const mode = info.isDirectory() ? 0o700 : (info.mode & 0o100) | 0o600;
    if ((info.mode & 0o7777) !== mode) await chmod(file, mode);
    if (info.isDirectory()) for (const entry of await readdir(file)) await visit(path.join(file, entry));
  };
  await visit(target);
  for (let ancestor = path.dirname(target); containsWorkspacePath(root, ancestor); ancestor = path.dirname(ancestor)) {
    const info = await lstat(ancestor);
    if (!info.isDirectory()) throw new Error("Ein Vorfahr des Arbeitsverzeichnisses ist kein Verzeichnis.");
    const mode = (info.mode & 0o7777) | 0o111;
    if ((info.mode & 0o7777) !== mode) await chmod(ancestor, mode);
    if (ancestor === root) break;
  }
};
