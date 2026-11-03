import type { Static, TSchema } from "typebox";

/** A request with a response; the server executes it, or a connected client if `implementedBy` says so. */
export interface OperationContract<I extends TSchema = TSchema, R extends TSchema = TSchema> {
  readonly kind: "operation";
  readonly id: string;
  readonly description: string;
  readonly rights: readonly string[];
  readonly scope?: "local";
  readonly input: I;
  readonly result: R;
  readonly implementedBy: "server" | "client";
  readonly timeoutMs?: number;
}

/** After subscribing, a channel delivers messages until the subscription ends. */
export interface ChannelContract<P extends TSchema = TSchema, M extends TSchema = TSchema> {
  readonly kind: "channel";
  readonly id: string;
  readonly description: string;
  readonly rights: readonly string[];
  readonly scope?: "local";
  readonly params: P;
  readonly message: M;
}

export type OperationInput<C> = C extends OperationContract<infer I, TSchema> ? Static<I> : never;

export type OperationResult<C> = C extends OperationContract<TSchema, infer R> ? Static<R> : never;

export type ChannelParams<C> = C extends ChannelContract<infer P, TSchema> ? Static<P> : never;

export type ChannelMessage<C> = C extends ChannelContract<TSchema, infer M> ? Static<M> : never;

export const CONTRACT_ID = /^[a-z][a-z0-9-]*(?:\.[a-zA-Z][a-zA-Z0-9-]*)+$/;

const assertContractId = (id: string): void => {
  if (!CONTRACT_ID.test(id)) throw new Error(`Invalid contract id: ${id}`);
};

const assertScope = (scope: unknown): void => {
  if (scope !== undefined && scope !== "local") throw new Error(`Invalid access scope: ${String(scope)} (expected local or no scope)`);
};

export const defineOperation = <I extends TSchema, R extends TSchema>(definition: {
  id: string;
  description: string;
  rights?: readonly string[];
  scope?: "local";
  input: I;
  result: R;
  implementedBy?: "server" | "client";
  timeoutMs?: number;
}): OperationContract<I, R> => {
  assertContractId(definition.id);
  assertScope(definition.scope);
  if (!definition.description.trim()) throw new Error(`Operation ${definition.id} has no description`);
  if (definition.timeoutMs !== undefined && (!Number.isSafeInteger(definition.timeoutMs) || definition.timeoutMs <= 0 || definition.timeoutMs > 2_147_483_647)) {
    throw new Error(`Operation ${definition.id} timeoutMs must be a positive timer duration`);
  }
  return Object.freeze({
    kind: "operation",
    id: definition.id,
    description: definition.description,
    rights: Object.freeze([...(definition.rights ?? [])]),
    ...(definition.scope === undefined ? {} : { scope: definition.scope }),
    input: definition.input,
    result: definition.result,
    implementedBy: definition.implementedBy ?? "server",
    ...(definition.timeoutMs === undefined ? {} : { timeoutMs: definition.timeoutMs }),
  });
};

export const defineChannel = <P extends TSchema, M extends TSchema>(definition: {
  id: string;
  description: string;
  rights?: readonly string[];
  scope?: "local";
  params: P;
  message: M;
}): ChannelContract<P, M> => {
  assertContractId(definition.id);
  assertScope(definition.scope);
  if (!definition.description.trim()) throw new Error(`Channel ${definition.id} has no description`);
  return Object.freeze({
    kind: "channel",
    id: definition.id,
    description: definition.description,
    rights: Object.freeze([...(definition.rights ?? [])]),
    ...(definition.scope === undefined ? {} : { scope: definition.scope }),
    params: definition.params,
    message: definition.message,
  });
};
