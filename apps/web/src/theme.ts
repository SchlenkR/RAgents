import { useSyncExternalStore } from "react";
import { subscribeStorageChanges } from "./lib/local-storage-setting";

export const THEME_STORAGE_KEY = "ragents.theme";
export type ThemePreference = "light" | "dark" | "system";
export type ResolvedTheme = Exclude<ThemePreference, "system">;

export const themeOptions = [
  { value: "light", label: "Hell" },
  { value: "dark", label: "Dunkel" },
  { value: "system", label: "System" },
] as const;

interface ThemeSnapshot {
  preference: ThemePreference;
  appearance: ResolvedTheme;
  error: string | null;
}

export function parseThemePreference(value: string | null): ThemePreference {
  if (value === null) return "dark";
  if (value === "light" || value === "dark" || value === "system") return value;
  throw new Error(`Ungültige Darstellung in ${THEME_STORAGE_KEY}: ${JSON.stringify(value)}. Erlaubt sind light, dark und system.`);
}

const errorMessage = (cause: unknown) => cause instanceof Error ? cause.message : String(cause);

export function createThemeStore(browser: Window) {
  let storage: Storage;
  let preference: ThemePreference;
  try {
    storage = browser.localStorage;
    preference = parseThemePreference(storage.getItem(THEME_STORAGE_KEY));
  } catch (cause) {
    throw new Error(`Die gespeicherte Darstellung konnte nicht geladen werden. ${errorMessage(cause)}`);
  }
  const media = browser.matchMedia("(prefers-color-scheme: dark)");
  const appearanceOf = (value: ThemePreference): ResolvedTheme => value === "system" ? media.matches ? "dark" : "light" : value;
  let snapshot: ThemeSnapshot = { preference, appearance: appearanceOf(preference), error: null };
  const listeners = new Set<() => void>();
  let watchingSystem = false;
  let disposed = false;

  function notify() {
    for (const listener of listeners) listener();
  }

  function systemChanged() {
    if (snapshot.preference !== "system") return;
    const appearance = appearanceOf("system");
    if (appearance === snapshot.appearance) return;
    snapshot = { ...snapshot, appearance };
    browser.document.documentElement.dataset.theme = appearance;
    notify();
  }

  function apply(next: ThemePreference) {
    const watchSystem = next === "system";
    if (watchSystem !== watchingSystem) {
      if (watchSystem) media.addEventListener("change", systemChanged);
      else media.removeEventListener("change", systemChanged);
      watchingSystem = watchSystem;
    }
    const appearance = appearanceOf(next);
    browser.document.documentElement.dataset.theme = appearance;
    if (snapshot.preference === next && snapshot.appearance === appearance && snapshot.error === null) return;
    snapshot = { preference: next, appearance, error: null };
    notify();
  }

  function reportError(message: string) {
    snapshot = { ...snapshot, error: message };
    notify();
  }

  function storageChanged(event: StorageEvent) {
    if (event.storageArea !== storage) return;
    try {
      apply(parseThemePreference(storage.getItem(THEME_STORAGE_KEY)));
    } catch (cause) {
      reportError(`Die Darstellung aus einem anderen Browser-Tab konnte nicht übernommen werden. ${errorMessage(cause)}`);
    }
  }

  apply(preference);
  const unsubscribeStorage = subscribeStorageChanges(browser, (key) => key === THEME_STORAGE_KEY, storageChanged);

  return {
    getSnapshot: () => snapshot,
    subscribe(listener: () => void) {
      if (disposed) throw new Error("Die Darstellung wurde bereits beendet.");
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    setPreference(next: ThemePreference) {
      if (disposed) throw new Error("Die Darstellung wurde bereits beendet.");
      try {
        parseThemePreference(next);
        storage.setItem(THEME_STORAGE_KEY, next);
        apply(next);
      } catch (cause) {
        reportError(`Die Darstellung konnte nicht gespeichert werden. ${errorMessage(cause)}`);
      }
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      unsubscribeStorage();
      if (watchingSystem) media.removeEventListener("change", systemChanged);
      listeners.clear();
    },
  };
}

let activeTheme: ReturnType<typeof createThemeStore> | undefined;

export function initializeTheme(browser: Window) {
  activeTheme?.dispose();
  activeTheme = undefined;
  activeTheme = createThemeStore(browser);
  return activeTheme;
}

export function getThemeStore() {
  if (!activeTheme) throw new Error("Die Darstellung wurde noch nicht initialisiert.");
  return activeTheme;
}

export function getResolvedTheme(): ResolvedTheme {
  return getThemeStore().getSnapshot().appearance;
}

export function useResolvedTheme(): ResolvedTheme {
  return useSyncExternalStore(getThemeStore().subscribe, getResolvedTheme);
}
