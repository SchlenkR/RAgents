/** Vertrag zwischen der Arbeitsspalte (column.html) und einem Host, der sie in einem iframe zeigt; importfrei, die VS-Code-Erweiterung bündelt ihn mit. */

export const COLUMN_PAGE = "column.html";

export type ColumnLayout = "column" | "app";
export type ColumnTheme = "light" | "dark";

export interface ColumnPageQuery {
  layout?: ColumnLayout;
  run?: string;
  element?: string;
  host?: "vscode";
  theme?: ColumnTheme;
  access?: string;
}

export const columnPageUrl = (serverUrl: string, query: ColumnPageQuery): string => {
  const url = new URL(COLUMN_PAGE, serverUrl.endsWith("/") ? serverUrl : `${serverUrl}/`);
  for (const [key, value] of Object.entries(query)) if (value !== undefined) url.searchParams.set(key, value);
  return url.toString();
};

/** Nachrichten der Spalte an ihren Host. */
export type ColumnHostMessage =
  | { type: "ready" }
  | { type: "runChanged"; runId: string | null }
  | { type: "openInCenter"; runId: string; elementId: string; title: string }
  | { type: "returnToColumn"; runId: string; elementId: string }
  | { type: "login" }
  | { type: "logout" }
  | { type: "openExternal"; url: string }
  | { type: "openPage"; url: string; title: string };

/** Nachrichten des Hosts an die Spalte. */
export type HostColumnMessage =
  | { type: "selectRun"; runId: string | null }
  | { type: "newRun"; startOptions?: Record<string, unknown> }
  | { type: "placements"; runId: string; center: string[] }
  | { type: "theme"; theme: ColumnTheme };

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null;
const isText = (value: unknown): value is string => typeof value === "string" && value.length > 0;

export const isColumnTheme = (value: unknown): value is ColumnTheme => value === "light" || value === "dark";

export const isColumnHostMessage = (value: unknown): value is ColumnHostMessage => {
  if (!isObject(value)) return false;
  switch (value.type) {
    case "ready":
    case "login":
    case "logout":
      return true;
    case "runChanged":
      return value.runId === null || isText(value.runId);
    case "openInCenter":
      return isText(value.runId) && isText(value.elementId) && typeof value.title === "string";
    case "returnToColumn":
      return isText(value.runId) && isText(value.elementId);
    case "openExternal":
      return isText(value.url);
    case "openPage":
      return isText(value.url) && typeof value.title === "string";
    default:
      return false;
  }
};

export const isHostColumnMessage = (value: unknown): value is HostColumnMessage => {
  if (!isObject(value)) return false;
  switch (value.type) {
    case "selectRun":
      return value.runId === null || isText(value.runId);
    case "newRun":
      return value.startOptions === undefined || (isObject(value.startOptions) && !Array.isArray(value.startOptions));
    case "placements":
      return isText(value.runId) && Array.isArray(value.center) && value.center.every(isText);
    case "theme":
      return isColumnTheme(value.theme);
    default:
      return false;
  }
};
