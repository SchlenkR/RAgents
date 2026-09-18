import { isRecord } from "../lib/guards";
import { stopChatActor } from "../api";

export function stopChatWork(runId: string, view: unknown, stopStartup: () => Promise<void>): Promise<void> {
  return isRecord(view) && view.id === runId && typeof view.primaryActorId === "string"
    ? stopChatActor(runId, view.primaryActorId)
    : stopStartup();
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
