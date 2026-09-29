import { createLocalStorageSetting } from "@ragents/web/lib/local-storage-setting";

/** The chosen view of the run panel: chat only, chat at the bottom as a sheet, or chat on the right if the run panel is wide enough. */
export type RunPanelChatMode = "chat" | "bottom" | "side";

/** How the chat relates to the mini-app: alone, next to it, or as a sheet above it. */
export type ChatLayout = "full" | "side" | "floating";

/** Personal state per run: mini-app, actor, chat position, side width and expanded sheet height. */
export interface RunPanelState {
  element: string | null;
  actor: string | null;
  chat: RunPanelChatMode;
  chatWidth: number;
  sheetExpandedHeight: number | null;
}

export const CHAT_MIN_WIDTH = 280;
export const CHAT_DEFAULT_WIDTH = 380;
/** Next to the chat there is always room for a piece of mini-app. */
export const STAGE_MIN_WIDTH = 300;

export const DEFAULT_RUN_PANEL_STATE: RunPanelState = Object.freeze({ element: null, actor: null, chat: "side", chatWidth: CHAT_DEFAULT_WIDTH, sheetExpandedHeight: null });

export const runPanelStorageKey = (runId: string) => `ragents.orchestration.run-panel:${runId}`;

const isTextOrNull = (value: unknown): value is string | null => value === null || typeof value === "string";
/** Earlier states knew `auto`, `floating` and `docked` as well as a stage height; they are mapped to today's positions. */
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
    throw new Error("The stored panel state is invalid.");
  }
  const stored = value as { element: string | null; actor: string | null; chat?: unknown; chatWidth?: number; sheetExpandedHeight?: number | null };
  return { element: stored.element, actor: stored.actor, chat: chatModeOf(stored.chat) ?? "side", chatWidth: stored.chatWidth ?? CHAT_DEFAULT_WIDTH, sheetExpandedHeight: stored.sheetExpandedHeight ?? null };
}

/** Without a mini-app and in the "Chat only" view the chat fills the run panel; otherwise it sits on the right if there is room, and at the bottom if not. */
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
