import type { WorkspaceTabContext } from "@ragents/web/PluginRegistry";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@ragents/web/ui";
import { actorAddress, chatPrimaryId, runViewFrom } from "@ragents/web/run-view";
import { FlowInspector, type FlowSelection } from "./FlowInspector";

export const INSPECTION_TAB_ID = "ragents.orchestration.inspection";

export function InspectionHeader({ navigation, selection, session }: WorkspaceTabContext) {
  const view = runViewFrom(session.runView);
  const selected = selection as FlowSelection | undefined;
  const actorId = selected?.type === "actor" ? selected.id : view && chatPrimaryId(view);
  const items = (view?.actors ?? []).map((actor) => ({ value: actor.id, label: `@${actorAddress(actor)}` }));
  return <Select items={items} value={actorId ?? null} onValueChange={(value) => { if (value) navigation.openTab(INSPECTION_TAB_ID, { type: "actor", id: value }); }}>
    <SelectTrigger aria-label="Inspect participants" className="max-w-40 min-w-0 flex-1" size="xs"><SelectValue /></SelectTrigger>
    <SelectContent>{items.map((item) => <SelectItem key={item.value} value={item.value}>{item.label}</SelectItem>)}</SelectContent>
  </Select>;
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
