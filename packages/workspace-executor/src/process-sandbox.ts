import { createServer, isIP, type Server } from "node:net";
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
  readonly tcpEndpoints?: (forwards: readonly TcpForward[]) => Promise<readonly TcpEndpoint[]>;
  readonly forwardTcp?: (launch: ProcessLaunch, forwards: readonly TcpForward[], ports: readonly number[]) => Promise<PublishedProcessLaunch>;
}

export interface TcpEndpoint {
  readonly host: string;
  readonly port: number;
}

export interface TcpForward extends TcpEndpoint {
  readonly insidePort: number;
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

export const checkedTcpForwards = (value: unknown, publishedPorts: readonly number[] = []): readonly TcpForward[] => {
  if (!Array.isArray(value)) throw new WorkspaceOperationError("process-tcp-invalid", "TCP forwards must be an array of host, port and insidePort targets", 400);
  const forwards = value.map((entry: unknown): TcpForward => {
    const target = entry as Partial<TcpForward> | null;
    const host = target?.host;
    const validHost = typeof host === "string" && !host.includes("%") && (isIP(host) !== 0 || (host.length <= 253
      && host.split(".").every((label) => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i.test(label))));
    const validPort = (port: unknown): port is number => typeof port === "number" && Number.isInteger(port) && port >= 1 && port <= 65535;
    if (!validHost || !validPort(target?.port) || !validPort(target?.insidePort)) {
      throw new WorkspaceOperationError("process-tcp-invalid", `Invalid TCP forward ${String(host)}:${String(target?.port)}; use a host and TCP ports from 1 to 65535`, 400);
    }
    return { host, port: target.port, insidePort: target.insidePort };
  });
  const ports = forwards.map((target) => target.insidePort);
  if (new Set(ports).size !== ports.length || ports.some((port) => publishedPorts.includes(port))) {
    throw new WorkspaceOperationError("process-tcp-invalid", "TCP inside ports must be distinct and must not overlap published ports", 400);
  }
  return forwards;
};

export const tcpEndpoints = (context: WorkspaceProcessContext, forwards: readonly TcpForward[]): Promise<readonly TcpEndpoint[]> => {
  if (!context.sandbox) return Promise.resolve(forwards.map(({ host, port }) => ({ host, port })));
  if (!context.sandbox.tcpEndpoints) {
    throw new WorkspaceOperationError("process-tcp-unsupported", "This process sandbox does not support outbound TCP forwards", 409);
  }
  return context.sandbox.tcpEndpoints(forwards);
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

/** Owns TCP bridges until the managed process and its children have ended. */
export const withSandboxedLaunch = async <T>(
  context: WorkspaceProcessContext,
  launch: ProcessLaunch,
  ports: readonly number[],
  execute: (launch: ProcessLaunch) => Promise<T>,
  forwards: readonly TcpForward[] = [],
): Promise<T> => {
  const checked = checkedPublishedPorts(ports);
  const targets = checkedTcpForwards(forwards, checked);
  if (targets.length > 0 && context.sandbox) {
    if (!context.sandbox.forwardTcp) {
      throw new WorkspaceOperationError("process-tcp-unsupported", "This process sandbox does not support outbound TCP forwards", 409);
    }
    const prepared = await context.sandbox.forwardTcp(launch, targets, checked);
    try { return await execute(prepared.launch); }
    finally { await prepared.close(); }
  }
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
