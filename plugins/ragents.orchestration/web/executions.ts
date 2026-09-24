import type { JournalEvent } from "@ragents/engine/src/domain/events";
import type { JsonValue } from "@ragents/engine/src/domain/json";
import type { RunView } from "@ragents/web/run-view";

export type ExecutionStatus = "running" | "completed" | "failed" | "interrupted";

export interface TypeScriptExecution {
  key: string;
  actorId: string;
  actorHandle: string;
  actorName: string;
  turnId: string;
  toolCallId: string;
  sequence: number;
  startedAt: string;
  finishedAt: string | null;
  status: ExecutionStatus;
  code: string | null;
  path: string | null;
  result: JsonValue | undefined;
  logs: readonly string[];
  error: string | null;
}

const record = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const executionKey = (actorId: string, turnId: string, toolCallId: string) => JSON.stringify([actorId, turnId, toolCallId]);

export const executionEventsFrom = (value: unknown, runId: string): readonly JournalEvent[] => {
  if (!Array.isArray(value) || value.some((entry: unknown) => {
    if (!record(entry) || entry.runId !== runId || typeof entry.eventId !== "string" || typeof entry.actorId !== "string"
      || !Number.isSafeInteger(entry.sequence) || typeof entry.occurredAt !== "string" || !Number.isFinite(Date.parse(entry.occurredAt))
      || typeof entry.type !== "string" || !record(entry.payload)) return true;
    const payload = entry.payload;
    if (entry.type.startsWith("tool.call.") && (typeof payload.turnId !== "string" || typeof payload.toolCallId !== "string")) return true;
    if (entry.type === "tool.call.source") return typeof payload.code !== "string" || (payload.path !== null && typeof payload.path !== "string");
    if (entry.type === "tool.call.started") return typeof payload.name !== "string" || !("input" in payload);
    if (entry.type === "tool.call.completed") return typeof payload.name !== "string" || !("output" in payload);
    if (entry.type === "tool.call.failed") return typeof payload.name !== "string" || typeof payload.error !== "string";
    if (entry.type === "turn.finished") return typeof payload.turnId !== "string" || !["completed", "failed"].includes(String(payload.outcome));
    if (entry.type === "turn.interrupted") return typeof payload.turnId !== "string" || typeof payload.reason !== "string";
    return false;
  })) throw new Error("Der Server hat kein gültiges Journal für diesen Run geliefert.");
  return value as JournalEvent[];
};

export const projectExecutions = (events: readonly JournalEvent[], view?: Pick<RunView, "id" | "actors" | "turns">): TypeScriptExecution[] => {
  const executions = new Map<string, TypeScriptExecution>();
  const actors = new Map(view?.actors.map((actor) => [actor.id, actor]));
  const ends = new Map<string, { at: string; reason: string | null }>();
  for (const event of [...events].sort((left, right) => left.sequence - right.sequence)) {
    if (view && event.runId !== view.id) continue;
    if (event.type === "turn.finished" || event.type === "turn.interrupted") {
      ends.set(JSON.stringify([event.actorId, event.payload.turnId]), { at: event.occurredAt, reason: "reason" in event.payload ? event.payload.reason : null });
      continue;
    }
    if (event.type !== "tool.call.started" && event.type !== "tool.call.completed" && event.type !== "tool.call.failed" && event.type !== "tool.call.source") continue;
    const key = executionKey(event.actorId, event.payload.turnId, event.payload.toolCallId);
    if (event.type === "tool.call.started") {
      if (event.payload.name !== "typescript_eval" || executions.has(key)) continue;
      const actor = actors.get(event.actorId);
      const input = record(event.payload.input) ? event.payload.input : {};
      executions.set(key, {
        key, actorId: event.actorId, actorHandle: actor?.handle ?? event.actorId, actorName: actor?.displayName ?? event.actorId,
        turnId: event.payload.turnId, toolCallId: event.payload.toolCallId, sequence: event.sequence,
        startedAt: event.occurredAt, finishedAt: null, status: "running",
        code: typeof input.code === "string" ? input.code : null, path: typeof input.path === "string" ? input.path : null,
        result: undefined, logs: [], error: null,
      });
      continue;
    }
    const execution = executions.get(key);
    if (!execution) continue;
    if (event.type === "tool.call.source") {
      execution.code = event.payload.code;
      execution.path = event.payload.path;
    } else if (event.type === "tool.call.completed") {
      execution.status = "completed";
      execution.finishedAt = event.occurredAt;
      const output = event.payload.output;
      const envelope = record(output) && "result" in output && Array.isArray(output.logs) && output.logs.every((line) => typeof line === "string");
      execution.result = envelope ? output.result as JsonValue : output;
      execution.logs = envelope ? output.logs as string[] : [];
    } else {
      execution.status = "failed";
      execution.finishedAt = event.occurredAt;
      execution.error = event.payload.error;
    }
  }
  const turns = new Map(view?.turns.map((turn) => [JSON.stringify([turn.actorId, turn.id]), turn]));
  for (const execution of executions.values()) {
    if (execution.status !== "running") continue;
    const turnKey = JSON.stringify([execution.actorId, execution.turnId]);
    const turn = turns.get(turnKey);
    const call = turn?.toolCalls?.find((entry) => entry.id === execution.toolCallId && entry.name === "typescript_eval");
    const ended = ends.get(turnKey);
    if (call && call.status !== "running") {
      execution.status = call.status;
      execution.finishedAt = call.finishedAt ?? turn?.finishedAt ?? ended?.at ?? null;
    } else if (ended || (turn && turn.status !== "running")) {
      execution.status = "interrupted";
      execution.finishedAt = ended?.at ?? turn?.finishedAt ?? null;
    }
    if (execution.status === "interrupted") execution.error = ended?.reason ?? turn?.reason ?? "Der Aufruf wurde unterbrochen.";
  }
  return [...executions.values()].sort((left, right) => right.sequence - left.sequence);
};

export const executionStatusLabel = (status: ExecutionStatus): string => ({ running: "Läuft", completed: "Fertig", failed: "Fehlgeschlagen", interrupted: "Unterbrochen" })[status];

export const filterExecutions = (executions: readonly TypeScriptExecution[], query: string, status: ExecutionStatus | "all"): TypeScriptExecution[] => {
  const search = query.trim().toLocaleLowerCase("de-DE");
  return executions.filter((execution) => (status === "all" || execution.status === status) && (!search || [
    execution.actorId, execution.actorHandle, execution.actorName, execution.code, execution.path,
    JSON.stringify(execution.result), ...execution.logs, execution.error, executionStatusLabel(execution.status),
  ].join("\n").toLocaleLowerCase("de-DE").includes(search)));
};

export const executionDuration = (execution: Pick<TypeScriptExecution, "startedAt" | "finishedAt">, now: number): string => {
  const milliseconds = Math.max(0, (execution.finishedAt ? Date.parse(execution.finishedAt) : now) - Date.parse(execution.startedAt));
  if (!Number.isFinite(milliseconds)) return "Dauer unbekannt";
  if (milliseconds < 1_000) return `${milliseconds} ms`;
  const seconds = Math.floor(milliseconds / 1_000);
  return seconds < 60 ? `${seconds} s` : `${Math.floor(seconds / 60)} min ${seconds % 60} s`;
};
