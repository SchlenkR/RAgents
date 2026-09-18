export interface CanvasCamera { x: number; y: number; zoom: number }
export interface CanvasSize { width: number; height: number }
export interface CanvasElementSizes {
  canvasSizes: [string, CanvasSize][];
  actorSizes: [string, CanvasSize][];
  expandedActors: string[];
  collapsedElements: string[];
}

export const canvasLayoutStorageKey = (runId: string, part: "camera" | "elements") =>
  `ragents.orchestration.canvas-layout:${runId}:${part}`;

const record = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);
const finite = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);
const positive = (value: unknown): value is number => finite(value) && value > 0;

export function parseCanvasCamera(raw: string | null): CanvasCamera | undefined {
  if (raw === null) return undefined;
  const value: unknown = JSON.parse(raw);
  if (!record(value) || !finite(value.x) || !finite(value.y) || !positive(value.zoom) || value.zoom > 2.5) {
    throw new Error("Die gespeicherte Canvas-Kamera ist ungültig.");
  }
  return { x: value.x, y: value.y, zoom: value.zoom };
}

export function parseCanvasElementSizes(raw: string | null): CanvasElementSizes {
  if (raw === null) return { canvasSizes: [], actorSizes: [], expandedActors: [], collapsedElements: [] };
  const value: unknown = JSON.parse(raw);
  const sizes = (entries: unknown) => Array.isArray(entries) && entries.every((entry: unknown) =>
    Array.isArray(entry) && entry.length === 2 && typeof entry[0] === "string"
    && record(entry[1]) && positive(entry[1].width) && positive(entry[1].height));
  const ids = (entries: unknown) => Array.isArray(entries) && entries.every((entry: unknown) => typeof entry === "string");
  if (!record(value) || !sizes(value.canvasSizes) || !sizes(value.actorSizes)
    || !ids(value.expandedActors) || !ids(value.collapsedElements)) {
    throw new Error("Die gespeicherten Canvas-Größen sind ungültig.");
  }
  return value as unknown as CanvasElementSizes;
}
