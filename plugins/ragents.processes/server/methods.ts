import { DomainError, implement, implementChannel, type AccessContext, type ChannelContribution, type MethodContribution } from "@ragents/engine";
import { processesContracts, type RunProcessMessage, type RunProcessSnapshot } from "../contract.js";

export interface ProcessObservation {
  observe: (runId: string, signal?: AbortSignal) => Promise<RunProcessSnapshot>;
  watch: (runId: string, listener: (message: RunProcessMessage) => void) => () => void;
}

export interface ProcessMethodOptions {
  observer: ProcessObservation;
  /** The processes live in the run's workspace; whoever may not see it does not see them either. */
  ensureWorkspaceAccess: (access: AccessContext, runId: string) => void;
  /** Ends in the run's executor; cancelling the request reaches it via `signal`. */
  terminate: (runId: string, processId: string, signal: AbortSignal) => Promise<void>;
}

export const createProcessMethods = (options: ProcessMethodOptions): MethodContribution[] => [
  implement(processesContracts.snapshot, ({ runId }, { access, signal }) => {
    options.ensureWorkspaceAccess(access, runId);
    return options.observer.observe(runId, signal);
  }),
  implement(processesContracts.stop, async ({ runId, processId }, { access, signal }) => {
    for (const right of processesContracts.stop.rights) {
      if (!access.can(right)) throw new DomainError("forbidden", "Ending processes is not allowed", 403);
    }
    if (signal.aborted) throw new Error("The process stop request was cancelled");
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
