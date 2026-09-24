import { isRecord } from "../lib/guards";
import { chatPrimaryId, runViewFrom, type RunActor } from "../run-view";

/** Der Partner des Run-Chats: gestoppt mit Grund, oder aktiv und ob gerade sein eigener Turn läuft; nur den unterbricht die Eingabe. */
export type PrimaryChatState =
  | { kind: "none" }
  | { kind: "stopped"; actor: RunActor }
  | { kind: "active"; actorId: string; turnRunning: boolean };

export function primaryChatState(value: unknown, runId: string, liveTurn: boolean): PrimaryChatState {
  const view = runViewFrom(value);
  const partnerId = view && view.id === runId ? chatPrimaryId(view) : null;
  const actor = partnerId === null ? undefined : view?.actors.find((entry) => entry.id === partnerId);
  if (!actor || actor.kind === "human") return { kind: "none" };
  if (actor.lifecycle?.kind === "stopped") return { kind: "stopped", actor };
  return { kind: "active", actorId: actor.id, turnRunning: liveTurn || actor.lifecycle?.kind === "running" };
}

export const programChatNotice = "Dieser TypeScript-Actor verarbeitet Programmeingaben und führt kein Gespräch. Verwende seine Mini-App oder seine dokumentierten Funktionen.";

export function primaryIsProgram(view: unknown, runId: string): boolean {
  return isRecord(view) && view.id === runId && Array.isArray(view.actors)
    && view.actors.some((actor: unknown) => isRecord(actor) && actor.id === view.primaryActorId && actor.kind === "script");
}

/** Laufender Turn irgendeines Agenten oder Programms; die Run-Liste verwendet dieselbe Lesart. */
export function runIsWorking(view: unknown, runId: string): boolean {
  return isRecord(view) && view.id === runId && Array.isArray(view.actors)
    && view.actors.some((actor: unknown) => isRecord(actor) && actor.kind !== "human" && isRecord(actor.lifecycle) && actor.lifecycle.kind === "running");
}
