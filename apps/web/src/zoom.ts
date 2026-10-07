import { subscribeStorageChanges } from "./lib/local-storage-setting";

export const ZOOM_STORAGE_KEY = "ragents.zoom";
export const zoomSteps = [80, 90, 100, 110, 120, 130, 150] as const;
export type ZoomStep = typeof zoomSteps[number];

interface ZoomSnapshot {
  readonly zoom: ZoomStep;
  readonly error: string | null;
}

const isZoomStep = (value: number): value is ZoomStep => (zoomSteps as readonly number[]).includes(value);

export function parseZoom(value: string | null): ZoomStep {
  if (value === null) return 100;
  const zoom = /^\d+$/.test(value) ? Number(value) : Number.NaN;
  if (isZoomStep(zoom)) return zoom;
  throw new Error(`Invalid zoom in ${ZOOM_STORAGE_KEY}: ${JSON.stringify(value)}. Allowed are ${zoomSteps.join(", ")} percent.`);
}

const errorMessage = (cause: unknown) => cause instanceof Error ? cause.message : String(cause);

/** The zoom of the whole page in the browser, as a transform of the root element; in VS Code the shell scales with ragents.zoom instead. */
export function createZoomStore(browser: Window) {
  const loaded = (() => {
    try {
      const storage = browser.localStorage;
      return { storage, zoom: parseZoom(storage.getItem(ZOOM_STORAGE_KEY)) };
    } catch (cause) {
      throw new Error(`The saved zoom could not be loaded. ${errorMessage(cause)}`);
    }
  })();
  const storage = loaded.storage;
  let snapshot: ZoomSnapshot = { zoom: loaded.zoom, error: null };
  const listeners = new Set<() => void>();
  let disposed = false;

  function notify() {
    for (const listener of listeners) listener();
  }

  function apply(next: ZoomStep) {
    const style = browser.document.documentElement.style;
    const scale = next / 100;
    style.setProperty("--ragents-viewport-width", `calc(100vw / ${scale})`);
    style.setProperty("--ragents-viewport-height", `calc(100dvh / ${scale})`);
    if (next === 100) {
      for (const property of ["transform", "transform-origin", "width", "height"]) style.removeProperty(property);
    } else {
      style.setProperty("transform", `scale(${scale})`);
      style.setProperty("transform-origin", "top left");
      style.setProperty("width", `calc(100% / ${scale})`);
      style.setProperty("height", `calc(100% / ${scale})`);
    }
    if (snapshot.zoom === next && snapshot.error === null) return;
    snapshot = { zoom: next, error: null };
    notify();
  }

  function reportError(message: string) {
    snapshot = { ...snapshot, error: message };
    notify();
  }

  function storageChanged(event: StorageEvent) {
    if (event.storageArea !== storage) return;
    try {
      apply(parseZoom(storage.getItem(ZOOM_STORAGE_KEY)));
    } catch (cause) {
      reportError(`The zoom from another browser tab could not be applied. ${errorMessage(cause)}`);
    }
  }

  apply(loaded.zoom);
  const unsubscribeStorage = subscribeStorageChanges(browser, (key) => key === ZOOM_STORAGE_KEY, storageChanged);

  return {
    getSnapshot: () => snapshot,
    subscribe(listener: () => void) {
      if (disposed) throw new Error("The zoom has already been disposed.");
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    setZoom(next: ZoomStep) {
      if (disposed) throw new Error("The zoom has already been disposed.");
      try {
        parseZoom(String(next));
        storage.setItem(ZOOM_STORAGE_KEY, String(next));
        apply(next);
      } catch (cause) {
        reportError(`The zoom could not be saved. ${errorMessage(cause)}`);
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

let activeZoom: ReturnType<typeof createZoomStore> | undefined;

export function initializeZoom(browser: Window) {
  activeZoom?.dispose();
  activeZoom = undefined;
  activeZoom = createZoomStore(browser);
  return activeZoom;
}

export function getZoomStore() {
  if (!activeZoom) throw new Error("The zoom has not been initialized yet.");
  return activeZoom;
}
