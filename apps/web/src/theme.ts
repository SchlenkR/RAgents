import { useSyncExternalStore } from "react";
import { subscribeStorageChanges } from "./lib/local-storage-setting";

export const THEME_STORAGE_KEY = "ragents.theme";
export type ThemePreference = "light" | "dark" | "system";
export type ResolvedTheme = Exclude<ThemePreference, "system">;

export const themeOptions = [
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
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
  throw new Error(`Invalid theme in ${THEME_STORAGE_KEY}: ${JSON.stringify(value)}. Allowed are light, dark, and system.`);
}

const errorMessage = (cause: unknown) => cause instanceof Error ? cause.message : String(cause);

export function createThemeStore(browser: Window) {
  let storage: Storage;
  let preference: ThemePreference;
  try {
    storage = browser.localStorage;
    preference = parseThemePreference(storage.getItem(THEME_STORAGE_KEY));
  } catch (cause) {
    throw new Error(`The saved theme could not be loaded. ${errorMessage(cause)}`);
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
      reportError(`The theme from another browser tab could not be applied. ${errorMessage(cause)}`);
    }
  }

  apply(preference);
  const unsubscribeStorage = subscribeStorageChanges(browser, (key) => key === THEME_STORAGE_KEY, storageChanged);

  return {
    getSnapshot: () => snapshot,
    subscribe(listener: () => void) {
      if (disposed) throw new Error("The theme has already been disposed.");
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    setPreference(next: ThemePreference) {
      if (disposed) throw new Error("The theme has already been disposed.");
      try {
        parseThemePreference(next);
        storage.setItem(THEME_STORAGE_KEY, next);
        apply(next);
      } catch (cause) {
        reportError(`The theme could not be saved. ${errorMessage(cause)}`);
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
  if (!activeTheme) throw new Error("The theme has not been initialized yet.");
  return activeTheme;
}

export function getResolvedTheme(): ResolvedTheme {
  return getThemeStore().getSnapshot().appearance;
}

export function useResolvedTheme(): ResolvedTheme {
  return useSyncExternalStore(getThemeStore().subscribe, getResolvedTheme);
}
