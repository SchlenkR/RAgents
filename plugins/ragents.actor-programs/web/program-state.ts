import { ACTOR_PROGRAMS_STATE_ID, ACTOR_STATE_ID } from "@ragents/host/plugin-support/actor-programs/contract";
import { isRecord } from "@ragents/web/lib/guards";
import { runViewFrom } from "@ragents/web/run-view";
import type { ActorProgramsListing } from "./api";
import { isJsonValue } from "./bridge";

export interface ActorProgramView {
  id: string;
  title: string;
  actorId: string;
  actorHandle: string;
  revision: string;
  app: Record<string, unknown>;
}

export const actorProgramSourceReference = (runView: unknown, actorId: string): { name: string; revision: string } | undefined => {
  const view = runViewFrom(runView);
  const entry = view?.pluginStates.find((entry) => entry.pluginId === ACTOR_PROGRAMS_STATE_ID
    && entry.scope.kind === "actor" && entry.scope.actorId === actorId);
  if (!entry || !isRecord(entry.state) || entry.state.program === null) return undefined;
  const program = entry.state.program;
  if (!isRecord(program) || program.actorId !== actorId || typeof program.name !== "string" || typeof program.revision !== "string") {
    throw new Error("Die Quellcode-Zuordnung des Actor-Programms ist ungültig.");
  }
  return { name: program.name, revision: program.revision };
};

export const actorProgramViews = (runView: unknown): ActorProgramView[] => {
  const view = runViewFrom(runView);
  if (!view) return [];
  return view.pluginStates.flatMap((entry): ActorProgramView[] => {
    if (entry.pluginId !== ACTOR_PROGRAMS_STATE_ID || entry.scope.kind !== "actor") return [];
    const actorId = entry.scope.actorId;
    const actor = view.actors.find((actor) => actor.id === actorId);
    if (!actor || actor.kind === "human" || actor.lifecycle?.kind === "stopped") return [];
    if (!isRecord(entry.state) || !isRecord(entry.state.program)) return [];
    const program = entry.state.program;
    if (program.actorId !== actor.id || program.actorHandle !== actor.handle || typeof program.revision !== "string" || !Array.isArray(program.views)) {
      throw new Error(`Das Ansichtsprogramm von @${actor.handle} ist ungültig.`);
    }
    return program.views.map((app) => {
      if (!isRecord(app) || typeof app.id !== "string" || typeof app.title !== "string") throw new Error(`Eine Ansicht von @${actor.handle} ist ungültig.`);
      return { id: app.id, title: app.title, actorId: actor.id, actorHandle: actor.handle, revision: program.revision as string, app };
    });
  });
};

export const currentActorListing = (listing: ActorProgramsListing | undefined, runView: unknown): ActorProgramsListing | undefined => {
  const view = runViewFrom(runView);
  if (!listing || !view) return undefined;
  const currentViews = new Map(actorProgramViews(view).map((entry) => [entry.id, entry]));
  const activeActors = new Set(view.actors.filter((actor) => actor.kind !== "human" && actor.lifecycle?.kind !== "stopped").map((actor) => actor.id));
  return {
    ...listing,
    apps: listing.apps.flatMap((app) => {
      const current = currentViews.get(app.id);
      if (!current || current.actorId !== app.actorId || current.revision !== app.revision) return [];
      const state = view.pluginStates.find((entry) => entry.pluginId === ACTOR_STATE_ID && entry.scope.kind === "actor" && entry.scope.actorId === app.actorId);
      const values = state ? state.state : app.state.values;
      if (!isJsonValue(values)) throw new Error(`Der Zustand von @${app.actorHandle} ist kein JSON-Wert.`);
      return [{ ...app, visible: current.app.visible !== false,
        state: { ...app.state, values } }];
    }),
    tools: listing.tools.filter((tool) => activeActors.has(tool.actorId) && view.pluginStates.some((entry) =>
      entry.pluginId === ACTOR_PROGRAMS_STATE_ID && entry.scope.kind === "actor" && entry.scope.actorId === tool.actorId
      && isRecord(entry.state) && isRecord(entry.state.program) && entry.state.program.revision === tool.revision)),
  };
};
