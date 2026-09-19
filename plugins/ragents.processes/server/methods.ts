import { DomainError, implement, implementChannel, type ChannelContribution, type MethodContribution } from "@aicontainer/ragents";
import { processesContracts, type RunProcessMessage, type RunProcessSnapshot } from "../contract.js";
import type { ProcessTerminationContext } from "./terminator.js";

export interface ProcessObservation {
  observe: (runId: string) => Promise<RunProcessSnapshot>;
  watch: (runId: string, listener: (message: RunProcessMessage) => void) => () => void;
}

export interface ProcessMethodOptions {
  observer: ProcessObservation;
  ensureSession: (runId: string) => void;
  terminate: (runId: string, processId: string, context: ProcessTerminationContext) => Promise<void>;
}

export const createProcessMethods = (options: ProcessMethodOptions): MethodContribution[] => [
  implement(processesContracts.snapshot, ({ runId }) => {
    options.ensureSession(runId);
    return options.observer.observe(runId);
  }),
  implement(processesContracts.stop, async ({ runId, processId }, { access, signal }) => {
    const assertAllowed = () => {
      for (const right of processesContracts.stop.rights) {
        if (!access.can(right)) throw new DomainError("forbidden", "Das Beenden von Prozessen ist nicht erlaubt", 403);
      }
      if (signal.aborted) throw new Error("Die Prozess-Stopp-Anfrage wurde abgebrochen");
      options.ensureSession(runId);
    };
    assertAllowed();
    await options.terminate(runId, processId, { signal, assertAllowed });
    return null;
  }),
];

export const createProcessChannel = (options: Pick<ProcessMethodOptions, "observer" | "ensureSession">): ChannelContribution =>
  implementChannel(processesContracts.live, ({ runId }, emit) => {
    options.ensureSession(runId);
    return options.observer.watch(runId, emit);
  });
