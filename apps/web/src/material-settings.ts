import { useSyncExternalStore } from "react";
import { subscribeStorageChanges } from "./lib/local-storage-setting";

export interface MaterialSettings {
  steps: number;
}

export const DEFAULT_MATERIAL_SETTINGS: MaterialSettings = Object.freeze({ steps: 1 });
export const MATERIAL_SETTINGS_LIMITS = { minSteps: 0, maxSteps: 5 };
export const MATERIAL_DEPTH_PER_STEP = 12;
export const MATERIAL_SETTINGS_STORAGE_KEY = "ragents.material-settings";

interface MaterialSettingsSnapshot {
  settings: MaterialSettings;
  error?: string;
}

export function parseMaterialSettings(raw: string | null): MaterialSettings {
  if (raw === null) return DEFAULT_MATERIAL_SETTINGS;
  const value: unknown = JSON.parse(raw);
  if (!value || typeof value !== "object" || !("steps" in value)
    || typeof value.steps !== "number" || !Number.isInteger(value.steps) || value.steps < MATERIAL_SETTINGS_LIMITS.minSteps || value.steps > MATERIAL_SETTINGS_LIMITS.maxSteps) {
    throw new Error("Ungültiges Material: Tiefenstufen müssen eine ganze Zahl von 0 bis 5 sein. Bitte die Materialeinstellungen zurücksetzen.");
  }
  return Object.freeze({ steps: value.steps });
}

const errorMessage = (cause: unknown) => cause instanceof Error ? cause.message : String(cause);
const serverSnapshot: MaterialSettingsSnapshot = { settings: DEFAULT_MATERIAL_SETTINGS };
const getServerSnapshot = () => serverSnapshot;
const subscribeServer = () => () => {};

export function createMaterialSettingsStore(browser: Window) {
  let snapshot: MaterialSettingsSnapshot;
  try {
    snapshot = { settings: parseMaterialSettings(browser.localStorage.getItem(MATERIAL_SETTINGS_STORAGE_KEY)) };
  } catch (cause) {
    snapshot = { settings: DEFAULT_MATERIAL_SETTINGS, error: `Das gespeicherte Material konnte nicht geladen werden. Die Standardwerte werden angezeigt. ${errorMessage(cause)}` };
  }
  const listeners = new Set<() => void>();
  let disposed = false;
  const publish = (next: MaterialSettingsSnapshot) => {
    if (snapshot.settings.steps === next.settings.steps && snapshot.error === next.error) return;
    snapshot = next;
    for (const listener of listeners) listener();
  };
  const report = (message: string) => publish({ ...snapshot, error: message });
  const storageChanged = (event: StorageEvent) => {
    try {
      const storage = browser.localStorage;
      if (event.storageArea !== storage) return;
      publish({ settings: parseMaterialSettings(storage.getItem(MATERIAL_SETTINGS_STORAGE_KEY)) });
    } catch (cause) {
      report(`Das Material aus einem anderen Browser-Tab konnte nicht übernommen werden. ${errorMessage(cause)}`);
    }
  };
  const unsubscribeStorage = subscribeStorageChanges(browser, (key) => key === MATERIAL_SETTINGS_STORAGE_KEY, storageChanged);
  return {
    getSnapshot: () => snapshot,
    subscribe(listener: () => void) {
      if (disposed) throw new Error("Die Materialeinstellungen wurden bereits beendet.");
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    save(settings: MaterialSettings) {
      if (disposed) throw new Error("Die Materialeinstellungen wurden bereits beendet.");
      try {
        const next = parseMaterialSettings(JSON.stringify(settings));
        browser.localStorage.setItem(MATERIAL_SETTINGS_STORAGE_KEY, JSON.stringify(next));
        publish({ settings: next });
      } catch (cause) {
        report(`Das Material konnte nicht gespeichert werden. ${errorMessage(cause)}`);
      }
    },
    reset() {
      if (disposed) throw new Error("Die Materialeinstellungen wurden bereits beendet.");
      try {
        browser.localStorage.removeItem(MATERIAL_SETTINGS_STORAGE_KEY);
        publish({ settings: DEFAULT_MATERIAL_SETTINGS });
        return true;
      } catch (cause) {
        report(`Das Material konnte nicht zurückgesetzt werden. ${errorMessage(cause)}`);
        return false;
      }
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      unsubscribeStorage();
      listeners.clear();
    },
  };
}

let activeStore: ReturnType<typeof createMaterialSettingsStore> | undefined;
const materialSettingsStore = () => activeStore ??= createMaterialSettingsStore(window);

export function useMaterialSettings(): MaterialSettingsSnapshot {
  const store = typeof window === "undefined" ? undefined : materialSettingsStore();
  return useSyncExternalStore(store?.subscribe ?? subscribeServer, store?.getSnapshot ?? getServerSnapshot, getServerSnapshot);
}

export const saveMaterialSettings = (settings: MaterialSettings): void => materialSettingsStore().save(settings);
export const resetMaterialSettings = (): boolean => materialSettingsStore().reset();
