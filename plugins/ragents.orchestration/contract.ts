import { handleKey } from "@ragents/engine/src/http/contracts";
import { canvasTileNodeOf } from "./tiled-layout.js";

export const ORCHESTRATION_PLUGIN_ID = "ragents.orchestration";

export type CanvasEntity =
  | { kind: "actor"; handle: string }
  | { kind: "app"; id: string };

export type CanvasTileNode =
  | { entity: string; chatInput?: boolean }
  | { direction: "horizontal" | "vertical"; weights: [number, number]; children: [CanvasTileNode, CanvasTileNode] };

export type CanvasLayout = {
  root: CanvasTileNode | null;
};

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);

export const canvasEntityOf = (text: string): CanvasEntity => {
  const trimmed = text.trim();
  if (trimmed.startsWith("@")) {
    const handle = handleKey(trimmed);
    if (!handle || /\s/.test(handle)) throw new Error(`Entität ${JSON.stringify(text)}: nach dem @ fehlt ein Handle`);
    return { kind: "actor", handle };
  }
  const match = /^app:(.+)$/s.exec(trimmed);
  if (!match) {
    throw new Error(`Entität ${JSON.stringify(text)}: erwartet @handle oder app:<id>`);
  }
  const id = match[1].trim();
  if (!id) throw new Error(`Entität ${JSON.stringify(text)}: die ID nach dem Doppelpunkt ist leer`);
  return { kind: "app", id };
};

export const canvasEntityKey = (entity: CanvasEntity): string =>
  entity.kind === "actor" ? `@${entity.handle}` : `app:${entity.id}`;

const LEGACY_KEYS = ["nodes", "shapes", "lines", "mode"] as const;

/** Parses and validates a tile layout; throws a German error naming the first violation. */
export const canvasLayoutOf = (value: unknown): CanvasLayout => {
  if (!isRecord(value)) throw new Error("Die Anordnung muss ein Objekt mit root sein");
  const legacy = LEGACY_KEYS.filter((key) => key in value);
  if (legacy.length > 0) {
    throw new Error(`Die Programmanordnung stammt aus dem entfernten freien Canvas (${legacy.join(", ")}); `
      + "canvas_layout_replace mit root setzt sie als Kachelaufteilung neu");
  }
  if (!("root" in value)) throw new Error("root fehlt; erwartet wird eine Kachel, eine Teilung oder null");
  return { root: value.root === null ? null : canvasTileNodeOf(value.root) };
};
