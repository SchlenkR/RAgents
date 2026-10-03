import { connect, type Socket } from "node:net";
import WebSocket from "ws";
import { WorkspaceOperationError } from "../errors.js";

/** How long the connection to the service and the opening of a leg to the server may take each. */
export const TUNNEL_CONNECT_TIMEOUT_MS = 10_000;

/** The text frame that ends one direction of a stream; the bytes themselves travel as binary frames. */
export const TUNNEL_END = "end";

/** How often a leg pings the server, also while it does not read: the server cuts a leg it has heard nothing from, and the frames keep proxies from closing idle streams. */
export const TUNNEL_PING_INTERVAL_MS = 30_000;

/** What a leg may buffer towards the network before it stops reading its socket. */
const HIGH_WATER_MARK = 1024 * 1024;

/** A close reason of a WebSocket carries at most 123 bytes. */
const CLOSE_REASON_BYTES = 123;

const LOOPBACK = ["127.0.0.1", "::1"] as const;
const WILDCARD = "*";
const UNREACHED = new Set(["ECONNREFUSED", "EADDRNOTAVAIL", "EAFNOSUPPORT", "ENETUNREACH"]);

/** Without a stream the operation only checks that a process of the run listens on the port. */
export interface DialInput {
  readonly port: number;
  /** The path with query on the server where this machine opens its leg of the stream. */
  readonly stream: string | null;
}

/** How a stream ended: the bytes in both directions, and the cause if it did not end normally. */
export interface TunnelClosed {
  readonly sent: number;
  readonly received: number;
  readonly error: string | undefined;
}

/** A TCP connection piped through a leg; `closed` settles once both are closed and never rejects. */
export interface TunnelStream {
  readonly closed: Promise<TunnelClosed>;
  readonly close: (reason: string) => void;
}

const messageOf = (error: unknown): string => error instanceof Error ? error.message : String(error);

const codeOf = (error: unknown): string | undefined => (error as NodeJS.ErrnoException | undefined)?.code;

const invalid = (message: string): WorkspaceOperationError => new WorkspaceOperationError("tunnel-invalid", message, 400);

export const dialInputOf = (input: unknown): DialInput => {
  if (typeof input !== "object" || input === null) throw invalid("The dial-back needs a port and a stream");
  const { port, stream } = input as Record<string, unknown>;
  if (typeof port !== "number" || !Number.isInteger(port) || port < 1 || port > 65535) throw invalid(`${JSON.stringify(port)} is not a port`);
  if (stream !== null && (typeof stream !== "string" || !stream.startsWith("/"))) throw invalid(`The stream ${JSON.stringify(stream)} must be a path on the server or null`);
  return { port, stream };
};

/** Where the listener is reached on this machine: a wildcard on loopback, IPv4 first, a concrete address itself. */
export const serviceTargets = (addresses: readonly string[]): readonly string[] =>
  [...new Set(addresses.flatMap((address) => address === WILDCARD ? [...LOOPBACK] : [address]))];

/** The WebSocket address of a leg: the path the server named, on the server as this machine reaches it, never another host. */
export const tunnelAddress = (server: string, path: string): string => {
  const base = new URL(server);
  const target = new URL(path, base);
  if (!path.startsWith("/") || target.host !== base.host) throw invalid(`The stream ${JSON.stringify(path)} does not lie on the server ${base.host}`);
  target.protocol = base.protocol === "https:" ? "wss:" : "ws:";
  return target.toString();
};

/** A close reason shortened to what a close frame carries, without a broken last character. */
export const tunnelCloseReason = (reason: string): string => {
  const bytes = Buffer.from(reason);
  return bytes.length <= CLOSE_REASON_BYTES ? reason : bytes.subarray(0, CLOSE_REASON_BYTES).toString("utf8").replace(/\uFFFD+$/, "");
};

const open = (leg: WebSocket): boolean => leg.readyState === WebSocket.OPEN;

/** With the default binary type a frame arrives as one Buffer; the other shapes are converted for safety. */
export const bytesOf = (data: WebSocket.RawData): Buffer =>
  Buffer.isBuffer(data) ? data : Array.isArray(data) ? Buffer.concat(data) : Buffer.from(data);

/** Pipes a TCP connection and its leg in both directions with backpressure; a text frame carries the end of one direction, so half-closed connections keep working. */
export const pipeTunnel = (socket: Socket, leg: WebSocket): TunnelStream => {
  const settled = Promise.withResolvers<TunnelClosed>();
  let sent = 0;
  let received = 0;
  let failure: string | undefined = socket.errored ? messageOf(socket.errored) : undefined;
  let socketClosed = socket.closed;
  let legClosed = leg.readyState === WebSocket.CLOSED;
  const settle = (): void => {
    if (socketClosed && legClosed) settled.resolve({ sent, received, error: failure });
  };
  const close = (reason: string, code: number): void => {
    failure ??= reason;
    socket.destroy();
    if (open(leg)) leg.close(code, tunnelCloseReason(reason));
  };
  const pinging = setInterval(() => { if (open(leg)) leg.ping(); }, TUNNEL_PING_INTERVAL_MS);
  pinging.unref();
  const resumeSocket = (): void => {
    if (socket.isPaused() && leg.bufferedAmount < HIGH_WATER_MARK) socket.resume();
  };
  socket.on("data", (chunk: Buffer) => {
    sent += chunk.length;
    leg.send(chunk, { binary: true }, (error) => { if (!error) resumeSocket(); });
    if (leg.bufferedAmount >= HIGH_WATER_MARK) socket.pause();
  });
  socket.on("end", () => { if (open(leg)) leg.send(TUNNEL_END); });
  socket.on("drain", () => leg.resume());
  socket.on("error", (error) => { failure ??= error.message; });
  socket.on("close", () => {
    socketClosed = true;
    if (open(leg)) {
      if (failure === undefined) leg.close(1000);
      else leg.close(1011, tunnelCloseReason(failure));
    }
    settle();
  });
  leg.on("message", (data, binary) => {
    const bytes = bytesOf(data);
    if (!binary) {
      if (bytes.toString("utf8") === TUNNEL_END) socket.end();
      else close(`The other side sent the unknown text frame ${JSON.stringify(bytes.toString("utf8").slice(0, 40))}`, 1003);
      return;
    }
    received += bytes.length;
    if (!socket.write(bytes)) leg.pause();
  });
  leg.on("error", (error) => { failure ??= error.message; });
  leg.on("close", (code, reason) => {
    legClosed = true;
    clearInterval(pinging);
    if (code === 1000) {
      // The other side ended both directions; what is still buffered reaches the socket before it closes.
      if (socket.writableFinished) socket.destroy();
      else socket.end(() => socket.destroy());
    } else {
      failure ??= reason.toString("utf8") || `The stream closed with code ${code}`;
      socket.destroy();
    }
    settle();
  });
  if (legClosed) clearInterval(pinging);
  if (socket.destroyed) close(failure ?? "The connection closed before the stream opened", 1011);
  else {
    socket.resume();
    leg.resume();
  }
  settle();
  return { closed: settled.promise, close: (reason) => close(reason, 1001) };
};

/** Opens a leg to the server, paused until the caller listens; its address carries the one-time secret, so the leg needs no headers. */
export const openTunnelLeg = (address: string, signal?: AbortSignal): Promise<WebSocket> => new Promise((resolve, reject) => {
  const leg = new WebSocket(address, { handshakeTimeout: TUNNEL_CONNECT_TIMEOUT_MS, perMessageDeflate: false });
  const aborted = (): void => {
    reject(new Error("The opening of the leg was cancelled"));
    leg.terminate();
  };
  leg.on("error", reject);
  if (signal?.aborted) {
    aborted();
    return;
  }
  signal?.addEventListener("abort", aborted, { once: true });
  leg.once("open", () => {
    signal?.removeEventListener("abort", aborted);
    // Frames that came with the handshake would be emitted before the caller listens; it resumes the leg.
    leg.pause();
    resolve(leg);
  });
  leg.once("unexpected-response", (_request, response) => {
    signal?.removeEventListener("abort", aborted);
    const chunks: Buffer[] = [];
    response.on("data", (chunk: Buffer) => { if (chunks.length < 8) chunks.push(chunk); });
    response.on("error", reject);
    response.on("end", () => {
      const text = Buffer.concat(chunks).toString("utf8").trim().slice(0, 300);
      reject(new Error(`The server refused the leg with ${response.statusCode ?? "no status"}${text ? `: ${text}` : ""}`));
      leg.terminate();
    });
  });
});

const connectTo = (host: string, port: number, signal: AbortSignal | undefined): Promise<Socket> => new Promise((resolve, reject) => {
  const socket = connect({ host, port, allowHalfOpen: true });
  socket.pause();
  const timer = setTimeout(() => {
    socket.destroy();
    reject(new WorkspaceOperationError("tunnel-timeout", `The service on port ${port} at ${host} did not accept within ${TUNNEL_CONNECT_TIMEOUT_MS / 1000} s`, 504));
  }, TUNNEL_CONNECT_TIMEOUT_MS);
  const aborted = (): void => {
    clearTimeout(timer);
    socket.destroy();
    reject(new Error("The connection to the service was cancelled"));
  };
  signal?.addEventListener("abort", aborted, { once: true });
  socket.once("connect", () => {
    clearTimeout(timer);
    signal?.removeEventListener("abort", aborted);
    resolve(socket);
  });
  socket.once("error", (error) => {
    clearTimeout(timer);
    signal?.removeEventListener("abort", aborted);
    reject(error);
  });
});

/** Connects to the service on this machine; the next address only if the previous one refused, so nothing was sent yet. */
export const connectService = async (port: number, addresses: readonly string[], signal?: AbortSignal): Promise<Socket> => {
  const targets = serviceTargets(addresses);
  for (const address of targets) {
    try {
      return await connectTo(address, port, signal);
    } catch (error) {
      if (error instanceof WorkspaceOperationError || signal?.aborted) throw error;
      if (UNREACHED.has(codeOf(error) ?? "")) continue;
      throw new WorkspaceOperationError("tunnel-failed", `The connection to port ${port} at ${address} failed: ${messageOf(error)}`, 502);
    }
  }
  throw new WorkspaceOperationError("tunnel-unreachable", `Nothing accepts connections on port ${port} at ${targets.join(", ")}`, 502);
};

export interface DialOptions {
  readonly port: number;
  /** The addresses the run's processes listen on with this port, as the process table names them. */
  readonly addresses: readonly string[];
  /** The address under which this machine reaches the server. */
  readonly server: string;
  readonly stream: string;
  readonly signal: AbortSignal | undefined;
}

/** The run's machine connects to the service and opens its leg; an error before the pipe runs closes the connection again. */
export const dialService = async (options: DialOptions): Promise<TunnelStream> => {
  const address = tunnelAddress(options.server, options.stream);
  const socket = await connectService(options.port, options.addresses, options.signal);
  const early = (): void => undefined;
  socket.on("error", early);
  try {
    const leg = await openTunnelLeg(address, options.signal);
    return pipeTunnel(socket, leg);
  } catch (error) {
    socket.destroy();
    throw new WorkspaceOperationError("tunnel-failed", `The leg to the server for port ${options.port} failed: ${messageOf(error)}`, 502);
  } finally {
    socket.off("error", early);
  }
};
