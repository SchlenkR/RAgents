import { createRoot } from "react-dom/client";
import { OrchestrationRunPanel } from "../../../plugins/ragents.orchestration/web/run-panel/RunPanel";
import type { RunView } from "../src/run-view";
import { createBrowserHost, RunPanelHostProvider } from "../src/run-panel/host";
import type { SessionContext } from "../src/PluginRegistry";
import { ChatPanel, ChatInputToolbar, ChatMessages } from "quassel";
import "../src/ui/tailwind.css";
import { QuasselHost } from "../src/chat/QuasselHost";

const runId = new URLSearchParams(location.search).get("run") ?? "sheet-a";
const at = "2026-09-22T10:00:00Z";
const view: RunView = {
  id: runId, revision: 1, title: "Sheet check", ownerId: "owner", primaryActorId: "primary", createdAt: at, forkedFrom: null,
  actors: [
    { id: "owner", kind: "human", handle: "owner", displayName: "Owner", grants: [], createdAt: at },
    { id: "primary", kind: "agent", handle: "coordinator", displayName: "Coordinator", grants: [], createdAt: at },
  ],
  inputs: [], turns: [], subscriptions: [], pluginStates: [], actions: [], artifacts: [],
};
const session: SessionContext = {
  connected: true, pluginEvents: [], runView: view, running: false,
  messages: Array.from({ length: 12 }, (_, index) => ({ key: String(index), role: "assistant", text: `Answer ${index}: ${"Text in the history. ".repeat(15)}`, closed: true })),
  session: { id: runId, title: "Sheet check", updatedAt: 0 },
  send: async () => {}, start: async () => {},
};
const host = createBrowserHost(window);

createRoot(document.getElementById("root")!).render(<QuasselHost><RunPanelHostProvider value={host}>
  <OrchestrationRunPanel
    surfaceElements={[{ id: "mini", order: 0, select: () => [{ id: "mini", title: "Stage" }], Element: () => <button id="stage-button" className="m-8 self-start">Operate mini-app</button> }]}
    cardSections={[]} navigation={{ activeTabId: "", openTab() {}, revealEntity: () => false, selectionFor: () => undefined }}
    runToolbarContainer={null} toolbarContainer={null} statusContainer={null} session={session} tabIds={[]}
    renderChat={(options = {}) => <ChatPanel className={`min-h-0 flex-1 ${options.chatElementClassName ?? ""}`} composer={
      <ChatInputToolbar rows={1} maxRows={4} onSend={() => {}} toolbarLeft={options.toolbarLeft} />
    }>
      <ChatMessages messages={session.messages} scrollerRef={options.chatScrollerRef} />
    </ChatPanel>}
  />
</RunPanelHostProvider></QuasselHost>);
