import type { ChannelContract, ChannelMessage, ChannelParams, OperationContract, OperationInput, OperationResult } from "@ragents/engine/src/rpc/contract";
import { RpcPeer, type RpcCallOptions, type RpcHandlerContext } from "@ragents/engine/src/rpc/peer";
import {
  isRpcMessage,
  isRpcNotification,
  isRpcRequest,
  RPC_ERROR_CODES,
  RPC_METHODS,
  RpcError,
  rpcFailure,
  type RpcCancelParams,
  type RpcEventParams,
  type RpcMessage,
  type RpcSubscribeResult,
} from "@ragents/engine/src/rpc/protocol";

export const RPC_PATH = "/rpc";
export const RPC_STREAM_PATH = "/rpc/stream";
export const RPC_CONNECTION_HEADER = "x-ragents-connection";

export type RpcStreamStatus =
  | { kind: "idle" }
  | { kind: "connecting" }
  | { kind: "connected" }
  | { kind: "unauthorized" }
  | { kind: "retrying"; message: string };

export interface RpcClientOptions {
  baseUrl?: string;
  fetch?: typeof fetch;
  retryDelayMs?: number;
  /** How long the stream may stay silent before it counts as lost; the server pings every 15 seconds. */
  idleTimeoutMs?: number;
}

interface Subscription {
  contract: ChannelContract;
  params: unknown;
  onMessage: (message: unknown) => void;
  onError: ((message: string) => void) | undefined;
  serverId: string | undefined;
}

const RETRY_DELAY_MS = 5_000;
const IDLE_TIMEOUT_MS = 45_000;
const EARLY_EVENT_TTL_MS = 10_000;

const messageOf = (cause: unknown): string => cause instanceof Error ? cause.message : String(cause);

/** Reads an SSE stream block by block; a block runs up to the blank line. */
async function* sseBlocks(body: ReadableStream<Uint8Array>, onChunk: () => void): AsyncGenerator<{ event: string | undefined; data: string | undefined }> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffered = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) return;
    onChunk();
    buffered += decoder.decode(value, { stream: true });
    for (;;) {
      const end = buffered.indexOf("\n\n");
      if (end < 0) break;
      const block = buffered.slice(0, end);
      buffered = buffered.slice(end + 2);
      if (!block || block.startsWith(":")) continue;
      const lines = block.split("\n");
      const event = lines.find((line) => line.startsWith("event:"))?.slice(6).trim();
      const data = lines.filter((line) => line.startsWith("data:")).map((line) => line.slice(5).trimStart()).join("\n");
      yield { event, data: data || undefined };
    }
  }
}

/** The client of the messaging layer: requests via POST, notifications and server requests over a stream. */
export class RpcClient {
  readonly #baseUrl: string;
  readonly #fetch: typeof fetch;
  readonly #retryDelayMs: number;
  readonly #idleTimeoutMs: number;
  readonly #peer: RpcPeer;
  readonly #subscriptions = new Set<Subscription>();
  readonly #inFlight = new Map<string, AbortController>();
  readonly #earlyEvents = new Map<string, { at: number; messages: unknown[] }>();
  readonly #statusListeners = new Set<(status: RpcStreamStatus) => void>();
  readonly #connectedListeners = new Set<() => void>();
  #status: RpcStreamStatus = { kind: "idle" };
  #outgoing: Promise<void> = Promise.resolve();
  #connection: string | undefined;
  #stream: AbortController | undefined;
  #retry: ReturnType<typeof setTimeout> | undefined;
  #idle: ReturnType<typeof setTimeout> | undefined;
  #handlers = 0;

  constructor(options: RpcClientOptions = {}) {
    this.#baseUrl = (options.baseUrl ?? "").replace(/\/$/, "");
    this.#fetch = options.fetch ?? ((input, init) => fetch(input, init));
    this.#retryDelayMs = options.retryDelayMs ?? RETRY_DELAY_MS;
    this.#idleTimeoutMs = options.idleTimeoutMs ?? IDLE_TIMEOUT_MS;
    this.#peer = new RpcPeer({ send: (message) => this.#send(message) });
    this.#peer.onNotification(RPC_METHODS.event, (params) => this.#event(params as RpcEventParams));
  }

  get status(): RpcStreamStatus {
    return this.#status;
  }

  get connection(): string | undefined {
    return this.#connection;
  }

  call<C extends OperationContract>(contract: C, input: OperationInput<C>, options?: RpcCallOptions): Promise<OperationResult<C>> {
    return this.#peer.call(contract, input, options);
  }

  subscribe<C extends ChannelContract>(
    contract: C,
    params: ChannelParams<C>,
    onMessage: (message: ChannelMessage<C>) => void,
    onError?: (message: string) => void,
  ): () => void {
    const subscription: Subscription = { contract, params, onMessage: onMessage as (message: unknown) => void, onError, serverId: undefined };
    this.#subscriptions.add(subscription);
    if (this.#connection) void this.#bind(subscription);
    else this.connect();
    return () => {
      if (!this.#subscriptions.delete(subscription)) return;
      const serverId = subscription.serverId;
      subscription.serverId = undefined;
      if (serverId && this.#connection) void this.#peer.request(RPC_METHODS.unsubscribe, { subscription: serverId }).catch(() => undefined);
      this.#settle();
    };
  }

  /** Answers requests from the server, for example to a workstation; keeps the stream open for that. */
  handle<C extends OperationContract>(
    contract: C,
    handler: (input: OperationInput<C>, context: RpcHandlerContext) => OperationResult<C> | Promise<OperationResult<C>>,
  ): () => void {
    const release = this.#peer.handle(contract, handler);
    this.#handlers += 1;
    this.connect();
    return () => {
      release();
      this.#handlers -= 1;
      this.#settle();
    };
  }

  onStatus(listener: (status: RpcStreamStatus) => void): () => void {
    this.#statusListeners.add(listener);
    return () => { this.#statusListeners.delete(listener); };
  }

  /** After every new connection, once the subscriptions are back in place; a workstation then registers again. */
  onConnected(listener: () => void): () => void {
    this.#connectedListeners.add(listener);
    return () => { this.#connectedListeners.delete(listener); };
  }

  connect(): void {
    if (this.#stream || this.#retry !== undefined) return;
    this.#open();
  }

  /** Ends the stream; open requests from the server are cancelled, own requests stay possible. */
  close(): void {
    this.#stop();
    this.#set({ kind: "idle" });
  }

  #settle(): void {
    if (this.#subscriptions.size === 0 && this.#handlers === 0) this.close();
  }

  #set(status: RpcStreamStatus): void {
    this.#status = status;
    for (const listener of [...this.#statusListeners]) listener(status);
  }

  /** Without a stream no answer reaches the server anymore; running handlers therefore end with it. */
  #stop(): void {
    if (this.#retry !== undefined) clearTimeout(this.#retry);
    this.#retry = undefined;
    if (this.#idle !== undefined) clearTimeout(this.#idle);
    this.#idle = undefined;
    this.#stream?.abort();
    this.#stream = undefined;
    this.#connection = undefined;
    this.#peer.cancelIncoming();
    for (const subscription of this.#subscriptions) subscription.serverId = undefined;
  }

  /** A half-open stream delivers nothing anymore, not even a ping; after the idle time it counts as lost. */
  #watchIdle(controller: AbortController): void {
    if (this.#idle !== undefined) clearTimeout(this.#idle);
    this.#idle = setTimeout(() => {
      this.#idle = undefined;
      if (this.#stream === controller) this.#scheduleRetry(`The event stream has been silent for ${Math.round(this.#idleTimeoutMs / 1000)} s.`);
    }, this.#idleTimeoutMs);
  }

  #open(): void {
    const controller = new AbortController();
    this.#stream = controller;
    this.#set({ kind: "connecting" });
    void this.#run(controller).catch((cause: unknown) => {
      if (controller.signal.aborted) return;
      this.#scheduleRetry(messageOf(cause));
    });
  }

  async #run(controller: AbortController): Promise<void> {
    const response = await this.#fetch(`${this.#baseUrl}${RPC_STREAM_PATH}`, { headers: { accept: "text/event-stream" }, signal: controller.signal, cache: "no-store" });
    if (response.status === 401) {
      this.#stream = undefined;
      this.#peer.cancelIncoming();
      this.#set({ kind: "unauthorized" });
      return;
    }
    if (!response.ok || !response.body) throw new Error(`The event stream responded with ${response.status}.`);
    this.#watchIdle(controller);
    for await (const block of sseBlocks(response.body, () => this.#watchIdle(controller))) {
      if (controller.signal.aborted) return;
      if (block.event === "hello") {
        this.#connection = (JSON.parse(block.data ?? "{}") as { connection: string }).connection;
        this.#set({ kind: "connected" });
        await Promise.all([...this.#subscriptions].map((subscription) => this.#bind(subscription)));
        for (const listener of [...this.#connectedListeners]) listener();
        continue;
      }
      if (block.data === undefined) continue;
      const message = JSON.parse(block.data) as unknown;
      if (isRpcMessage(message)) this.#peer.receive(message);
    }
    if (!controller.signal.aborted) this.#scheduleRetry("The server ended the event stream.");
  }

  #scheduleRetry(message: string): void {
    this.#stop();
    this.#set({ kind: "retrying", message });
    for (const subscription of this.#subscriptions) subscription.onError?.(message);
    this.#retry = setTimeout(() => {
      this.#retry = undefined;
      if (this.#subscriptions.size > 0 || this.#handlers > 0) this.#open();
      else this.#set({ kind: "idle" });
    }, this.#retryDelayMs);
  }

  async #bind(subscription: Subscription): Promise<void> {
    const connection = this.#connection;
    if (!connection || subscription.serverId !== undefined) return;
    try {
      const { subscription: serverId } = await this.#peer.request(RPC_METHODS.subscribe, { channel: subscription.contract.id, params: subscription.params }) as RpcSubscribeResult;
      if (this.#connection !== connection || !this.#subscriptions.has(subscription)) {
        if (this.#connection === connection) void this.#peer.request(RPC_METHODS.unsubscribe, { subscription: serverId }).catch(() => undefined);
        return;
      }
      subscription.serverId = serverId;
      const early = this.#earlyEvents.get(serverId);
      this.#earlyEvents.delete(serverId);
      for (const message of early?.messages ?? []) subscription.onMessage(message);
    } catch (cause) {
      subscription.onError?.(`Channel ${subscription.contract.id}: ${messageOf(cause)}`);
    }
  }

  #event(params: RpcEventParams): void {
    const subscription = [...this.#subscriptions].find((entry) => entry.serverId === params.subscription);
    if (subscription) {
      subscription.onMessage(params.message);
      return;
    }
    // The event can arrive before the answer to the subscription; keep it briefly.
    const now = Date.now();
    for (const [id, entry] of this.#earlyEvents) if (now - entry.at > EARLY_EVENT_TTL_MS) this.#earlyEvents.delete(id);
    const entry = this.#earlyEvents.get(params.subscription) ?? { at: now, messages: [] };
    entry.messages.push(params.message);
    this.#earlyEvents.set(params.subscription, entry);
  }

  async #send(message: RpcMessage): Promise<void> {
    if (isRpcNotification(message) && message.method === RPC_METHODS.cancel) {
      const id = String((message.params as RpcCancelParams).id);
      const inFlight = this.#inFlight.get(id);
      if (inFlight) {
        inFlight.abort();
        return;
      }
    }
    const headers: Record<string, string> = { "content-type": "application/json" };
    if (this.#connection) headers[RPC_CONNECTION_HEADER] = this.#connection;
    if (!isRpcRequest(message)) {
      if (!this.#connection) return;
      // Notifications and responses go out in order so progress never overtakes its result.
      const send = this.#outgoing.then(() => this.#fetch(`${this.#baseUrl}${RPC_PATH}`, { method: "POST", headers, body: JSON.stringify(message) }));
      this.#outgoing = send.then(() => undefined, () => undefined);
      await send;
      return;
    }
    const id = String(message.id);
    const controller = new AbortController();
    this.#inFlight.set(id, controller);
    try {
      const response = await this.#fetch(`${this.#baseUrl}${RPC_PATH}`, { method: "POST", headers, body: JSON.stringify(message), signal: controller.signal });
      const body = await response.json().catch(() => undefined) as unknown;
      if (isRpcMessage(body)) {
        this.#peer.receive(body);
        return;
      }
      const detail = body as { error?: unknown; code?: unknown } | undefined;
      const text = typeof detail?.error === "string" ? detail.error : `The server responded with ${response.status}.`;
      this.#peer.receive(rpcFailure(message.id, RPC_ERROR_CODES.application, text, { code: typeof detail?.code === "string" ? detail.code : "http-error", status: response.status }));
    } catch (cause) {
      const cancelled = controller.signal.aborted;
      this.#peer.receive(rpcFailure(message.id, cancelled ? RPC_ERROR_CODES.cancelled : RPC_ERROR_CODES.connectionClosed,
        cancelled ? "Cancelled" : `${this.#baseUrl || "The server"} is unreachable: ${messageOf(cause)}`));
    } finally {
      this.#inFlight.delete(id);
    }
  }
}

export { RpcError };
