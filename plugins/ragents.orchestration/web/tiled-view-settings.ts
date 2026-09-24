import { createLocalStorageSetting } from "@ragents/web/lib/local-storage-setting";
import { useEffect, useMemo } from "react";
import { ORCHESTRATION_PLUGIN_ID, surfaceLayoutOf } from "../contract";
import { surfaceTileEntities, surfaceTileNodeOf, type SurfaceTileNode } from "../tiled-layout";
import type { RunView } from "@ragents/web/run-view";

export interface SurfacePresentation {
  root: SurfaceTileNode | null;
  programBasis?: string;
}

export const surfacePresentationStorageKey = (runId: string) => `ragents.orchestration.tile-presentation:${runId}`;

export function parseSurfacePresentation(raw: string | null): SurfacePresentation | null {
  if (raw === null || raw === "null") return null;
  const value: unknown = JSON.parse(raw);
  if (!value || typeof value !== "object" || Array.isArray(value)
    || !("root" in value) || Object.keys(value).some((key) => !["root", "programBasis"].includes(key))
    || ("programBasis" in value && typeof value.programBasis !== "string")) {
    throw new Error("Die gespeicherte Kachelansicht ist ungültig.");
  }
  return { root: value.root === null ? null : surfaceTileNodeOf(value.root),
    ...("programBasis" in value ? { programBasis: value.programBasis as string } : {}),
  };
}

const setting = createLocalStorageSetting({
  changeEvent: "ragents-tile-presentation-change",
  matchesKey: (key) => key.startsWith("ragents.orchestration.tile-presentation:"),
  parse: parseSurfacePresentation,
  serialize: JSON.stringify,
});

export const useSurfacePresentationOverride = (runId: string) => setting.useValue(surfacePresentationStorageKey(runId));
export const saveSurfacePresentation = (runId: string, value: SurfacePresentation | null) =>
  setting.save(surfacePresentationStorageKey(runId), value);

export const surfaceProgramBasis = (program: SurfacePresentation): string => JSON.stringify({ root: program.root });

export function currentSurfaceOverride(personal: SurfacePresentation | null, program: SurfacePresentation): SurfacePresentation | null {
  if (!personal) return null;
  if (personal.programBasis !== undefined) return personal.programBasis === surfaceProgramBasis(program) ? personal : null;
  const entities = new Set(surfaceTileEntities(personal.root));
  return surfaceTileEntities(program.root).some((entity) => !entities.has(entity)) ? null : personal;
}

export function useSurfacePresentation(runId: string, view: RunView | undefined) {
  const state = view?.pluginStates.find((entry) => entry.pluginId === ORCHESTRATION_PLUGIN_ID && entry.scope.kind === "run")?.state;
  const stateKey = useMemo(() => state === undefined ? undefined : JSON.stringify(state), [state]);
  const programLayout = useMemo(() => {
    try { return { layout: stateKey === undefined ? undefined : surfaceLayoutOf(JSON.parse(stateKey)) }; }
    catch (error) { return { error: error instanceof Error ? error.message : String(error) }; }
  }, [stateKey]);
  const program = useMemo((): SurfacePresentation => ({ root: programLayout.layout?.root ?? null }), [programLayout]);
  const programBasis = useMemo(() => surfaceProgramBasis(program), [program]);
  const storedLayout = useSurfacePresentationOverride(runId);
  const personalLayout = view && !programLayout.error ? currentSurfaceOverride(storedLayout, program) : storedLayout;
  useEffect(() => {
    if (storedLayout && !personalLayout) saveSurfacePresentation(runId, null);
  }, [runId, storedLayout, personalLayout]);
  return { programLayout, personalLayout, presentation: personalLayout ?? program, programBasis };
}

export function initialTileLayout(entities: readonly string[], direction: "horizontal" | "vertical" = "horizontal"): SurfaceTileNode | null {
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
