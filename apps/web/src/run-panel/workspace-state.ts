import { createLocalStorageSetting } from "../lib/local-storage-setting";
import type { WorkspaceTabContribution } from "../PluginRegistry";

/** Personal state of the sidebar in the run panel per run: the open tab, null means closed. */
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
    throw new Error("The saved sidebar state is invalid.");
  }
  return value as RunPanelWorkspaceState;
}

/** The tab of the open sidebar; empty when it is closed or the remembered tab is currently not available. */
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
