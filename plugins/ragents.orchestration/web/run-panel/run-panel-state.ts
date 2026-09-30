import { createLocalStorageSetting } from "@ragents/web/lib/local-storage-setting";

export interface RunPanelState {
  element: string | null;
  actor: string | null;
}

export const DEFAULT_RUN_PANEL_STATE: RunPanelState = Object.freeze({ element: null, actor: null });
export const runPanelStorageKey = (runId: string) => `ragents.orchestration.run-navigation:${runId}`;

const isTextOrNull = (value: unknown): value is string | null => value === null || typeof value === "string";

export function parseRunPanelState(raw: string | null): RunPanelState {
  if (raw === null) return DEFAULT_RUN_PANEL_STATE;
  const value: unknown = JSON.parse(raw);
  if (!value || typeof value !== "object" || Array.isArray(value)
    || Object.keys(value).some((key) => !["element", "actor"].includes(key))
    || !("element" in value) || !isTextOrNull(value.element)
    || !("actor" in value) || !isTextOrNull(value.actor)) {
    throw new Error("The stored panel navigation is invalid.");
  }
  return { element: value.element, actor: value.actor };
}

const setting = createLocalStorageSetting({
  changeEvent: "ragents-run-panel-change",
  matchesKey: (key) => key.startsWith("ragents.orchestration.run-navigation:"),
  parse: parseRunPanelState,
  serialize: JSON.stringify,
});

export function useRunPanelState(runId: string): RunPanelState {
  return setting.useValue(runPanelStorageKey(runId));
}

export function saveRunPanelState(runId: string, state: RunPanelState) {
  setting.save(runPanelStorageKey(runId), state);
}
