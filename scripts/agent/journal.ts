import { closeSync, existsSync, openSync, readSync, statSync } from "node:fs";
import path from "node:path";
import { askPayloadComplaints, ASK_PLUGIN_ID, type AskOption, type AskPayload, type AskQuestion } from "../../plugins/ragents.ask/ask-payload.ts";

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
  if (!RUN_ID_PATTERN.test(runId)) throw new Error(`Invalid run id: ${runId}`);
  return path.join(dataDirectory, "runs", runId, "journal.jsonl");
};

/** A journal record carries actor and time in the command, its events do not; both together make an event. */
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

/** Reads a journal continuously: each call returns the events added since the last one. */
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
  if (!existsSync(reader.file)) throw new Error(`Journal missing: ${reader.file}`);
  return reader.next();
};

export const usageByActor = (events: readonly JournalEvent[]): Map<string, ActorUsage> => {
  const result = new Map<string, ActorUsage>();
  for (const event of events) {
    const model = event.payload.usage as Record<string, unknown> | undefined;
    if (!model || event.type === "model.step.completed") continue;
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

const byUser = (payload: Record<string, unknown>): string => typeof payload.userId === "string" ? ` by ${payload.userId}` : "";

const optionText = (option: AskOption): string =>
  option.description.trim() ? `${JSON.stringify(option.label)} (${text(option.description)})` : JSON.stringify(option.label);

/** A question of ragents.ask in one line: its header, its text, and its options with their descriptions. */
export const questionLine = (question: AskQuestion): string =>
  `[${text(question.header)}] ${text(question.question)} Options: ${question.options.map(optionText).join(", ")}${question.multiSelect ? " (several allowed)" : ""}`;

/** The questions of a ragents.ask action; a payload in another shape stays a raw action line. */
const askedQuestions = (type: string, payload: Record<string, unknown>): readonly AskQuestion[] =>
  type === "action.proposed" && payload.owner === ASK_PLUGIN_ID && askPayloadComplaints(payload.payload).length === 0
    ? (payload.payload as AskPayload).questions : [];

export type JournalMode = "chat" | "tools" | "all";

export const journalLines = (events: readonly JournalEvent[], mode: JournalMode, since: number): string[] => {
  const lines: string[] = [];
  for (const event of events) {
    if (event.sequence < since) continue;
    const actor = event.actorId.slice(0, 14);
    const payload = event.payload;
    const type = event.type;
    const questions = askedQuestions(type, payload);
    if (type === "model.output.completed" && mode !== "tools") {
      const output = text(payload.text);
      if (output.trim()) lines.push(`[${event.sequence}] ${actor}: ${output.slice(0, 800)}`);
    } else if (type === "actor.input.enqueued" && mode !== "tools") {
      const content = payload.subscriptionId ? `[event ${String((payload.sourceEventIds as string[] | undefined)?.[0] ?? "")}]` : text(payload.content);
      lines.push(`[${event.sequence}] INPUT -> ${String(payload.actorId ?? "").slice(0, 14)}: ${content.slice(0, 300)}`);
    } else if (type === "context.compacted" && mode !== "tools") {
      const threshold = payload.threshold as { tokens?: unknown; source?: unknown } | undefined;
      const applied = threshold ? ` (threshold ${String(threshold.tokens)} from ${String(threshold.source)})` : "";
      lines.push(`[${event.sequence}] CONTEXT COMPACTED ${actor}: about ${String(payload.tokensBefore)} tokens summarized${applied}`);
    } else if (type === "turn.input-steered" && mode !== "tools") {
      lines.push(`[${event.sequence}] STEERING -> ${actor}: ${String(payload.inputId ?? "")} in ${String(payload.turnId ?? "")}`);
    } else if (type === "run.paused" && mode !== "tools") {
      lines.push(`[${event.sequence}] PAUSED${byUser(payload)}: ${text(payload.reason)}`);
    } else if (type === "run.resumed" && mode !== "tools") {
      lines.push(`[${event.sequence}] RESUMED (${String(payload.trigger ?? "")})${byUser(payload)}`);
    } else if (questions.length > 0 && mode !== "tools") {
      lines.push(...questions.map((question) => `[${event.sequence}] QUESTION ${actor}: ${questionLine(question)}`));
    } else if (type.startsWith("tool.call.") && mode !== "chat") {
      const body = type.endsWith("started") ? payload.input : type.endsWith("failed") ? payload.error : undefined;
      if (body !== undefined) lines.push(`[${event.sequence}] ${type.split(".").pop()} ${actor} ${String(payload.name ?? "")}: ${JSON.stringify(body).slice(0, 300)}`);
    } else if (mode !== "tools" && (type.includes("failed") || type.includes("stopped") || type.startsWith("action."))) {
      lines.push(`[${event.sequence}] ${type} ${actor}: ${JSON.stringify(payload).slice(0, 300)}`);
    }
  }
  lines.push(`-- last sequence: ${events.at(-1)?.sequence ?? 0}`);
  return lines;
};
