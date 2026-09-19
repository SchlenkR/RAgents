import type { Static, TSchema } from "typebox";

/** Eine Anfrage mit Antwort; der Server führt sie aus, oder ein verbundener Client, wenn `implementedBy` das sagt. */
export interface OperationContract<I extends TSchema = TSchema, R extends TSchema = TSchema> {
  readonly kind: "operation";
  readonly id: string;
  readonly description: string;
  readonly rights: readonly string[];
  readonly input: I;
  readonly result: R;
  readonly implementedBy: "server" | "client";
}

/** Ein Kanal liefert nach dem Abonnieren Nachrichten, bis das Abonnement endet. */
export interface ChannelContract<P extends TSchema = TSchema, M extends TSchema = TSchema> {
  readonly kind: "channel";
  readonly id: string;
  readonly description: string;
  readonly rights: readonly string[];
  readonly params: P;
  readonly message: M;
}

export type OperationInput<C> = C extends OperationContract<infer I, TSchema> ? Static<I> : never;

export type OperationResult<C> = C extends OperationContract<TSchema, infer R> ? Static<R> : never;

export type ChannelParams<C> = C extends ChannelContract<infer P, TSchema> ? Static<P> : never;

export type ChannelMessage<C> = C extends ChannelContract<TSchema, infer M> ? Static<M> : never;

export const CONTRACT_ID = /^[a-z][a-z0-9-]*(?:\.[a-zA-Z][a-zA-Z0-9-]*)+$/;

const assertContractId = (id: string): void => {
  if (!CONTRACT_ID.test(id)) throw new Error(`Ungültige Vertrags-Id: ${id}`);
};

export const defineOperation = <I extends TSchema, R extends TSchema>(definition: {
  id: string;
  description: string;
  rights?: readonly string[];
  input: I;
  result: R;
  implementedBy?: "server" | "client";
}): OperationContract<I, R> => {
  assertContractId(definition.id);
  if (!definition.description.trim()) throw new Error(`Operation ${definition.id} hat keine Beschreibung`);
  return Object.freeze({
    kind: "operation",
    id: definition.id,
    description: definition.description,
    rights: Object.freeze([...(definition.rights ?? [])]),
    input: definition.input,
    result: definition.result,
    implementedBy: definition.implementedBy ?? "server",
  });
};

export const defineChannel = <P extends TSchema, M extends TSchema>(definition: {
  id: string;
  description: string;
  rights?: readonly string[];
  params: P;
  message: M;
}): ChannelContract<P, M> => {
  assertContractId(definition.id);
  if (!definition.description.trim()) throw new Error(`Kanal ${definition.id} hat keine Beschreibung`);
  return Object.freeze({
    kind: "channel",
    id: definition.id,
    description: definition.description,
    rights: Object.freeze([...(definition.rights ?? [])]),
    params: definition.params,
    message: definition.message,
  });
};
