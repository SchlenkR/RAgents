import { ACCESS_TOKEN_QUERY } from "../../../../packages/ragents/src/access";
import { isRunPanelScheme, isRunPanelTheme, type RunPanelLooks, type RunPanelScheme, type RunPanelTheme } from "./host-contract";

interface RunPanelLocationCommon {
  host: RunPanelHostKind;
  connection: string | undefined;
  theme: RunPanelTheme | undefined;
  scheme: RunPanelScheme | undefined;
  looks: RunPanelLooks;
  access: string | undefined;
}

export type RunPanelLocation =
  | ({ layout: "panel"; runId: string | undefined; pageId: string | undefined } & RunPanelLocationCommon)
  | ({ layout: "app"; runId: string; elementId: string } & RunPanelLocationCommon);

export type RunPanelHostKind = "browser" | "vscode";

const PAGE_QUERY = "page";

const text = (value: string | null): string | undefined => value?.trim() ? value.trim() : undefined;

const hostKind = (value: string): RunPanelHostKind => {
  if (value === "browser" || value === "vscode") return value;
  throw new Error(`Unknown host ${JSON.stringify(value)}. Allowed are browser and vscode.`);
};

/** Reads the panel's address; unknown values are a hard error instead of a silent default view. */
export function parseRunPanelLocation(search: string): RunPanelLocation {
  const query = new URLSearchParams(search);
  const layout = text(query.get("layout")) ?? "panel";
  if (layout !== "panel" && layout !== "app") throw new Error(`Unknown layout ${JSON.stringify(layout)}. Allowed are panel and app.`);
  const themeValue = text(query.get("theme"));
  if (themeValue !== undefined && !isRunPanelTheme(themeValue)) throw new Error(`Unknown theme ${JSON.stringify(themeValue)}. Allowed are light and dark.`);
  const schemeValue = text(query.get("scheme"));
  if (schemeValue !== undefined && !isRunPanelScheme(schemeValue)) throw new Error(`Unknown scheme ${JSON.stringify(schemeValue)}. Allowed are auto, light, and dark.`);
  const common: RunPanelLocationCommon = {
    host: hostKind(text(query.get("host")) ?? "browser"),
    connection: text(query.get("connection")),
    theme: themeValue,
    scheme: schemeValue,
    looks: {
      palette: text(query.get("palette")),
      codeStyle: text(query.get("codeStyle")),
      corners: text(query.get("corners")),
      density: text(query.get("density")),
    },
    access: text(query.get(ACCESS_TOKEN_QUERY)),
  };
  const runId = text(query.get("run"));
  if (layout === "panel") return { layout, runId, pageId: text(query.get(PAGE_QUERY)), ...common };
  const elementId = text(query.get("element"));
  if (!runId || !elementId) throw new Error("The app layout needs run and element.");
  return { layout, runId, elementId, ...common };
}

/** The plugin page the address names; the registry decides whether it exists. */
export const pageIn = (search: string): string | undefined => text(new URLSearchParams(search).get(PAGE_QUERY));

/** The address with the plugin page named, or with none; every other part of it stays. */
export function withPage(address: string, pageId: string | undefined): string {
  const url = new URL(address);
  if (pageId === undefined) url.searchParams.delete(PAGE_QUERY);
  else url.searchParams.set(PAGE_QUERY, pageId);
  return url.toString();
}
