import { createLocalStorageSetting } from "@aicontainer/web/lib/local-storage-setting";
import { useEffect, useMemo } from "react";
import { ORCHESTRATION_PLUGIN_ID, canvasLayoutOf } from "../contract";
import { canvasTileEntities, canvasTileNodeOf, type CanvasTileNode } from "../tiled-layout";
import type { RunView } from "./run-view";

export interface CanvasPresentation {
  mode: "free" | "tiled";
  root: CanvasTileNode | null;
  programBasis?: string;
}

export const canvasPresentationStorageKey = (runId: string) => `ragents.orchestration.canvas-presentation:${runId}`;

export function parseCanvasPresentation(raw: string | null): CanvasPresentation | null {
  if (raw === null || raw === "null") return null;
  const value: unknown = JSON.parse(raw);
  if (!value || typeof value !== "object" || Array.isArray(value)
    || !("mode" in value) || (value.mode !== "free" && value.mode !== "tiled")
    || !("root" in value) || Object.keys(value).some((key) => !["mode", "root", "programBasis"].includes(key))
    || ("programBasis" in value && typeof value.programBasis !== "string")) {
    throw new Error("Die gespeicherte Kachelansicht ist ungültig.");
  }
  return { mode: value.mode, root: value.root === null ? null : canvasTileNodeOf(value.root),
    ...("programBasis" in value ? { programBasis: value.programBasis as string } : {}),
  };
}

const setting = createLocalStorageSetting({
  changeEvent: "ragents-canvas-presentation-change",
  matchesKey: (key) => key.startsWith("ragents.orchestration.canvas-presentation:"),
  parse: parseCanvasPresentation,
  serialize: JSON.stringify,
});

export const useCanvasPresentationOverride = (runId: string) => setting.useValue(canvasPresentationStorageKey(runId));
export const saveCanvasPresentation = (runId: string, value: CanvasPresentation | null) =>
  setting.save(canvasPresentationStorageKey(runId), value);

export const canvasProgramBasis = (program: CanvasPresentation): string => JSON.stringify({ mode: program.mode, root: program.root });

export function currentCanvasOverride(personal: CanvasPresentation | null, program: CanvasPresentation): CanvasPresentation | null {
  if (!personal) return null;
  if (personal.programBasis !== undefined) return personal.programBasis === canvasProgramBasis(program) ? personal : null;
  const entities = new Set(canvasTileEntities(personal.root));
  return canvasTileEntities(program.root).some((entity) => !entities.has(entity)) ? null : personal;
}

export function useCanvasPresentation(runId: string, view: RunView | undefined) {
  const state = view?.pluginStates.find((entry) => entry.pluginId === ORCHESTRATION_PLUGIN_ID && entry.scope.kind === "run")?.state;
  const stateKey = useMemo(() => state === undefined ? undefined : JSON.stringify(state), [state]);
  const programLayout = useMemo(() => {
    try { return { layout: stateKey === undefined ? undefined : canvasLayoutOf(JSON.parse(stateKey)) }; }
    catch (error) { return { error: error instanceof Error ? error.message : String(error) }; }
  }, [stateKey]);
  const program = useMemo((): CanvasPresentation => ({ mode: programLayout.layout?.mode ?? "free", root: programLayout.layout?.root ?? null }), [programLayout]);
  const programBasis = useMemo(() => canvasProgramBasis(program), [program]);
  const storedLayout = useCanvasPresentationOverride(runId);
  const personalLayout = view && !programLayout.error ? currentCanvasOverride(storedLayout, program) : storedLayout;
  useEffect(() => {
    if (storedLayout && !personalLayout) saveCanvasPresentation(runId, null);
  }, [runId, storedLayout, personalLayout]);
  return { programLayout, personalLayout, presentation: personalLayout ?? program, programBasis };
}

export function initialTileLayout(entities: readonly string[], direction: "horizontal" | "vertical" = "horizontal"): CanvasTileNode | null {
  if (entities.length === 0) return null;
  if (entities.length === 1) return { entity: entities[0]! };
  const middle = Math.ceil(entities.length / 2);
  const nextDirection = direction === "horizontal" ? "vertical" : "horizontal";
  return {
    direction,
    weights: [middle, entities.length - middle],
    children: [initialTileLayout(entities.slice(0, middle), nextDirection)!, initialTileLayout(entities.slice(middle), nextDirection)!],
  };
}
