import type { Journal, StartOptionContributionRegistry } from "@ragents/engine";
import { storedStartOption } from "./start-option-state.js";

/** Der Benutzer eines Runs aus seinem Journal: null ohne Eigentümer, undefined für eine Kennung ohne Run. */
export const runOwnerOf = (journal: Journal, runId: string): string | null | undefined => {
  const state = journal.stateOf(runId);
  return state ? state.ownerUserId : undefined;
};

/** Nur der Eigentümer bedient einen Run, dessen gespeicherte Startoption das für ihren Wert erklärt. */
export const runOwnerOnly = (journal: Journal, startOptions: StartOptionContributionRegistry, runId: string): boolean => {
  const state = journal.stateOf(runId);
  return startOptions.entries().some(({ option }) => {
    const chosen = storedStartOption(state, option.id);
    return chosen !== undefined && option.ownerOnly?.(chosen) === true;
  });
};
