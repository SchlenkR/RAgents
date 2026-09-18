import { readdir, readFile } from "node:fs/promises";

export interface SessionIdent {
  uid: number;
  gid: number;
  name: string;
}

const processes = async (uid: number): Promise<number[]> => {
  const entries = await readdir("/proc", { withFileTypes: true });
  const pids: number[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || !/^\d+$/.test(entry.name)) continue;
    const status = await readFile(`/proc/${entry.name}/status`, "utf8").catch(() => "");
    if (/^State:\s+Z/m.test(status)) continue;
    const processUid = Number(/^Uid:\s+(\d+)/m.exec(status)?.[1]);
    if (processUid === uid) pids.push(Number(entry.name));
  }
  return pids;
};

export const stopUidProcesses = async (uid: number): Promise<void> => {
  for (let versuch = 0; versuch < 20; versuch++) {
    const pids = await processes(uid);
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
  const pids = await processes(uid);
  if (pids.length > 0) throw new Error(`Prozesse mit UID ${uid} konnten nicht beendet werden: ${pids.join(", ")}`);
};
