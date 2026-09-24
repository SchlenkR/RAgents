import { useMemo, useSyncExternalStore } from "react";

export function subscribeStorageChanges(browser: Window, matchesKey: (key: string) => boolean, listener: (event: StorageEvent) => void) {
  const onStorage = (event: StorageEvent) => {
    if (event.key === null || matchesKey(event.key)) listener(event);
  };
  browser.addEventListener("storage", onStorage);
  return () => browser.removeEventListener("storage", onStorage);
}

export function createLocalStorageSetting<T>({ changeEvent, matchesKey, parse, serialize }: {
  changeEvent: string;
  matchesKey: (key: string) => boolean;
  parse: (raw: string | null) => T;
  serialize: (value: T) => string;
}) {
  const subscribe = (listener: () => void) => {
    const unsubscribeStorage = subscribeStorageChanges(window, matchesKey, (event) => {
      if (event.storageArea === window.localStorage) listener();
    });
    window.addEventListener(changeEvent, listener);
    return () => {
      window.removeEventListener(changeEvent, listener);
      unsubscribeStorage();
    };
  };
  return {
    useValue(key: string): T {
      const raw = useSyncExternalStore(subscribe, () => window.localStorage.getItem(key), () => null);
      return useMemo(() => parse(raw), [raw]);
    },
    save(key: string, value: T) {
      const raw = serialize(value);
      parse(raw);
      window.localStorage.setItem(key, raw);
      window.dispatchEvent(new Event(changeEvent));
    },
  };
}
