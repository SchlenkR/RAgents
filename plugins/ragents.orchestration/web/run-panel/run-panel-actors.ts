import type { CanvasElementDefinition } from "@ragents/web/PluginRegistry";
import { actorVisibleInHeader, type ActorHeaderMode } from "../actor-header-settings";
import { chatPrimaryId, type RunActor, type RunView } from "@ragents/web/run-view";

/** Die Actors der Chip-Reihe: Koordinator zuerst, dann in Anlegereihenfolge; ohne Prüfrecht nur LLM-Agenten. */
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

/** Sichtbar nach der Actor-Anzeige des Canvas; der Koordinator und der gewählte Actor bleiben immer als Chip da. */
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

/** Ein Chip trägt ein Ausrufezeichen, wenn eine Host-Bestätigung oder eine Aktion des Actors auf eine Eingabe wartet. */
export const elementNeedsAttention = (view: RunView | undefined, definition: CanvasElementDefinition, confirmationPending: boolean): boolean =>
  confirmationPending || (view !== undefined && definition.anchorActorId !== undefined && pendingActionCount(view, definition.anchorActorId) > 0);
