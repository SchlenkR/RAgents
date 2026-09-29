import type { ChatStartupStatus } from "quassel/events";
import type { StartupNoticeState } from "@ragents/web/ui";
import { isPendingRunActorInput, type RunView } from "@ragents/web/run-view";

export type SurfaceStartupState = StartupNoticeState;

export function surfaceStartupState({ view, startup, connected, running, error }: {
  view: RunView | undefined;
  startup: ChatStartupStatus | undefined;
  connected: boolean;
  running: boolean;
  error: string | undefined;
}): SurfaceStartupState | undefined {
  if (startup?.status === "failed") return { kind: "error", title: "The run could not be prepared", detail: startup.message };
  if (error) return { kind: "error", title: "The run status is unreachable", detail: error };
  if (startup?.status === "preparing") return { kind: "working", title: "Preparing run", detail: startup.message };
  const actors = view?.actors.filter((actor) => actor.kind !== "human") ?? [];
  const activeActors = actors.filter((actor) => actor.lifecycle?.kind !== "stopped");
  if (actors.length && !activeActors.length) return { kind: "stopped", title: "The run was stopped", detail: "No further work is performed." };
  if (view?.actions.some((action) => action.status === "pending")) return {
    kind: "waiting", title: "Your input is needed", detail: "An action in the chat is waiting for your input.",
  };
  const activeIds = new Set(activeActors.map((actor) => actor.id));
  const working = running || activeActors.some((actor) => actor.lifecycle?.kind === "running")
    || view?.turns.some((turn) => activeIds.has(turn.actorId) && turn.status === "running")
    || view?.inputs.some((input) => activeIds.has(input.actorId) && isPendingRunActorInput(input));
  if (working) return { kind: "working", title: "Setting up the run", detail: "The interface is being built. The elements appear automatically." };
  const failed = activeActors.map((actor) => view?.turns.filter((turn) => turn.actorId === actor.id).at(-1))
    .find((turn) => turn?.status === "failed" || turn?.status === "interrupted");
  if (failed) return { kind: "error", title: "The setup was halted", detail: failed.reason || "The last work step could not be completed." };
  if (!connected) return { kind: "working", title: "Loading run", detail: "Connecting to the run." };
  return undefined;
}
