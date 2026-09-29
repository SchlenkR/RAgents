import { isRecord } from "../lib/guards";
import { chatPrimaryId, runViewFrom, type RunActor } from "../run-view";

/** The partner of the run chat: stopped with a reason, or active and whether its own turn is running; only that one is interrupted by the input. */
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

export const programChatNotice = "This TypeScript actor processes program input and does not hold a conversation. Use its mini-app or its documented functions.";

export function primaryIsProgram(view: unknown, runId: string): boolean {
  return isRecord(view) && view.id === runId && Array.isArray(view.actors)
    && view.actors.some((actor: unknown) => isRecord(actor) && actor.id === view.primaryActorId && actor.kind === "script");
}

/** Running turn of any agent or program; the run list uses the same reading. */
export function runIsWorking(view: unknown, runId: string): boolean {
  return isRecord(view) && view.id === runId && Array.isArray(view.actors)
    && view.actors.some((actor: unknown) => isRecord(actor) && actor.kind !== "human" && isRecord(actor.lifecycle) && actor.lifecycle.kind === "running");
}
