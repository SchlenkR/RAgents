import { notShared, type Journal, type RunSharing, type StartOptionContributionRegistry } from "@ragents/engine";
import { storedStartOption } from "./start-option-state.js";

/** A run's user from its journal: null without owner and for a locked journal without state, undefined for an id without a run. */
export const runOwnerOf = (journal: Journal, runId: string): string | null | undefined => {
  const state = journal.stateOf(runId);
  if (state) return state.ownerUserId;
  return journal.failureOf(runId) ? null : undefined;
};

/** Whom a run is shared with from its journal; nobody for an id without a run and for a locked journal without state. */
export const runSharingOf = (journal: Journal, runId: string): RunSharing => journal.stateOf(runId)?.sharing ?? notShared();

/** Only the owner operates a run whose stored start option declares this for its value. */
export const runOwnerOnly = (journal: Journal, startOptions: StartOptionContributionRegistry, runId: string): boolean => {
  const state = journal.stateOf(runId);
  return startOptions.entries().some(({ option }) => {
    const chosen = storedStartOption(state, option.id);
    return chosen !== undefined && option.ownerOnly?.(chosen) === true;
  });
};
