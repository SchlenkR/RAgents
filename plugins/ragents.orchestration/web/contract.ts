import type { RunActor, RunView } from "./run-view";

export type {
  RunAction,
  RunActor,
  RunActorInput,
  RunArtifact,
  RunSubscription,
  RunTurn,
  RunView,
} from "./run-view";
export { runArtifactContentUrl, runViewFrom } from "./run-view";

export const runActorFrom = (value: unknown): RunActor => {
  const actor = value as RunActor | undefined;
  if (typeof actor?.id !== "string" || typeof actor.handle !== "string") {
    throw new Error("Der Karten-Kontext enthält keinen Actor der Laufansicht");
  }
  return actor;
};

export const actorPluginState = (view: RunView, pluginId: string, actorId: string): unknown =>
  view.pluginStates
    .find((entry) => entry.pluginId === pluginId && entry.scope.kind === "actor" && entry.scope.actorId === actorId)
    ?.state;
