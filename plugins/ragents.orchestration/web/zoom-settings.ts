import { createLocalStorageSetting } from "@aicontainer/web/lib/local-storage-setting";

export const DEFAULT_PINCH_ZOOM_SENSITIVITY = 2;
export const PINCH_ZOOM_STORAGE_KEY = "ragents.orchestration.pinch-zoom-sensitivity";

export function parsePinchZoomSensitivity(raw: string | null): number {
  if (raw === null) return DEFAULT_PINCH_ZOOM_SENSITIVITY;
  const value = Number(raw);
  if (!Number.isFinite(value) || value < 0.1 || value > 10) {
    throw new Error("Die Pinch-Zoom-Empfindlichkeit muss zwischen 0,1 und 10 liegen.");
  }
  return value;
}

const setting = createLocalStorageSetting({
  changeEvent: "ragents-pinch-zoom-change",
  matchesKey: (key) => key === PINCH_ZOOM_STORAGE_KEY,
  parse: parsePinchZoomSensitivity,
  serialize: String,
});

export function usePinchZoomSensitivity(): number {
  return setting.useValue(PINCH_ZOOM_STORAGE_KEY);
}

export function savePinchZoomSensitivity(value: number) {
  setting.save(PINCH_ZOOM_STORAGE_KEY, value);
}
