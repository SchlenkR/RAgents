import { DomainError, implement, implementChannel, type AccessContext, type ChannelContribution, type MethodContribution } from "@ragents/engine";
import type { OperationInput, OperationResult } from "@ragents/engine/src/rpc/contract";
import { processesContracts, type RunProcessMessage, type RunProcessSnapshot } from "../contract.js";

export type ForwardInput = OperationInput<typeof processesContracts.forward>;
export type ForwardResult = OperationResult<typeof processesContracts.forward>;

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
  /** Forwards in the run's executor, which checks the port against the run's processes. */
  forward: (input: ForwardInput, signal: AbortSignal) => Promise<ForwardResult>;
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
  implement(processesContracts.forward, (input, { access, signal }) => {
    assertRights(access, processesContracts.forward.rights, "Forwarding to a service of the run");
    options.ensureWorkspaceAccess(access, input.runId);
    return options.forward(input, signal);
  }),
];

export const createProcessChannel = (options: Pick<ProcessMethodOptions, "observer" | "ensureWorkspaceAccess">): ChannelContribution =>
  implementChannel(processesContracts.live, ({ runId }, emit, { access }) => {
    options.ensureWorkspaceAccess(access, runId);
    return options.observer.watch(runId, emit);
  });
