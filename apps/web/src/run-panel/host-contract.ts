/** Vertrag zwischen dem Run-Panel (run-panel.html) und einem Host, der es in einem iframe zeigt; importfrei, die VS-Code-Erweiterung bündelt ihn mit. */

export const RUN_PANEL_PAGE = "run-panel.html";

export type RunPanelLayout = "panel" | "app";
export type RunPanelTheme = "light" | "dark";

export interface RunPanelPageQuery {
  layout?: RunPanelLayout;
  run?: string;
  element?: string;
  host?: "vscode";
  /** Der Name des Servers, auf dem dieser Run liegt; die Kopfzeile nennt ihn als Pille. */
  environment?: string;
  theme?: RunPanelTheme;
  access?: string;
}

export const runPanelPageUrl = (serverUrl: string, query: RunPanelPageQuery): string => {
  const url = new URL(RUN_PANEL_PAGE, serverUrl.endsWith("/") ? serverUrl : `${serverUrl}/`);
  for (const [key, value] of Object.entries(query)) if (value !== undefined) url.searchParams.set(key, value);
  return url.toString();
};

/** Nachrichten des Panels an seinen Host. */
export type RunPanelHostMessage =
  | { type: "ready" }
  | { type: "runChanged"; runId: string | null }
  | { type: "showStart" }
  | { type: "openInCenter"; runId: string; elementId: string; title: string }
  | { type: "returnToRunPanel"; runId: string; elementId: string }
  | { type: "login" }
  | { type: "logout" }
  | { type: "openExternal"; url: string }
  | { type: "openPage"; url: string; title: string };

/** Der Text der Zwischenablage: ein iframe fremder Herkunft darf sie im Webview nicht lesen, die Hülle darüber schon. */
export type RunPanelClipboardMessage = { type: "clipboardRead"; id: string };
export type ClipboardRunPanelMessage = { type: "clipboardText"; id: string; text: string };

export interface RunPanelKeyboardMessage {
  type: "keyboardEvent";
  event: {
    type: "keydown" | "keyup";
    key: string;
    code: string;
    keyCode: number;
    ctrlKey: boolean;
    metaKey: boolean;
    shiftKey: boolean;
    altKey: boolean;
    repeat: boolean;
  };
}

export function isRunPanelKeyboardMessage(value: unknown): value is RunPanelKeyboardMessage {
  if (typeof value !== "object" || value === null) return false;
  const message = value as Record<string, unknown>;
  if (message.type !== "keyboardEvent" || typeof message.event !== "object" || message.event === null) return false;
  const event = message.event as Record<string, unknown>;
  return (event.type === "keydown" || event.type === "keyup") && typeof event.key === "string"
    && typeof event.code === "string" && typeof event.keyCode === "number" && Number.isInteger(event.keyCode)
    && event.keyCode >= 0 && event.keyCode <= 255
    && ["ctrlKey", "metaKey", "shiftKey", "altKey", "repeat"].every((key) => typeof event[key] === "boolean");
}

/** Nachrichten des Hosts an das Panel. */
export type HostRunPanelMessage =
  | { type: "selectRun"; runId: string | null }
  | { type: "newRun"; startOptions?: Record<string, unknown>; entryId?: string }
  | { type: "placements"; runId: string; center: string[] }
  | { type: "theme"; theme: RunPanelTheme };

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null;
const isText = (value: unknown): value is string => typeof value === "string" && value.length > 0;

export const isRunPanelTheme = (value: unknown): value is RunPanelTheme => value === "light" || value === "dark";

export const isRunPanelHostMessage = (value: unknown): value is RunPanelHostMessage => {
  if (!isObject(value)) return false;
  switch (value.type) {
    case "ready":
    case "showStart":
    case "login":
    case "logout":
      return true;
    case "runChanged":
      return value.runId === null || isText(value.runId);
    case "openInCenter":
      return isText(value.runId) && isText(value.elementId) && typeof value.title === "string";
    case "returnToRunPanel":
      return isText(value.runId) && isText(value.elementId);
    case "openExternal":
      return isText(value.url);
    case "openPage":
      return isText(value.url) && typeof value.title === "string";
    default:
      return false;
  }
};

export const isRunPanelClipboardMessage = (value: unknown): value is RunPanelClipboardMessage =>
  isObject(value) && value.type === "clipboardRead" && isText(value.id);

export const isClipboardRunPanelMessage = (value: unknown): value is ClipboardRunPanelMessage =>
  isObject(value) && value.type === "clipboardText" && isText(value.id) && typeof value.text === "string";

export const isHostRunPanelMessage = (value: unknown): value is HostRunPanelMessage => {
  if (!isObject(value)) return false;
  switch (value.type) {
    case "selectRun":
      return value.runId === null || isText(value.runId);
    case "newRun":
      return (value.startOptions === undefined || (isObject(value.startOptions) && !Array.isArray(value.startOptions)))
        && (value.entryId === undefined || isText(value.entryId));
    case "placements":
      return isText(value.runId) && Array.isArray(value.center) && value.center.every(isText);
    case "theme":
      return isRunPanelTheme(value.theme);
    default:
      return false;
  }
};
