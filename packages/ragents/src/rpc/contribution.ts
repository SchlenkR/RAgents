import type { Static, TSchema } from "typebox";
import type { AccessContext } from "../access.ts";
import type { JsonValue } from "../domain/json.ts";
import type { ChannelContract, OperationContract, OperationInput, OperationResult } from "./contract.ts";
import type { RpcCallOptions } from "./peer.ts";

/** Die Verbindung, über die eine Anfrage kam; der Server ruft darüber auch den Client. */
export interface MethodConnection {
  readonly id: string;
  readonly userId: string | null;
  /** Ohne Ereignisstrom kann der Server diese Verbindung nicht zurückrufen. */
  readonly streamless: boolean;
  call: <C extends OperationContract>(contract: C, input: OperationInput<C>, options?: RpcCallOptions) => Promise<OperationResult<C>>;
  onClose: (listener: () => void) => () => void;
}

export interface MethodContext {
  access: AccessContext;
  signal: AbortSignal;
  progress: (value: JsonValue) => void;
  connection: MethodConnection;
  local: boolean;
}

export interface MethodContribution<I extends TSchema = TSchema, R extends TSchema = TSchema> {
  contract: OperationContract<I, R>;
  execute: (input: Static<I>, context: MethodContext) => Static<R> | Promise<Static<R>>;
}

export interface ChannelContext {
  access: AccessContext;
  connection: MethodConnection;
}

export interface ChannelContribution<P extends TSchema = TSchema, M extends TSchema = TSchema> {
  contract: ChannelContract<P, M>;
  open: (params: Static<P>, emit: (message: Static<M>) => void, context: ChannelContext) => (() => void) | Promise<() => void>;
}

export const implement = <I extends TSchema, R extends TSchema>(
  contract: OperationContract<I, R>,
  execute: MethodContribution<I, R>["execute"],
): MethodContribution<I, R> => ({ contract, execute });

export const implementChannel = <P extends TSchema, M extends TSchema>(
  contract: ChannelContract<P, M>,
  open: ChannelContribution<P, M>["open"],
): ChannelContribution<P, M> => ({ contract, open });

export interface MethodDescriptor {
  owner: string;
  id: string;
  description: string;
  rights: readonly string[];
  input: TSchema;
  result: TSchema;
  implementedBy: "server" | "client";
}

export interface ChannelDescriptor {
  owner: string;
  id: string;
  description: string;
  rights: readonly string[];
  params: TSchema;
  message: TSchema;
}
