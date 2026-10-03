import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import type { Duplex } from "node:stream";
import { setTimeout as delay } from "node:timers/promises";
import { Type, type TUnsafe } from "typebox";
import { defineOperation, type OperationContract } from "../../../packages/ragents/src/rpc/contract";
import { RPC_ERROR_CODES, RpcError } from "../../../packages/ragents/src/rpc/protocol";
import type { RpcClient } from "../../web/src/rpc/client";
import type { RunService, ServiceForwardInput, ServiceForwardResult, ServiceHttpResponse } from "../../web/src/run-panel/host-contract";

/** The largest body a tunnel forwards per request; the forwarding on the run's machine has the same limit for both directions. */
export const SERVICE_BODY_LIMIT = 16 * 1024 * 1024;

/** How often an open tunnel asks whether a process of its run still listens on the port. */
const CHECK_INTERVAL_MS = 5_000;

type ForwardContract = OperationContract<TUnsafe<ServiceForwardInput>, TUnsafe<ServiceForwardResult>>;

export interface ServiceTunnelsOptions {
  log: (line: string) => void;
  checkIntervalMs?: number;
}

interface Listening {
  readonly server: Server;
  readonly localPort: number;
}

/** A tunnel from a local port to a port of a run, through the server connection the run belongs to. */
interface Tunnel {
  readonly key: string;
  readonly connection: string;
  readonly rpc: RpcClient;
  readonly service: RunService;
  readonly contract: ForwardContract;
  readonly closed: AbortController;
  readonly listening: Promise<Listening>;
}

/** Refused by the tunnel itself, before the server is asked. */
class Refusal extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

const messageOf = (cause: unknown): string => cause instanceof Error ? cause.message : String(cause);

/** A service runs on this machine on this window's workstation, or on the server when that is the extension's own host. */
export const serviceOnThisMachine = (service: RunService, here: { ownHost: boolean; workstation: string | undefined }): boolean =>
  service.workstation === null ? here.ownHost : service.workstation === here.workstation;

const keyOf = (connection: string, { runId, port }: RunService): string => JSON.stringify([connection, runId, port]);

const forwardContract = (id: string): ForwardContract => defineOperation({
  id,
  description: "Forwards one HTTP request to a service of a run.",
  input: Type.Unsafe<ServiceForwardInput>({}),
  result: Type.Unsafe<ServiceForwardResult>({}),
});

/** The server answered that the port, the run, the access, or the forwarding itself is gone; asking again does not help. */
const gone = (cause: unknown): boolean => cause instanceof RpcError
  && (cause.code === RPC_ERROR_CODES.methodNotFound || cause.status === 403 || cause.status === 404);

/** An error status the browser should see; everything without one is a failed gateway. */
const statusOf = (cause: unknown): number => {
  const status = cause instanceof Refusal || cause instanceof RpcError ? cause.status : undefined;
  return status !== undefined && status >= 400 && status <= 599 ? status : 502;
};

const isHeaderPair = (value: unknown): value is [string, string] =>
  Array.isArray(value) && value.length === 2 && typeof value[0] === "string" && typeof value[1] === "string";

/** The response comes from the server; it is checked before it reaches the browser. */
const responseOf = (value: ServiceForwardResult): ServiceHttpResponse => {
  const candidate = value as Partial<ServiceHttpResponse> | null;
  if (candidate === null || typeof candidate !== "object" || typeof candidate.status !== "number" || !Number.isInteger(candidate.status)
    || candidate.status < 100 || candidate.status > 999 || !Array.isArray(candidate.headers) || !candidate.headers.every(isHeaderPair)
    || typeof candidate.body !== "string") {
    throw new Error("The server answered the forwarding with an unreadable response");
  }
  return { status: candidate.status, headers: candidate.headers, body: candidate.body };
};

const pairsOf = (raw: readonly string[]): Array<[string, string]> =>
  Array.from({ length: raw.length / 2 }, (_, index) => [raw[index * 2]!, raw[index * 2 + 1]!]);

/** An oversized body is read to its end and discarded, so the browser receives the refusal instead of a broken connection. */
const bodyOf = (request: IncomingMessage): Promise<Buffer> => new Promise((resolve, reject) => {
  const chunks: Buffer[] = [];
  let size = 0;
  request.on("data", (chunk: Buffer) => {
    size += chunk.length;
    if (size <= SERVICE_BODY_LIMIT) chunks.push(chunk);
  });
  request.on("end", () => size <= SERVICE_BODY_LIMIT
    ? resolve(Buffer.concat(chunks))
    : reject(new Refusal(413, `The request body exceeds ${SERVICE_BODY_LIMIT / 1024 / 1024} MiB; forwarding carries at most that much`)));
  request.on("error", reject);
});

const answer = (response: ServerResponse, status: number, text: string): void => {
  if (response.headersSent) {
    response.destroy();
    return;
  }
  response.writeHead(status, { "Content-Type": "text/plain; charset=utf-8", Connection: "close" });
  response.end(`${text}\n`);
};

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

/** VS Code as the forwarding client: a local listener per service of a run, each request through the forwarding method of the run's server. */
export class ServiceTunnels {
  readonly #log: (line: string) => void;
  readonly #checkIntervalMs: number;
  readonly #tunnels = new Map<string, Tunnel>();

  constructor(options: ServiceTunnelsOptions) {
    this.#log = options.log;
    this.#checkIntervalMs = options.checkIntervalMs ?? CHECK_INTERVAL_MS;
  }

  /** The local port of the service; a second call reuses the open tunnel. The server first confirms that a process of the run listens on the port. */
  async open(connection: string, rpc: RpcClient, service: RunService): Promise<number> {
    const key = keyOf(connection, service);
    const known = this.#tunnels.get(key);
    if (known?.rpc === rpc) return (await known.listening).localPort;
    if (known) this.#close(known, "the server connection was renewed");
    const closed = new AbortController();
    const contract = forwardContract(service.forward);
    const tunnel: Tunnel = {
      key, connection, rpc, service, contract, closed,
      listening: this.#listen(rpc, service, contract, closed.signal, (request, response) => this.#forward(tunnel, request, response)),
    };
    this.#tunnels.set(key, tunnel);
    try {
      const { localPort } = await tunnel.listening;
      this.#log(`== Forwarding http://localhost:${localPort}/ to port ${service.port} of run ${service.runId} on ${connection}`);
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
      if (clientOf(tunnel.connection) !== tunnel.rpc) this.#close(tunnel, `the connection to ${tunnel.connection} ended`);
    }
  }

  async dispose(): Promise<void> {
    const tunnels = [...this.#tunnels.values()];
    for (const tunnel of tunnels) this.#close(tunnel, "the extension ends");
    await Promise.allSettled(tunnels.map((tunnel) => tunnel.listening));
  }

  async #listen(
    rpc: RpcClient,
    service: RunService,
    contract: ForwardContract,
    signal: AbortSignal,
    forward: (request: IncomingMessage, response: ServerResponse) => Promise<void>,
  ): Promise<Listening> {
    await rpc.call(contract, { runId: service.runId, port: service.port, request: null }, { signal });
    const server = createServer((request, response) => { void forward(request, response); });
    server.on("upgrade", (request: IncomingMessage, socket: Duplex) => {
      this.#log(`== Forward ${service.runId.slice(0, 8)}:${service.port} ${request.method ?? "GET"} ${request.url ?? "/"} refused: no WebSocket forwarding`);
      socket.end("HTTP/1.1 501 Not Implemented\r\nContent-Type: text/plain; charset=utf-8\r\nConnection: close\r\n\r\n"
        + "RAgents forwards HTTP requests only, no WebSocket upgrade.\n");
    });
    const localPort = await listenOnPort(server, service.port);
    if (signal.aborted) {
      server.close();
      throw new Error(`The forwarding of port ${service.port} was closed while it started`);
    }
    return { server, localPort };
  }

  async #forward(tunnel: Tunnel, request: IncomingMessage, response: ServerResponse): Promise<void> {
    const started = Date.now();
    const { runId, port } = tunnel.service;
    const method = request.method ?? "GET";
    const path = request.url ?? "/";
    const line = `${runId.slice(0, 8)}:${port} ${method} ${path}`;
    const cancelled = new AbortController();
    response.on("close", () => { if (!response.writableFinished) cancelled.abort(); });
    try {
      const body = await bodyOf(request);
      const result = responseOf(await tunnel.rpc.call(tunnel.contract, {
        runId, port, request: { method, path, headers: pairsOf(request.rawHeaders), body: body.toString("base64") },
      }, { signal: cancelled.signal }));
      response.writeHead(result.status, result.headers.flat());
      response.end(Buffer.from(result.body, "base64"));
      this.#log(`== Forward ${line} ${result.status} ${Date.now() - started} ms`);
    } catch (cause) {
      const status = statusOf(cause);
      this.#log(`== Forward ${line} failed with ${status}: ${messageOf(cause)}`);
      if (!cancelled.signal.aborted) answer(response, status, `RAgents could not forward ${method} ${path} to port ${port} of run ${runId}: ${messageOf(cause)}`);
      if (gone(cause)) this.#close(tunnel, messageOf(cause));
    }
  }

  /** Asks at intervals whether the port still belongs to the run; ends the tunnel once the run stopped or the process is gone. */
  async #watch(tunnel: Tunnel): Promise<void> {
    const { signal } = tunnel.closed;
    try {
      for (;;) {
        await delay(this.#checkIntervalMs, undefined, { signal, ref: false });
        const failure = await tunnel.rpc.call(tunnel.contract, { runId: tunnel.service.runId, port: tunnel.service.port, request: null }, { signal })
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
    void tunnel.listening.then(({ server, localPort }) => {
      server.close();
      server.closeAllConnections();
      this.#log(`== Forwarding http://localhost:${localPort}/ to port ${tunnel.service.port} of run ${tunnel.service.runId} ended: ${reason}`);
    }, () => undefined);
  }
}
