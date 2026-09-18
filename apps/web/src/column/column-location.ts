import { ACCESS_TOKEN_QUERY } from "../../../../packages/ragents/src/access";
import { isColumnTheme, type ColumnTheme } from "./host-contract";

export type ColumnLocation =
  | { layout: "column"; runId: string | undefined; host: ColumnHostKind; theme: ColumnTheme | undefined; access: string | undefined }
  | { layout: "app"; runId: string; elementId: string; host: ColumnHostKind; theme: ColumnTheme | undefined; access: string | undefined };

export type ColumnHostKind = "browser" | "vscode";

const text = (value: string | null): string | undefined => value?.trim() ? value.trim() : undefined;

const hostKind = (value: string): ColumnHostKind => {
  if (value === "browser" || value === "vscode") return value;
  throw new Error(`Unbekannter Host ${JSON.stringify(value)}. Erlaubt sind browser und vscode.`);
};

/** Liest die Adresse der Spalte; unbekannte Werte sind ein harter Fehler statt einer stillen Standardansicht. */
export function parseColumnLocation(search: string): ColumnLocation {
  const query = new URLSearchParams(search);
  const layout = text(query.get("layout")) ?? "column";
  if (layout !== "column" && layout !== "app") throw new Error(`Unbekanntes Layout ${JSON.stringify(layout)}. Erlaubt sind column und app.`);
  const themeValue = text(query.get("theme"));
  if (themeValue !== undefined && !isColumnTheme(themeValue)) throw new Error(`Unbekannte Darstellung ${JSON.stringify(themeValue)}. Erlaubt sind light und dark.`);
  const common = { host: hostKind(text(query.get("host")) ?? "browser"), theme: themeValue, access: text(query.get(ACCESS_TOKEN_QUERY)) };
  const runId = text(query.get("run"));
  if (layout === "column") return { layout, runId, ...common };
  const elementId = text(query.get("element"));
  if (!runId || !elementId) throw new Error("Das Layout app braucht run und element.");
  return { layout, runId, elementId, ...common };
}
