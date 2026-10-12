import { isRecord } from "../lib/guards";
import { chatPrimaryId, isPendingRunActorInput, runViewFrom, type RunActor } from "../run-view";

/** The partner of the run chat: none, stopped with its reason, or active. */
export type PrimaryChatState =
  | { kind: "none" }
  | { kind: "stopped"; actor: RunActor }
  | { kind: "active" };

export function primaryChatState(value: unknown, runId: string): PrimaryChatState {
  const view = runViewFrom(value);
  const partnerId = view && view.id === runId ? chatPrimaryId(view) : null;
  const actor = partnerId === null ? undefined : view?.actors.find((entry) => entry.id === partnerId);
  if (!actor || actor.kind === "human") return { kind: "none" };
  if (actor.lifecycle?.kind === "stopped") return { kind: "stopped", actor };
  return { kind: "active" };
}

export const programChatNotice = "This TypeScript actor processes program input and does not hold a conversation. Use its mini-app or its documented functions.";

export function primaryIsProgram(view: unknown, runId: string): boolean {
  return isRecord(view) && view.id === runId && Array.isArray(view.actors)
    && view.actors.some((actor: unknown) => isRecord(actor) && actor.id === view.primaryActorId && actor.kind === "script");
}

/** A stopped run with the number of waiting inputs of its active actors. */
export function runStopped(value: unknown, runId: string): { waiting: number } | undefined {
  const view = runViewFrom(value);
  if (!view || view.id !== runId || !view.stopped) return undefined;
  const active = new Set(view.actors.filter((actor) => actor.kind !== "human" && actor.lifecycle?.kind !== "stopped").map((actor) => actor.id));
  return { waiting: view.inputs.filter((input) => isPendingRunActorInput(input) && active.has(input.actorId)).length };
}

export const stoppedRunText = (waiting: number): string =>
  waiting === 0 ? "Stopped" : `Stopped - ${waiting} ${waiting === 1 ? "input" : "inputs"} waiting`;
