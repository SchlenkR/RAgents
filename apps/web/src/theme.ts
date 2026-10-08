import { useSyncExternalStore } from "react";
import { subscribeStorageChanges } from "./lib/local-storage-setting";

export { useLooks, usePalette } from "./appearance";
export type { PaletteId } from "./appearance-options";

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

/** Where "system" gets its scheme from: the browser, or in VS Code the editor. */
export interface SystemScheme {
  current(): ResolvedTheme;
  subscribe(listener: () => void): () => void;
}

export function browserSystemScheme(browser: Window): SystemScheme {
  const media = browser.matchMedia("(prefers-color-scheme: dark)");
  return {
    current: () => media.matches ? "dark" : "light",
    subscribe(listener) {
      media.addEventListener("change", listener);
      return () => media.removeEventListener("change", listener);
    },
  };
}

export function createEditorSystemScheme(initial: ResolvedTheme) {
  let scheme = initial;
  const listeners = new Set<() => void>();
  return {
    current: () => scheme,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    set(next: ResolvedTheme) {
      if (next === scheme) return;
      scheme = next;
      for (const listener of listeners) listener();
    },
  };
}

export function createThemeStore(browser: Window, system: SystemScheme = browserSystemScheme(browser)) {
  let storage: Storage;
  let preference: ThemePreference;
  try {
    storage = browser.localStorage;
    preference = parseThemePreference(storage.getItem(THEME_STORAGE_KEY));
  } catch (cause) {
    throw new Error(`The saved theme could not be loaded. ${errorMessage(cause)}`);
  }
  const appearanceOf = (value: ThemePreference): ResolvedTheme => value === "system" ? system.current() : value;
  let snapshot: ThemeSnapshot = { preference, appearance: appearanceOf(preference), error: null };
  const listeners = new Set<() => void>();
  let unwatchSystem: (() => void) | undefined;
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
    if ((next === "system") !== (unwatchSystem !== undefined)) {
      if (next === "system") unwatchSystem = system.subscribe(systemChanged);
      else {
        unwatchSystem?.();
        unwatchSystem = undefined;
      }
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
      unwatchSystem?.();
      listeners.clear();
    },
  };
}

let activeTheme: ReturnType<typeof createThemeStore> | undefined;

export function initializeTheme(browser: Window, system?: SystemScheme) {
  activeTheme?.dispose();
  activeTheme = undefined;
  activeTheme = createThemeStore(browser, system);
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
