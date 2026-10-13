import { notShared, type Journal, type RunSharing, type RunState, type StartOptionContributionRegistry } from "@ragents/engine";
import { storedStartOption } from "./start-option-state.js";

/** Reads a run without cloning its state; a locked run is read from the state it kept, if any. */
const readRun = <Value>(journal: Journal, runId: string, read: (state: RunState | null) => Value): Value =>
  journal.failureOf(runId) || !journal.hasRun(runId) ? read(journal.stateOf(runId)) : journal.select(runId, read) as Value;

/** A run's user from its journal: null without owner and for a locked journal without state, undefined for an id without a run. */
export const runOwnerOf = (journal: Journal, runId: string): string | null | undefined =>
  readRun(journal, runId, (state) => state ? state.ownerUserId : journal.failureOf(runId) ? null : undefined);

/** Whom a run is shared with from its journal; nobody for an id without a run and for a locked journal without state. */
export const runSharingOf = (journal: Journal, runId: string): RunSharing =>
  readRun(journal, runId, (state) => state?.sharing ?? notShared());

/** Only the owner operates a run whose stored start option declares this for its value. */
export const runOwnerOnly = (journal: Journal, startOptions: StartOptionContributionRegistry, runId: string): boolean =>
  readRun(journal, runId, (state) => startOptions.entries().some(({ option }) => {
    const chosen = storedStartOption(state, option.id);
    return chosen !== undefined && option.ownerOnly?.(chosen) === true;
  }));
