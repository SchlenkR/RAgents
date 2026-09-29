import type { SessionInfo } from "../../web/src/api";
import { runViewFrom, type RunActor, type RunView } from "../../web/src/run-view";

type ActorStatus = "running" | "waiting" | "idle" | "stopped";
export type RunState = "running" | "waiting" | "idle" | "ended";

export interface RunSummary {
  id: string;
  title: string;
  updatedAt: number;
  state: RunState;
  pendingActions: number;
  /** The run view could not be read; the run stays as a list row, the other runs are not affected. */
  problem?: string;
  /** Why the server has locked the run; it no longer opens, deleting remains possible. */
  locked?: string;
}

const actorStatusOf = (view: RunView, actor: RunActor): ActorStatus => {
  if (actor.lifecycle?.kind === "running") return "running";
  if (actor.lifecycle?.kind === "stopped") return "stopped";
  return view.inputs.some((input) => input.actorId === actor.id && input.lifecycle.kind === "pending") ? "waiting" : "idle";
};

const runStateOf = (session: SessionInfo, statuses: readonly ActorStatus[], pendingActions: number): RunState => {
  if (session.running || statuses.includes("running")) return "running";
  if (pendingActions > 0) return "waiting";
  if (statuses.length > 0 && statuses.every((status) => status === "stopped")) return "ended";
  return "idle";
};

const listRow = (session: SessionInfo): RunSummary => ({
  id: session.id, title: session.title, updatedAt: session.updatedAt, state: session.running ? "running" : "idle", pendingActions: 0,
  ...(session.locked !== undefined ? { locked: session.locked } : {}),
});

const loadedSummary = (session: SessionInfo, view: RunView): RunSummary => {
  const statuses = view.actors.filter((actor) => actor.kind !== "human").map((actor) => actorStatusOf(view, actor));
  const pendingActions = view.actions.filter((action) => action.status === "pending").length;
  return {
    id: session.id,
    title: session.title,
    updatedAt: session.updatedAt,
    state: runStateOf(session, statuses, pendingActions),
    pendingActions,
  };
};

/** The summary of a run for overview and badge; without a readable run view, only the list row remains. */
export const runSummaryFrom = (session: SessionInfo, rawView: unknown): RunSummary => {
  const view = session.locked === undefined ? runViewFrom(rawView) : undefined;
  if (!view) return listRow(session);
  try {
    return loadedSummary(session, view);
  } catch (cause) {
    return { ...listRow(session), problem: `The run view is not readable: ${cause instanceof Error ? cause.message : String(cause)}` };
  }
};

export const sortRuns = (runs: readonly RunSummary[]): RunSummary[] =>
  [...runs].sort((left, right) => right.updatedAt - left.updatedAt || left.id.localeCompare(right.id));
