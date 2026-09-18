import { createLocalStorageSetting } from "@aicontainer/web/lib/local-storage-setting";

/** Verhalten der Arbeitsspalte: ab welcher Breite der Chat neben der Mini-App liegt und wie das Sheet auf die Maus reagiert. */
export interface ColumnSettings {
  sideWidth: number;
  openDelay: number;
  closeDelay: number;
}

export const DEFAULT_COLUMN_SETTINGS: ColumnSettings = Object.freeze({ sideWidth: 900, openDelay: 160, closeDelay: 150 });
export const COLUMN_SETTINGS_STORAGE_KEY = "ragents.orchestration.column-settings";
export const COLUMN_SETTINGS_LIMITS = Object.freeze({
  sideWidth: { min: 400, max: 4000 },
  openDelay: { min: 0, max: 5000 },
  closeDelay: { min: 0, max: 10000 },
});

const inRange = (value: unknown, range: { min: number; max: number }): value is number =>
  typeof value === "number" && Number.isInteger(value) && value >= range.min && value <= range.max;

export function parseColumnSettings(raw: string | null): ColumnSettings {
  if (raw === null) return DEFAULT_COLUMN_SETTINGS;
  const value: unknown = JSON.parse(raw);
  if (!value || typeof value !== "object" || Array.isArray(value)
    || Object.keys(value).some((key) => !["sideWidth", "openDelay", "closeDelay"].includes(key))
    || !("sideWidth" in value) || !inRange(value.sideWidth, COLUMN_SETTINGS_LIMITS.sideWidth)
    || !("openDelay" in value) || !inRange(value.openDelay, COLUMN_SETTINGS_LIMITS.openDelay)
    || !("closeDelay" in value) || !inRange(value.closeDelay, COLUMN_SETTINGS_LIMITS.closeDelay)) {
    throw new Error("Die Einstellungen der Arbeitsspalte sind ungültig: Breite 400 bis 4000 Pixel, Verzögerungen 0 bis 5000 beziehungsweise 10000 Millisekunden, ganze Zahlen.");
  }
  return value as ColumnSettings;
}

const setting = createLocalStorageSetting({
  changeEvent: "ragents-column-settings-change",
  matchesKey: (key) => key === COLUMN_SETTINGS_STORAGE_KEY,
  parse: parseColumnSettings,
  serialize: JSON.stringify,
});

export function useColumnSettings(): ColumnSettings {
  return setting.useValue(COLUMN_SETTINGS_STORAGE_KEY);
}

export function saveColumnSettings(value: ColumnSettings) {
  setting.save(COLUMN_SETTINGS_STORAGE_KEY, value);
}
