import { createLocalStorageSetting } from "@aicontainer/web/lib/local-storage-setting";

/** Wo der Chat liegt, wenn die Spalte breit genug ist; darunter liegt er immer unten als Sheet. */
export type ColumnChatMode = "side" | "bottom";

/** Persönlicher Zustand der Arbeitsspalte je Run: gewählte Mini-App, gewählter Actor, Chat-Lage und Chatbreite daneben. */
export interface ColumnState {
  element: string | null;
  actor: string | null;
  chat: ColumnChatMode;
  chatWidth: number;
}

export const CHAT_MIN_WIDTH = 280;
export const CHAT_DEFAULT_WIDTH = 380;
/** Neben dem Chat bleibt immer Platz für ein Stück Mini-App. */
export const STAGE_MIN_WIDTH = 300;

export const DEFAULT_COLUMN_STATE: ColumnState = Object.freeze({ element: null, actor: null, chat: "side", chatWidth: CHAT_DEFAULT_WIDTH });

export const columnStorageKey = (runId: string) => `ragents.orchestration.column:${runId}`;

const isTextOrNull = (value: unknown): value is string | null => value === null || typeof value === "string";
/** Frühere Zustände kannten `auto`, `floating` und `docked` sowie eine Bühnenhöhe; sie werden auf die zwei Lagen abgebildet. */
const chatModeOf = (value: unknown): ColumnChatMode | undefined =>
  value === undefined || value === "side" || value === "auto" ? "side" : value === "bottom" || value === "floating" || value === "docked" ? "bottom" : undefined;

export function parseColumnState(raw: string | null): ColumnState {
  if (raw === null) return DEFAULT_COLUMN_STATE;
  const value: unknown = JSON.parse(raw);
  if (!value || typeof value !== "object" || Array.isArray(value)
    || Object.keys(value).some((key) => !["element", "stageHeight", "actor", "chat", "chatWidth"].includes(key))
    || !("element" in value) || !isTextOrNull(value.element)
    || !("actor" in value) || !isTextOrNull(value.actor)
    || chatModeOf("chat" in value ? value.chat : undefined) === undefined
    || ("chatWidth" in value && (typeof value.chatWidth !== "number" || !Number.isFinite(value.chatWidth) || value.chatWidth < CHAT_MIN_WIDTH))) {
    throw new Error("Der gespeicherte Spaltenzustand ist ungültig.");
  }
  const stored = value as { element: string | null; actor: string | null; chat?: unknown; chatWidth?: number };
  return { element: stored.element, actor: stored.actor, chat: chatModeOf(stored.chat) ?? "side", chatWidth: stored.chatWidth ?? CHAT_DEFAULT_WIDTH };
}

export const clampChatWidth = (width: number, available: number): number =>
  Math.max(CHAT_MIN_WIDTH, Math.min(Math.round(width), Math.max(CHAT_MIN_WIDTH, available - STAGE_MIN_WIDTH)));

const setting = createLocalStorageSetting({
  changeEvent: "ragents-column-change",
  matchesKey: (key) => key.startsWith("ragents.orchestration.column:"),
  parse: parseColumnState,
  serialize: JSON.stringify,
});

export function useColumnState(runId: string): ColumnState {
  return setting.useValue(columnStorageKey(runId));
}

export function saveColumnState(runId: string, state: ColumnState) {
  setting.save(columnStorageKey(runId), state);
}
