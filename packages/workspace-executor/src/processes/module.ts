import { WorkspaceOperationError } from "../errors.js";
import type { WorkspaceModuleFactory } from "../module.js";
import { forwardInputOf, forwardRequest } from "./forward.js";
import { hasProcessTable, processTableForPlatform, type ProcessTable } from "./process-table.js";
import { ProcessScanner, type WorkspaceProcessSnapshot } from "./scanner.js";
import { RunProcessTerminator } from "./terminator.js";

export const PROCESS_OPERATIONS = {
  snapshot: "processes.snapshot",
  stop: "processes.stop",
  stopAll: "processes.stopAll",
  forward: "processes.forward",
} as const;

/** How long a scan answers which ports belong to a run before the next forwarding scans again; the tick of the process rail. */
export const SERVICE_PORTS_TTL_MS = 2_000;

export interface ProcessModuleOptions {
  /** The process table of this machine; without a value the one of the platform, resolved only at the call. */
  table?: () => ProcessTable;
  /** The clock of the port check; tests set their own. */
  now?: () => number;
}

interface ServicePorts {
  readonly at: number;
  readonly ports: Promise<ReadonlyMap<number, readonly string[]>>;
}

const processIdOf = (input: unknown): string => {
  const value = (input as { processId?: unknown } | null)?.processId;
  if (typeof value !== "string") throw new WorkspaceOperationError("invalid-process", "Invalid process reference", 400);
  return value;
};

/** Per port the addresses the run's processes listen on. */
const portsOf = (snapshot: WorkspaceProcessSnapshot): ReadonlyMap<number, readonly string[]> => {
  const listeners = snapshot.processes.flatMap((entry) => entry.ports);
  return new Map(listeners.map(({ port }) => [port, listeners.filter((listener) => listener.port === port).map(({ address }) => address)]));
};

/** The marked processes of a run on this machine; without a process table (Windows) the stop only clears the bash trees. */
export const processModule = (options: ProcessModuleOptions = {}): WorkspaceModuleFactory => () => {
  const table = options.table ?? (() => processTableForPlatform());
  const now = options.now ?? Date.now;
  const cleansUp = options.table !== undefined || hasProcessTable();
  const identity = { executorPid: process.pid, executorUid: process.getuid?.() };
  const scanner = new ProcessScanner({ table, ...identity });
  const terminator = (): RunProcessTerminator => new RunProcessTerminator({ table: table(), ...identity });
  const servicePorts = new Map<string, ServicePorts>();
  const stopAll = async (runId: string, signal?: AbortSignal): Promise<null> => {
    servicePorts.delete(runId);
    if (cleansUp) await terminator().stopRun(runId, signal ? { signal } : {});
    return null;
  };
  /** A page loads many files at once; they share one scan instead of each asking the process table. */
  const portsOfRun = (runId: string): ServicePorts["ports"] => {
    const known = servicePorts.get(runId);
    if (known && now() - known.at < SERVICE_PORTS_TTL_MS) return known.ports;
    const ports = scanner.snapshot(runId).then(portsOf);
    const entry = { at: now(), ports };
    servicePorts.set(runId, entry);
    ports.catch(() => { if (servicePorts.get(runId) === entry) servicePorts.delete(runId); });
    return ports;
  };
  const addressesOf = async (runId: string, port: number): Promise<readonly string[]> => {
    const addresses = (await portsOfRun(runId)).get(port);
    if (!addresses) {
      throw new WorkspaceOperationError("forward-port-unknown", `No process of run ${runId} listens on port ${port} on this machine`, 404);
    }
    return addresses;
  };
  return {
    operations: {
      [PROCESS_OPERATIONS.snapshot]: ({ runId }) => scanner.snapshot(runId),
      [PROCESS_OPERATIONS.stop]: async ({ runId, input, signal }) => {
        await terminator().stop(runId, processIdOf(input), signal ? { signal } : {});
        return null;
      },
      [PROCESS_OPERATIONS.stopAll]: ({ runId, signal }) => stopAll(runId, signal),
      [PROCESS_OPERATIONS.forward]: async ({ runId, input, signal }) => {
        const { port, request } = forwardInputOf(input);
        const addresses = await addressesOf(runId, port);
        return request === null ? null : forwardRequest({ port, addresses, request, signal });
      },
    },
    stopRun: async (runId) => {
      await stopAll(runId);
    },
  };
};
