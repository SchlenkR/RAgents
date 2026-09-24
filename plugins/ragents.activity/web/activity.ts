export const VISIBLE_ENTRIES = 3;

export interface ActivityActor {
  id: string;
  displayName?: string;
  handle?: string;
}

export interface ActivityTool {
  id: string;
  name: string;
  status: string;
  startedAt?: string;
  finishedAt?: string | null;
}

export interface ActivityTurn {
  id: string;
  actorId: string;
  status: string;
  startedAt?: string;
  finishedAt?: string | null;
  toolCalls: readonly ActivityTool[];
}

export interface ActivitySource {
  primaryActorId?: string;
  actors: readonly ActivityActor[];
  turns: readonly ActivityTurn[];
}

export interface ActivityEntry {
  id: string;
  kind: "tool" | "turn";
  label: string;
  startedAt: string | undefined;
}

export interface ActivityState {
  entries: readonly ActivityEntry[];
  hidden: number;
}

const emptySource: ActivitySource = { actors: [], turns: [] };

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const optionalText = (value: unknown): string | undefined =>
  typeof value === "string" ? value : undefined;

const actorFrom = (value: unknown): ActivityActor[] => {
  if (!isRecord(value) || typeof value.id !== "string") return [];
  return [{ id: value.id, displayName: optionalText(value.displayName), handle: optionalText(value.handle) }];
};

const toolFrom = (value: unknown): ActivityTool[] => {
  if (!isRecord(value) || typeof value.id !== "string" || typeof value.name !== "string" || typeof value.status !== "string") return [];
  return [{ id: value.id, name: value.name, status: value.status, startedAt: optionalText(value.startedAt), finishedAt: optionalText(value.finishedAt) ?? null }];
};

const turnFrom = (value: unknown): ActivityTurn[] => {
  if (!isRecord(value) || typeof value.id !== "string" || typeof value.actorId !== "string") return [];
  if (typeof value.status !== "string") return [];
  return [{
    id: value.id,
    actorId: value.actorId,
    status: value.status,
    toolCalls: Array.isArray(value.toolCalls) ? value.toolCalls.flatMap(toolFrom) : [],
    startedAt: optionalText(value.startedAt),
    finishedAt: optionalText(value.finishedAt) ?? null,
  }];
};

/** Liest Actors und Turns aus der Run-Ansicht; eine noch nicht geladene oder fremde Struktur ergibt nichts. */
export const activitySourceFrom = (
  runView: unknown,
): ActivitySource => {
  if (!isRecord(runView)) return emptySource;
  const actors = Array.isArray(runView.actors) ? runView.actors.flatMap(actorFrom) : [];
  const turns = Array.isArray(runView.turns) ? runView.turns.flatMap(turnFrom) : [];
  return { actors, turns, primaryActorId: optionalText(runView.primaryActorId) };
};

const labelOf = (actors: readonly ActivityActor[], actorId: string): string => {
  const actor = actors.find((candidate) => candidate.id === actorId);
  return actor?.displayName || actor?.handle || actorId;
};

const startedMillis = (startedAt: string | undefined): number => {
  if (startedAt === undefined) return Number.MAX_SAFE_INTEGER;
  const parsed = Date.parse(startedAt);
  return Number.isNaN(parsed) ? Number.MAX_SAFE_INTEGER : parsed;
};

const byStart = (left: ActivityEntry, right: ActivityEntry) =>
  startedMillis(left.startedAt) - startedMillis(right.startedAt) || left.id.localeCompare(right.id);

const runningToolCalls = (turn: ActivityTurn): readonly ActivityTool[] =>
  turn.status === "running" && !turn.finishedAt
    ? turn.toolCalls.filter((tool) => tool.status === "running" && !tool.finishedAt)
    : [];

const runningTools = (source: ActivitySource): ActivityEntry[] =>
  source.turns.flatMap((turn) => runningToolCalls(turn).map((tool) => ({
    id: `tool:${JSON.stringify([turn.id, tool.id])}`,
    kind: "tool" as const,
    label: turn.actorId === source.primaryActorId ? tool.name : `${labelOf(source.actors, turn.actorId)}: ${tool.name}`,
    startedAt: tool.startedAt,
  })));

const runningTurns = (source: ActivitySource): ActivityEntry[] =>
  source.turns.flatMap((turn) => {
    if (turn.actorId === source.primaryActorId || turn.status !== "running" || turn.finishedAt || runningToolCalls(turn).length > 0) return [];
    return [{
      id: `turn:${turn.id}`,
      kind: "turn" as const,
      label: labelOf(source.actors, turn.actorId),
      startedAt: turn.startedAt,
    }];
  });

/** Der Ist-Zustand: offene Werkzeugaufrufe zuerst, dann laufende Turns, jeweils das Älteste voran. */
export const activeActivity = (source: ActivitySource): ActivityState => {
  const entries = [
    ...runningTools(source).sort(byStart),
    ...runningTurns(source).sort(byStart),
  ];
  return {
    entries: entries.slice(0, VISIBLE_ENTRIES),
    hidden: Math.max(0, entries.length - VISIBLE_ENTRIES),
  };
};

export const elapsedLabel = (startedAt: string | undefined, now: number): string | undefined => {
  if (startedAt === undefined) return undefined;
  const started = Date.parse(startedAt);
  if (Number.isNaN(started)) return undefined;
  const seconds = Math.max(0, Math.floor((now - started) / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}:${String(seconds % 60).padStart(2, "0")}`;
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
};
