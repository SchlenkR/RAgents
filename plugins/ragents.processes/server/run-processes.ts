import { PROCESS_OPERATIONS } from "@ragents/workspace-executor";
import type { SandboxServices } from "@ragents/host/plugin-support/workspace-sandbox-host.js";
import type { RunProcessSnapshot } from "../contract.js";

export interface RunProcesses {
  snapshot: (runId: string, signal?: AbortSignal) => Promise<RunProcessSnapshot>;
  terminate: (runId: string, processId: string, signal: AbortSignal) => Promise<void>;
  /** Ist der Arbeitsplatz nicht erreichbar, holt der Stopp des Runs (`stopRun` seines Executors) das Beenden nach, sobald er wieder da ist. */
  stopAll: (runId: string, signal?: AbortSignal) => Promise<void>;
}

/** Die Prozesse eines Runs liegen beim Executor, der ihn ausführt; wo das ist, entscheidet allein seine Bindung. */
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
