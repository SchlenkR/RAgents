const CHECK_INTERVAL_MS = 5_000;

export interface ParentWatch {
  readonly parentPid: string | undefined;
  readonly onGone: (pid: number) => void;
  /** Tests only: the liveness check and the watcher's interval. */
  readonly alive?: (pid: number) => boolean;
  readonly intervalMs?: number;
}

/** Is the process still alive? ESRCH means gone, EPERM means alive under another owner. */
export const processAlive = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
};

/** Ends the host as soon as the process from RAGENTS_PARENT_PID disappears; without the variable there is no watcher. */
export const watchParentProcess = (watch: ParentWatch): (() => void) | undefined => {
  const given = watch.parentPid;
  if (given === undefined) return undefined;
  if (!/^\d+$/.test(given) || !Number.isSafeInteger(Number(given)) || Number(given) <= 0) {
    throw new Error(`RAGENTS_PARENT_PID names the caller's process id; ${JSON.stringify(given)} is not a positive integer.`);
  }
  const pid = Number(given);
  const alive = watch.alive ?? processAlive;
  const timer = setInterval(() => {
    if (alive(pid)) return;
    clearInterval(timer);
    watch.onGone(pid);
  }, watch.intervalMs ?? CHECK_INTERVAL_MS);
  timer.unref();
  return () => clearInterval(timer);
};
