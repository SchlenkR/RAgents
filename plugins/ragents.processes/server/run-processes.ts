import { PROCESS_OPERATIONS } from "@ragents/workspace-executor";
import type { SandboxServices } from "@ragents/host/plugin-support/workspace-sandbox-host.js";
import type { RunProcessSnapshot } from "../contract.js";

export interface RunProcesses {
  snapshot: (runId: string, signal?: AbortSignal) => Promise<RunProcessSnapshot>;
  terminate: (runId: string, processId: string, signal: AbortSignal) => Promise<void>;
  /** If the workspace is unreachable, the run's stop (`stopRun` of its executor) catches up on ending once it is back. */
  stopAll: (runId: string, signal?: AbortSignal) => Promise<void>;
}

/** A run's processes live at the executor running it; where that is is decided solely by its binding. */
export const runProcessesOf = (sandbox: Pick<SandboxServices, "execute">): RunProcesses => ({
  snapshot: async (runId, signal) => {
    const observed = await sandbox.execute(runId, PROCESS_OPERATIONS.snapshot, {}, signal ? { signal } : {}) as Omit<RunProcessSnapshot, "runId">;
    return { runId, ...observed };
  },
  terminate: async (runId, processId, signal) => {
    await sandbox.execute(runId, PROCESS_OPERATIONS.stop, { processId }, { signal });
  },
  stopAll: async (runId, signal) => {
    await sandbox.execute(runId, PROCESS_OPERATIONS.stopAll, {}, { whenReachable: true, ...(signal ? { signal } : {}) });
  },
});
