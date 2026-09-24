import { WorkspaceOperationError } from "../errors.js";
import type { WorkspaceModuleFactory } from "../module.js";
import { hasProcessTable, processTableForPlatform, type ProcessTable } from "./process-table.js";
import { ProcessScanner } from "./scanner.js";
import { RunProcessTerminator } from "./terminator.js";

export const PROCESS_OPERATIONS = {
  snapshot: "processes.snapshot",
  stop: "processes.stop",
  stopAll: "processes.stopAll",
} as const;

export interface ProcessModuleOptions {
  /** Die Prozesstabelle dieser Maschine; ohne Angabe die der Plattform, aufgelöst erst im Aufruf. */
  table?: () => ProcessTable;
}

const processIdOf = (input: unknown): string => {
  const value = (input as { processId?: unknown } | null)?.processId;
  if (typeof value !== "string") throw new WorkspaceOperationError("invalid-process", "Ungültige Prozessreferenz", 400);
  return value;
};

/** Die markierten Prozesse eines Runs auf dieser Maschine; ohne Prozesstabelle (Windows) räumt der Stopp nur die Bash-Bäume ab. */
export const processModule = (options: ProcessModuleOptions = {}): WorkspaceModuleFactory => () => {
  const table = options.table ?? (() => processTableForPlatform());
  const cleansUp = options.table !== undefined || hasProcessTable();
  const identity = { executorPid: process.pid, executorUid: process.getuid?.() };
  const scanner = new ProcessScanner({ table, ...identity });
  const terminator = (): RunProcessTerminator => new RunProcessTerminator({ table: table(), ...identity });
  const stopAll = async (runId: string, signal?: AbortSignal): Promise<null> => {
    if (cleansUp) await terminator().stopRun(runId, signal ? { signal } : {});
    return null;
  };
  return {
    operations: {
      [PROCESS_OPERATIONS.snapshot]: ({ runId }) => scanner.snapshot(runId),
      [PROCESS_OPERATIONS.stop]: async ({ runId, input, signal }) => {
        await terminator().stop(runId, processIdOf(input), signal ? { signal } : {});
        return null;
      },
      [PROCESS_OPERATIONS.stopAll]: ({ runId, signal }) => stopAll(runId, signal),
    },
    stopRun: async (runId) => {
      await stopAll(runId);
    },
  };
};
