export interface VisibilitySource {
  readonly visibilityState: string;
  addEventListener(type: "visibilitychange", listener: () => void): void;
  removeEventListener(type: "visibilitychange", listener: () => void): void;
}

export function refreshOnChange(load: () => Promise<void>, visibility: VisibilitySource = document) {
  let disposed = false;
  let inFlight = false;
  let stale = true;
  let lastStarted = -Infinity;
  let dueAt = 0;
  let requested = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let completions: (() => void)[] = [];

  const schedule = () => {
    if (disposed || inFlight || !stale || visibility.visibilityState === "hidden" || timer !== undefined) return;
    const delay = requested ? 0 : Math.max(0, dueAt - Date.now(), lastStarted + 2000 - Date.now());
    timer = setTimeout(() => { timer = undefined; void run(); }, delay);
  };
  const run = async () => {
    if (disposed || inFlight || visibility.visibilityState === "hidden") return;
    stale = false;
    requested = false;
    inFlight = true;
    lastStarted = Date.now();
    const settled = completions;
    completions = [];
    try { await load(); }
    finally {
      inFlight = false;
      for (const complete of settled) complete();
      schedule();
    }
  };
  const nudge = () => {
    if (disposed) return;
    if (!stale) dueAt = Date.now() + 250;
    stale = true;
    schedule();
  };
  const onVisibility = () => {
    if (timer !== undefined) clearTimeout(timer);
    timer = undefined;
    if (visibility.visibilityState === "hidden") { stale = true; return; }
    dueAt = Date.now();
    schedule();
  };
  visibility.addEventListener("visibilitychange", onVisibility);
  void run();

  return {
    nudge,
    /** An explicit request skips the spacing; it still waits for a running refresh and for visibility. */
    refresh: (): Promise<void> => disposed ? Promise.resolve() : new Promise((resolve) => {
      completions.push(resolve);
      requested = true;
      stale = true;
      if (timer !== undefined) clearTimeout(timer);
      timer = undefined;
      schedule();
    }),
    dispose: () => {
      disposed = true;
      clearTimeout(timer);
      visibility.removeEventListener("visibilitychange", onVisibility);
      for (const complete of completions) complete();
      completions = [];
    },
  };
}
