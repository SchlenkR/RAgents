import { DomainError, implement, implementChannel, type AccessContext, type ChannelContribution, type MethodContribution } from "@ragents/engine";
import { processesContracts, type RunProcessMessage, type RunProcessSnapshot } from "../contract.js";

export interface ProcessObservation {
  observe: (runId: string, signal?: AbortSignal) => Promise<RunProcessSnapshot>;
  watch: (runId: string, listener: (message: RunProcessMessage) => void) => () => void;
}

export interface ProcessMethodOptions {
  observer: ProcessObservation;
  /** Die Prozesse liegen im Arbeitsbereich des Runs; wer ihn nicht sehen darf, sieht auch sie nicht. */
  ensureWorkspaceAccess: (access: AccessContext, runId: string) => void;
  /** Beendet beim Executor des Runs; der Abbruch der Anfrage erreicht ihn über `signal`. */
  terminate: (runId: string, processId: string, signal: AbortSignal) => Promise<void>;
}

export const createProcessMethods = (options: ProcessMethodOptions): MethodContribution[] => [
  implement(processesContracts.snapshot, ({ runId }, { access, signal }) => {
    options.ensureWorkspaceAccess(access, runId);
    return options.observer.observe(runId, signal);
  }),
  implement(processesContracts.stop, async ({ runId, processId }, { access, signal }) => {
    for (const right of processesContracts.stop.rights) {
      if (!access.can(right)) throw new DomainError("forbidden", "Das Beenden von Prozessen ist nicht erlaubt", 403);
    }
    if (signal.aborted) throw new Error("Die Prozess-Stopp-Anfrage wurde abgebrochen");
    options.ensureWorkspaceAccess(access, runId);
    await options.terminate(runId, processId, signal);
    return null;
  }),
];

export const createProcessChannel = (options: Pick<ProcessMethodOptions, "observer" | "ensureWorkspaceAccess">): ChannelContribution =>
  implementChannel(processesContracts.live, ({ runId }, emit, { access }) => {
    options.ensureWorkspaceAccess(access, runId);
    return options.observer.watch(runId, emit);
  });
