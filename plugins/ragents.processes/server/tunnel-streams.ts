import { randomBytes } from "node:crypto";
import { STATUS_CODES } from "node:http";
import type { Duplex } from "node:stream";
import WebSocket, { WebSocketServer } from "ws";
import type { HttpRouteContribution, HttpUpgradeContext } from "@ragents/engine";
import { TUNNEL_PING_INTERVAL_MS, bytesOf, tunnelCloseReason } from "@ragents/workspace-executor";
import { PROCESS_TUNNEL_PATH } from "../contract.js";

/** How long a stream waits for its second leg after it was opened. */
export const TUNNEL_PAIRING_TIMEOUT_MS = 15_000;

/** A leg the server has heard nothing from for this long is cut; its own pings arrive twice in that time. */
export const TUNNEL_SILENCE_LIMIT_MS = TUNNEL_PING_INTERVAL_MS * 2.5;

/** What the relay buffers towards one leg before it stops reading the other. */
const HIGH_WATER_MARK = 1024 * 1024;

/** How long the shutdown waits for the closing handshakes before it cuts the legs. */
const SHUTDOWN_GRACE_MS = 2_000;

/** The machine leg comes from the run's machine, the client leg from whoever opened the stream. */
type Side = "machine" | "client";

interface Stream {
  readonly runId: string;
  readonly secrets: Readonly<Record<Side, string>>;
  readonly legs: Partial<Record<Side, WebSocket>>;
  readonly timer: NodeJS.Timeout;
  closed: boolean;
}

export interface TunnelStreamsOptions {
  /** Asks the run's executor to connect to the port and to open the machine leg at the path; settles once that leg is open. */
  dial: (runId: string, port: number, path: string, signal: AbortSignal) => Promise<void>;
  pairingTimeoutMs?: number;
  /** How often the server pings and looks for silent legs. */
  pingIntervalMs?: number;
  silenceLimitMs?: number;
  now?: () => number;
}

const otherSide = (side: Side): Side => side === "machine" ? "client" : "machine";

const secret = (): string => randomBytes(32).toString("base64url");

const pathOf = (value: string): string => `${PROCESS_TUNNEL_PATH}?secret=${value}`;

/** The code a leg closed with goes to the other leg; codes that cannot be sent become a normal end or an error. */
const relayedCode = (code: number): number => {
  if (code === 1005) return 1000;
  return (code >= 1000 && code <= 1014 && code !== 1004 && code !== 1006) || (code >= 3000 && code <= 4999) ? code : 1011;
};

const refuse = (socket: Duplex, status: number, text: string): void => {
  socket.end(`HTTP/1.1 ${status} ${STATUS_CODES[status] ?? ""}\r\nContent-Type: text/plain; charset=utf-8\r\nConnection: close\r\n\r\n${text}\n`);
};

/** Forwards every frame of one leg to the other unchanged, binary or text; reading pauses while the other leg's buffer is full. */
const relay = (from: WebSocket, to: WebSocket): void => {
  from.on("message", (data, binary) => {
    to.send(bytesOf(data), { binary }, () => { if (from.isPaused && to.bufferedAmount < HIGH_WATER_MARK) from.resume(); });
    if (to.bufferedAmount >= HIGH_WATER_MARK) from.pause();
  });
};

const closeLeg = (leg: WebSocket, code: number, reason: string): void => {
  // A paused leg would never read the answer to its close frame.
  leg.resume();
  if (leg.readyState === WebSocket.OPEN) leg.close(code, tunnelCloseReason(reason));
};

/** Pairs the two legs of every stream to a service of a run: the run's machine dials back, the caller connects, both by one-time secret. */
export class TunnelStreams {
  readonly #options: TunnelStreamsOptions;
  readonly #sockets = new WebSocketServer({ noServer: true, perMessageDeflate: false });
  readonly #streams = new Set<Stream>();
  readonly #secrets = new Map<string, { readonly stream: Stream; readonly side: Side }>();
  /** When the server last heard anything from a leg: a frame, a ping, or a pong. */
  readonly #heard = new WeakMap<WebSocket, number>();
  readonly #heartbeat: NodeJS.Timeout;
  readonly #now: () => number;

  constructor(options: TunnelStreamsOptions) {
    this.#options = options;
    this.#now = options.now ?? Date.now;
    this.#heartbeat = setInterval(() => this.#ping(), options.pingIntervalMs ?? TUNNEL_PING_INTERVAL_MS);
    this.#heartbeat.unref();
  }

  /** Opens a stream to a port of the run: the run's machine has opened its leg when this returns the path of the caller's leg. */
  async open(runId: string, port: number, signal: AbortSignal): Promise<{ path: string }> {
    const timeoutMs = this.#options.pairingTimeoutMs ?? TUNNEL_PAIRING_TIMEOUT_MS;
    const stream: Stream = {
      runId,
      secrets: { machine: secret(), client: secret() },
      legs: {},
      timer: setTimeout(() => this.#close(stream, 1011, `The other leg of the stream did not connect within ${timeoutMs / 1000} s`), timeoutMs),
      closed: false,
    };
    stream.timer.unref();
    this.#streams.add(stream);
    this.#secrets.set(stream.secrets.machine, { stream, side: "machine" });
    this.#secrets.set(stream.secrets.client, { stream, side: "client" });
    try {
      await this.#options.dial(runId, port, pathOf(stream.secrets.machine), signal);
    } catch (cause) {
      this.#close(stream, 1011, "The run's machine could not open the stream");
      throw cause;
    }
    if (stream.closed) throw new Error(`The stream to port ${port} of run ${runId} was closed while it opened`);
    if (!stream.legs.machine) {
      this.#close(stream, 1011, "The leg of the run's machine is missing");
      throw new Error(`The run's machine reported the stream to port ${port} as open, but its leg did not arrive`);
    }
    return { path: pathOf(stream.secrets.client) };
  }

  /** The endpoint of both legs; a plain request there learns that it needs a WebSocket. */
  route(): HttpRouteContribution {
    return {
      id: "ragents.processes.tunnel",
      isApiPath: (pathname) => pathname === PROCESS_TUNNEL_PATH,
      matches: (_request, url) => url.pathname === PROCESS_TUNNEL_PATH,
      requiredRights: [],
      handle: ({ response }) => {
        response.writeHead(426, { "Content-Type": "text/plain; charset=utf-8", Upgrade: "websocket", Connection: "Upgrade" });
        response.end("A tunnel stream opens as a WebSocket with the secret from ragents.processes.tunnel.\n");
      },
      upgrade: (context) => this.#upgrade(context),
    };
  }

  /** Closes the streams of a run, such as on its stop or deletion. */
  closeRun(runId: string, reason: string): void {
    for (const stream of [...this.#streams]) if (stream.runId === runId) this.#close(stream, 1001, reason);
  }

  async shutdown(): Promise<void> {
    clearInterval(this.#heartbeat);
    const legs = [...this.#streams].flatMap((stream) => Object.values(stream.legs));
    for (const stream of [...this.#streams]) this.#close(stream, 1001, "The server shuts down");
    const closed = legs.map((leg) => leg.readyState === WebSocket.CLOSED
      ? Promise.resolve()
      : new Promise<void>((resolve) => leg.once("close", () => resolve())));
    const grace = new Promise<void>((resolve) => setTimeout(resolve, SHUTDOWN_GRACE_MS).unref());
    await Promise.race([Promise.all(closed), grace]);
    for (const leg of legs) leg.terminate();
    this.#sockets.close();
  }

  #upgrade({ request, socket, head, url }: HttpUpgradeContext): void {
    const entry = this.#secrets.get(url.searchParams.get("secret") ?? "");
    if (!entry) {
      refuse(socket, 404, "This tunnel stream is unknown, already connected, or expired.");
      return;
    }
    this.#secrets.delete(entry.stream.secrets[entry.side]);
    this.#sockets.handleUpgrade(request, socket, head, (leg) => this.#attach(entry.stream, entry.side, leg));
  }

  #attach(stream: Stream, side: Side, leg: WebSocket): void {
    leg.on("error", (error) => console.warn(`A tunnel leg of run ${stream.runId} failed: ${error.message}`));
    if (stream.closed) {
      leg.close(1001, "The stream is already closed");
      return;
    }
    leg.pause();
    stream.legs[side] = leg;
    const heard = (): void => { this.#heard.set(leg, this.#now()); };
    heard();
    leg.on("message", heard);
    leg.on("ping", heard);
    leg.on("pong", heard);
    leg.on("close", (code, reason) => this.#legClosed(stream, side, code, reason.toString("utf8")));
    const machine = stream.legs.machine;
    const client = stream.legs.client;
    if (!machine || !client) return;
    clearTimeout(stream.timer);
    relay(machine, client);
    relay(client, machine);
    machine.resume();
    client.resume();
  }

  #legClosed(stream: Stream, side: Side, code: number, reason: string): void {
    const other = stream.legs[otherSide(side)];
    if (other) closeLeg(other, relayedCode(code), reason || (code === 1006 ? "The other leg was cut off" : ""));
    if (!other || other.readyState === WebSocket.CLOSED) this.#close(stream, relayedCode(code), reason);
  }

  #close(stream: Stream, code: number, reason: string): void {
    if (!stream.closed) {
      stream.closed = true;
      clearTimeout(stream.timer);
      this.#secrets.delete(stream.secrets.machine);
      this.#secrets.delete(stream.secrets.client);
    }
    for (const leg of Object.values(stream.legs)) closeLeg(leg, code, reason);
    if (Object.values(stream.legs).every((leg) => leg.readyState === WebSocket.CLOSED)) this.#streams.delete(stream);
  }

  /** A paused leg is not read on purpose, while it waits for its partner or for the partner's buffer; its silence starts anew. */
  #ping(): void {
    const now = this.#now();
    const limit = this.#options.silenceLimitMs ?? TUNNEL_SILENCE_LIMIT_MS;
    for (const stream of this.#streams) {
      for (const leg of Object.values(stream.legs)) {
        if (leg.readyState !== WebSocket.OPEN) continue;
        if (leg.isPaused) this.#heard.set(leg, now);
        else if (now - (this.#heard.get(leg) ?? now) > limit) leg.terminate();
        else leg.ping();
      }
    }
  }
}
