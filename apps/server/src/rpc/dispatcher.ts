import { randomUUID } from "node:crypto";
import type { TSchema } from "typebox";
import { Value } from "typebox/value";
import {
  DomainError,
  RPC_ERROR_CODES,
  RPC_METHODS,
  RpcError,
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
} from "@aicontainer/ragents";

const MAX_SUBSCRIPTIONS = 64;

export interface RpcConnectionOptions {
  id: string;
  access: AccessContext;
  local: boolean;
  peer: RpcPeer;
  /** Ohne Ereignisstrom erreichen Benachrichtigungen den Client nicht; Abonnements sind dann abgelehnt. */
  streamless?: boolean;
}

const firstComplaint = (schema: TSchema, value: unknown): string =>
  [...Value.Errors(schema, value)].at(0)?.message ?? "Schema nicht erfüllt";

/** Eine Verbindung eines Clients: hält ihre Abonnements und ist der Rückweg für Anfragen des Servers. */
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
    if (contract.implementedBy !== "client") return Promise.reject(new Error(`Die Operation ${contract.id} wird vom Server ausgeführt, nicht vom Client`));
    if (this.streamless) return Promise.reject(new DomainError("stream-required", "Der Rückruf an den Client braucht einen Ereignisstrom.", 409));
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
}

/** Führt Anfragen einer Verbindung gegen die registrierten Verträge aus: Rechte, Eingabe, Ausführung, Antwort. */
export class RpcDispatcher {
  readonly #options: RpcDispatcherOptions;

  constructor(options: RpcDispatcherOptions) {
    this.#options = options;
  }

  async dispatch(connection: RpcConnection, method: string, params: unknown, context: RpcHandlerContext): Promise<unknown> {
    if (method === RPC_METHODS.subscribe) return this.#subscribe(connection, params);
    if (method === RPC_METHODS.unsubscribe) return this.#unsubscribe(connection, params);
    const found = this.#options.methods.find(method);
    if (!found || found.contribution.contract.implementedBy === "client") {
      throw new RpcError(RPC_ERROR_CODES.methodNotFound, `Unbekannte Methode: ${method}`);
    }
    const { contract, execute } = found.contribution;
    assertRights(connection.access, contract.rights);
    const input = params === undefined ? {} : params;
    if (!Value.Check(contract.input, input)) {
      throw new RpcError(RPC_ERROR_CODES.invalidParams, `Ungültige Eingabe für ${method}: ${firstComplaint(contract.input, input)}`);
    }
    const result = await execute(input, {
      access: connection.access,
      signal: context.signal,
      progress: (value: JsonValue) => context.progress(value),
      connection,
      local: connection.local,
    });
    const plain = result === undefined ? null : JSON.parse(JSON.stringify(result)) as unknown;
    if (!Value.Check(contract.result, plain)) {
      const complaint = firstComplaint(contract.result, plain);
      console.error(`Die Antwort von ${method} verletzt ihren Vertrag: ${complaint}`);
      throw new RpcError(RPC_ERROR_CODES.internal, `Die Antwort von ${method} verletzt ihren Vertrag: ${complaint}`);
    }
    return plain;
  }

  async #subscribe(connection: RpcConnection, params: unknown): Promise<RpcSubscribeResult> {
    const { channel, params: channelParams } = (params ?? {}) as Partial<RpcSubscribeParams>;
    if (typeof channel !== "string") throw new RpcError(RPC_ERROR_CODES.invalidParams, "channel fehlt");
    if (connection.streamless) throw new DomainError("stream-required", "Abonnements brauchen einen Ereignisstrom.", 409);
    const found = this.#options.channels.find(channel);
    if (!found) throw new DomainError("unknown-channel", `Unbekannter Ereigniskanal: ${channel}`, 400);
    const { contract, open } = found.contribution;
    assertRights(connection.access, contract.rights);
    const input = channelParams === undefined ? {} : channelParams;
    if (!Value.Check(contract.params, input)) {
      throw new RpcError(RPC_ERROR_CODES.invalidParams, `Ungültige Parameter für ${channel}: ${firstComplaint(contract.params, input)}`);
    }
    if (connection.subscriptions.size >= MAX_SUBSCRIPTIONS) throw new DomainError("too-many-channels", "Zu viele Ereigniskanäle auf einer Verbindung.", 429);
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
    if (connection.closed) {
      stop();
      throw new DomainError("connection-closed", "Die Ereignisverbindung wurde beendet.", 410);
    }
    connection.subscriptions.set(subscription, stop);
    // Erst die Antwort auf das Abonnement, dann die beim Öffnen entstandenen Nachrichten.
    setTimeout(() => { if (connection.subscriptions.has(subscription)) for (const message of buffered) send(message); }, 0);
    return { subscription };
  }

  #unsubscribe(connection: RpcConnection, params: unknown): null {
    const { subscription } = (params ?? {}) as Partial<RpcUnsubscribeParams>;
    if (typeof subscription !== "string") throw new RpcError(RPC_ERROR_CODES.invalidParams, "subscription fehlt");
    const stop = connection.subscriptions.get(subscription);
    connection.subscriptions.delete(subscription);
    stop?.();
    return null;
  }
}

export const assertRights = (access: AccessContext, rights: readonly string[]): void => {
  const missing = rights.find((right) => !access.can(right));
  if (missing) throw new DomainError("access-denied", `Das Recht ${missing} fehlt.`, 403);
};
