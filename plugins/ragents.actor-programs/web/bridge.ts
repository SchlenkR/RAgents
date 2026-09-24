import { isRecord } from "@ragents/web/lib/guards";
import type { ChatAttachmentInput } from "@ragents/host/chat-events";
import { parseChatAttachments } from "@ragents/host/chat-attachments";

export const RUN_APP_BRIDGE_VERSION = 1;

export const RUN_APP_FRAME_READY = "ragents.app.frame-ready";
export const RUN_APP_CONNECTED = "ragents.app.connected";
export const RUN_APP_READY = "ragents.app.ready";
export const RUN_APP_THEME = "ragents.app.theme";
export const RUN_APP_INVOKE = "ragents.app.invoke";
export const RUN_APP_GET_STATE = "ragents.app.get-state";
export const RUN_APP_STATE = "ragents.app.state";
export const RUN_APP_INVOCATION = "ragents.app.invocation";
export const RUN_APP_ERROR = "ragents.app.error";
export const RUN_APP_CHAT_WATCH = "ragents.app.chat-watch";
export const RUN_APP_CHAT_UNWATCH = "ragents.app.chat-unwatch";
export const RUN_APP_CHAT_SEND = "ragents.app.chat-send";
export const RUN_APP_CHAT_STATE = "ragents.app.chat-state";
export const RUN_APP_CHAT_ACK = "ragents.app.chat-ack";

export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };

export interface RunAppInvokeRequest {
  type: typeof RUN_APP_INVOKE;
  version: typeof RUN_APP_BRIDGE_VERSION;
  requestId: string;
  actionId: string;
  input: JsonValue;
}

export interface RunAppGetStateRequest {
  type: typeof RUN_APP_GET_STATE;
  version: typeof RUN_APP_BRIDGE_VERSION;
  requestId: string;
}

export type RunAppChatRequest = {
  version: typeof RUN_APP_BRIDGE_VERSION;
  requestId: string;
  actor: string;
} & (
  | { type: typeof RUN_APP_CHAT_WATCH }
  | { type: typeof RUN_APP_CHAT_UNWATCH }
  | { type: typeof RUN_APP_CHAT_SEND; text: string; attachments?: ChatAttachmentInput[] }
);

export type RunAppBridgeRequest = RunAppInvokeRequest | RunAppGetStateRequest | RunAppChatRequest;

export type RunAppBridgeValidation =
  | { ok: true; request: RunAppBridgeRequest }
  | { ok: false; requestId?: string; error: string };

const ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;
const MAX_INPUT_LENGTH = 64 * 1024;
const MAX_DEPTH = 24;

export const isJsonValue = (value: unknown, depth = 0): value is JsonValue => {
  if (depth > MAX_DEPTH) return false;
  if (value === null || typeof value === "string" || typeof value === "boolean") return true;
  if (typeof value === "number") return Number.isFinite(value);
  if (Array.isArray(value)) return value.every((entry) => isJsonValue(entry, depth + 1));
  if (!isRecord(value)) return false;
  return Object.entries(value).every(([key, entry]) => key.length <= 256 && isJsonValue(entry, depth + 1));
};

const requestIdFrom = (value: unknown): string | undefined =>
  typeof value === "string" && ID_PATTERN.test(value) ? value : undefined;

const inputWithinLimit = (value: JsonValue): boolean => {
  try {
    return new TextEncoder().encode(JSON.stringify(value)).byteLength <= MAX_INPUT_LENGTH;
  } catch {
    return false;
  }
};

export const validateRunAppBridgeRequest = (value: unknown): RunAppBridgeValidation => {
  if (!isRecord(value)) return { ok: false, error: "Die App-Nachricht ist kein Objekt" };
  const requestId = requestIdFrom(value.requestId);
  if (!requestId) return { ok: false, error: "Die App-Nachricht enthält keine gültige requestId" };
  if (value.version !== RUN_APP_BRIDGE_VERSION) {
    return { ok: false, requestId, error: "Die App verwendet eine nicht unterstützte Bridge-Version" };
  }
  if (value.type === RUN_APP_GET_STATE) {
    return { ok: true, request: { type: RUN_APP_GET_STATE, version: RUN_APP_BRIDGE_VERSION, requestId } };
  }
  if (value.type === RUN_APP_CHAT_WATCH || value.type === RUN_APP_CHAT_UNWATCH || value.type === RUN_APP_CHAT_SEND) {
    if (typeof value.actor !== "string" || !/^@?[\p{L}\p{N}_-]{1,64}$/u.test(value.actor)) {
      return { ok: false, requestId, error: "Das Chat-Ziel muss primary oder ein Actor-Handle wie @reviewer sein" };
    }
    const common = { version: RUN_APP_BRIDGE_VERSION, requestId, actor: value.actor } as const;
    if (value.type !== RUN_APP_CHAT_SEND) return { ok: true, request: { ...common, type: value.type } };
    let attachments: ChatAttachmentInput[];
    try { attachments = parseChatAttachments(value.attachments); } catch (cause) {
      return { ok: false, requestId, error: cause instanceof Error ? cause.message : String(cause) };
    }
    if (typeof value.text !== "string" || (!value.text.trim() && !attachments.length) || !inputWithinLimit(value.text)) {
      return { ok: false, requestId, error: "Die Chat-Nachricht ist leer oder zu groß" };
    }
    return { ok: true, request: { ...common, type: RUN_APP_CHAT_SEND, text: value.text.trim(), ...(attachments.length ? { attachments } : {}) } };
  }
  if (value.type !== RUN_APP_INVOKE) {
    return { ok: false, requestId, error: "Die App-Nachricht hat einen unbekannten Typ" };
  }
  if (typeof value.actionId !== "string" || !ID_PATTERN.test(value.actionId)) {
    return { ok: false, requestId, error: "Die App-Nachricht enthält keine gültige actionId" };
  }
  if (!isJsonValue(value.input) || !inputWithinLimit(value.input)) {
    return { ok: false, requestId, error: "Die Eingabe der App-Aktion ist kein gültiger JSON-Wert oder zu groß" };
  }
  return {
    ok: true,
    request: {
      type: RUN_APP_INVOKE,
      version: RUN_APP_BRIDGE_VERSION,
      requestId,
      actionId: value.actionId,
      input: value.input,
    },
  };
};
