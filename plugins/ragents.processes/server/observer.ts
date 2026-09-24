import type { RunProcessMessage, RunProcessSnapshot } from "../contract.js";

export interface RunProcessObserverOptions {
  /** Der Stand eines Runs beim Executor, der ihn ausführt; `signal` bricht die Abfrage dort ab. */
  snapshot: (runId: string, signal: AbortSignal) => Promise<RunProcessSnapshot>;
  pollIntervalMs: number;
}

export type RunProcessListener = (message: RunProcessMessage) => void;

interface RunWatch {
  listeners: Set<RunProcessListener>;
  fresh: Set<RunProcessListener>;
  last: string | undefined;
  /** Die laufende Abfrage dieses Runs; ein hängender Executor hält nur sie auf. */
  polling: Promise<void> | undefined;
  controller: AbortController | undefined;
}

/** So viele Takte darf eine Abfrage dauern, bevor sie als gescheitert gilt. */
const SNAPSHOT_TIMEOUT_TICKS = 5;

const messageOf = (error: unknown): string => error instanceof Error ? error.message : String(error);

/** Fragt je Takt den Stand jedes beobachteten Laufs bei seinem Executor ab, jeden für sich und mit Zeitgrenze, und meldet nur Änderungen. */
export class RunProcessObserver {
  readonly #options: RunProcessObserverOptions;
  readonly #watches = new Map<string, RunWatch>();
  #timer: NodeJS.Timeout | undefined;
  #stopped = false;

  constructor(options: RunProcessObserverOptions) {
    this.#options = options;
  }

  observe(runId: string, signal?: AbortSignal): Promise<RunProcessSnapshot> {
    return this.#bounded(runId, signal);
  }

  watch(runId: string, listener: RunProcessListener): () => void {
    if (this.#stopped) throw new Error("Die Prozessüberwachung ist beendet");
    let watch = this.#watches.get(runId);
    if (!watch) {
      watch = { listeners: new Set(), fresh: new Set(), last: undefined, polling: undefined, controller: undefined };
      this.#watches.set(runId, watch);
    }
    watch.listeners.add(listener);
    watch.fresh.add(listener);
    this.#ensureTimer();
    void this.#poll(runId, watch);
    return () => {
      const current = this.#watches.get(runId);
      if (!current) return;
      current.listeners.delete(listener);
      current.fresh.delete(listener);
      if (current.listeners.size === 0) {
        this.#watches.delete(runId);
        current.controller?.abort();
      }
      if (this.#watches.size === 0) this.#clearTimer();
    };
  }

  watchedRuns(): readonly string[] {
    return [...this.#watches.keys()];
  }

  async shutdown(): Promise<void> {
    this.#stopped = true;
    this.#clearTimer();
    const watches = [...this.#watches.values()];
    this.#watches.clear();
    for (const watch of watches) watch.controller?.abort();
    await Promise.allSettled(watches.map((watch) => watch.polling));
  }

  #ensureTimer(): void {
    if (this.#timer || this.#watches.size === 0) return;
    this.#timer = setInterval(() => {
      for (const [runId, watch] of this.#watches) void this.#poll(runId, watch);
    }, this.#options.pollIntervalMs);
    this.#timer.unref();
  }

  #clearTimer(): void {
    if (!this.#timer) return;
    clearInterval(this.#timer);
    this.#timer = undefined;
  }

  #poll(runId: string, watch: RunWatch): Promise<void> {
    if (watch.polling) return watch.polling;
    const controller = new AbortController();
    watch.controller = controller;
    watch.polling = this.#bounded(runId, controller.signal)
      .then((snapshot): RunProcessMessage => ({ kind: "snapshot", snapshot }), (error: unknown): RunProcessMessage => ({ kind: "error", error: messageOf(error) }))
      .then((message) => {
        if (!controller.signal.aborted && this.#watches.get(runId) === watch) this.#publish(watch, runId, message);
      })
      .finally(() => {
        watch.polling = undefined;
        watch.controller = undefined;
      });
    return watch.polling;
  }

  /** Eine Abfrage endet spätestens nach ihrer Zeitgrenze; der Abbruch erreicht dabei auch den Executor. */
  #bounded(runId: string, signal: AbortSignal | undefined): Promise<RunProcessSnapshot> {
    const timeoutMs = this.#options.pollIntervalMs * SNAPSHOT_TIMEOUT_TICKS;
    const controller = new AbortController();
    const forward = (): void => controller.abort(signal?.reason);
    signal?.addEventListener("abort", forward, { once: true });
    let timer: NodeJS.Timeout | undefined;
    const deadline = new Promise<never>((_settle, fail) => {
      timer = setTimeout(() => {
        const error = new Error(`Der Executor des Runs ${runId} hat die Prozessabfrage nicht innerhalb von ${timeoutMs / 1000} s beantwortet`);
        fail(error);
        controller.abort(error);
      }, timeoutMs);
    });
    return Promise.race([this.#options.snapshot(runId, controller.signal), deadline]).finally(() => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", forward);
    });
  }

  #publish(watch: RunWatch, runId: string, message: RunProcessMessage): void {
    const serialized = JSON.stringify(message.kind === "snapshot"
      ? { kind: message.kind, processes: message.snapshot.processes }
      : message);
    const changed = serialized !== watch.last;
    watch.last = serialized;
    if (changed && message.kind === "error") console.error(`Prozessüberwachung für ${runId}: ${message.error}`);
    for (const listener of watch.listeners) {
      if (changed || watch.fresh.has(listener)) listener(message);
    }
    watch.fresh.clear();
  }
}
