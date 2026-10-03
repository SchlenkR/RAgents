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
  /** Asks the run's executor whether a process of the run listens on the port. */
  checkPort: (runId: string, port: number, signal: AbortSignal) => Promise<void>;
  /** Opens a stream to the port; the run's executor dials back before the path of the caller's leg comes back. */
  openStream: (runId: string, port: number, signal: AbortSignal) => Promise<{ path: string }>;
}

const assertRights = (access: AccessContext, rights: readonly string[], action: string): void => {
  for (const right of rights) {
    if (!access.can(right)) throw new DomainError("forbidden", `${action} is not allowed`, 403);
  }
};

export const createProcessMethods = (options: ProcessMethodOptions): MethodContribution[] => [
  implement(processesContracts.snapshot, ({ runId }, { access, signal }) => {
    options.ensureWorkspaceAccess(access, runId);
    return options.observer.observe(runId, signal);
  }),
  implement(processesContracts.stop, async ({ runId, processId }, { access, signal }) => {
    assertRights(access, processesContracts.stop.rights, "Ending processes");
    if (signal.aborted) throw new Error("The process stop request was cancelled");
    options.ensureWorkspaceAccess(access, runId);
    await options.terminate(runId, processId, signal);
    return null;
  }),
  implement(processesContracts.tunnel, async ({ runId, port, connect }, { access, signal }) => {
    assertRights(access, processesContracts.tunnel.rights, "Opening a service of the run");
    options.ensureWorkspaceAccess(access, runId);
    if (connect) return options.openStream(runId, port, signal);
    await options.checkPort(runId, port, signal);
    return null;
  }),
];

export const createProcessChannel = (options: Pick<ProcessMethodOptions, "observer" | "ensureWorkspaceAccess">): ChannelContribution =>
  implementChannel(processesContracts.live, ({ runId }, emit, { access }) => {
    options.ensureWorkspaceAccess(access, runId);
    return options.observer.watch(runId, emit);
  });
