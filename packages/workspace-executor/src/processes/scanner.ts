import type { ProcessRecord, ProcessTable, WorkspaceProcessPort } from "./process-table.js";
import { runProcessesFrom, type WorkspaceProcess } from "./snapshot.js";

export interface WorkspaceProcessSnapshot {
  observedAt: string;
  processes: WorkspaceProcess[];
}

export interface ProcessScannerOptions {
  table: () => ProcessTable;
  executorPid: number;
  executorUid: number | undefined;
  now?: () => Date;
}

interface Scan {
  records: readonly ProcessRecord[];
  observedAt: string;
  markers: ReadonlyMap<number, string | undefined>;
  firstSeen: ReadonlyMap<number, string>;
}

const keyOf = (record: ProcessRecord): string => `${record.pid}:${record.startKey}`;

/** Liest die markierten Prozesse dieser Maschine; gleichzeitige Abfragen mehrerer Runs teilen sich einen Tabellenscan. */
export class ProcessScanner {
  readonly #options: ProcessScannerOptions;
  readonly #now: () => Date;
  readonly #markers = new Map<string, string | null>();
  readonly #firstSeen = new Map<string, string>();
  #scanning: Promise<Scan> | undefined;

  constructor(options: ProcessScannerOptions) {
    this.#options = options;
    this.#now = options.now ?? (() => new Date());
  }

  async snapshot(runId: string): Promise<WorkspaceProcessSnapshot> {
    const scan = await this.#shared();
    const markerOf = (record: ProcessRecord): string | undefined => scan.markers.get(record.pid);
    const marked = scan.records.filter((record) => markerOf(record) === runId);
    const ports: ReadonlyMap<number, readonly WorkspaceProcessPort[]> = marked.length > 0
      ? await this.#options.table().listeningPorts(marked.map((record) => record.pid))
      : new Map();
    return {
      observedAt: scan.observedAt,
      processes: runProcessesFrom({
        runId,
        executorPid: this.#options.executorPid,
        records: scan.records,
        markerOf,
        ports,
        firstSeen: (record) => {
          const seen = scan.firstSeen.get(record.pid);
          if (!seen) throw new Error(`Prozess ${record.pid} ohne Erstsichtung`);
          return seen;
        },
      }),
    };
  }

  #shared(): Promise<Scan> {
    this.#scanning ??= this.#scan().finally(() => {
      this.#scanning = undefined;
    });
    return this.#scanning;
  }

  #readable(record: ProcessRecord): boolean {
    const uid = this.#options.executorUid;
    return uid === undefined || uid === 0 || record.uid === uid;
  }

  /** Die Umgebung eines Prozesses wird nur einmal gelesen; ein Fehler dabei merkt sich nichts. */
  async #scan(): Promise<Scan> {
    const table = this.#options.table();
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
    return {
      records,
      observedAt,
      markers: new Map(records.map((record) => [record.pid, this.#markers.get(keyOf(record)) ?? undefined])),
      firstSeen: new Map(records.flatMap((record) => {
        const seen = this.#firstSeen.get(keyOf(record));
        return seen === undefined ? [] : [[record.pid, seen] as const];
      })),
    };
  }
}
