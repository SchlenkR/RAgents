import { DomainError } from "../runtime/domain-error.ts";
import type { OperationContract, OperationInput, OperationResult } from "./contract.ts";
import {
  isRpcNotification,
  isRpcRequest,
  isRpcResponse,
  RPC_ERROR_CODES,
  RPC_METHODS,
  RpcError,
  rpcFailure,
  type RpcCancelParams,
  type RpcFailure,
  type RpcId,
  type RpcMessage,
  type RpcProgressParams,
  type RpcRequest,
} from "./protocol.ts";

export interface RpcCallOptions {
  signal?: AbortSignal;
  /** null explicitly keeps a long-lived request open until cancellation. */
  timeoutMs?: number | null;
  onProgress?: (value: unknown) => void;
}

export interface RpcHandlerContext {
  id: RpcId;
  signal: AbortSignal;
  progress: (value: unknown) => void;
}

export type RpcRequestHandler = (params: unknown, context: RpcHandlerContext) => unknown;

export type RpcNotificationHandler = (params: unknown) => void;

export type RpcFallbackHandler = (method: string, params: unknown, context: RpcHandlerContext) => unknown;

export interface RpcPeerOptions {
  send: (message: RpcMessage) => void | Promise<void>;
  requestTimeoutMs?: number;
}

interface PendingCall {
  settle: (outcome: { result: unknown } | { error: Error }) => void;
  onProgress: ((value: unknown) => void) | undefined;
}

const CANCEL_GRACE_MS = 5_000;
export const RPC_REQUEST_TIMEOUT_MS = 30_000;

export const rpcFailureOf = (id: RpcId | null, error: unknown): RpcFailure => {
  if (error instanceof RpcError) return rpcFailure(id, error.code, error.message, error.data);
  if (error instanceof DomainError) return rpcFailure(id, RPC_ERROR_CODES.application, error.message, { code: error.code, status: error.status });
  if (error instanceof Error && error.name === "AbortError") return rpcFailure(id, RPC_ERROR_CODES.cancelled, "Cancelled");
  return rpcFailure(id, RPC_ERROR_CODES.internal, error instanceof Error ? error.message : String(error));
};

export const rpcErrorOf = (failure: RpcFailure): RpcError => new RpcError(failure.error.code, failure.error.message, failure.error.data);

/** One side of a JSON-RPC connection: sends and answers requests, knows cancellation and progress, without transport. */
export class RpcPeer {
  readonly #send: RpcPeerOptions["send"];
  readonly #requestTimeoutMs: number;
  readonly #pending = new Map<RpcId, PendingCall>();
  readonly #running = new Map<string, AbortController>();
  readonly #requestHandlers = new Map<string, RpcRequestHandler>();
  readonly #notificationHandlers = new Map<string, RpcNotificationHandler>();
  #fallback: RpcFallbackHandler | undefined;
  #nextId = 1;
  #closed: string | undefined;

  constructor(options: RpcPeerOptions) {
    this.#send = options.send;
    this.#requestTimeoutMs = options.requestTimeoutMs ?? RPC_REQUEST_TIMEOUT_MS;
    if (!Number.isSafeInteger(this.#requestTimeoutMs) || this.#requestTimeoutMs <= 0 || this.#requestTimeoutMs > 2_147_483_647) {
      throw new Error("requestTimeoutMs must be a positive timer duration");
    }
  }

  get closed(): boolean {
    return this.#closed !== undefined;
  }

  request(method: string, params: unknown, options: RpcCallOptions = {}): Promise<unknown> {
    if (this.#closed !== undefined) return Promise.reject(new RpcError(RPC_ERROR_CODES.connectionClosed, this.#closed));
    if (options.signal?.aborted) return Promise.reject(new RpcError(RPC_ERROR_CODES.cancelled, "Cancelled"));
    const id = this.#nextId++;
    const timeoutMs = options.timeoutMs === undefined ? this.#requestTimeoutMs : options.timeoutMs;
    if (timeoutMs !== null && (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0 || timeoutMs > 2_147_483_647)) {
      return Promise.reject(new Error("timeoutMs must be a positive timer duration or null"));
    }
    return new Promise((resolve, reject) => {
      let grace: ReturnType<typeof setTimeout> | undefined;
      let dispatched = false;
      const timer = timeoutMs === null ? undefined : setTimeout(() => {
        this.notify(RPC_METHODS.cancel, { id } satisfies RpcCancelParams);
        settle({ error: new RpcError(RPC_ERROR_CODES.timeout, `No response to ${method} within ${timeoutMs} ms`) });
      }, timeoutMs);
      const cancel = () => {
        if (!dispatched) {
          settle({ error: new RpcError(RPC_ERROR_CODES.cancelled, "Cancelled") });
          return;
        }
        this.notify(RPC_METHODS.cancel, { id } satisfies RpcCancelParams);
        grace = setTimeout(() => settle({ error: new RpcError(RPC_ERROR_CODES.cancelled, "Cancelled") }), CANCEL_GRACE_MS);
      };
      const settle: PendingCall["settle"] = (outcome) => {
        if (!this.#pending.delete(id)) return;
        if (timer !== undefined) clearTimeout(timer);
        if (grace !== undefined) clearTimeout(grace);
        options.signal?.removeEventListener("abort", cancel);
        if ("error" in outcome) reject(outcome.error);
        else resolve(outcome.result);
      };
      this.#pending.set(id, { settle, onProgress: options.onProgress });
      options.signal?.addEventListener("abort", cancel, { once: true });
      void this.#deliver({ jsonrpc: "2.0", id, method, params }, () => {
        if (!this.#pending.has(id)) return false;
        dispatched = true;
        return true;
      }).catch((error: unknown) =>
        settle({ error: new RpcError(RPC_ERROR_CODES.connectionClosed, error instanceof Error ? error.message : String(error)) }));
    });
  }

  notify(method: string, params: unknown): void {
    if (this.#closed !== undefined) return;
    void this.#deliver({ jsonrpc: "2.0", method, params }).catch(() => undefined);
  }

  onRequest(method: string, handler: RpcRequestHandler): () => void {
    if (this.#requestHandlers.has(method)) throw new Error(`The method ${method} already has a handler`);
    this.#requestHandlers.set(method, handler);
    return () => { if (this.#requestHandlers.get(method) === handler) this.#requestHandlers.delete(method); };
  }

  onNotification(method: string, handler: RpcNotificationHandler): () => void {
    if (this.#notificationHandlers.has(method)) throw new Error(`The notification ${method} already has a handler`);
    this.#notificationHandlers.set(method, handler);
    return () => { if (this.#notificationHandlers.get(method) === handler) this.#notificationHandlers.delete(method); };
  }

  /** Handles every request without its own handler, such as the dispatcher of the server. */
  fallback(handler: RpcFallbackHandler | undefined): void {
    this.#fallback = handler;
  }

  call<C extends OperationContract>(contract: C, input: OperationInput<C>, options?: RpcCallOptions): Promise<OperationResult<C>> {
    return this.request(contract.id, input, options?.timeoutMs !== undefined || contract.timeoutMs === undefined
      ? options
      : { ...options, timeoutMs: contract.timeoutMs }) as Promise<OperationResult<C>>;
  }

  handle<C extends OperationContract>(
    contract: C,
    handler: (input: OperationInput<C>, context: RpcHandlerContext) => OperationResult<C> | Promise<OperationResult<C>>,
  ): () => void {
    return this.onRequest(contract.id, (params, context) => handler(params as OperationInput<C>, context));
  }

  receive(message: unknown): void {
    if (this.#closed !== undefined) return;
    if (isRpcRequest(message)) {
      void this.#answer(message);
      return;
    }
    if (isRpcNotification(message)) {
      this.#notified(message.method, message.params);
      return;
    }
    if (isRpcResponse(message)) {
      if (message.id === null) return;
      const pending = this.#pending.get(message.id);
      if (!pending) return;
      if ("error" in message) pending.settle({ error: rpcErrorOf(message) });
      else pending.settle({ result: message.result });
      return;
    }
    void this.#deliver(rpcFailure(null, RPC_ERROR_CODES.invalidRequest, "The message is not valid JSON-RPC")).catch(() => undefined);
  }

  /** Cancels all running handlers, for example when the stream their response would go through is gone; own calls stay possible. */
  cancelIncoming(): void {
    for (const controller of this.#running.values()) controller.abort();
    this.#running.clear();
  }

  cancelOutgoing(reason: string): void {
    for (const [id, pending] of [...this.#pending]) {
      this.notify(RPC_METHODS.cancel, { id } satisfies RpcCancelParams);
      pending.settle({ error: new RpcError(RPC_ERROR_CODES.connectionClosed, reason) });
    }
  }

  close(reason: string): void {
    if (this.#closed !== undefined) return;
    this.#closed = reason;
    for (const controller of this.#running.values()) controller.abort();
    this.#running.clear();
    for (const pending of [...this.#pending.values()]) pending.settle({ error: new RpcError(RPC_ERROR_CODES.connectionClosed, reason) });
    this.#pending.clear();
  }

  #deliver(message: RpcMessage, current?: () => boolean): Promise<void> {
    return Promise.resolve().then(() => {
      if (current && !current()) return;
      if (isRpcRequest(message) && !this.#pending.has(message.id)) return;
      return this.#send(message);
    });
  }

  #observe(callback: () => unknown, label: string): void {
    const report = (cause: unknown) => console.error(`${label}: ${cause instanceof Error ? cause.message : String(cause)}`);
    try { void Promise.resolve(callback()).catch(report); } catch (cause) { report(cause); }
  }

  #notified(method: string, params: unknown): void {
    if (method === RPC_METHODS.cancel) {
      const id = (params as RpcCancelParams | undefined)?.id;
      if (id !== undefined) this.#running.get(String(id))?.abort();
      return;
    }
    if (method === RPC_METHODS.progress) {
      const { id, value } = (params ?? {}) as Partial<RpcProgressParams>;
      const callback = id === undefined ? undefined : this.#pending.get(id)?.onProgress;
      if (callback) this.#observe(() => callback(value), `RPC progress callback for request ${id} failed`);
      return;
    }
    const callback = this.#notificationHandlers.get(method);
    if (callback) this.#observe(() => callback(params), `RPC notification ${method} callback failed`);
  }

  async #answer(request: RpcRequest): Promise<void> {
    const key = String(request.id);
    const controller = new AbortController();
    this.#running.set(key, controller);
    const current = () => this.#closed === undefined && this.#running.get(key) === controller;
    const context: RpcHandlerContext = {
      id: request.id,
      signal: controller.signal,
      progress: (value) => {
        void this.#deliver({ jsonrpc: "2.0", method: RPC_METHODS.progress, params: { id: request.id, value } satisfies RpcProgressParams }, current).catch(() => undefined);
      },
    };
    try {
      const handler = this.#requestHandlers.get(request.method);
      const result = handler
        ? await handler(request.params, context)
        : this.#fallback
          ? await this.#fallback(request.method, request.params, context)
          : (() => { throw new RpcError(RPC_ERROR_CODES.methodNotFound, `Unknown method: ${request.method}`); })();
      if (current()) await this.#deliver({ jsonrpc: "2.0", id: request.id, result: result === undefined ? null : result }, current);
    } catch (error) {
      if (current()) await this.#deliver(rpcFailureOf(request.id, error), current).catch(() => undefined);
    } finally {
      if (this.#running.get(key) === controller) this.#running.delete(key);
    }
  }
}
