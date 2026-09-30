import type { WorkspaceTabContext } from "@ragents/web/PluginRegistry";
import { Button } from "@ragents/web/ui";
import { chatPrimaryId, runViewFrom } from "@ragents/web/run-view";
import { FlowInspector, type FlowSelection } from "./FlowInspector";

export const INSPECTION_TAB_ID = "ragents.orchestration.inspection";

export function InspectionPanel({ navigation, selection, session }: WorkspaceTabContext) {
  const view = runViewFrom(session.runView);
  const primary = view && chatPrimaryId(view);
  const selected = (selection ?? undefined) as FlowSelection | undefined;
  return <div className="flex h-full min-h-0 flex-col">
    <nav aria-label="Inspect participants" className="flex flex-none flex-wrap gap-1 border-b border-border p-2">
      {view?.actors.map((actor) => <Button key={actor.id} onClick={() => navigation.openTab(INSPECTION_TAB_ID, { type: "actor", id: actor.id })} size="xs" variant="ghost">@{actor.handle}</Button>)}
    </nav>
    <div className="min-h-0 flex-1"><FlowInspector actorConversations={session.actorConversations} canGoBack={selected !== undefined} composerVisible={false}
      conversationError={session.conversationError} onBack={() => navigation.openTab(INSPECTION_TAB_ID, null)}
      onNavigate={(next) => navigation.openTab(INSPECTION_TAB_ID, next)} primaryMessages={session.messages}
      primaryRunning={session.running} selection={selected ?? (primary ? { type: "actor", id: primary } : undefined)} view={view} /></div>
  </div>;
}
