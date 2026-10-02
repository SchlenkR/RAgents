import { useState } from "react";
import { createRoot } from "react-dom/client";
import { unrestrictedAccess } from "../../../packages/ragents/src/access";
import { AccessContext } from "../src/AccessContext";
import { PluginRegistry } from "../src/PluginRegistry";
import { RunPanelApp } from "../src/run-panel/RunPanelApp";
import { RunPanelHostProvider, type RunPanelHost } from "../src/run-panel/host";
import type { HostRunPanelMessage, RunPanelHostMessage } from "../src/run-panel/host-contract";
import { ChatInputToolbar } from "quassel";
import "../src/ui/tailwind.css";
import { QuasselHost } from "../src/chat/QuasselHost";
import { OrchestrationRunPanel } from "../../../plugins/ragents.orchestration/web/run-panel/RunPanel";
import { saveRunPanelState } from "../../../plugins/ragents.orchestration/web/run-panel/run-panel-state";
import type { RunView } from "../src/run-view";

type Subscription = { id: string; runId?: string; message: (event: unknown) => void; error?: (message: string) => void };
const subscriptions = new Set<Subscription>();
const commands = new Set<(message: HostRunPanelMessage) => void>();
const query = new URLSearchParams(location.search);
const actorChat = query.get("actor") === "reviewer";
if (actorChat) saveRunPanelState("existing", { actor: "reviewer", element: null });
const host: RunPanelHost = {
  kind: query.get("host") === "browser" ? "browser" : "vscode",
  machines: query.get("host") === "browser" ? "server" : "all",
  openApp() {},
  requestLogin() {},
  requestLogout() {},
  openExternal() {},
  openPage() {},
  onCommand(listener) { commands.add(listener); return () => { commands.delete(listener); }; },
  notify(message) { fixture.notifications.push(message); },
};

const fixture = {
  registry: new PluginRegistry({
    brand: { title: "Focus check" }, product: { id: "focus", title: "Focus check" },
    plugins: [{ id: "focus", ...(actorChat ? { needsRunView: true, surface: { RunPanel: OrchestrationRunPanel } } : {}) }],
    startEntries: [{ id: "focus.template", owner: "focus", title: "Template", description: "Test template", action: "script", coordinator: true }],
  }),
  notifications: [] as RunPanelHostMessage[],
  calls: [] as string[],
  disabled: true,
  hidden: false,
  readOnly: query.get("readonly") === "true",
  settled: 0,
  render() {},
  resolveView() {},
  command(message: HostRunPanelMessage) { commands.forEach((listener) => listener(message)); },
  ready() { subscriptions.forEach((entry) => { if (entry.id === "ragents.chat") entry.message({ kind: "replay-end" }); }); },
  disconnect() { subscriptions.forEach((entry) => { if (entry.id === "ragents.chat") entry.error?.("disconnected"); }); },
  stream() { subscriptions.forEach((entry) => { if (entry.id === "ragents.chat") entry.message({ kind: "text", delta: "New answer" }); }); },
  activeRun() { return [...subscriptions].find((entry) => entry.id === "ragents.chat")?.runId; },
  async call(contract: { id: string }, params?: { runId?: string }) {
    fixture.calls.push(contract.id);
    switch (contract.id) {
      case "ragents.runs.list": return [{ id: "existing", title: "Existing run", updatedAt: 0 }];
      case "ragents.startOptions.list": return [];
      case "ragents.runs.view": {
        if (query.get("delayedView") === "true") await new Promise<void>((resolve) => { fixture.resolveView = resolve; });
        return actorChat && params?.runId === "existing" ? actorView : null;
      }
      case "ragents.chat.start": return null;
      case "ragents.chat.actorHistory": return { actors: {} };
      default: throw new Error(`Unexpected fixture RPC: ${contract.id}`);
    }
  },
  subscribe(contract: { id: string }, params: { runId?: string }, message: Subscription["message"], error?: Subscription["error"]) {
    const entry = { id: contract.id, runId: params.runId, message, error };
    subscriptions.add(entry);
    return () => { subscriptions.delete(entry); };
  },
};

const actorView: RunView = {
  id: "existing", title: "Existing run", revision: 1, ownerId: "owner", primaryActorId: "coordinator",
  createdAt: "2026-10-01T10:00:00Z", forkedFrom: null,
  actors: ["coordinator", "reviewer"].map((id) => ({
    id, kind: "agent", handle: id, displayName: id, grants: [], createdAt: "2026-10-01T10:00:00Z",
    lifecycle: { kind: "idle", since: "2026-10-01T10:00:00Z" },
  })),
  inputs: [], turns: [], subscriptions: [], pluginStates: [], actions: [], artifacts: [],
};

declare global { interface Window { runFocusFixture: typeof fixture; } }
window.runFocusFixture = fixture;

function App() {
  const [, update] = useState(0);
  fixture.render = () => update((value) => value + 1);
  if (query.get("mode") === "composer") return <div style={{ display: fixture.hidden ? "none" : "block" }}>
    <ChatInputToolbar autoFocus disabled={fixture.disabled} onAutoFocusSettled={() => { fixture.settled += 1; }} onSend={() => {}} />
  </div>;
  return <AccessContext.Provider value={{ ...unrestrictedAccess, can: (right) => right !== "runs.write" || !fixture.readOnly, logout: async () => {} }}>
    <RunPanelHostProvider value={host}>
      <RunPanelApp location={{ layout: "panel", runId: "existing", host: host.kind, connection: undefined, theme: undefined, access: undefined }} />
    </RunPanelHostProvider>
  </AccessContext.Provider>;
}

createRoot(document.getElementById("root")!).render(<QuasselHost><App /></QuasselHost>);
