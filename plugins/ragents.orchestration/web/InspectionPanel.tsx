import type { WorkspaceTabContext } from "@ragents/web/PluginRegistry";
import { actorAddress, chatPrimaryId, runViewFrom } from "@ragents/web/run-view";
import { FlowInspector, type FlowSelection } from "./FlowInspector";

export const INSPECTION_TAB_ID = "ragents.orchestration.inspection";

export function InspectionHeader({ navigation, selection, session }: WorkspaceTabContext) {
  const view = runViewFrom(session.runView);
  const selected = selection as FlowSelection | undefined;
  const actorId = selected?.type === "actor" ? selected.id : view && chatPrimaryId(view);
  return <select aria-label="Inspect participants" className="h-6 min-w-0 max-w-40 flex-1 rounded border border-border bg-popover px-1 py-0 text-xs text-popover-foreground" value={actorId ?? ""}
    onChange={(event) => navigation.openTab(INSPECTION_TAB_ID, { type: "actor", id: event.target.value })}>
    {view?.actors.map((actor) => <option key={actor.id} value={actor.id}>@{actorAddress(actor)}</option>)}
  </select>;
}

export function InspectionPanel({ navigation, selection, session }: WorkspaceTabContext) {
  const view = runViewFrom(session.runView);
  const primary = view && chatPrimaryId(view);
  const selected = (selection ?? undefined) as FlowSelection | undefined;
  return <div className="flex h-full min-h-0 flex-col">
    <div className="min-h-0 flex-1"><FlowInspector actorConversations={session.actorConversations} canGoBack={selected !== undefined} composerVisible={false}
      conversationError={session.conversationError} onBack={() => navigation.openTab(INSPECTION_TAB_ID, null)}
      onNavigate={(next) => navigation.openTab(INSPECTION_TAB_ID, next)} primaryMessages={session.messages}
      primaryRunning={session.running} selection={selected ?? (primary ? { type: "actor", id: primary } : undefined)} view={view} /></div>
  </div>;
}
