import type { RunProcessMessage, RunProcessSnapshot } from "../contract.js";
import type { ProcessRecord, ProcessTable } from "./process-table.js";
import { runProcessesFrom } from "./snapshot.js";

export interface RunProcessObserverOptions {
  table: ProcessTable;
  serverPid: number;
  serverUid: number | undefined;
  pollIntervalMs: number;
  now?: () => Date;
}

export type RunProcessListener = (message: RunProcessMessage) => void;

interface RunWatch {
  listeners: Set<RunProcessListener>;
  fresh: Set<RunProcessListener>;
  last: string | undefined;
}

const keyOf = (record: ProcessRecord): string => `${record.pid}:${record.startKey}`;

const messageOf = (error: unknown): string => error instanceof Error ? error.message : String(error);

/** Beobachtet die markierten Prozesse aller beobachteten Läufe mit EINEM Tabellenscan je Intervall. */
export class RunProcessObserver {
  readonly #options: RunProcessObserverOptions;
  readonly #now: () => Date;
  readonly #markers = new Map<string, string | null>();
  readonly #firstSeen = new Map<string, string>();
  readonly #watches = new Map<string, RunWatch>();
  #timer: NodeJS.Timeout | undefined;
  #scanning: Promise<void> | undefined;
  #stopped = false;

  constructor(options: RunProcessObserverOptions) {
    this.#options = options;
    this.#now = options.now ?? (() => new Date());
  }

  async observe(runId: string): Promise<RunProcessSnapshot> {
    const snapshot = (await this.#scan([runId])).get(runId);
    if (!snapshot) throw new Error(`Der Scan hat keinen Stand für ${runId} geliefert`);
    return snapshot;
  }

  watch(runId: string, listener: RunProcessListener): () => void {
    if (this.#stopped) throw new Error("Die Prozessüberwachung ist beendet");
    let watch = this.#watches.get(runId);
    if (!watch) {
      watch = { listeners: new Set(), fresh: new Set(), last: undefined };
      this.#watches.set(runId, watch);
    }
    watch.listeners.add(listener);
    watch.fresh.add(listener);
    this.#ensureTimer();
    void this.#tick();
    return () => {
      const current = this.#watches.get(runId);
      if (!current) return;
      current.listeners.delete(listener);
      current.fresh.delete(listener);
      if (current.listeners.size === 0) this.#watches.delete(runId);
      if (this.#watches.size === 0) this.#clearTimer();
    };
  }

  watchedRuns(): readonly string[] {
    return [...this.#watches.keys()];
  }

  async shutdown(): Promise<void> {
    this.#stopped = true;
    this.#clearTimer();
    this.#watches.clear();
    await this.#scanning?.catch(() => undefined);
  }

  #ensureTimer(): void {
    if (this.#timer || this.#watches.size === 0) return;
    this.#timer = setInterval(() => void this.#tick(), this.#options.pollIntervalMs);
    this.#timer.unref();
  }

  #clearTimer(): void {
    if (!this.#timer) return;
    clearInterval(this.#timer);
    this.#timer = undefined;
  }

  #tick(): Promise<void> {
    if (this.#scanning) return this.#scanning;
    this.#scanning = this.#deliver().finally(() => {
      this.#scanning = undefined;
    });
    return this.#scanning;
  }

  async #deliver(): Promise<void> {
    const runIds = [...this.#watches.keys()];
    if (runIds.length === 0) return;
    let messages: Map<string, RunProcessMessage>;
    try {
      const snapshots = await this.#scan(runIds);
      messages = new Map(runIds.map((runId) => {
        const snapshot = snapshots.get(runId);
        if (!snapshot) throw new Error(`Der Scan hat keinen Stand für ${runId} geliefert`);
        return [runId, { kind: "snapshot", snapshot }];
      }));
    } catch (error) {
      const message: RunProcessMessage = { kind: "error", error: messageOf(error) };
      messages = new Map(runIds.map((runId) => [runId, message]));
    }
    for (const [runId, message] of messages) {
      const watch = this.#watches.get(runId);
      if (!watch) continue;
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

  #readable(record: ProcessRecord): boolean {
    const uid = this.#options.serverUid;
    return uid === undefined || uid === 0 || record.uid === uid;
  }

  async #scan(runIds: readonly string[]): Promise<Map<string, RunProcessSnapshot>> {
    const { table, serverPid } = this.#options;
    const records = await table.list();
    const observedAt = this.#now().toISOString();
    const present = new Set<string>();
    const unknown: ProcessRecord[] = [];
    for (const record of records) {
      const key = keyOf(record);
      present.add(key);
      if (!this.#firstSeen.has(key)) this.#firstSeen.set(key, observedAt);
      if (!this.#markers.has(key) && this.#readable(record)) unknown.push(record);
    }
    if (unknown.length > 0) {
      const found = await table.runMarkers(unknown.map((record) => record.pid));
      for (const record of unknown) this.#markers.set(keyOf(record), found.get(record.pid) ?? null);
    }
    for (const key of [...this.#markers.keys(), ...this.#firstSeen.keys()]) {
      if (present.has(key)) continue;
      this.#markers.delete(key);
      this.#firstSeen.delete(key);
    }
    const markerOf = (record: ProcessRecord): string | undefined => this.#markers.get(keyOf(record)) ?? undefined;
    const marked = records.filter((record) => {
      const marker = markerOf(record);
      return marker !== undefined && runIds.includes(marker);
    });
    const ports = marked.length > 0 ? await table.listeningPorts(marked.map((record) => record.pid)) : new Map();
    return new Map(runIds.map((runId) => [runId, {
      runId,
      observedAt,
      processes: runProcessesFrom({
        runId,
        serverPid,
        records,
        markerOf,
        ports,
        firstSeen: (record) => {
          const seen = this.#firstSeen.get(keyOf(record));
          if (!seen) throw new Error(`Prozess ${record.pid} ohne Erstsichtung`);
          return seen;
        },
      }),
    }]));
  }
}
