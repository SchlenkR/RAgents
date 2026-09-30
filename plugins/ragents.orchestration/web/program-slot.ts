import { createContext, useContext, type ReactNode } from "react";
import type { RunView } from "@ragents/web/run-view";

/** What an actor-program extension adds to the run panel and the inspector; without one both show no programs. */
export interface ProgramSlot {
  runId: string;
  source: (view: RunView, actorId: string) => ReactNode;
}

export const ProgramSlotContext = createContext<ProgramSlot | undefined>(undefined);
export const useProgramSlot = () => useContext(ProgramSlotContext);
