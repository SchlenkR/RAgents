import { closeSync, existsSync, openSync, readSync, statSync } from "node:fs";
import path from "node:path";

export interface JournalEvent {
  readonly sequence: number;
  readonly type: string;
  readonly actorId: string;
  readonly occurredAt: string;
  readonly payload: Record<string, unknown>;
}

interface JournalRecord {
  command?: { actorId?: string };
  occurredAt?: string;
  events: { sequence: number; type: string; occurredAt?: string; payload?: Record<string, unknown> }[];
}

export interface ActorUsage {
  calls: number;
  inputTokens: number;
  cacheReadTokens: number;
  outputTokens: number;
  costUsd: number;
}

export const RUN_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

export const journalFile = (dataDirectory: string, runId: string): string => {
  if (!RUN_ID_PATTERN.test(runId)) throw new Error(`Ungültige Run-Id: ${runId}`);
  return path.join(dataDirectory, "runs", runId, "journal.jsonl");
};

/** Ein Journalsatz trägt Actor und Zeitpunkt im Kommando, seine Ereignisse nicht; beides zusammen ist ein Ereignis. */
const eventsOf = (line: string): readonly JournalEvent[] => {
  const record = JSON.parse(line) as JournalRecord;
  const actorId = record.command?.actorId ?? "";
  return record.events.map((event) => ({
    sequence: event.sequence,
    type: event.type,
    actorId,
    occurredAt: event.occurredAt ?? record.occurredAt ?? "",
    payload: event.payload ?? {},
  }));
};

/** Liest ein Journal fortlaufend: jeder Aufruf liefert die Ereignisse, die seit dem letzten dazugekommen sind. */
export class JournalReader {
  readonly #file: string;
  #offset = 0;
  #partial = "";

  constructor(dataDirectory: string, runId: string) {
    this.#file = journalFile(dataDirectory, runId);
  }

  get file(): string {
    return this.#file;
  }

  next(): readonly JournalEvent[] {
    const size = statSync(this.#file, { throwIfNoEntry: false })?.size;
    if (size === undefined || size <= this.#offset) return [];
    const handle = openSync(this.#file, "r");
    const buffer = Buffer.allocUnsafe(size - this.#offset);
    try {
      readSync(handle, buffer, 0, buffer.length, this.#offset);
    } finally {
      closeSync(handle);
    }
    this.#offset = size;
    const lines = (this.#partial + buffer.toString("utf8")).split("\n");
    this.#partial = lines.pop() ?? "";
    return lines.filter((line) => line.trim()).flatMap(eventsOf);
  }
}

export const readJournal = (dataDirectory: string, runId: string): readonly JournalEvent[] => {
  const reader = new JournalReader(dataDirectory, runId);
  if (!existsSync(reader.file)) throw new Error(`Journal fehlt: ${reader.file}`);
  return reader.next();
};

export const usageByActor = (events: readonly JournalEvent[]): Map<string, ActorUsage> => {
  const result = new Map<string, ActorUsage>();
  for (const event of events) {
    const model = event.payload.usage as Record<string, unknown> | undefined;
    if (!model) continue;
    const entry = result.get(event.actorId) ?? { calls: 0, inputTokens: 0, cacheReadTokens: 0, outputTokens: 0, costUsd: 0 };
    entry.calls += 1;
    for (const key of ["inputTokens", "cacheReadTokens", "outputTokens", "costUsd"] as const) {
      const value = model[key];
      if (typeof value === "number") entry[key] += value;
    }
    result.set(event.actorId, entry);
  }
  return result;
};

const text = (value: unknown): string => (typeof value === "string" ? value : "").replace(/\n/g, " ");

export type JournalMode = "chat" | "tools" | "all";

export const journalLines = (events: readonly JournalEvent[], mode: JournalMode, since: number): string[] => {
  const lines: string[] = [];
  for (const event of events) {
    if (event.sequence < since) continue;
    const actor = event.actorId.slice(0, 14);
    const payload = event.payload;
    const type = event.type;
    if (type === "model.output.completed" && mode !== "tools") {
      const output = text(payload.text);
      if (output.trim()) lines.push(`[${event.sequence}] ${actor}: ${output.slice(0, 800)}`);
    } else if (type === "actor.input.enqueued" && mode !== "tools") {
      const input = payload.input as Record<string, unknown> | undefined;
      lines.push(`[${event.sequence}] INPUT -> ${String(payload.actorId ?? "").slice(0, 14)}: ${text(payload.text ?? input?.text).slice(0, 300)}`);
    } else if (type === "turn.input-steered" && mode !== "tools") {
      lines.push(`[${event.sequence}] STEERING -> ${actor}: ${String(payload.inputId ?? "")} in ${String(payload.turnId ?? "")}`);
    } else if (type.startsWith("tool.call.") && mode !== "chat") {
      const body = type.endsWith("started") ? payload.input : type.endsWith("failed") ? payload.error : undefined;
      if (body !== undefined) lines.push(`[${event.sequence}] ${type.split(".").pop()} ${actor} ${String(payload.name ?? "")}: ${JSON.stringify(body).slice(0, 300)}`);
    } else if (mode !== "tools" && (type.includes("failed") || type.includes("stopped") || type.startsWith("action."))) {
      lines.push(`[${event.sequence}] ${type} ${actor}: ${JSON.stringify(payload).slice(0, 300)}`);
    }
  }
  lines.push(`-- letzte Sequenz: ${events.at(-1)?.sequence ?? 0}`);
  return lines;
};
