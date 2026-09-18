import type { ExecutableActor, JournalEvent, JsonValue, RunView } from "@aicontainer/ragents";

const OUTPUT_CHARS = 600;

export interface ActorObservation {
  lifecycle: "idle" | "running" | "stopped";
  stopReason?: string;
  completedTurns: number;
  lastTurn?: { status: string; reason?: string };
  pendingInputs: number;
  openQuestions: number;
  lastOutput?: string;
}

export const actorByReference = (view: RunView, reference: string): ExecutableActor | undefined => {
  const handle = reference.startsWith("@") ? reference.slice(1) : reference;
  return view.actors.find((actor): actor is ExecutableActor => actor.kind !== "human" && (actor.id === reference || actor.handle === handle));
};

export const observeActor = (view: RunView, actorId: string): ActorObservation | undefined => {
  const actor = view.actors.find((candidate): candidate is ExecutableActor => candidate.kind !== "human" && candidate.id === actorId);
  if (!actor) return undefined;
  const turns = view.turns.filter((turn) => turn.actorId === actorId);
  const last = turns.at(-1);
  const output = turns.findLast((turn) => turn.status !== "running" && turn.outputs.length > 0)?.outputs.at(-1)?.text;
  return {
    lifecycle: actor.lifecycle.kind,
    ...(actor.lifecycle.kind === "stopped" ? { stopReason: actor.lifecycle.reason } : {}),
    completedTurns: turns.filter((turn) => turn.status !== "running").length,
    ...(last ? { lastTurn: { status: last.status, ...(last.reason ? { reason: last.reason } : {}) } } : {}),
    pendingInputs: view.inputs.filter((input) => input.actorId === actorId && input.lifecycle.kind === "pending").length,
    openQuestions: view.actions.filter((action) => action.askedBy === actorId && action.kind === "question" && action.status === "pending").length,
    ...(output ? { lastOutput: output.length > OUTPUT_CHARS ? `...${output.slice(-OUTPUT_CHARS)}` : output } : {}),
  };
};

export const lastActivityOf = (events: readonly JournalEvent[], actor: ExecutableActor): string => {
  const event = events.findLast((candidate) => candidate.actorId === actor.id
    || candidate.type === "actor.input.enqueued" && candidate.payload.actorId === actor.id
    || (candidate.type === "turn.finished" || candidate.type === "turn.interrupted") && candidate.actorId === actor.id);
  return event?.occurredAt ?? actor.createdAt;
};

const isObject = (value: JsonValue): value is { [key: string]: JsonValue } => typeof value === "object" && value !== null && !Array.isArray(value);

export const flattenJson = (value: JsonValue, prefix = "", into = new Map<string, string>()): Map<string, string> => {
  if (Array.isArray(value)) {
    if (value.length === 0 && prefix) into.set(prefix, "[]");
    value.forEach((entry, index) => flattenJson(entry, prefix ? `${prefix}.${index}` : String(index), into));
  } else if (isObject(value)) {
    const keys = Object.keys(value);
    if (keys.length === 0 && prefix) into.set(prefix, "{}");
    for (const key of keys) flattenJson(value[key], prefix ? `${prefix}.${key}` : key, into);
  } else into.set(prefix || "$", JSON.stringify(value));
  return into;
};

export const changesBetween = (before: JsonValue | undefined, after: JsonValue): string[] => {
  const previous = before === undefined ? new Map<string, string>() : flattenJson(before);
  const current = flattenJson(after);
  const lines: string[] = [];
  for (const [path, value] of current) {
    const old = previous.get(path);
    if (old === undefined) lines.push(`${path}: ${value}${before === undefined ? "" : " (neu)"}`);
    else if (old !== value) lines.push(`${path}: ${old} -> ${value}`);
  }
  for (const path of previous.keys()) if (!current.has(path)) lines.push(`${path}: entfernt`);
  return lines;
};
