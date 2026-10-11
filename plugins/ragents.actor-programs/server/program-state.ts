import type { RunView } from "@ragents/engine";
import { ACTOR_STATE_ID, type ActorProgramDefinition } from "@ragents/host/plugin-support/actor-programs/contract.js";
import type { ProgramStatus, ProgramWaiting } from "@ragents/host/plugin-support/actor-programs/program-runner.js";

/** What the host reads from a state-aware program's actor state: where it stands and when it wants to be woken. */
export interface ProgramSummary {
  readonly revision: string;
  readonly status: ProgramStatus;
  readonly waiting: ProgramWaiting | null;
  readonly wakeAt: string | null;
  readonly error: string | null;
  readonly damaged?: true;
}
/** start: the current revision never evaluated; the host wakes it now. */
export type ProgramWake = { readonly kind: "start" } | { readonly kind: "at"; readonly at: string } | null;

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const text = (value: unknown): string | null => typeof value === "string" ? value : null;

/** undefined before the first evaluation; a state of another shape counts as damaged and reports it as its error. */
export const programSummaryOf = (values: unknown): ProgramSummary | undefined => {
  if (!isRecord(values) || Object.keys(values).length === 0) return undefined;
  const statuses: readonly unknown[] = ["waiting", "done", "failed", "blocked"];
  if (values.version !== 1 || typeof values.revision !== "string" || !statuses.includes(values.status))
    return { revision: "", status: "blocked", waiting: null, wakeAt: null, error: "The program state is damaged.", damaged: true };
  const waiting = isRecord(values.waiting) ? values.waiting as unknown as ProgramWaiting : null;
  return { revision: values.revision, status: values.status as ProgramStatus, waiting, wakeAt: text(values.wakeAt), error: text(values.error) };
};

export const programValuesOf = (view: RunView, actorId: string): unknown =>
  view.pluginStates.find((entry) => entry.pluginId === ACTOR_STATE_ID && entry.scope.kind === "actor" && entry.scope.actorId === actorId)?.state;

/** When a state-aware program wants its next evaluation: at once for a revision it has not evaluated, its wake time, or never while blocked by this revision. */
export const programWakeOf = (view: RunView, program: ActorProgramDefinition): ProgramWake => {
  if (!program.stateAware) return null;
  const summary = programSummaryOf(programValuesOf(view, program.actorId));
  if (!summary) return { kind: "start" };
  if (summary.status === "blocked" && (summary.damaged || summary.revision === program.revision)) return null;
  if (summary.revision !== program.revision) return { kind: "start" };
  return summary.wakeAt ? { kind: "at", at: summary.wakeAt } : null;
};
