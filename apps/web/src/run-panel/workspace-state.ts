import { createLocalStorageSetting } from "../lib/local-storage-setting";
import type { WorkspaceTabContribution } from "../PluginRegistry";

/** Persönlicher Zustand der Leiste im Run-Panel je Run: der offene Reiter (null: Leiste geschlossen) und die Höhe der Leiste. */
export interface RunPanelWorkspaceState {
  tab: string | null;
  height: number;
}

export const RUN_PANEL_WORKSPACE_ID = "run-panel-workspace";
export const WORKSPACE_MIN_HEIGHT = 120;
export const WORKSPACE_DEFAULT_HEIGHT = 280;
/** Über der Leiste bleibt immer Platz für ein Stück Chat. */
export const CHAT_MIN_HEIGHT = 160;

export const DEFAULT_RUN_PANEL_WORKSPACE_STATE: RunPanelWorkspaceState = Object.freeze({ tab: null, height: WORKSPACE_DEFAULT_HEIGHT });

export const runPanelWorkspaceStorageKey = (runId: string) => `ragents.run-panel.workspace:${runId}`;

export function parseRunPanelWorkspaceState(raw: string | null): RunPanelWorkspaceState {
  if (raw === null) return DEFAULT_RUN_PANEL_WORKSPACE_STATE;
  const value: unknown = JSON.parse(raw);
  if (!value || typeof value !== "object" || Array.isArray(value)
    || Object.keys(value).some((key) => !["tab", "height"].includes(key))
    || !("tab" in value) || !(value.tab === null || typeof value.tab === "string")
    || !("height" in value) || typeof value.height !== "number" || !Number.isFinite(value.height) || value.height < WORKSPACE_MIN_HEIGHT) {
    throw new Error("Der gespeicherte Zustand der Leiste ist ungültig.");
  }
  return value as RunPanelWorkspaceState;
}

/** Der Reiter der offenen Leiste; leer, wenn sie geschlossen ist oder der gemerkte Reiter gerade nicht verfügbar ist. */
export const activeWorkspaceTab = (state: RunPanelWorkspaceState, tabs: readonly WorkspaceTabContribution[]): string =>
  state.tab !== null && tabs.some((tab) => tab.id === state.tab) ? state.tab : "";

export const clampWorkspaceHeight = (height: number, available: number): number =>
  Math.max(WORKSPACE_MIN_HEIGHT, Math.min(Math.round(height), Math.max(WORKSPACE_MIN_HEIGHT, available - CHAT_MIN_HEIGHT)));

const setting = createLocalStorageSetting({
  changeEvent: "ragents-run-panel-workspace-change",
  matchesKey: (key) => key.startsWith("ragents.run-panel.workspace:"),
  parse: parseRunPanelWorkspaceState,
  serialize: JSON.stringify,
});

export function useRunPanelWorkspaceState(runId: string): RunPanelWorkspaceState {
  return setting.useValue(runPanelWorkspaceStorageKey(runId));
}

export function saveRunPanelWorkspaceState(runId: string, state: RunPanelWorkspaceState) {
  setting.save(runPanelWorkspaceStorageKey(runId), state);
}
