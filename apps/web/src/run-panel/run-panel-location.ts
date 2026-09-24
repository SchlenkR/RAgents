import { ACCESS_TOKEN_QUERY } from "../../../../packages/ragents/src/access";
import { isRunPanelTheme, type RunPanelTheme } from "./host-contract";

export type RunPanelLocation =
  | { layout: "panel"; runId: string | undefined; host: RunPanelHostKind; environment: string | undefined; theme: RunPanelTheme | undefined; access: string | undefined }
  | { layout: "app"; runId: string; elementId: string; host: RunPanelHostKind; environment: string | undefined; theme: RunPanelTheme | undefined; access: string | undefined };

export type RunPanelHostKind = "browser" | "vscode";

const text = (value: string | null): string | undefined => value?.trim() ? value.trim() : undefined;

const hostKind = (value: string): RunPanelHostKind => {
  if (value === "browser" || value === "vscode") return value;
  throw new Error(`Unbekannter Host ${JSON.stringify(value)}. Erlaubt sind browser und vscode.`);
};

/** Liest die Adresse des Panels; unbekannte Werte sind ein harter Fehler statt einer stillen Standardansicht. */
export function parseRunPanelLocation(search: string): RunPanelLocation {
  const query = new URLSearchParams(search);
  const layout = text(query.get("layout")) ?? "panel";
  if (layout !== "panel" && layout !== "app") throw new Error(`Unbekanntes Layout ${JSON.stringify(layout)}. Erlaubt sind panel und app.`);
  const themeValue = text(query.get("theme"));
  if (themeValue !== undefined && !isRunPanelTheme(themeValue)) throw new Error(`Unbekannte Darstellung ${JSON.stringify(themeValue)}. Erlaubt sind light und dark.`);
  const common = {
    host: hostKind(text(query.get("host")) ?? "browser"),
    environment: text(query.get("environment")),
    theme: themeValue,
    access: text(query.get(ACCESS_TOKEN_QUERY)),
  };
  const runId = text(query.get("run"));
  if (layout === "panel") return { layout, runId, ...common };
  const elementId = text(query.get("element"));
  if (!runId || !elementId) throw new Error("Das Layout app braucht run und element.");
  return { layout, runId, elementId, ...common };
}
