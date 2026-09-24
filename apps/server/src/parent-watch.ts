const CHECK_INTERVAL_MS = 5_000;

export interface ParentWatch {
  readonly parentPid: string | undefined;
  readonly onGone: (pid: number) => void;
  /** Nur für Tests: die Lebendprüfung und der Takt des Wächters. */
  readonly alive?: (pid: number) => boolean;
  readonly intervalMs?: number;
}

/** Lebt der Prozess noch? ESRCH heißt weg, EPERM heißt lebendig unter fremdem Besitzer. */
export const processAlive = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
};

/** Beendet den Host, sobald der Prozess aus RAGENTS_PARENT_PID verschwindet; ohne die Variable gibt es keinen Wächter. */
export const watchParentProcess = (watch: ParentWatch): (() => void) | undefined => {
  const given = watch.parentPid;
  if (given === undefined) return undefined;
  if (!/^\d+$/.test(given) || !Number.isSafeInteger(Number(given)) || Number(given) <= 0) {
    throw new Error(`RAGENTS_PARENT_PID nennt die Prozesskennung des Aufrufers; ${JSON.stringify(given)} ist keine positive ganze Zahl.`);
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
