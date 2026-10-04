import { chatPrimaryId, type RunActor, type RunView } from "@ragents/web/run-view";

/** The actors of the chip row: coordinator first, then in creation order; without inspection only conversational actors. */
export const runPanelActors = (view: RunView, inspect: boolean): RunActor[] => {
  const candidates = view.actors.filter((actor) => actor.kind !== "human" && (inspect || actor.kind === "agent" || actor.kind === "external"));
  const primaryId = chatPrimaryId(view);
  const primary = candidates.filter((actor) => actor.id === primaryId);
  return [...primary, ...candidates.filter((actor) => actor.id !== primaryId)];
};

export const pendingInputCount = (view: RunView, actorId: string): number =>
  view.inputs.filter((input) => input.actorId === actorId && input.lifecycle.kind === "pending").length;

/** The chat's addressee: the stored actor while it is listed, otherwise the coordinator, otherwise the first actor. */
export const selectedRunPanelActor = (view: RunView, actors: readonly RunActor[], stored: string | null): RunActor | undefined => {
  const primaryId = chatPrimaryId(view);
  return actors.find((actor) => actor.id === stored) ?? actors.find((actor) => actor.id === primaryId) ?? actors[0];
};
