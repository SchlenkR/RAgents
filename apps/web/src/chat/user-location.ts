import type { ChatUserLocation } from "../../../server/src/chat-context";
import type { EntityReference } from "../PluginRegistry";

export type ChatRunLocation = Pick<ChatUserLocation, "tab" | "selection"> & { runId: string };

export function runUserLocation(runId: string, activeTabId: string, tabs: readonly { id: string; label: string }[], panelVisible: boolean, selection: EntityReference | undefined): ChatRunLocation {
  return {
    runId,
    tab: panelVisible ? tabs.find((tab) => tab.id === activeTabId)?.label ?? null : null,
    selection: selection ? { type: selection.type, id: selection.id } : null,
  };
}

export function chatUserLocation(activeRunId: string | undefined, overviewOpen: boolean, details: ChatRunLocation | undefined): ChatUserLocation {
  const current = activeRunId !== undefined && details?.runId === activeRunId ? details : undefined;
  return {
    surface: overviewOpen ? "overview" : activeRunId === undefined ? "home" : "run",
    runId: activeRunId ?? null,
    tab: !overviewOpen && current ? current.tab : null,
    selection: !overviewOpen && current?.selection ? { type: current.selection.type, id: current.selection.id } : null,
  };
}
