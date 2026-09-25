import { createLocalStorageSetting } from "../lib/local-storage-setting";
import type { WorkspaceTabContribution } from "../PluginRegistry";

/** Persönlicher Zustand der Leiste im Run-Panel je Run: der offene Reiter, null heißt geschlossen. */
export interface RunPanelWorkspaceState {
  tab: string | null;
}

export const RUN_PANEL_WORKSPACE_ID = "run-panel-workspace";

export const DEFAULT_RUN_PANEL_WORKSPACE_STATE: RunPanelWorkspaceState = Object.freeze({ tab: null });

export const runPanelWorkspaceStorageKey = (runId: string) => `ragents.run-panel.workspace-tab:${runId}`;

export function parseRunPanelWorkspaceState(raw: string | null): RunPanelWorkspaceState {
  if (raw === null) return DEFAULT_RUN_PANEL_WORKSPACE_STATE;
  const value: unknown = JSON.parse(raw);
  if (!value || typeof value !== "object" || Array.isArray(value)
    || Object.keys(value).some((key) => key !== "tab")
    || !("tab" in value) || !(value.tab === null || typeof value.tab === "string")) {
    throw new Error("Der gespeicherte Zustand der Leiste ist ungültig.");
  }
  return value as RunPanelWorkspaceState;
}

/** Der Reiter der offenen Leiste; leer, wenn sie geschlossen ist oder der gemerkte Reiter gerade nicht verfügbar ist. */
export const activeWorkspaceTab = (state: RunPanelWorkspaceState, tabs: readonly WorkspaceTabContribution[]): string =>
  state.tab !== null && tabs.some((tab) => tab.id === state.tab) ? state.tab : "";

const setting = createLocalStorageSetting({
  changeEvent: "ragents-run-panel-workspace-change",
  matchesKey: (key) => key.startsWith("ragents.run-panel.workspace-tab:"),
  parse: parseRunPanelWorkspaceState,
  serialize: JSON.stringify,
});

export function useRunPanelWorkspaceState(runId: string): RunPanelWorkspaceState {
  return setting.useValue(runPanelWorkspaceStorageKey(runId));
}

export function saveRunPanelWorkspaceState(runId: string, state: RunPanelWorkspaceState) {
  setting.save(runPanelWorkspaceStorageKey(runId), state);
}
