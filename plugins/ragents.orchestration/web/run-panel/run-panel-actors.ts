import { chatPrimaryId, type RunActor, type RunView } from "@ragents/web/run-view";

/** The actors of the chip row: coordinator first, then in creation order; without the inspect right only LLM agents. */
export const runPanelActors = (view: RunView, inspect: boolean): RunActor[] => {
  const candidates = view.actors.filter((actor) => actor.kind !== "human" && (inspect || actor.kind === "agent"));
  const primaryId = chatPrimaryId(view);
  const primary = candidates.filter((actor) => actor.id === primaryId);
  return [...primary, ...candidates.filter((actor) => actor.id !== primaryId)];
};

export const pendingInputCount = (view: RunView, actorId: string): number =>
  view.inputs.filter((input) => input.actorId === actorId && input.lifecycle.kind === "pending").length;
