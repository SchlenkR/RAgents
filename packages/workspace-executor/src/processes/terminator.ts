import { WorkspaceOperationError } from "../errors.js";
import { runMarkerOf } from "../run-marker.js";
import { processIdOf, type ProcessRecord, type ProcessTable } from "./process-table.js";

export interface ProcessTerminationOptions {
  table: ProcessTable;
  /** Der Prozess dieses Executors; er und seine Vorfahren sind geschützt. */
  executorPid: number;
  executorUid: number | undefined;
  termGraceMs?: number;
  killGraceMs?: number;
  timeoutMs?: number;
  pollIntervalMs?: number;
  sendSignal?: (pid: number, signal: "SIGTERM" | "SIGKILL") => void;
}

export interface ProcessTerminationContext {
  signal?: AbortSignal;
}

interface Attempt {
  termAt: number;
  killAt?: number;
}

const delay = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));
const gone = (error: unknown): boolean => (error as NodeJS.ErrnoException).code === "ESRCH";

export class RunProcessTerminator {
  readonly #options: ProcessTerminationOptions;
  readonly #termGraceMs: number;
  readonly #killGraceMs: number;
  readonly #timeoutMs: number;
  readonly #pollIntervalMs: number;
  readonly #sendSignal: NonNullable<ProcessTerminationOptions["sendSignal"]>;

  constructor(options: ProcessTerminationOptions) {
    this.#options = options;
    this.#termGraceMs = options.termGraceMs ?? 2_000;
    this.#killGraceMs = options.killGraceMs ?? 1_000;
    this.#timeoutMs = options.timeoutMs ?? 8_000;
    this.#pollIntervalMs = options.pollIntervalMs ?? 100;
    this.#sendSignal = options.sendSignal ?? ((pid, signal) => { process.kill(pid, signal); });
    for (const duration of [this.#termGraceMs, this.#killGraceMs, this.#timeoutMs, this.#pollIntervalMs]) {
      if (!Number.isSafeInteger(duration) || duration < 1) throw new Error("Prozess-Stopp-Zeitgrenzen müssen positive ganze Zahlen sein");
    }
  }

  async stop(runId: string, processId: string, context: ProcessTerminationContext = {}): Promise<void> {
    const pid = Number(processId.split("-")[0]);
    if (!/^[1-9]\d*-[a-f0-9]{64}$/.test(processId) || !Number.isSafeInteger(pid) || pid > 2_147_483_647)
      throw new WorkspaceOperationError("invalid-process", "Ungültige Prozessreferenz", 400);
    await this.#stop(runId, processId, context);
  }

  async stopRun(runId: string, context: ProcessTerminationContext = {}): Promise<void> {
    await this.#stop(runId, undefined, context);
  }

  async #stop(runId: string, processId: string | undefined, context: ProcessTerminationContext): Promise<void> {
    if (runMarkerOf(runId) !== runId) throw new WorkspaceOperationError("invalid-run", "Ungültige Laufkennung", 400);
    const deadline = Date.now() + this.#timeoutMs;
    const attempts = new Map<string, Attempt>();
    const failures = new Map<string, unknown>();
    const assertClean = () => {
      if (failures.size === 1) throw [...failures.values()][0];
      if (failures.size > 1) throw new AggregateError([...failures.values()], `Prozess-Stopp ist für ${failures.size} Prozesse fehlgeschlagen`);
    };
    let first = true;
    let emptyScans = 0;
    while (true) {
      this.#assertActive(context, deadline);
      const records = await this.#bounded(this.#options.table.list(), deadline);
      const selected = processId === undefined ? records : records.filter((record) => record.pid === Number(processId.split("-")[0]));
      const readable = selected.filter((record) => this.#readable(record));
      const markers = await this.#bounded(this.#options.table.runMarkers(readable.map((record) => record.pid)), deadline);
      if (first && processId !== undefined && selected.length > 0) {
        const record = selected[0];
        if (processIdOf(record) !== processId) throw new WorkspaceOperationError("stale-process", "Die Prozess-ID wurde inzwischen neu vergeben. Bitte die Prozessliste aktualisieren.", 409);
        if (markers.get(record.pid) !== runId) throw new WorkspaceOperationError("process-run-mismatch", "Der Prozess gehört nicht zu diesem Run", 403);
      }
      first = false;
      const targets = readable.filter((record) => markers.get(record.pid) === runId
        && (processId === undefined || processIdOf(record) === processId));
      if (targets.length === 0) {
        if (processId !== undefined || ++emptyScans >= 2) {
          assertClean();
          return;
        }
      } else {
        emptyScans = 0;
        for (const record of targets) {
          const key = processIdOf(record);
          if (failures.has(key)) continue;
          try {
            this.#assertUnprotected(record, records);
            const attempt = attempts.get(key);
            if (!attempt) {
              if (await this.#signal(record, runId, "SIGTERM", context, deadline)) attempts.set(key, { termAt: Date.now() });
            } else if (attempt.killAt === undefined && Date.now() - attempt.termAt >= this.#termGraceMs) {
              if (await this.#signal(record, runId, "SIGKILL", context, deadline)) attempt.killAt = Date.now();
            } else if (attempt.killAt !== undefined && Date.now() - attempt.killAt >= this.#killGraceMs) {
              throw new Error(`Prozess ${record.pid} von Run ${runId} ist nach SIGKILL noch aktiv`);
            }
          } catch (error) {
            this.#assertActive(context, deadline);
            if (processId !== undefined) throw error;
            failures.set(key, error);
          }
        }
        if (targets.every((record) => failures.has(processIdOf(record)))) assertClean();
      }
      await delay(Math.min(this.#pollIntervalMs, Math.max(1, deadline - Date.now())));
    }
  }

  #readable(record: ProcessRecord): boolean {
    return this.#options.executorUid === undefined || this.#options.executorUid === 0 || record.uid === this.#options.executorUid;
  }

  #assertUnprotected(record: ProcessRecord, records: readonly ProcessRecord[]): void {
    const protectedPids = new Set([0, 1, this.#options.executorPid]);
    let parent = records.find((candidate) => candidate.pid === this.#options.executorPid)?.ppid;
    while (parent !== undefined && !protectedPids.has(parent)) {
      protectedPids.add(parent);
      parent = records.find((candidate) => candidate.pid === parent)?.ppid;
    }
    if (protectedPids.has(record.pid)) throw new WorkspaceOperationError("protected-process", `Prozess ${record.pid} gehört zum geschützten Prozessbaum des Executors`, 403);
  }

  #assertActive(context: ProcessTerminationContext, deadline: number): void {
    context.signal?.throwIfAborted();
    if (Date.now() >= deadline) throw new Error(`Prozess-Stopp hat die Zeitgrenze von ${this.#timeoutMs} ms überschritten`);
  }

  async #bounded<T>(operation: Promise<T>, deadline: number): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([operation, new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error("Die Prozesstabelle antwortet nicht innerhalb der Stopp-Zeitgrenze")), Math.max(1, deadline - Date.now()));
      })]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  async #signal(expected: ProcessRecord, runId: string, signal: "SIGTERM" | "SIGKILL", context: ProcessTerminationContext, deadline: number): Promise<boolean> {
    const markers = await this.#bounded(this.#options.table.runMarkers([expected.pid]), deadline);
    const records = await this.#bounded(this.#options.table.list(), deadline);
    const current = records.find((record) => record.pid === expected.pid);
    if (!current || current.startKey !== expected.startKey || current.uid !== expected.uid) return false;
    if (markers.get(current.pid) !== runId) throw new WorkspaceOperationError("process-run-mismatch", `Prozess ${current.pid} gehört nicht mehr zu diesem Run`, 403);
    this.#assertUnprotected(current, records);
    this.#assertActive(context, deadline);
    try {
      this.#sendSignal(current.pid, signal);
      return true;
    } catch (error) {
      if (gone(error)) return false;
      throw new Error(`${signal} für Prozess ${current.pid} ist fehlgeschlagen: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}
