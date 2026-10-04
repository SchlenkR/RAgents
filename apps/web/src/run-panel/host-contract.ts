/** Contract between the run panel (run-panel.html) and a host that shows it in an iframe; import-free, the VS Code extension bundles it. */

export const RUN_PANEL_PAGE = "run-panel.html";

export type RunPanelLayout = "panel" | "app";
export type RunPanelTheme = "light" | "dark";

export interface RunPanelPageQuery {
  layout?: RunPanelLayout;
  run?: string;
  element?: string;
  host?: "vscode";
  /** The selected environment; the header shows it on Start, Runs, and the run. */
  connection?: string;
  theme?: RunPanelTheme;
  access?: string;
}

export const runPanelPageUrl = (serverUrl: string, query: RunPanelPageQuery): string => {
  const url = new URL(RUN_PANEL_PAGE, serverUrl.endsWith("/") ? serverUrl : `${serverUrl}/`);
  for (const [key, value] of Object.entries(query)) if (value !== undefined) url.searchParams.set(key, value);
  return url.toString();
};

/** A service of a run that the panel asks its host to open. */
export interface RunService {
  runId: string;
  port: number;
  /** The workstation the run works on; null for the server. */
  workstation: string | null;
  /** The server method that opens a stream to the service, with ServiceTunnelInput and ServiceTunnelResult; the plugin that shows the port names it. */
  tunnel: string;
}

/** With connect false the tunnel method only checks that a process of the run still listens on the port. */
export interface ServiceTunnelInput {
  runId: string;
  port: number;
  connect: boolean;
}

/** The path with query on the server where the caller opens its WebSocket leg of the stream. */
export type ServiceTunnelResult = { path: string } | null;

/** Messages from the panel to its host. */
export type RunPanelHostMessage =
  | { type: "ready" }
  | { type: "runChanged"; runId: string | null }
  | { type: "pageChanged"; page: "start" | "runs" }
  | { type: "newRun"; entryId?: string }
  /** With notice, Start shows it, such as for a run that is no longer shared with the user. */
  | { type: "showStart"; notice?: string }
  | { type: "openInCenter"; runId: string; elementId: string; title: string }
  | { type: "login" }
  | { type: "logout" }
  | { type: "openExternal"; url: string }
  | { type: "openPage"; url: string; title: string }
  | ({ type: "openService" } & RunService);

/** The shell reads clipboard contents on behalf of its cross-origin frames. */
export interface ClipboardContent {
  text: string;
  files: File[];
}
export type RunPanelClipboardMessage = { type: "clipboardRead"; id: string };
export type ClipboardRunPanelMessage = ClipboardContent & { type: "clipboardContent"; id: string };

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

/** Messages from the host to the panel. */
export type HostRunPanelMessage =
  | { type: "selectRun"; runId: string | null }
  | { type: "showPage"; page: "start" | "runs"; notice?: string }
  | { type: "newRun"; startOptions?: Record<string, unknown>; entryId?: string }
  | { type: "theme"; theme: RunPanelTheme };

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null;
const isText = (value: unknown): value is string => typeof value === "string" && value.length > 0;
const isPort = (value: unknown): value is number => typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= 65535;

export const isRunPanelTheme = (value: unknown): value is RunPanelTheme => value === "light" || value === "dark";

export const isRunPanelHostMessage = (value: unknown): value is RunPanelHostMessage => {
  if (!isObject(value)) return false;
  switch (value.type) {
    case "ready":
    case "login":
    case "logout":
      return true;
    case "showStart":
      return value.notice === undefined || isText(value.notice);
    case "runChanged":
      return value.runId === null || isText(value.runId);
    case "pageChanged":
      return value.page === "start" || value.page === "runs";
    case "newRun":
      return value.entryId === undefined || isText(value.entryId);
    case "openInCenter":
      return isText(value.runId) && isText(value.elementId) && typeof value.title === "string";
    case "openExternal":
      return isText(value.url);
    case "openPage":
      return isText(value.url) && typeof value.title === "string";
    case "openService":
      return isText(value.runId) && isPort(value.port) && (value.workstation === null || isText(value.workstation)) && isText(value.tunnel);
    default:
      return false;
  }
};

export const isRunPanelClipboardMessage = (value: unknown): value is RunPanelClipboardMessage =>
  isObject(value) && value.type === "clipboardRead" && isText(value.id);

export const isClipboardRunPanelMessage = (value: unknown): value is ClipboardRunPanelMessage =>
  isObject(value) && value.type === "clipboardContent" && isText(value.id) && typeof value.text === "string"
    && Array.isArray(value.files) && value.files.every((file) => file instanceof File);

export const isHostRunPanelMessage = (value: unknown): value is HostRunPanelMessage => {
  if (!isObject(value)) return false;
  switch (value.type) {
    case "selectRun":
      return value.runId === null || isText(value.runId);
    case "showPage":
      return (value.page === "start" || value.page === "runs") && (value.notice === undefined || isText(value.notice));
    case "newRun":
      return (value.startOptions === undefined || (isObject(value.startOptions) && !Array.isArray(value.startOptions)))
        && (value.entryId === undefined || isText(value.entryId));
    case "theme":
      return isRunPanelTheme(value.theme);
    default:
      return false;
  }
};
