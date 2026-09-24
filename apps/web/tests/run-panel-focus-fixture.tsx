import { useState } from "react";
import { createRoot } from "react-dom/client";
import { unrestrictedAccess } from "../../../packages/ragents/src/access";
import { AccessContext } from "../src/AccessContext";
import { PluginRegistry } from "../src/PluginRegistry";
import { RunPanelApp } from "../src/run-panel/RunPanelApp";
import { RunPanelHostProvider, type RunPanelHost } from "../src/run-panel/host";
import type { HostRunPanelMessage, RunPanelHostMessage } from "../src/run-panel/host-contract";
import { ChatInputToolbar } from "../src/chat/ChatInputToolbar";
import "../src/ui/tailwind.css";

type Subscription = { id: string; runId?: string; message: (event: unknown) => void; error?: (message: string) => void };
const subscriptions = new Set<Subscription>();
const commands = new Set<(message: HostRunPanelMessage) => void>();
const query = new URLSearchParams(location.search);
const host: RunPanelHost = {
  kind: query.get("host") === "browser" ? "browser" : "vscode",
  centerElements: () => new Set(),
  subscribe: () => () => {},
  openInCenter() {},
  returnToRunPanel() {},
  requestLogin() {},
  requestLogout() {},
  openExternal() {},
  openPage() {},
  onCommand(listener) { commands.add(listener); return () => { commands.delete(listener); }; },
  notify(message) { fixture.notifications.push(message); },
};

const fixture = {
  registry: new PluginRegistry({
    brand: { title: "Fokusprüfung" }, product: { id: "focus", title: "Fokusprüfung" }, plugins: [{ id: "focus" }],
    startEntries: [{ id: "focus.template", owner: "focus", title: "Vorlage", description: "Testvorlage", action: "script", coordinator: true }],
  }),
  notifications: [] as RunPanelHostMessage[],
  calls: [] as string[],
  disabled: true,
  hidden: false,
  readOnly: query.get("readonly") === "true",
  settled: 0,
  render() {},
  command(message: HostRunPanelMessage) { commands.forEach((listener) => listener(message)); },
  ready() { subscriptions.forEach((entry) => { if (entry.id === "ragents.chat") entry.message({ kind: "replay-end" }); }); },
  disconnect() { subscriptions.forEach((entry) => { if (entry.id === "ragents.chat") entry.error?.("disconnected"); }); },
  stream() { subscriptions.forEach((entry) => { if (entry.id === "ragents.chat") entry.message({ kind: "text", delta: "Neue Antwort" }); }); },
  activeRun() { return [...subscriptions].find((entry) => entry.id === "ragents.chat")?.runId; },
  async call(contract: { id: string }) {
    fixture.calls.push(contract.id);
    switch (contract.id) {
      case "ragents.runs.list": return [{ id: "existing", title: "Vorhandener Run", updatedAt: 0 }];
      case "ragents.startOptions.list": return [];
      case "ragents.runs.view": return null;
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

createRoot(document.getElementById("root")!).render(<App />);
