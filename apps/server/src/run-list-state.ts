import type { Actor, ExecutableActor, RunState } from "@ragents/engine";
import type { RunListState } from "./chat-handler.js";

type ActorStatus = "running" | "waiting" | "idle" | "stopped";

const executable = (actor: Actor): actor is ExecutableActor => actor.kind !== "human";

/** What a list row shows of a run: paused while a pause holds an actor that is not stopped, else running work, else open actions, else ended once every actor stopped, else idle. */
export const runListStateOf = (state: RunState, running: boolean): { state: RunListState; pendingActions: number } => {
  const waiting = new Set([...state.inputs.values()].filter((input) => input.lifecycle.kind === "pending").map((input) => input.actorId));
  const statuses = [...state.actors.values()].filter(executable).map((actor): ActorStatus =>
    actor.lifecycle.kind === "running" ? "running" : actor.lifecycle.kind === "stopped" ? "stopped" : waiting.has(actor.id) ? "waiting" : "idle");
  const pendingActions = [...state.actions.values()].filter((action) => action.status === "pending").length;
  const ended = statuses.length > 0 && statuses.every((status) => status === "stopped");
  if (state.pause && !ended) return { state: "paused", pendingActions };
  if (running || statuses.includes("running")) return { state: "running", pendingActions };
  if (pendingActions > 0) return { state: "waiting", pendingActions };
  if (ended) return { state: "ended", pendingActions };
  return { state: "idle", pendingActions };
};
