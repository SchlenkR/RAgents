import type { ColumnTheme } from "../../web/src/column/host-contract";

export type ThemeSetting = "auto" | "light" | "dark";

export interface Settings {
  serverUrl: string;
  theme: ThemeSetting;
}

export const parseServerUrl = (value: unknown): string => {
  if (typeof value !== "string" || !value.trim()) throw new Error("ragents.serverUrl ist leer.");
  const url = new URL(value.trim());
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error(`ragents.serverUrl muss mit http:// oder https:// beginnen, nicht ${url.protocol}`);
  if (url.pathname !== "/" || url.search || url.hash) throw new Error("ragents.serverUrl nennt nur Host und Port, keinen Pfad.");
  return url.origin;
};

export const parseThemeSetting = (value: unknown): ThemeSetting => {
  if (value === "auto" || value === "light" || value === "dark") return value;
  throw new Error(`ragents.theme muss auto, light oder dark sein, nicht ${JSON.stringify(value)}`);
};

export const resolveTheme = (setting: ThemeSetting, editorTheme: ColumnTheme): ColumnTheme => setting === "auto" ? editorTheme : setting;

export const tokenSecretKey = (serverUrl: string): string => `ragents.access-token:${serverUrl}`;
