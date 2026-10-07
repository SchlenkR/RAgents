import { useSyncExternalStore } from "react";
import { subscribeStorageChanges } from "./lib/local-storage-setting";

export const PALETTE_STORAGE_KEY = "ragents.palette";

export const paletteOptions = [
  { value: "schichtwerk", label: "Schichtwerk", description: "Violet-tinted layers with drawn outlines." },
  { value: "graphite", label: "Graphite", description: "Neutral grey with one violet accent." },
  { value: "midnight", label: "Midnight", description: "Deep blue-black with a sky accent." },
  { value: "black", label: "Black", description: "True black with a cyan accent." },
] as const;

export type PaletteId = (typeof paletteOptions)[number]["value"];

export const defaultPalette: PaletteId = "schichtwerk";

interface PaletteSnapshot {
  palette: PaletteId;
  error: string | null;
}

export function parsePalette(value: string | null): PaletteId {
  if (value === null) return defaultPalette;
  const option = paletteOptions.find((entry) => entry.value === value);
  if (option) return option.value;
  throw new Error(`Invalid palette in ${PALETTE_STORAGE_KEY}: ${JSON.stringify(value)}. Allowed are ${paletteOptions.map((entry) => entry.value).join(", ")}.`);
}

const errorMessage = (cause: unknown) => cause instanceof Error ? cause.message : String(cause);

export function createPaletteStore(browser: Window) {
  let storage: Storage;
  let snapshot: PaletteSnapshot;
  try {
    storage = browser.localStorage;
    snapshot = { palette: parsePalette(storage.getItem(PALETTE_STORAGE_KEY)), error: null };
  } catch (cause) {
    throw new Error(`The saved palette could not be loaded. ${errorMessage(cause)}`);
  }
  const listeners = new Set<() => void>();
  let disposed = false;

  function notify() {
    for (const listener of listeners) listener();
  }

  function apply(next: PaletteId) {
    browser.document.documentElement.dataset.palette = next;
    if (snapshot.palette === next && snapshot.error === null) return;
    snapshot = { palette: next, error: null };
    notify();
  }

  function reportError(message: string) {
    snapshot = { ...snapshot, error: message };
    notify();
  }

  function storageChanged(event: StorageEvent) {
    if (event.storageArea !== storage) return;
    try {
      apply(parsePalette(storage.getItem(PALETTE_STORAGE_KEY)));
    } catch (cause) {
      reportError(`The palette from another browser tab could not be applied. ${errorMessage(cause)}`);
    }
  }

  apply(snapshot.palette);
  const unsubscribeStorage = subscribeStorageChanges(browser, (key) => key === PALETTE_STORAGE_KEY, storageChanged);

  return {
    getSnapshot: () => snapshot,
    subscribe(listener: () => void) {
      if (disposed) throw new Error("The palette has already been disposed.");
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    setPalette(next: PaletteId) {
      if (disposed) throw new Error("The palette has already been disposed.");
      try {
        parsePalette(next);
        storage.setItem(PALETTE_STORAGE_KEY, next);
        apply(next);
      } catch (cause) {
        reportError(`The palette could not be saved. ${errorMessage(cause)}`);
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

let activePalette: ReturnType<typeof createPaletteStore> | undefined;

export function initializePalette(browser: Window) {
  activePalette?.dispose();
  activePalette = undefined;
  activePalette = createPaletteStore(browser);
  return activePalette;
}

export function getPaletteStore() {
  if (!activePalette) throw new Error("The palette has not been initialized yet.");
  return activePalette;
}

export function usePalette(): PaletteId {
  const store = getPaletteStore();
  return useSyncExternalStore(store.subscribe, () => store.getSnapshot().palette);
}
