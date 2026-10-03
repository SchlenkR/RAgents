import { PROCESS_OPERATIONS } from "@ragents/workspace-executor";
import type { SandboxServices } from "@ragents/host/plugin-support/workspace-sandbox-host.js";
import type { WorkspacePlacement } from "@ragents/host/ragents/workspace-runtime.js";
import type { RunProcessMachine, RunProcessSnapshot } from "../contract.js";

export interface RunProcesses {
  snapshot: (runId: string, signal?: AbortSignal) => Promise<RunProcessSnapshot>;
  terminate: (runId: string, processId: string, signal: AbortSignal) => Promise<void>;
  /** If the workspace is unreachable, the run's stop (`stopRun` of its executor) catches up on ending once it is back. */
  stopAll: (runId: string, signal?: AbortSignal) => Promise<void>;
  /** The run's executor checks the port against the run's processes; with a stream it connects to the port and opens its leg at that path on the server. */
  dial: (runId: string, port: number, stream: string | null, signal: AbortSignal) => Promise<void>;
}

export const machineOf = (placement: WorkspacePlacement): RunProcessMachine =>
  placement.machine === "server" ? "server" : { client: placement.workstation.client, label: placement.workstation.label };

/** A run's processes live at the executor running it; where that is is decided solely by its binding. */
export const runProcessesOf = (sandbox: Pick<SandboxServices, "execute">, placementOf: (runId: string) => WorkspacePlacement): RunProcesses => ({
  snapshot: async (runId, signal) => {
    const observed = await sandbox.execute(runId, PROCESS_OPERATIONS.snapshot, {}, signal ? { signal } : {}) as Omit<RunProcessSnapshot, "runId" | "machine">;
    return { runId, machine: machineOf(placementOf(runId)), ...observed };
  },
  terminate: async (runId, processId, signal) => {
    await sandbox.execute(runId, PROCESS_OPERATIONS.stop, { processId }, { signal });
  },
  stopAll: async (runId, signal) => {
    await sandbox.execute(runId, PROCESS_OPERATIONS.stopAll, {}, { whenReachable: true, ...(signal ? { signal } : {}) });
  },
  dial: async (runId, port, stream, signal) => {
    await sandbox.execute(runId, PROCESS_OPERATIONS.dial, { port, stream }, { signal });
  },
});
