import { randomUUID } from "node:crypto";
import { Value } from "typebox/value";
import {
  DomainError,
  RPC_ERROR_CODES,
  RPC_METHODS,
  RpcError,
  schemaComplaints,
  type AccessContext,
  type ChannelContributionRegistry,
  type JsonValue,
  type MethodConnection,
  type MethodContributionRegistry,
  type OperationContract,
  type OperationInput,
  type OperationResult,
  type RpcCallOptions,
  type RpcEventParams,
  type RpcHandlerContext,
  type RpcPeer,
  type RpcSubscribeParams,
  type RpcSubscribeResult,
  type RpcUnsubscribeParams,
} from "@ragents/engine";

const MAX_SUBSCRIPTIONS = 64;

export interface RpcConnectionOptions {
  id: string;
  access: AccessContext;
  local: boolean;
  peer: RpcPeer;
  /** Without an event stream, notifications do not reach the client; subscriptions are then rejected. */
  streamless?: boolean;
}

/** A client's connection: holds its subscriptions and is the way back for requests from the server. */
export class RpcConnection implements MethodConnection {
  readonly id: string;
  readonly access: AccessContext;
  readonly local: boolean;
  readonly peer: RpcPeer;
  readonly streamless: boolean;
  readonly subscriptions = new Map<string, () => void>();
  readonly #closeListeners = new Set<() => void>();
  #closed = false;

  constructor(options: RpcConnectionOptions, dispatcher: RpcDispatcher) {
    this.id = options.id;
    this.access = options.access;
    this.local = options.local;
    this.peer = options.peer;
    this.streamless = options.streamless ?? false;
    this.peer.fallback((method, params, context) => dispatcher.dispatch(this, method, params, context));
  }

  get userId(): string | null {
    return this.access.user?.id ?? null;
  }

  get closed(): boolean {
    return this.#closed;
  }

  call<C extends OperationContract>(contract: C, input: OperationInput<C>, options?: RpcCallOptions): Promise<OperationResult<C>> {
    if (contract.implementedBy !== "client") return Promise.reject(new Error(`The operation ${contract.id} is executed by the server, not by the client`));
    if (this.streamless) return Promise.reject(new DomainError("stream-required", "The callback to the client needs an event stream.", 409));
    return this.peer.call(contract, input, options);
  }

  onClose(listener: () => void): () => void {
    this.#closeListeners.add(listener);
    return () => { this.#closeListeners.delete(listener); };
  }

  close(reason: string): void {
    if (this.#closed) return;
    this.#closed = true;
    for (const stop of this.subscriptions.values()) stop();
    this.subscriptions.clear();
    this.peer.close(reason);
    for (const listener of [...this.#closeListeners]) listener();
    this.#closeListeners.clear();
  }
}

export interface RpcDispatcherOptions {
  methods: MethodContributionRegistry;
  channels: ChannelContributionRegistry;
  /** Every method and every channel with runId is additionally checked against the run's ownership; a method with runs.write operates it. */
  assertRunReachable?: (access: AccessContext, runId: string, operates: boolean) => void;
  /** Calls the listener whenever who may see the run can have changed; a channel of the run whose caller no longer reaches it ends then. */
  watchRunAccess?: (runId: string, listener: () => void) => () => void;
}

const runIdOf = (input: unknown): string | undefined => {
  if (typeof input !== "object" || input === null || !("runId" in input)) return undefined;
  const value = (input as { runId: unknown }).runId;
  return typeof value === "string" ? value : undefined;
};

/** Executes a connection's requests against the registered contracts: rights, input, execution, response. */
export class RpcDispatcher {
  readonly #options: RpcDispatcherOptions;

  constructor(options: RpcDispatcherOptions) {
    this.#options = options;
  }

  async dispatch(connection: RpcConnection, method: string, params: unknown, context: RpcHandlerContext): Promise<unknown> {
    if (method === RPC_METHODS.subscribe) return this.#subscribe(connection, params, context.signal);
    if (method === RPC_METHODS.unsubscribe) return this.#unsubscribe(connection, params);
    const found = this.#options.methods.find(method);
    if (!found || found.contribution.contract.implementedBy === "client") {
      throw new RpcError(RPC_ERROR_CODES.methodNotFound, `Unknown method: ${method}`);
    }
    const { contract, execute } = found.contribution;
    assertRights(connection.access, contract.rights);
    const input = params === undefined ? {} : params;
    if (!Value.Check(contract.input, input)) {
      throw new RpcError(RPC_ERROR_CODES.invalidParams, `Invalid input for ${method}: ${schemaComplaints(contract.input, input, "params")}`);
    }
    const target = runIdOf(input);
    if (target !== undefined) this.#options.assertRunReachable?.(connection.access, target, contract.rights.includes("runs.write"));
    const result = await execute(input, {
      access: connection.access,
      signal: context.signal,
      progress: (value: JsonValue) => context.progress(value),
      connection,
      local: connection.local,
    });
    const plain = result === undefined ? null : JSON.parse(JSON.stringify(result)) as unknown;
    if (!Value.Check(contract.result, plain)) {
      const complaint = schemaComplaints(contract.result, plain, "result");
      console.error(`The response of ${method} violates its contract: ${complaint}`);
      throw new RpcError(RPC_ERROR_CODES.internal, `The response of ${method} violates its contract: ${complaint}`);
    }
    return plain;
  }

  async #subscribe(connection: RpcConnection, params: unknown, signal: AbortSignal): Promise<RpcSubscribeResult> {
    const { channel, params: channelParams } = (params ?? {}) as Partial<RpcSubscribeParams>;
    if (typeof channel !== "string") throw new RpcError(RPC_ERROR_CODES.invalidParams, "channel is missing");
    if (connection.streamless) throw new DomainError("stream-required", "Subscriptions need an event stream.", 409);
    const found = this.#options.channels.find(channel);
    if (!found) throw new DomainError("unknown-channel", `Unknown event channel: ${channel}`, 400);
    const { contract, open } = found.contribution;
    assertRights(connection.access, contract.rights);
    const input = channelParams === undefined ? {} : channelParams;
    if (!Value.Check(contract.params, input)) {
      throw new RpcError(RPC_ERROR_CODES.invalidParams, `Invalid parameters for ${channel}: ${schemaComplaints(contract.params, input, "params")}`);
    }
    const target = runIdOf(input);
    if (target !== undefined) this.#options.assertRunReachable?.(connection.access, target, false);
    if (connection.subscriptions.size >= MAX_SUBSCRIPTIONS) throw new DomainError("too-many-channels", "Too many event channels on one connection.", 429);
    const subscription = randomUUID();
    const buffered: unknown[] = [];
    let opening = true;
    const send = (message: unknown) => connection.peer.notify(RPC_METHODS.event, { subscription, channel, message } satisfies RpcEventParams);
    const emit = (message: unknown) => {
      if (opening) buffered.push(message);
      else if (connection.subscriptions.has(subscription)) send(message);
    };
    const stop = await open(input, emit, { access: connection.access, connection });
    opening = false;
    if (connection.closed || signal.aborted) {
      stop();
      throw new RpcError(RPC_ERROR_CODES.cancelled, "The subscription was cancelled.");
    }
    const unwatch = target === undefined ? undefined : this.#options.watchRunAccess?.(target, () => {
      try {
        this.#options.assertRunReachable?.(connection.access, target, false);
      } catch (error) {
        if (!(error instanceof DomainError)) throw error;
        this.#end(connection, subscription);
      }
    });
    connection.subscriptions.set(subscription, () => {
      unwatch?.();
      stop();
    });
    // First the response to the subscription, then the messages created while opening.
    setTimeout(() => { if (connection.subscriptions.has(subscription)) for (const message of buffered) send(message); }, 0);
    return { subscription };
  }

  #unsubscribe(connection: RpcConnection, params: unknown): null {
    const { subscription } = (params ?? {}) as Partial<RpcUnsubscribeParams>;
    if (typeof subscription !== "string") throw new RpcError(RPC_ERROR_CODES.invalidParams, "subscription is missing");
    this.#end(connection, subscription);
    return null;
  }

  #end(connection: RpcConnection, subscription: string): void {
    const stop = connection.subscriptions.get(subscription);
    connection.subscriptions.delete(subscription);
    stop?.();
  }
}

export const assertRights = (access: AccessContext, rights: readonly string[]): void => {
  const missing = rights.find((right) => !access.can(right));
  if (missing) throw new DomainError("access-denied", `The right ${missing} is missing.`, 403);
};
