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
  timeoutMs?: number;
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
}

interface PendingCall {
  settle: (outcome: { result: unknown } | { error: Error }) => void;
  onProgress: ((value: unknown) => void) | undefined;
}

const CANCEL_GRACE_MS = 5_000;

export const rpcFailureOf = (id: RpcId | null, error: unknown): RpcFailure => {
  if (error instanceof RpcError) return rpcFailure(id, error.code, error.message, error.data);
  if (error instanceof DomainError) return rpcFailure(id, RPC_ERROR_CODES.application, error.message, { code: error.code, status: error.status });
  if (error instanceof Error && error.name === "AbortError") return rpcFailure(id, RPC_ERROR_CODES.cancelled, "Abgebrochen");
  return rpcFailure(id, RPC_ERROR_CODES.internal, error instanceof Error ? error.message : String(error));
};

export const rpcErrorOf = (failure: RpcFailure): RpcError => new RpcError(failure.error.code, failure.error.message, failure.error.data);

/** Eine Seite einer JSON-RPC-Verbindung: schickt und beantwortet Anfragen, kennt Abbruch und Fortschritt, ohne Transport. */
export class RpcPeer {
  readonly #send: RpcPeerOptions["send"];
  readonly #pending = new Map<RpcId, PendingCall>();
  readonly #running = new Map<string, AbortController>();
  readonly #requestHandlers = new Map<string, RpcRequestHandler>();
  readonly #notificationHandlers = new Map<string, RpcNotificationHandler>();
  #fallback: RpcFallbackHandler | undefined;
  #nextId = 1;
  #closed: string | undefined;

  constructor(options: RpcPeerOptions) {
    this.#send = options.send;
  }

  get closed(): boolean {
    return this.#closed !== undefined;
  }

  request(method: string, params: unknown, options: RpcCallOptions = {}): Promise<unknown> {
    if (this.#closed !== undefined) return Promise.reject(new RpcError(RPC_ERROR_CODES.connectionClosed, this.#closed));
    if (options.signal?.aborted) return Promise.reject(new RpcError(RPC_ERROR_CODES.cancelled, "Abgebrochen"));
    const id = this.#nextId++;
    return new Promise((resolve, reject) => {
      let grace: ReturnType<typeof setTimeout> | undefined;
      const timer = options.timeoutMs === undefined ? undefined : setTimeout(() => {
        this.notify(RPC_METHODS.cancel, { id } satisfies RpcCancelParams);
        settle({ error: new RpcError(RPC_ERROR_CODES.timeout, `Keine Antwort auf ${method} innerhalb von ${options.timeoutMs} ms`) });
      }, options.timeoutMs);
      const cancel = () => {
        this.notify(RPC_METHODS.cancel, { id } satisfies RpcCancelParams);
        grace = setTimeout(() => settle({ error: new RpcError(RPC_ERROR_CODES.cancelled, "Abgebrochen") }), CANCEL_GRACE_MS);
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
      void this.#deliver({ jsonrpc: "2.0", id, method, params }).catch((error: unknown) =>
        settle({ error: new RpcError(RPC_ERROR_CODES.connectionClosed, error instanceof Error ? error.message : String(error)) }));
    });
  }

  notify(method: string, params: unknown): void {
    if (this.#closed !== undefined) return;
    void this.#deliver({ jsonrpc: "2.0", method, params }).catch(() => undefined);
  }

  onRequest(method: string, handler: RpcRequestHandler): () => void {
    if (this.#requestHandlers.has(method)) throw new Error(`Die Methode ${method} hat bereits einen Handler`);
    this.#requestHandlers.set(method, handler);
    return () => { if (this.#requestHandlers.get(method) === handler) this.#requestHandlers.delete(method); };
  }

  onNotification(method: string, handler: RpcNotificationHandler): () => void {
    if (this.#notificationHandlers.has(method)) throw new Error(`Die Benachrichtigung ${method} hat bereits einen Handler`);
    this.#notificationHandlers.set(method, handler);
    return () => { if (this.#notificationHandlers.get(method) === handler) this.#notificationHandlers.delete(method); };
  }

  /** Bearbeitet jede Anfrage ohne eigenen Handler, etwa der Dispatcher des Servers. */
  fallback(handler: RpcFallbackHandler | undefined): void {
    this.#fallback = handler;
  }

  call<C extends OperationContract>(contract: C, input: OperationInput<C>, options?: RpcCallOptions): Promise<OperationResult<C>> {
    return this.request(contract.id, input, options) as Promise<OperationResult<C>>;
  }

  handle<C extends OperationContract>(
    contract: C,
    handler: (input: OperationInput<C>, context: RpcHandlerContext) => OperationResult<C> | Promise<OperationResult<C>>,
  ): () => void {
    return this.onRequest(contract.id, (params, context) => handler(params as OperationInput<C>, context));
  }

  receive(message: unknown): void {
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
    void this.#deliver(rpcFailure(null, RPC_ERROR_CODES.invalidRequest, "Die Nachricht ist kein gültiges JSON-RPC")).catch(() => undefined);
  }

  /** Bricht alle laufenden Handler ab, etwa wenn der Strom weg ist, über den ihre Antwort ginge; eigene Aufrufe bleiben möglich. */
  cancelIncoming(): void {
    for (const controller of this.#running.values()) controller.abort();
    this.#running.clear();
  }

  close(reason: string): void {
    if (this.#closed !== undefined) return;
    this.#closed = reason;
    for (const controller of this.#running.values()) controller.abort();
    this.#running.clear();
    for (const pending of [...this.#pending.values()]) pending.settle({ error: new RpcError(RPC_ERROR_CODES.connectionClosed, reason) });
    this.#pending.clear();
  }

  #deliver(message: RpcMessage): Promise<void> {
    return Promise.resolve().then(() => this.#send(message));
  }

  #notified(method: string, params: unknown): void {
    if (method === RPC_METHODS.cancel) {
      const id = (params as RpcCancelParams | undefined)?.id;
      if (id !== undefined) this.#running.get(String(id))?.abort();
      return;
    }
    if (method === RPC_METHODS.progress) {
      const { id, value } = (params ?? {}) as Partial<RpcProgressParams>;
      if (id !== undefined) this.#pending.get(id)?.onProgress?.(value);
      return;
    }
    this.#notificationHandlers.get(method)?.(params);
  }

  async #answer(request: RpcRequest): Promise<void> {
    const key = String(request.id);
    const controller = new AbortController();
    this.#running.set(key, controller);
    const context: RpcHandlerContext = {
      id: request.id,
      signal: controller.signal,
      progress: (value) => this.notify(RPC_METHODS.progress, { id: request.id, value } satisfies RpcProgressParams),
    };
    try {
      const handler = this.#requestHandlers.get(request.method);
      const result = handler
        ? await handler(request.params, context)
        : this.#fallback
          ? await this.#fallback(request.method, request.params, context)
          : (() => { throw new RpcError(RPC_ERROR_CODES.methodNotFound, `Unbekannte Methode: ${request.method}`); })();
      if (this.#closed === undefined) await this.#deliver({ jsonrpc: "2.0", id: request.id, result: result === undefined ? null : result });
    } catch (error) {
      if (this.#closed === undefined) await this.#deliver(rpcFailureOf(request.id, error)).catch(() => undefined);
    } finally {
      this.#running.delete(key);
    }
  }
}
