import { useMemo, useSyncExternalStore } from "react";
import {
  allowedAppearanceValues,
  appearanceChoiceIds,
  appearanceChoices,
  isAppearanceValue,
  type AppearanceChoiceId,
  type AppearanceValue,
} from "./appearance-options";
import { subscribeStorageChanges } from "./lib/local-storage-setting";

export interface ChoiceSnapshot<Id extends AppearanceChoiceId> {
  value: AppearanceValue<Id>;
  error: string | null;
}

const errorMessage = (cause: unknown) => cause instanceof Error ? cause.message : String(cause);
const nameOf = (id: AppearanceChoiceId) => appearanceChoices[id].label.toLowerCase();

export function parseAppearanceValue<Id extends AppearanceChoiceId>(id: Id, value: string | null): AppearanceValue<Id> {
  const choice = appearanceChoices[id];
  if (value === null) return choice.fallback as AppearanceValue<Id>;
  if (isAppearanceValue(id, value)) return value;
  throw new Error(`Invalid ${nameOf(id)} in ${choice.storageKey}: ${JSON.stringify(value)}. Allowed are ${allowedAppearanceValues(id)}.`);
}

export function createChoiceStore<Id extends AppearanceChoiceId>(browser: Window, id: Id) {
  const choice = appearanceChoices[id];
  let storage: Storage;
  let snapshot: ChoiceSnapshot<Id>;
  try {
    storage = browser.localStorage;
    snapshot = { value: parseAppearanceValue(id, storage.getItem(choice.storageKey)), error: null };
  } catch (cause) {
    throw new Error(`The saved ${nameOf(id)} could not be loaded. ${errorMessage(cause)}`);
  }
  const listeners = new Set<() => void>();
  let disposed = false;

  function notify() {
    for (const listener of listeners) listener();
  }

  function apply(next: AppearanceValue<Id>) {
    browser.document.documentElement.dataset[dataKey(choice.attribute)] = next;
    if (snapshot.value === next && snapshot.error === null) return;
    snapshot = { value: next, error: null };
    notify();
  }

  function reportError(message: string) {
    snapshot = { ...snapshot, error: message };
    notify();
  }

  function storageChanged(event: StorageEvent) {
    if (event.storageArea !== storage) return;
    try {
      apply(parseAppearanceValue(id, storage.getItem(choice.storageKey)));
    } catch (cause) {
      reportError(`The ${nameOf(id)} from another browser tab could not be applied. ${errorMessage(cause)}`);
    }
  }

  apply(snapshot.value);
  const unsubscribeStorage = subscribeStorageChanges(browser, (key) => key === choice.storageKey, storageChanged);

  return {
    getSnapshot: () => snapshot,
    subscribe(listener: () => void) {
      if (disposed) throw new Error(`The ${nameOf(id)} has already been disposed.`);
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    set(next: AppearanceValue<Id>) {
      if (disposed) throw new Error(`The ${nameOf(id)} has already been disposed.`);
      try {
        parseAppearanceValue(id, next);
        storage.setItem(choice.storageKey, next);
        apply(next);
      } catch (cause) {
        reportError(`The ${nameOf(id)} could not be saved. ${errorMessage(cause)}`);
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

export type ChoiceStore<Id extends AppearanceChoiceId> = ReturnType<typeof createChoiceStore<Id>>;
type ChoiceStores = { readonly [Id in AppearanceChoiceId]: ChoiceStore<Id> };

const dataKey = (attribute: string) => attribute.replace(/-([a-z])/g, (_, letter: string) => letter.toUpperCase());

let activeStores: ChoiceStores | undefined;

export function initializeAppearance(browser: Window) {
  disposeAppearance();
  const stores = {
    palette: createChoiceStore(browser, "palette"),
    codeStyle: createChoiceStore(browser, "codeStyle"),
    corners: createChoiceStore(browser, "corners"),
    density: createChoiceStore(browser, "density"),
  } satisfies ChoiceStores;
  activeStores = stores;
  return { ...stores, dispose: disposeAppearance };
}

function disposeAppearance() {
  if (!activeStores) return;
  for (const id of appearanceChoiceIds) activeStores[id].dispose();
  activeStores = undefined;
}

export function getChoiceStore<Id extends AppearanceChoiceId>(id: Id): ChoiceStore<Id> {
  if (!activeStores) throw new Error("The appearance has not been initialized yet.");
  return activeStores[id] as unknown as ChoiceStore<Id>;
}

export function useChoice<Id extends AppearanceChoiceId>(id: Id): ChoiceSnapshot<Id> {
  const store = getChoiceStore(id);
  return useSyncExternalStore(store.subscribe, store.getSnapshot);
}

export const usePalette = (): AppearanceValue<"palette"> => useChoice("palette").value;

/** What a mini-app frame takes over besides palette and scheme. */
export function useLooks() {
  const codeStyle = useChoice("codeStyle").value;
  const corners = useChoice("corners").value;
  const density = useChoice("density").value;
  return useMemo(() => ({ codeStyle, corners, density }), [codeStyle, corners, density]);
}

function setChoice<Id extends AppearanceChoiceId>(id: Id, value: string) {
  if (!isAppearanceValue(id, value)) throw new Error(`Unknown ${nameOf(id)} ${JSON.stringify(value)}. Allowed are ${allowedAppearanceValues(id)}.`);
  getChoiceStore(id).set(value);
}

/** Applies values a host sends; an unknown value is a hard error so a host never silently shows another look. */
export function applyAppearance(values: Partial<Record<AppearanceChoiceId, string>>) {
  for (const id of appearanceChoiceIds) {
    const value = values[id];
    if (value !== undefined) setChoice(id, value);
  }
}
