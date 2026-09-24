import { createLocalStorageSetting } from "@ragents/web/lib/local-storage-setting";

/** Die gewählte Ansicht des Run-Panels: nur Chat, Chat unten als Sheet oder Chat rechts, sofern das Run-Panel breit genug ist. */
export type RunPanelChatMode = "chat" | "bottom" | "side";

/** Wie der Chat zur Mini-App liegt: allein, daneben oder als Sheet darüber. */
export type ChatLayout = "full" | "side" | "floating";

/** Persönlicher Zustand je Run: Mini-App, Actor, Chat-Lage, Seitenbreite und ausgeklappte Sheet-Höhe. */
export interface RunPanelState {
  element: string | null;
  actor: string | null;
  chat: RunPanelChatMode;
  chatWidth: number;
  sheetExpandedHeight: number | null;
}

export const CHAT_MIN_WIDTH = 280;
export const CHAT_DEFAULT_WIDTH = 380;
/** Neben dem Chat bleibt immer Platz für ein Stück Mini-App. */
export const STAGE_MIN_WIDTH = 300;

export const DEFAULT_RUN_PANEL_STATE: RunPanelState = Object.freeze({ element: null, actor: null, chat: "side", chatWidth: CHAT_DEFAULT_WIDTH, sheetExpandedHeight: null });

export const runPanelStorageKey = (runId: string) => `ragents.orchestration.run-panel:${runId}`;

const isTextOrNull = (value: unknown): value is string | null => value === null || typeof value === "string";
/** Frühere Zustände kannten `auto`, `floating` und `docked` sowie eine Bühnenhöhe; sie werden auf die heutigen Lagen abgebildet. */
const chatModeOf = (value: unknown): RunPanelChatMode | undefined =>
  value === undefined || value === "side" || value === "auto" ? "side"
    : value === "chat" ? "chat"
      : value === "bottom" || value === "floating" || value === "docked" ? "bottom" : undefined;

export function parseRunPanelState(raw: string | null): RunPanelState {
  if (raw === null) return DEFAULT_RUN_PANEL_STATE;
  const value: unknown = JSON.parse(raw);
  if (!value || typeof value !== "object" || Array.isArray(value)
    || Object.keys(value).some((key) => !["element", "stageHeight", "actor", "chat", "chatWidth", "sheetExpandedHeight", "sheetPeekExtra"].includes(key))
    || !("element" in value) || !isTextOrNull(value.element)
    || !("actor" in value) || !isTextOrNull(value.actor)
    || chatModeOf("chat" in value ? value.chat : undefined) === undefined
    || ("chatWidth" in value && (typeof value.chatWidth !== "number" || !Number.isFinite(value.chatWidth) || value.chatWidth < CHAT_MIN_WIDTH))
    || ("sheetExpandedHeight" in value && value.sheetExpandedHeight !== null && (typeof value.sheetExpandedHeight !== "number" || !Number.isFinite(value.sheetExpandedHeight) || value.sheetExpandedHeight <= 0))
    || ("sheetPeekExtra" in value && (typeof value.sheetPeekExtra !== "number" || !Number.isFinite(value.sheetPeekExtra) || value.sheetPeekExtra < 0))) {
    throw new Error("Der gespeicherte Panelzustand ist ungültig.");
  }
  const stored = value as { element: string | null; actor: string | null; chat?: unknown; chatWidth?: number; sheetExpandedHeight?: number | null };
  return { element: stored.element, actor: stored.actor, chat: chatModeOf(stored.chat) ?? "side", chatWidth: stored.chatWidth ?? CHAT_DEFAULT_WIDTH, sheetExpandedHeight: stored.sheetExpandedHeight ?? null };
}

/** Ohne Mini-App und in der Ansicht "Nur Chat" füllt der Chat das Run-Panel; sonst liegt er rechts, wenn Platz ist, und unten, wenn nicht. */
export const chatLayoutFor = ({ chat, hasElement, narrow }: { chat: RunPanelChatMode; hasElement: boolean; narrow: boolean }): ChatLayout =>
  !hasElement || chat === "chat" ? "full" : !narrow && chat === "side" ? "side" : "floating";

export const clampChatWidth = (width: number, available: number): number =>
  Math.max(CHAT_MIN_WIDTH, Math.min(Math.round(width), Math.max(CHAT_MIN_WIDTH, available - STAGE_MIN_WIDTH)));

const setting = createLocalStorageSetting({
  changeEvent: "ragents-run-panel-change",
  matchesKey: (key) => key.startsWith("ragents.orchestration.run-panel:"),
  parse: parseRunPanelState,
  serialize: JSON.stringify,
});

export function useRunPanelState(runId: string): RunPanelState {
  return setting.useValue(runPanelStorageKey(runId));
}

export function saveRunPanelState(runId: string, state: RunPanelState) {
  setting.save(runPanelStorageKey(runId), state);
}
