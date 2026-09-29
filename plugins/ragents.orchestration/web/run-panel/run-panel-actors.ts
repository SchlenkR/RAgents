import type { SurfaceElementDefinition } from "@ragents/web/PluginRegistry";
import { actorVisibleInHeader, type ActorHeaderMode } from "../actor-header-settings";
import { chatPrimaryId, type RunActor, type RunView } from "@ragents/web/run-view";

/** The actors of the chip row: coordinator first, then in creation order; without the inspect right only LLM agents. */
export const runPanelActors = (view: RunView, inspect: boolean): RunActor[] => {
  const candidates = view.actors.filter((actor) => actor.kind !== "human" && (inspect || actor.kind === "agent"));
  const primaryId = chatPrimaryId(view);
  const primary = candidates.filter((actor) => actor.id === primaryId);
  return [...primary, ...candidates.filter((actor) => actor.id !== primaryId)];
};

export interface RunPanelActorFilter {
  mode: ActorHeaderMode;
  onStage: (actor: RunActor) => boolean;
  primaryId: string | null | undefined;
  selectedId: string | undefined;
}

/** Visible according to the surface's actor display; the coordinator and the selected actor always stay as a chip. */
export const partitionRunPanelActors = (actors: readonly RunActor[], filter: RunPanelActorFilter): { shown: RunActor[]; hidden: RunActor[] } => {
  const shown: RunActor[] = [];
  const hidden: RunActor[] = [];
  for (const actor of actors) {
    const pinned = actor.id === filter.primaryId || actor.id === filter.selectedId;
    (pinned || actorVisibleInHeader(actor, filter.mode, filter.onStage(actor)) ? shown : hidden).push(actor);
  }
  return { shown, hidden };
};

export const pendingInputCount = (view: RunView, actorId: string): number =>
  view.inputs.filter((input) => input.actorId === actorId && input.lifecycle.kind === "pending").length;

export const pendingActionCount = (view: RunView, askedBy: string): number =>
  view.actions.filter((action) => action.status === "pending" && action.askedBy === askedBy).length;

/** A chip carries an exclamation mark when a host confirmation or an action of the actor waits for input. */
export const elementNeedsAttention = (view: RunView | undefined, definition: SurfaceElementDefinition, confirmationPending: boolean): boolean =>
  confirmationPending || (view !== undefined && definition.anchorActorId !== undefined && pendingActionCount(view, definition.anchorActorId) > 0);
