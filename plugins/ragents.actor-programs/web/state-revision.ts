import { ACTOR_PROGRAMS_STATE_ID, ACTOR_INVOCATIONS_STATE_ID, ACTOR_STATE_ID } from "../contract";
import { runViewFrom } from "@aicontainer/plugins/ragents.orchestration/web/contract";

export const actorProgramsRevision = (runView: unknown): string => {
  const view = runViewFrom(runView);
  const programActors = new Set(view?.pluginStates.filter((entry) => entry.pluginId === ACTOR_PROGRAMS_STATE_ID && entry.scope.kind === "actor")
    .map((entry) => entry.scope.kind === "actor" ? entry.scope.actorId : "") ?? []);
  return JSON.stringify({
    actors: view?.actors.filter((actor) => programActors.has(actor.id)).map((actor) => [actor.id, actor.handle, actor.lifecycle?.kind === "stopped"]).sort(([left], [right]) => String(left).localeCompare(String(right))) ?? [],
    states: (view?.pluginStates ?? [])
      .filter((entry) => entry.pluginId === ACTOR_PROGRAMS_STATE_ID || entry.pluginId === ACTOR_INVOCATIONS_STATE_ID
        || entry.pluginId === ACTOR_STATE_ID && entry.scope.kind === "actor" && programActors.has(entry.scope.actorId))
      .map((entry) => [`${entry.pluginId}:${entry.scope.kind === "actor" ? entry.scope.actorId : "run"}`, entry.state])
      .sort(([left], [right]) => String(left).localeCompare(String(right))),
  });
};
