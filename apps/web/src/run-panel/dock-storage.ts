import { useCallback, useMemo, useState, useSyncExternalStore } from "react";
import { initialDockState, parseDockState, persistentDockState, type DockState } from "./dock-state";

const snapshots = new Map<string, string>();
const snapshot = (key: string): string | null => snapshots.get(key) ?? window.localStorage.getItem(key);
const changeEvent = "ragents-dock-layout-change";
export const dockStorageKey = (server: string, run: string) => `ragents.docking:${encodeURIComponent(server)}:${encodeURIComponent(run)}`;
const subscribe = (listener: () => void) => {
  const onStorage = (event: StorageEvent) => {
    if (event.key === null) snapshots.clear();
    else snapshots.delete(event.key);
    listener();
  };
  window.addEventListener("storage", onStorage);
  window.addEventListener(changeEvent, listener);
  return () => {
    window.removeEventListener("storage", onStorage);
    window.removeEventListener(changeEvent, listener);
  };
};

function read(key: string): { state: DockState; error?: string } {
  try { return { state: parseDockState(snapshot(key)) }; }
  catch (error) { return { state: initialDockState(), error: String(error) }; }
}

export function useDockStorage(runId: string) {
  const key = dockStorageKey(typeof window === "undefined" ? "" : window.location?.origin ?? "", runId);
  const raw = useSyncExternalStore(subscribe, () => {
    try { return snapshot(key); }
    catch (error) { return String(error); }
  }, () => null);
  const loaded = useMemo(() => {
    try { return { state: parseDockState(raw), error: undefined }; }
    catch (error) { return { state: initialDockState(), error: String(error) }; }
  }, [raw]);
  const [writeError, setWriteError] = useState<string>();
  const update = useCallback((change: (state: DockState) => DockState, reset = false) => {
    const current = read(key);
    if (current.error && !reset) return;
    try {
      const next = change(current.state);
      if (!reset && next === current.state) return;
      const value = JSON.stringify(next);
      parseDockState(value);
      window.localStorage.setItem(key, JSON.stringify(persistentDockState(next)));
      snapshots.set(key, value);
      setWriteError(undefined);
      window.dispatchEvent(new Event(changeEvent));
    } catch (error) { setWriteError(`Could not save docking layout: ${String(error)}`); }
  }, [key]);
  return { state: loaded.state, error: loaded.error ?? writeError, update };
}
