import { handleKey } from "@ragents/engine/src/http/contracts";
import { surfaceTileNodeOf } from "./tiled-layout.js";

export const ORCHESTRATION_PLUGIN_ID = "ragents.orchestration";

export type SurfaceEntity =
  | { kind: "actor"; handle: string }
  | { kind: "app"; id: string };

export type SurfaceTileNode =
  | { entity: string; chatInput?: boolean }
  | { direction: "horizontal" | "vertical"; weights: [number, number]; children: [SurfaceTileNode, SurfaceTileNode] };

export type SurfaceLayout = {
  root: SurfaceTileNode | null;
};

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);

export const surfaceEntityOf = (text: string): SurfaceEntity => {
  const trimmed = text.trim();
  if (trimmed.startsWith("@")) {
    const handle = handleKey(trimmed);
    if (!handle || /\s/.test(handle)) throw new Error(`Entity ${JSON.stringify(text)}: a handle is missing after the @`);
    return { kind: "actor", handle };
  }
  const match = /^app:(.+)$/s.exec(trimmed);
  if (!match) {
    throw new Error(`Entity ${JSON.stringify(text)}: expected @handle or app:<id>`);
  }
  const id = match[1].trim();
  if (!id) throw new Error(`Entity ${JSON.stringify(text)}: the ID after the colon is empty`);
  return { kind: "app", id };
};

export const surfaceEntityKey = (entity: SurfaceEntity): string =>
  entity.kind === "actor" ? `@${entity.handle}` : `app:${entity.id}`;

const LEGACY_KEYS = ["nodes", "shapes", "lines", "mode"] as const;

/** Parses and validates a tile layout; throws an error naming the first violation. */
export const surfaceLayoutOf = (value: unknown): SurfaceLayout => {
  if (!isRecord(value)) throw new Error("The arrangement must be an object with root");
  const legacy = LEGACY_KEYS.filter((key) => key in value);
  if (legacy.length > 0) {
    throw new Error(`The program arrangement comes from the removed free surface (${legacy.join(", ")}); `
      + "canvas_layout_replace with root sets it anew as a tile layout");
  }
  if (!("root" in value)) throw new Error("root is missing; expected a tile, a split or null");
  return { root: value.root === null ? null : surfaceTileNodeOf(value.root) };
};
