export type RpcId = number | string;

export interface RpcRequest {
  jsonrpc: "2.0";
  id: RpcId;
  method: string;
  params?: unknown;
}

export interface RpcNotification {
  jsonrpc: "2.0";
  method: string;
  params?: unknown;
}

export interface RpcErrorObject {
  code: number;
  message: string;
  data?: unknown;
}

export interface RpcSuccess {
  jsonrpc: "2.0";
  id: RpcId;
  result: unknown;
}

export interface RpcFailure {
  jsonrpc: "2.0";
  id: RpcId | null;
  error: RpcErrorObject;
}

export type RpcResponse = RpcSuccess | RpcFailure;

export type RpcMessage = RpcRequest | RpcNotification | RpcResponse;

export const RPC_ERROR_CODES = Object.freeze({
  parse: -32700,
  invalidRequest: -32600,
  methodNotFound: -32601,
  invalidParams: -32602,
  internal: -32603,
  application: -32000,
  cancelled: -32001,
  connectionClosed: -32002,
  timeout: -32003,
});

/** Feste Methoden der Nachrichtenschicht; alles andere sind registrierte Verträge. */
export const RPC_METHODS = Object.freeze({
  subscribe: "rpc.subscribe",
  unsubscribe: "rpc.unsubscribe",
  event: "rpc.event",
  cancel: "rpc.cancel",
  progress: "rpc.progress",
});

export interface RpcSubscribeParams {
  channel: string;
  params: unknown;
}

export interface RpcSubscribeResult {
  subscription: string;
}

export interface RpcUnsubscribeParams {
  subscription: string;
}

export interface RpcEventParams {
  subscription: string;
  channel: string;
  message: unknown;
}

export interface RpcCancelParams {
  id: RpcId;
}

export interface RpcProgressParams {
  id: RpcId;
  value: unknown;
}

/** Ein Fehler der Gegenseite oder des Transports; `data` trägt bei Fachfehlern `code` und `status`. */
export class RpcError extends Error {
  readonly code: number;
  readonly data: unknown;

  constructor(code: number, message: string, data?: unknown) {
    super(message);
    this.name = "RpcError";
    this.code = code;
    this.data = data;
  }

  get domainCode(): string | undefined {
    const data = this.data as { code?: unknown } | undefined;
    return typeof data?.code === "string" ? data.code : undefined;
  }

  get status(): number | undefined {
    const data = this.data as { status?: unknown } | undefined;
    return typeof data?.status === "number" ? data.status : undefined;
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);

const isId = (value: unknown): value is RpcId => typeof value === "number" || typeof value === "string";

export const isRpcRequest = (value: unknown): value is RpcRequest =>
  isRecord(value) && value.jsonrpc === "2.0" && isId(value.id) && typeof value.method === "string";

export const isRpcNotification = (value: unknown): value is RpcNotification =>
  isRecord(value) && value.jsonrpc === "2.0" && !("id" in value) && typeof value.method === "string";

export const isRpcResponse = (value: unknown): value is RpcResponse =>
  isRecord(value) && value.jsonrpc === "2.0" && !("method" in value)
  && ((isId(value.id) && "result" in value) || ((isId(value.id) || value.id === null) && isRecord(value.error)
    && typeof value.error.code === "number" && typeof value.error.message === "string"));

export const isRpcMessage = (value: unknown): value is RpcMessage =>
  isRpcRequest(value) || isRpcNotification(value) || isRpcResponse(value);

export const rpcFailure = (id: RpcId | null, code: number, message: string, data?: unknown): RpcFailure =>
  ({ jsonrpc: "2.0", id, error: data === undefined ? { code, message } : { code, message, data } });
