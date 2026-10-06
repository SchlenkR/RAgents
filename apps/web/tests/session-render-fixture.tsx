import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { PluginRegistry, type SessionContext, type SessionProviderProps, type WorkspaceTabContext } from "../src/PluginRegistry";
import type { ListedSession } from "../src/api";
import { RunPanelApp } from "../src/run-panel/RunPanelApp";
import { RunPanelHostProvider, createBrowserHost } from "../src/run-panel/host";
import { QuasselHost } from "../src/chat/QuasselHost";
import "../src/ui/tailwind.css";

type Subscription = { id: string; message: (event: unknown) => void };
const subscriptions = new Set<Subscription>();
let previousContext: SessionContext | undefined;
function ProbeProvider({ children, session }: SessionProviderProps) {
  if (session !== previousContext) fixture.contextChanges += 1;
  previousContext = session;
  fixture.contextRevision = session.session.revision;
  return children;
}

function HeavyPanel({ active, session }: WorkspaceTabContext) {
  fixture.renders += 1;
  const [count, setCount] = useState(0);
  useEffect(() => {
    fixture.effects += 1;
    const timer = setInterval(() => { fixture.ticks += 1; }, 50);
    return () => { clearInterval(timer); fixture.cleanups += 1; };
  }, []);
  return <div>
    <input aria-label="Heavy draft" />
    <iframe title="Heavy frame" srcDoc={'<!doctype html><input aria-label="Frame draft"><script>window.identity = Math.random()</script>'} />
    <button onClick={() => setCount((value) => value + 1)}>Count</button>
    <output aria-label="Heavy count">{count}</output>
    <p>{active ? "Heavy active" : "Heavy inactive"}</p>
    <p>Revision {session.session.revision}</p>
    {Array.from({ length: 200 }, (_, index) => <p key={index}>Heavy row {index}</p>)}
  </div>;
}

const listed = (id: string): ListedSession => ({ id, title: id, revision: 1, updatedAt: 0, running: false,
  state: "idle", pendingActions: 0, workspaceAccessible: true, operable: true, metadata: { details: { value: 1 } } });
const view = { id: "run", revision: 1, title: "Run", ownerId: "owner", primaryActorId: null,
  createdAt: "2026-10-06T00:00:00Z", forkedFrom: null, actors: [], inputs: [], turns: [], subscriptions: [], pluginStates: [], actions: [], artifacts: [] };
const registry = new PluginRegistry({ brand: { title: "Render check" }, product: { id: "render", title: "Render check" }, startEntries: [],
  plugins: [{ id: "render", needsRunView: true, SessionProvider: ProbeProvider, workspaceTabs: [
    { id: "heavy", label: "Heavy", order: 0, placement: "window", keepMounted: true, Icon: () => <svg />, Panel: HeavyPanel },
    { id: "light", label: "Light", order: 1, placement: "window", Icon: () => <svg />, Panel: () => <p>Light panel</p> },
  ] }] });
const fixture = {
  registry, polls: 0, contextChanges: 0, contextRevision: undefined as number | undefined,
  renders: 0, effects: 0, cleanups: 0, ticks: 0, runs: [listed("run"), listed("other")],
  render() {},
  poll() { for (const entry of subscriptions) if (entry.id === "ragents.runs") entry.message({ kind: "changed" }); },
  chat() { for (const entry of subscriptions) if (entry.id === "ragents.chat") entry.message({ kind: "status", running: true }); },
  runChanged() { view.revision += 1; for (const entry of subscriptions) if (entry.id === "ragents.run") entry.message({ kind: "run" }); },
  async call(contract: { id: string }) {
    switch (contract.id) {
      case "ragents.runs.list": fixture.polls += 1; return structuredClone(fixture.runs);
      case "ragents.runs.markViewed": return null;
      case "ragents.startOptions.list": return [];
      case "ragents.runs.view": return structuredClone(view);
      case "ragents.chat.actorHistory": return { revision: view.revision, actors: {} };
      default: throw new Error(`Unexpected fixture RPC: ${contract.id}`);
    }
  },
  subscribe(contract: { id: string }, _params: unknown, message: Subscription["message"]) {
    const entry = { id: contract.id, message };
    subscriptions.add(entry);
    return () => { subscriptions.delete(entry); };
  },
};
declare global { interface Window { sessionRenderFixture: typeof fixture; } }
window.sessionRenderFixture = fixture;
const host = { ...createBrowserHost(window), kind: new URLSearchParams(location.search).has("vscode") ? "vscode" as const : "browser" as const };
function Fixture() {
  const [, update] = useState(0);
  fixture.render = () => update((value) => value + 1);
  return <QuasselHost><RunPanelHostProvider value={host}>
    <RunPanelApp location={{ layout: "panel", runId: "run", host: host.kind, connection: undefined, theme: undefined, access: undefined }} />
  </RunPanelHostProvider></QuasselHost>;
}
createRoot(document.getElementById("root")!).render(<Fixture />);
