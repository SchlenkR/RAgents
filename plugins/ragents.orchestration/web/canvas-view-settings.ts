import { createLocalStorageSetting } from "@aicontainer/web/lib/local-storage-setting";
import type { RunActor } from "./run-view";

export interface CanvasViewPreferences {
  showAppActors: boolean;
  showConnections: boolean;
  actorVisibility: Readonly<Record<string, boolean>>;
}

export const DEFAULT_CANVAS_VIEW_PREFERENCES: CanvasViewPreferences = Object.freeze({
  showAppActors: false, showConnections: true, actorVisibility: Object.freeze({}),
});
export const canvasViewStorageKey = (runId: string) => `ragents.orchestration.canvas-view:${runId}`;

export function parseCanvasViewPreferences(raw: string | null): CanvasViewPreferences {
  if (raw === null) return DEFAULT_CANVAS_VIEW_PREFERENCES;
  const value: unknown = JSON.parse(raw);
  if (!value || typeof value !== "object" || Array.isArray(value)
    || Object.keys(value).some((key) => !["showAppActors", "showConnections", "actorVisibility"].includes(key))
    || !("showAppActors" in value) || typeof value.showAppActors !== "boolean"
    || !("showConnections" in value) || typeof value.showConnections !== "boolean"
    || !("actorVisibility" in value) || !value.actorVisibility || typeof value.actorVisibility !== "object"
    || Array.isArray(value.actorVisibility) || Object.values(value.actorVisibility).some((visible) => typeof visible !== "boolean")) {
    throw new Error("Die gespeicherte Canvas-Ansicht ist ungültig.");
  }
  return value as CanvasViewPreferences;
}

export const actorVisibleOnCanvas = (actor: RunActor, appActorIds: ReadonlySet<string>, preferences: CanvasViewPreferences, primaryActorId?: string | null): boolean => {
  if (actor.kind === "human") return false;
  const override = Object.hasOwn(preferences.actorVisibility, actor.id) ? preferences.actorVisibility[actor.id] : undefined;
  return override ?? (actor.id !== primaryActorId && (!appActorIds.has(actor.id) || preferences.showAppActors));
};

const setting = createLocalStorageSetting({
  changeEvent: "ragents-canvas-view-change",
  matchesKey: (key) => key.startsWith("ragents.orchestration.canvas-view:"),
  parse: parseCanvasViewPreferences,
  serialize: JSON.stringify,
});

export function useCanvasViewPreferences(runId: string): CanvasViewPreferences {
  return setting.useValue(canvasViewStorageKey(runId));
}

export function saveCanvasViewPreferences(runId: string, preferences: CanvasViewPreferences) {
  setting.save(canvasViewStorageKey(runId), preferences);
}
