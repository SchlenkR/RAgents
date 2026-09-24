import { createRoot } from "react-dom/client";
import { OrchestrationRunPanel } from "../../../plugins/ragents.orchestration/web/run-panel/RunPanel";
import type { RunView } from "../src/run-view";
import { createBrowserHost, RunPanelHostProvider } from "../src/run-panel/host";
import type { SessionContext } from "../src/PluginRegistry";
import { ChatPanel } from "../src/chat/ChatPanel";
import { ChatInputToolbar } from "../src/chat/ChatInputToolbar";
import { ChatMessages } from "../src/chat/ChatMessages";
import "../src/ui/tailwind.css";

const runId = new URLSearchParams(location.search).get("run") ?? "sheet-a";
const at = "2026-09-22T10:00:00Z";
const view: RunView = {
  id: runId, revision: 1, title: "Sheet-Prüfung", ownerId: "owner", primaryActorId: "primary", createdAt: at, forkedFrom: null,
  actors: [
    { id: "owner", kind: "human", handle: "owner", displayName: "Owner", grants: [], createdAt: at },
    { id: "primary", kind: "agent", handle: "coordinator", displayName: "Koordinator", grants: [], createdAt: at },
  ],
  inputs: [], turns: [], subscriptions: [], pluginStates: [], actions: [], artifacts: [],
};
const session: SessionContext = {
  connected: true, extensionEvents: [], runView: view, running: false,
  messages: Array.from({ length: 12 }, (_, index) => ({ key: String(index), role: "assistant", text: `Antwort ${index}: ${"Text im Verlauf. ".repeat(15)}`, closed: true })),
  session: { id: runId, title: "Sheet-Prüfung", updatedAt: 0 },
  send: async () => {}, start: async () => {}, stop: async () => {},
};
const host = createBrowserHost(window);

createRoot(document.getElementById("root")!).render(<RunPanelHostProvider value={host}>
  <OrchestrationRunPanel
    canvasElements={[{ id: "mini", order: 0, select: () => [{ id: "mini", title: "Bühne" }], Element: () => <button id="stage-button" className="m-8 self-start">Mini-App bedienen</button> }]}
    cardSections={[]} navigation={{ activeTabId: "", openTab() {}, revealEntity: () => false, selectionFor: () => undefined }}
    runToolbarContainer={null} toolbarContainer={null} statusContainer={null} session={session} tabIds={[]}
    renderChat={(options = {}) => <ChatPanel className={`min-h-0 flex-1 ${options.chatElementClassName ?? ""}`} composer={
      <ChatInputToolbar rows={1} maxRows={4} onSend={() => {}} toolbarLeft={options.toolbarLeft} />
    }>
      <ChatMessages messages={session.messages} scrollerRef={options.chatScrollerRef} />
    </ChatPanel>}
  />
</RunPanelHostProvider>);
