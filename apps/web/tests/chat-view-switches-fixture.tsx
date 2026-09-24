import { useRef } from "react";
import { createRoot } from "react-dom/client";
import { createAccessContext } from "../../../packages/ragents/src/access";
import { ActorChat } from "../../../plugins/ragents.orchestration/web/ActorChat";
import { ActorChatControls } from "../../../plugins/ragents.orchestration/web/ActorChatControls";
import { ActorChatPreview } from "../../../plugins/ragents.orchestration/web/ActorChatPreview";
import { OrchestrationRunPanel } from "../../../plugins/ragents.orchestration/web/run-panel/RunPanel";
import { webPlugin as overseerPlugin } from "../../../plugins/ragents.overseer/web/index";
import { AccessContext } from "../src/AccessContext";
import type { PluginActivationState } from "../src/PluginActivation";
import { ChatStepsProvider, defaultChatDisplayPolicy, PluginRegistry, type SessionContext, type SkillStartEntry } from "../src/PluginRegistry";
import { RunPreparationChat } from "../src/RunPreparationChat";
import type { Message } from "../src/chat/types";
import { RunPanelApp } from "../src/run-panel/RunPanelApp";
import { RunPanelHostProvider, type RunPanelHost } from "../src/run-panel/host";
import type { RunActor, RunView } from "../src/run-view";
import "../src/ui/tailwind.css";

type Subscription = { id: string; runId?: string; message: (event: unknown) => void };
const subscriptions = new Set<Subscription>();
const at = (minute: number) => `2026-09-25T09:${String(minute).padStart(2, "0")}:00.000Z`;
const actor = (id: string, kind: RunActor["kind"], displayName: string, lifecycle?: RunActor["lifecycle"]): RunActor =>
  ({ id, kind, handle: id, displayName, grants: [], createdAt: at(0), lifecycle });
const view: RunView = {
  id: "demo", revision: 1, title: "Zeitstempel", ownerId: "tester", primaryActorId: "coordinator", createdAt: at(0), forkedFrom: null,
  actors: [
    actor("tester", "human", "Tester"),
    actor("coordinator", "agent", "Koordinator", { kind: "idle", since: at(4) }),
    actor("reviewer", "agent", "Prüfer", { kind: "idle", since: at(6) }),
    actor("archive", "agent", "Archiv", { kind: "stopped", stoppedAt: at(7), reason: "Auftrag erledigt" }),
    actor("counter", "script", "Zähler", { kind: "idle", since: at(8) }),
  ],
  inputs: [], turns: [], subscriptions: [], pluginStates: [], actions: [], artifacts: [],
};
const conversation = (who: string): Message[] => [
  { key: `${who}-question`, role: "user", sender: "tester", text: `Bitte prüfe den Stand, @${who}.`, closed: true, at: at(5) },
  { key: `${who}-answer`, role: "assistant", sender: who, text: "Der Stand ist geprüft, es gibt keine offenen Punkte.", closed: true, at: at(6) },
];
const conversations = Object.fromEntries(view.actors.map(({ id }) => [id, conversation(id)]));
const session: SessionContext = {
  connected: true, pluginEvents: [], runView: view, running: false, messages: conversation("coordinator"),
  session: { id: "demo", title: "Zeitstempel", updatedAt: 0 }, send: async () => {}, start: async () => {},
};
const registry = new PluginRegistry({
  brand: { title: "Zeitstempel" }, product: { id: "switches", title: "Zeitstempel" },
  plugins: [{ id: "switches", needsRunView: true, surface: { Center: () => null, RunPanel: OrchestrationRunPanel } }],
  startEntries: [],
});

const fixture = {
  activation: { status: "ready", registry, failures: [] } as PluginActivationState,
  unexpected: [] as string[],
  chat(runId: string, event: unknown) { subscriptions.forEach((entry) => { if (entry.id === "ragents.chat" && entry.runId === runId) entry.message(event); }); },
  onActivation() { return () => {}; },
  async call(contract: { id: string }, params: { runId?: string }) {
    switch (contract.id) {
      case "ragents.runs.view": return params.runId === "demo" ? view : null;
      case "ragents.runs.list": return [{ id: "demo", title: "Zeitstempel", updatedAt: 0 }];
      case "ragents.startOptions.list": return [];
      case "ragents.chat.actorHistory": return { actors: conversations };
      case "ragents.chat.capabilities": return { input: ["text"], model: "demo-model" };
      case "ragents.runs.prepare": return { kind: "reply", text: "Gut, der Auftrag ist klar. Soll ich den Run erstellen?" };
      case "ragents.overseer.coordinator": return { runId: "global" };
      case "ragents.overseer.settings.read": return { provider: "demo", model: "demo-model", thinking: "off", models: [{ id: "demo-model", provider: "demo", label: "Demo", thinking: ["off"] }] };
      default: fixture.unexpected.push(contract.id); return null;
    }
  },
  subscribe(contract: { id: string }, params: { runId?: string }, message: Subscription["message"]) {
    const entry = { id: contract.id, runId: params.runId, message };
    subscriptions.add(entry);
    return () => { subscriptions.delete(entry); };
  },
};

declare global { interface Window { chatViewFixture: typeof fixture } }
window.chatViewFixture = fixture;

const centered: ReadonlySet<string> = new Set();
const host: RunPanelHost = {
  kind: "vscode", machines: "all", centerElements: () => centered, subscribe: () => () => {},
  openInCenter() {}, returnToRunPanel() {}, requestLogin() {}, requestLogout() {}, openExternal() {}, openPage() {},
  onCommand: () => () => {}, notify() {},
};
const rights = ["runs.read", "runs.write", "runs.create", "runs.inspect", "ragents.overseer.read", "ragents.overseer.write"];
const access = createAccessContext({ enabled: true, user: { id: "tester", label: "Tester", rights, startEntries: [] } });
const skill = { id: "switches.skill", owner: "switches", title: "Vorlage", description: "Bespricht den Auftrag", action: "skill", skill: "demo" } as SkillStartEntry;
const Overseer = overseerPlugin.overviewPanels![0]!.Panel;
const byId = (id: string) => view.actors.find((candidate) => candidate.id === id)!;

function ActorPart({ name, id, presentation, composerVisible = true }: { name: string; id: string; presentation: "surface" | "inspector"; composerVisible?: boolean }) {
  return <section aria-label={name} className="flex h-72 flex-col border border-border">
    <ActorChat actor={byId(id)} className="min-h-0 flex-1" conversation={conversations[id]} onNavigate={() => {}} presentation={presentation} primaryMessages={conversations[id]} view={view} />
    <ActorChatControls actor={byId(id)} composerVisible={composerVisible} presentation={presentation} view={view} />
  </section>;
}

function Parts() {
  const sessionRef = useRef(session);
  return <ChatStepsProvider policy={{ ...defaultChatDisplayPolicy, selectable: true }}>
    <main className="grid grid-cols-2 gap-3 p-3">
      <section aria-label="tile" className="flex h-72 flex-col border border-border"><ActorChatPreview actor={byId("reviewer")} conversation={conversations.reviewer} onNavigate={() => {}} view={view} /></section>
      <section aria-label="tile-readonly" className="flex h-72 flex-col border border-border"><ActorChatPreview actor={byId("reviewer")} chatInput={false} conversation={conversations.reviewer} onNavigate={() => {}} view={view} /></section>
      <ActorPart id="archive" name="stopped" presentation="inspector" />
      <ActorPart id="counter" name="program" presentation="inspector" />
      <ActorPart id="tester" name="human" presentation="inspector" />
      <ActorPart composerVisible={false} id="coordinator" name="hidden-composer" presentation="inspector" />
      <section aria-label="preparation" className="flex h-96 flex-col border border-border"><RunPreparationChat entry={skill} initialPrompt="Baue eine Übersicht" registry={registry} sessionRef={sessionRef} /></section>
      <section aria-label="overseer" className="h-24"><header><Overseer onBusy={() => {}} onClose={() => {}} onOpen={() => {}} open registry={registry} /></header></section>
    </main>
  </ChatStepsProvider>;
}

createRoot(document.getElementById("root")!).render(<AccessContext.Provider value={{ ...access, logout: async () => {} }}>
  {new URLSearchParams(location.search).get("mode") === "parts"
    ? <Parts />
    : <RunPanelHostProvider value={host}>
      <RunPanelApp location={{ layout: "panel", runId: "demo", host: "vscode", connection: "lokal", theme: undefined, access: undefined }} />
    </RunPanelHostProvider>}
</AccessContext.Provider>);
