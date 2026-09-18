import type { CanvasElementDefinition } from "@aicontainer/web/PluginRegistry";
import { actorVisibleInHeader, type ActorHeaderMode } from "../actor-header-settings";
import type { RunActor, RunView } from "../run-view";

/** Die Actors der Chip-Reihe: Koordinator zuerst, dann in Anlegereihenfolge; ohne Prüfrecht nur LLM-Agenten. */
export const columnActors = (view: RunView, inspect: boolean): RunActor[] => {
  const candidates = view.actors.filter((actor) => actor.kind !== "human" && (inspect || actor.kind === "agent"));
  const primary = candidates.filter((actor) => actor.id === view.primaryActorId);
  return [...primary, ...candidates.filter((actor) => actor.id !== view.primaryActorId)];
};

export interface ColumnActorFilter {
  mode: ActorHeaderMode;
  onStage: (actor: RunActor) => boolean;
  primaryId: string | null | undefined;
  selectedId: string | undefined;
}

/** Sichtbar nach der Actor-Anzeige des Canvas; der Koordinator und der gewählte Actor bleiben immer als Chip da. */
export const partitionColumnActors = (actors: readonly RunActor[], filter: ColumnActorFilter): { shown: RunActor[]; hidden: RunActor[] } => {
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

export const pendingQuestionCount = (view: RunView, askedBy: string): number =>
  view.actions.filter((action) => action.kind === "question" && action.status === "pending" && action.askedBy === askedBy).length;

/** Ein Chip trägt ein Ausrufezeichen, wenn eine Host-Bestätigung oder eine Rückfrage des Actors auf eine Antwort wartet. */
export const elementNeedsAttention = (view: RunView | undefined, definition: CanvasElementDefinition, confirmationPending: boolean): boolean =>
  confirmationPending || (view !== undefined && definition.anchorActorId !== undefined && pendingQuestionCount(view, definition.anchorActorId) > 0);
