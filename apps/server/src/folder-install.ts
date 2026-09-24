import { readdirSync, readFileSync, statSync } from "node:fs";
import { mkdir, readFile, rename, rm, rmdir, writeFile } from "node:fs/promises";
import path from "node:path";

const LOCK_POLL_MS = 100;
const LOCK_TIMEOUT_MS = 10 * 60_000;
/** A lock file without a process number is being written right now; only an old one is a leftover. */
const EMPTY_LOCK_LEFTOVER_MS = 10_000;

/** Every file below a folder as a relative path with forward slashes, sorted; directories only through their files. */
export const filesBelow = (folder: string, prefix = ""): readonly string[] =>
  readdirSync(folder, { withFileTypes: true }).sort((left, right) => left.name.localeCompare(right.name, "en")).flatMap((entry) => {
    const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
    return entry.isDirectory() ? filesBelow(path.join(folder, entry.name), relative) : [relative];
  });

const isAlive = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
};

const isLeftover = (file: string, owner: string): boolean => {
  const pid = Number(owner);
  if (owner !== "" && Number.isInteger(pid) && pid > 0) return !isAlive(pid);
  const stats = statSync(file, { throwIfNoEntry: false });
  return stats !== undefined && Date.now() - stats.mtimeMs > EMPTY_LOCK_LEFTOVER_MS;
};

/** Takes the lock file for this process, waiting while another live process holds it; a lock of a dead process is taken over. Returns the release. */
export const acquireLock = async (file: string): Promise<() => Promise<void>> => {
  await mkdir(path.dirname(file), { recursive: true });
  const started = Date.now();
  for (;;) {
    try {
      await writeFile(file, `${process.pid}\n`, { flag: "wx" });
      return () => rm(file, { force: true });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      const owner = (await readFile(file, "utf8").catch(() => "")).trim();
      if (isLeftover(file, owner)) {
        await rm(file, { force: true });
        continue;
      }
      if (Date.now() - started > LOCK_TIMEOUT_MS) {
        throw new Error(`${file} ist seit ${Math.round(LOCK_TIMEOUT_MS / 60_000)} Minuten von Prozess ${owner || "?"} belegt; läuft dort noch ein Bau?`);
      }
      await new Promise((resolve) => setTimeout(resolve, LOCK_POLL_MS));
    }
  }
};

/** Runs an action while this process holds the lock file, so that parallel builds into the same place take turns. */
export const withLock = async <T>(file: string, action: () => Promise<T>): Promise<T> => {
  const release = await acquireLock(file);
  try {
    return await action();
  } finally {
    await release();
  }
};

const sameContent = (left: string, right: string): boolean => {
  const target = statSync(right, { throwIfNoEntry: false });
  if (!target?.isFile() || target.size !== statSync(left).size) return false;
  return readFileSync(left).equals(readFileSync(right));
};

/** Removes whatever blocks a path: a file where a folder must go, or a folder where a file must go. */
const clearWay = async (target: string, relative: string): Promise<void> => {
  const parts = relative.split("/");
  for (let length = 1; length < parts.length; length += 1) {
    const folder = path.join(target, ...parts.slice(0, length));
    const stats = statSync(folder, { throwIfNoEntry: false });
    if (stats && !stats.isDirectory()) await rm(folder, { force: true });
  }
  const file = path.join(target, ...parts);
  if (statSync(file, { throwIfNoEntry: false })?.isDirectory()) await rm(file, { recursive: true, force: true });
  await mkdir(path.dirname(file), { recursive: true });
};

const removeEmptyFolders = async (folder: string, root: string): Promise<void> => {
  for (const entry of readdirSync(folder, { withFileTypes: true })) {
    if (entry.isDirectory()) await removeEmptyFolders(path.join(folder, entry.name), root);
  }
  if (folder !== root && readdirSync(folder).length === 0) await rmdir(folder);
};

/** Moves a finished folder into place file by file with atomic renames: the target never disappears, unchanged files stay, the given ones come last. */
export const installFolder = async (staging: string, target: string, last: readonly string[]): Promise<void> => {
  if (!statSync(target, { throwIfNoEntry: false })?.isDirectory()) {
    await rm(target, { force: true });
    await mkdir(path.dirname(target), { recursive: true });
    await rename(staging, target);
    return;
  }
  const incoming = filesBelow(staging);
  const ordered = [...incoming.filter((file) => !last.includes(file)), ...last.filter((file) => incoming.includes(file))];
  for (const relative of ordered) {
    const from = path.join(staging, ...relative.split("/"));
    const to = path.join(target, ...relative.split("/"));
    if (sameContent(from, to)) continue;
    await clearWay(target, relative);
    await rename(from, to);
  }
  const kept = new Set(incoming);
  for (const relative of filesBelow(target)) {
    if (!kept.has(relative)) await rm(path.join(target, ...relative.split("/")), { force: true });
  }
  await removeEmptyFolders(target, target);
  await rm(staging, { recursive: true, force: true });
};
