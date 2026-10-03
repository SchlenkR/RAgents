import { readdir, readFile } from "node:fs/promises";

export interface SessionIdent {
  uid: number;
  gid: number;
  name: string;
}

interface UidProcess {
  readonly pid: number;
  readonly ppid: number;
}

const processes = async (uid: number): Promise<UidProcess[]> => {
  const entries = await readdir("/proc", { withFileTypes: true });
  const found: UidProcess[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || !/^\d+$/.test(entry.name)) continue;
    const status = await readFile(`/proc/${entry.name}/status`, "utf8").catch(() => "");
    if (/^State:\s+Z/m.test(status)) continue;
    const processUid = Number(/^Uid:\s+(\d+)/m.exec(status)?.[1]);
    if (processUid === uid) found.push({ pid: Number(entry.name), ppid: Number(/^PPid:\s+(\d+)/m.exec(status)?.[1]) });
  }
  return found;
};

/** The processes of the account without the kept ones and everything below them. */
const withoutKept = (found: readonly UidProcess[], keep: ReadonlySet<number>): number[] => {
  const parents = new Map(found.map((entry) => [entry.pid, entry.ppid]));
  const kept = (pid: number, seen: ReadonlySet<number>): boolean => {
    if (keep.has(pid)) return true;
    const parent = parents.get(pid);
    return parent !== undefined && !seen.has(parent) && kept(parent, new Set([...seen, pid]));
  };
  return found.filter((entry) => !kept(entry.pid, new Set())).map((entry) => entry.pid);
};

/** Ends every process of the account; `keep` names processes that stay with everything they started, such as background commands of the run. */
export const stopUidProcesses = async (uid: number, keep: ReadonlySet<number> = new Set()): Promise<void> => {
  for (let attempt = 0; attempt < 20; attempt++) {
    const pids = withoutKept(await processes(uid), keep);
    if (pids.length === 0) return;
    for (const pid of pids) {
      try {
        process.kill(pid, "SIGKILL");
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error;
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  const pids = withoutKept(await processes(uid), keep);
  if (pids.length > 0) throw new Error(`Processes with UID ${uid} could not be ended: ${pids.join(", ")}`);
};
