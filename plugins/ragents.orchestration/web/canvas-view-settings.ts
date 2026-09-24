import { createLocalStorageSetting } from "@ragents/web/lib/local-storage-setting";
import type { RunActor } from "@ragents/web/run-view";

export interface CanvasViewPreferences {
  actorVisibility: Readonly<Record<string, boolean>>;
}

export const DEFAULT_CANVAS_VIEW_PREFERENCES: CanvasViewPreferences = Object.freeze({ actorVisibility: Object.freeze({}) });
export const canvasViewStorageKey = (runId: string) => `ragents.orchestration.actor-visibility:${runId}`;

export function parseCanvasViewPreferences(raw: string | null): CanvasViewPreferences {
  if (raw === null) return DEFAULT_CANVAS_VIEW_PREFERENCES;
  const value: unknown = JSON.parse(raw);
  if (!value || typeof value !== "object" || Array.isArray(value)
    || Object.keys(value).some((key) => key !== "actorVisibility")
    || !("actorVisibility" in value) || !value.actorVisibility || typeof value.actorVisibility !== "object"
    || Array.isArray(value.actorVisibility) || Object.values(value.actorVisibility).some((visible) => typeof visible !== "boolean")) {
    throw new Error("Die gespeicherte Actor-Sichtbarkeit ist ungültig.");
  }
  return value as CanvasViewPreferences;
}

export const actorVisibleOnCanvas = (actor: RunActor, appActorIds: ReadonlySet<string>, preferences: CanvasViewPreferences, primaryActorId?: string | null): boolean => {
  if (actor.kind === "human") return false;
  const override = Object.hasOwn(preferences.actorVisibility, actor.id) ? preferences.actorVisibility[actor.id] : undefined;
  return override ?? (actor.id !== primaryActorId && !appActorIds.has(actor.id));
};

const setting = createLocalStorageSetting({
  changeEvent: "ragents-actor-visibility-change",
  matchesKey: (key) => key.startsWith("ragents.orchestration.actor-visibility:"),
  parse: parseCanvasViewPreferences,
  serialize: JSON.stringify,
});

export function useCanvasViewPreferences(runId: string): CanvasViewPreferences {
  return setting.useValue(canvasViewStorageKey(runId));
}

export function saveCanvasViewPreferences(runId: string, preferences: CanvasViewPreferences) {
  setting.save(canvasViewStorageKey(runId), preferences);
}
