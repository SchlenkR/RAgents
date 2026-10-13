import { createServer, type Server } from "node:net";
import type { WorkspaceProcessContext } from "./context.js";
import { WorkspaceOperationError } from "./errors.js";

/** A program with its arguments, as it is started. */
export interface ProcessLaunch {
  readonly command: string;
  readonly args: readonly string[];
}

/** How an executor puts the processes of a run into its sandbox; the context carries it, every start asks it. */
export interface ProcessSandbox {
  readonly wrap: (launch: ProcessLaunch) => Promise<ProcessLaunch>;
  readonly publishPorts?: (launch: ProcessLaunch, ports: readonly number[]) => Promise<PublishedProcessLaunch>;
}

export interface PublishedProcessLaunch {
  readonly launch: ProcessLaunch;
  readonly close: () => Promise<void>;
}

export const checkedPublishedPorts = (value: unknown): readonly number[] => {
  if (!Array.isArray(value)) throw new WorkspaceOperationError("process-port-invalid", "Published ports must be an array of TCP ports", 400);
  const ports = [...value];
  for (const port of ports) {
    if (typeof port !== "number" || !Number.isInteger(port) || port < 1 || port > 65535) {
      throw new WorkspaceOperationError("process-port-invalid", `Invalid published port ${String(port)}; use an integer from 1 to 65535`, 400);
    }
  }
  if (new Set(ports).size !== ports.length) throw new WorkspaceOperationError("process-port-invalid", "Published ports must be distinct", 400);
  return ports;
};

export const listenLoopback = (server: Server, port: number): Promise<void> => new Promise((resolve, reject) => {
  server.once("error", (error: NodeJS.ErrnoException) => reject(new WorkspaceOperationError(
    error.code === "EADDRINUSE" ? "process-port-in-use" : "process-port-unavailable",
    `Cannot publish loopback TCP port ${port}: ${error.message}`, 409,
  )));
  server.listen({ host: "127.0.0.1", port, exclusive: true }, resolve);
});

export const closeListener = (server: Server): Promise<void> => new Promise((resolve, reject) => {
  if (!server.listening) return resolve();
  server.close((error) => error ? reject(error) : resolve());
});

export const checkAvailablePorts = async (ports: readonly number[]): Promise<void> => {
  const servers = ports.map(() => createServer((socket) => socket.destroy()));
  try {
    for (const [index, port] of ports.entries()) await listenLoopback(servers[index]!, port);
  } finally {
    await Promise.all(servers.map(closeListener));
  }
};

/** Owns published listeners until the managed process and its children have ended. */
export const withSandboxedLaunch = async <T>(
  context: WorkspaceProcessContext,
  launch: ProcessLaunch,
  ports: readonly number[],
  execute: (launch: ProcessLaunch) => Promise<T>,
): Promise<T> => {
  const checked = checkedPublishedPorts(ports);
  if (checked.length === 0) return execute(await sandboxedLaunch(context, launch));
  if (!context.sandbox) {
    await checkAvailablePorts(checked);
    return execute(launch);
  }
  if (!context.sandbox.publishPorts) {
    throw new WorkspaceOperationError("process-port-unsupported", "This process sandbox does not support publishing loopback TCP ports", 409);
  }
  const published = await context.sandbox.publishPorts(launch, checked);
  try {
    return await execute(published.launch);
  } finally {
    await published.close();
  }
};

/** The start of a process in the context of a run: wrapped with a sandbox, unchanged without one. */
export const sandboxedLaunch = (context: WorkspaceProcessContext, launch: ProcessLaunch): Promise<ProcessLaunch> =>
  context.sandbox ? context.sandbox.wrap(launch) : Promise.resolve(launch);
