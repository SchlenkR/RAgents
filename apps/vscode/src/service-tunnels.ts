import { createServer, type AddressInfo, type Server, type Socket } from "node:net";
import { setTimeout as delay } from "node:timers/promises";
import { Type, type TUnsafe } from "typebox";
import { openTunnelLeg, pipeTunnel, tunnelAddress, type TunnelStream } from "@ragents/workspace-executor/src/processes/tunnel";
import { defineOperation, type OperationContract } from "../../../packages/ragents/src/rpc/contract";
import { RPC_ERROR_CODES, RpcError } from "../../../packages/ragents/src/rpc/protocol";
import type { RpcClient } from "../../web/src/rpc/client";
import type { RunService, ServiceTunnelInput, ServiceTunnelResult } from "../../web/src/run-panel/host-contract";

/** How often an open tunnel asks whether a process of its run still listens on the port. */
const CHECK_INTERVAL_MS = 5_000;

type TunnelContract = OperationContract<TUnsafe<ServiceTunnelInput>, TUnsafe<ServiceTunnelResult>>;

/** What a tunnel needs of a server connection: the address its legs connect to and the message layer. */
export interface TunnelServer {
  readonly origin: string;
  readonly rpc: RpcClient;
}

export interface ServiceTunnelsOptions {
  log: (line: string) => void;
  checkIntervalMs?: number;
}

interface Listening {
  readonly server: Server;
  readonly localPort: number;
}

/** A tunnel from a local port to a port of a run: every accepted connection becomes a stream through the server the run belongs to. */
interface Tunnel {
  readonly key: string;
  readonly connection: string;
  readonly server: TunnelServer;
  readonly service: RunService;
  readonly contract: TunnelContract;
  readonly closed: AbortController;
  readonly listening: Promise<Listening>;
  readonly sockets: Set<Socket>;
  readonly streams: Set<TunnelStream>;
}

const messageOf = (cause: unknown): string => cause instanceof Error ? cause.message : String(cause);

/** A service runs on this machine on this window's workstation, or on the server when that is the extension's own host. */
export const serviceOnThisMachine = (service: RunService, here: { ownHost: boolean; workstation: string | undefined }): boolean =>
  service.workstation === null ? here.ownHost : service.workstation === here.workstation;

const keyOf = (connection: string, { runId, port }: RunService): string => JSON.stringify([connection, runId, port]);

const tunnelContract = (id: string): TunnelContract => defineOperation({
  id,
  description: "Opens a byte stream to a service of a run.",
  input: Type.Unsafe<ServiceTunnelInput>({}),
  result: Type.Unsafe<ServiceTunnelResult>({}),
});

/** The server answered that the port, the run, the access, or the tunnel itself is gone; asking again does not help. */
const gone = (cause: unknown): boolean => cause instanceof RpcError
  && (cause.code === RPC_ERROR_CODES.methodNotFound || cause.status === 403 || cause.status === 404);

/** The answer comes from the server; it is checked before a leg connects to it. */
const pathOf = (value: ServiceTunnelResult): string => {
  const path = (value as { path?: unknown } | null)?.path;
  if (typeof path !== "string" || !path.startsWith("/")) throw new Error("The server answered the opening of the stream without a path for its leg");
  return path;
};

const kilobytes = (bytes: number): string => `${(bytes / 1024).toFixed(1)} KB`;

const listen = (server: Server, port: number): Promise<number> => new Promise((resolve, reject) => {
  const failed = (error: Error): void => reject(error);
  server.once("error", failed);
  server.listen(port, "127.0.0.1", () => {
    server.off("error", failed);
    resolve((server.address() as AddressInfo).port);
  });
});

/** The same port number as on the run's machine keeps absolute addresses of the service valid; if it is taken here, a free one. */
const listenOnPort = async (server: Server, port: number): Promise<number> => {
  try {
    return await listen(server, port);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code !== "EADDRINUSE" && code !== "EACCES") throw error;
    return listen(server, 0);
  }
};

/** VS Code as the forwarding client: a local listener per service of a run, each connection a byte stream through the run's server to the run's machine. */
export class ServiceTunnels {
  readonly #log: (line: string) => void;
  readonly #checkIntervalMs: number;
  readonly #tunnels = new Map<string, Tunnel>();

  constructor(options: ServiceTunnelsOptions) {
    this.#log = options.log;
    this.#checkIntervalMs = options.checkIntervalMs ?? CHECK_INTERVAL_MS;
  }

  /** The local port of the service; a second call reuses the open tunnel. The server first confirms that a process of the run listens on the port. */
  async open(connection: string, server: TunnelServer, service: RunService): Promise<number> {
    const key = keyOf(connection, service);
    const known = this.#tunnels.get(key);
    if (known?.server.rpc === server.rpc) return (await known.listening).localPort;
    if (known) this.#close(known, "the server connection was renewed");
    const closed = new AbortController();
    const contract = tunnelContract(service.tunnel);
    const tunnel: Tunnel = {
      key, connection, server, service, contract, closed,
      listening: this.#listen(server, service, contract, closed.signal, (socket) => this.#stream(tunnel, socket)),
      sockets: new Set(),
      streams: new Set(),
    };
    this.#tunnels.set(key, tunnel);
    try {
      const { localPort } = await tunnel.listening;
      this.#log(`== Forwarding localhost:${localPort} to port ${service.port} of run ${service.runId} on ${connection}`);
      void this.#watch(tunnel);
      return localPort;
    } catch (cause) {
      if (this.#tunnels.get(key) === tunnel) this.#tunnels.delete(key);
      throw cause;
    }
  }

  /** Ends every tunnel whose server connection is gone or no longer uses the client the tunnel was opened with. */
  retain(clientOf: (connection: string) => RpcClient | undefined): void {
    for (const tunnel of [...this.#tunnels.values()]) {
      if (clientOf(tunnel.connection) !== tunnel.server.rpc) this.#close(tunnel, `the connection to ${tunnel.connection} ended`);
    }
  }

  async dispose(): Promise<void> {
    const tunnels = [...this.#tunnels.values()];
    for (const tunnel of tunnels) this.#close(tunnel, "the extension ends");
    await Promise.allSettled(tunnels.map((tunnel) => tunnel.listening));
  }

  async #listen(
    server: TunnelServer,
    service: RunService,
    contract: TunnelContract,
    signal: AbortSignal,
    accept: (socket: Socket) => Promise<void>,
  ): Promise<Listening> {
    await server.rpc.call(contract, { runId: service.runId, port: service.port, connect: false }, { signal });
    const listener = createServer({ allowHalfOpen: true, pauseOnConnect: true }, (socket) => { void accept(socket); });
    const localPort = await listenOnPort(listener, service.port);
    if (signal.aborted) {
      listener.close();
      throw new Error(`The forwarding of port ${service.port} was closed while it started`);
    }
    return { server: listener, localPort };
  }

  /** One accepted connection: the server opens a stream to the service, then this side connects its leg and pipes the bytes. */
  async #stream(tunnel: Tunnel, socket: Socket): Promise<void> {
    const { runId, port } = tunnel.service;
    const label = `from local port ${socket.remotePort ?? "?"} to port ${port} of run ${runId.slice(0, 8)}`;
    tunnel.sockets.add(socket);
    socket.on("error", () => undefined);
    socket.once("close", () => tunnel.sockets.delete(socket));
    const { signal } = tunnel.closed;
    try {
      const opened = await tunnel.server.rpc.call(tunnel.contract, { runId, port, connect: true }, { signal });
      const leg = await openTunnelLeg(tunnelAddress(tunnel.server.origin, pathOf(opened)), signal);
      const stream = pipeTunnel(socket, leg);
      tunnel.streams.add(stream);
      this.#log(`== Stream ${label} opened`);
      const { sent, received, error } = await stream.closed;
      tunnel.streams.delete(stream);
      this.#log(`== Stream ${label} closed: ${kilobytes(sent)} sent, ${kilobytes(received)} received${error === undefined ? "" : `, ${error}`}`);
    } catch (cause) {
      socket.destroy();
      if (signal.aborted) return;
      this.#log(`== Stream ${label} failed: ${messageOf(cause)}`);
      if (gone(cause)) this.#close(tunnel, messageOf(cause));
    }
  }

  /** Asks at intervals whether the port still belongs to the run; ends the tunnel once the run stopped or the process is gone. */
  async #watch(tunnel: Tunnel): Promise<void> {
    const { signal } = tunnel.closed;
    try {
      for (;;) {
        await delay(this.#checkIntervalMs, undefined, { signal, ref: false });
        const failure = await tunnel.server.rpc.call(tunnel.contract, { runId: tunnel.service.runId, port: tunnel.service.port, connect: false }, { signal })
          .then(() => undefined, (cause: unknown) => cause);
        if (signal.aborted) return;
        if (gone(failure)) this.#close(tunnel, messageOf(failure));
      }
    } catch (cause) {
      if (!signal.aborted) this.#log(`== Forwarding of port ${tunnel.service.port} of run ${tunnel.service.runId} stopped checking: ${messageOf(cause)}`);
    }
  }

  #close(tunnel: Tunnel, reason: string): void {
    if (this.#tunnels.get(tunnel.key) !== tunnel) return;
    this.#tunnels.delete(tunnel.key);
    tunnel.closed.abort();
    for (const stream of tunnel.streams) stream.close(`The forwarding ended: ${reason}`);
    for (const socket of tunnel.sockets) socket.destroy();
    void tunnel.listening.then(({ server, localPort }) => {
      server.close();
      this.#log(`== Forwarding localhost:${localPort} to port ${tunnel.service.port} of run ${tunnel.service.runId} ended: ${reason}`);
    }, () => undefined);
  }
}
