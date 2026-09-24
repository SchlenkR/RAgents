import { createLocalStorageSetting } from "@ragents/web/lib/local-storage-setting";

/** Verhalten des Run-Panels: ab welcher Breite der Chat neben der Mini-App liegt und wie das Sheet auf die Maus reagiert. */
export interface RunPanelSettings {
  sideWidth: number;
  openDelay: number;
  closeDelay: number;
}

export const DEFAULT_RUN_PANEL_SETTINGS: RunPanelSettings = Object.freeze({ sideWidth: 900, openDelay: 160, closeDelay: 150 });
export const RUN_PANEL_SETTINGS_STORAGE_KEY = "ragents.orchestration.run-panel-settings";
export const RUN_PANEL_SETTINGS_LIMITS = Object.freeze({
  sideWidth: { min: 400, max: 4000 },
  openDelay: { min: 0, max: 5000 },
  closeDelay: { min: 0, max: 10000 },
});

const inRange = (value: unknown, range: { min: number; max: number }): value is number =>
  typeof value === "number" && Number.isInteger(value) && value >= range.min && value <= range.max;

export function parseRunPanelSettings(raw: string | null): RunPanelSettings {
  if (raw === null) return DEFAULT_RUN_PANEL_SETTINGS;
  const value: unknown = JSON.parse(raw);
  if (!value || typeof value !== "object" || Array.isArray(value)
    || Object.keys(value).some((key) => !["sideWidth", "openDelay", "closeDelay"].includes(key))
    || !("sideWidth" in value) || !inRange(value.sideWidth, RUN_PANEL_SETTINGS_LIMITS.sideWidth)
    || !("openDelay" in value) || !inRange(value.openDelay, RUN_PANEL_SETTINGS_LIMITS.openDelay)
    || !("closeDelay" in value) || !inRange(value.closeDelay, RUN_PANEL_SETTINGS_LIMITS.closeDelay)) {
    throw new Error("Die Einstellungen des Run-Panels sind ungültig: Breite 400 bis 4000 Pixel, Verzögerungen 0 bis 5000 beziehungsweise 10000 Millisekunden, ganze Zahlen.");
  }
  return value as RunPanelSettings;
}

const setting = createLocalStorageSetting({
  changeEvent: "ragents-run-panel-settings-change",
  matchesKey: (key) => key === RUN_PANEL_SETTINGS_STORAGE_KEY,
  parse: parseRunPanelSettings,
  serialize: JSON.stringify,
});

export function useRunPanelSettings(): RunPanelSettings {
  return setting.useValue(RUN_PANEL_SETTINGS_STORAGE_KEY);
}

export function saveRunPanelSettings(value: RunPanelSettings) {
  setting.save(RUN_PANEL_SETTINGS_STORAGE_KEY, value);
}
