import { createLocalStorageSetting } from "@ragents/web/lib/local-storage-setting";
import type { RunActor } from "@ragents/web/run-view";

export interface SurfaceViewPreferences {
  actorVisibility: Readonly<Record<string, boolean>>;
}

export const DEFAULT_SURFACE_VIEW_PREFERENCES: SurfaceViewPreferences = Object.freeze({ actorVisibility: Object.freeze({}) });
export const surfaceViewStorageKey = (runId: string) => `ragents.orchestration.actor-visibility:${runId}`;

export function parseSurfaceViewPreferences(raw: string | null): SurfaceViewPreferences {
  if (raw === null) return DEFAULT_SURFACE_VIEW_PREFERENCES;
  const value: unknown = JSON.parse(raw);
  if (!value || typeof value !== "object" || Array.isArray(value)
    || Object.keys(value).some((key) => key !== "actorVisibility")
    || !("actorVisibility" in value) || !value.actorVisibility || typeof value.actorVisibility !== "object"
    || Array.isArray(value.actorVisibility) || Object.values(value.actorVisibility).some((visible) => typeof visible !== "boolean")) {
    throw new Error("Die gespeicherte Actor-Sichtbarkeit ist ungültig.");
  }
  return value as SurfaceViewPreferences;
}

export const actorVisibleOnSurface = (actor: RunActor, appActorIds: ReadonlySet<string>, preferences: SurfaceViewPreferences, primaryActorId?: string | null): boolean => {
  if (actor.kind === "human") return false;
  const override = Object.hasOwn(preferences.actorVisibility, actor.id) ? preferences.actorVisibility[actor.id] : undefined;
  return override ?? (actor.id !== primaryActorId && !appActorIds.has(actor.id));
};

const setting = createLocalStorageSetting({
  changeEvent: "ragents-actor-visibility-change",
  matchesKey: (key) => key.startsWith("ragents.orchestration.actor-visibility:"),
  parse: parseSurfaceViewPreferences,
  serialize: JSON.stringify,
});

export function useSurfaceViewPreferences(runId: string): SurfaceViewPreferences {
  return setting.useValue(surfaceViewStorageKey(runId));
}

export function saveSurfaceViewPreferences(runId: string, preferences: SurfaceViewPreferences) {
  setting.save(surfaceViewStorageKey(runId), preferences);
}
