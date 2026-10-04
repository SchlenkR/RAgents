import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { createAccessContext } from "../../../packages/ragents/src/access";
import { WORKSPACE_BINDING_OPTION_ID } from "../../../plugins/ragents.workspace/contract";
import { webPlugin as overseerPlugin } from "../../../plugins/ragents.overseer/web/index";
import { WorkspaceBindingControl } from "../../../plugins/ragents.workspace/web/WorkspaceBinding";
import { parseRunPanelLocation } from "../src/run-panel/run-panel-location";
import { AccessContext } from "../src/AccessContext";
import type { PluginActivationState } from "../src/PluginActivation";
import { PluginRegistry, type EntryGuideContext } from "../src/PluginRegistry";
import { PanelPage } from "../src/panel/PanelPage";
import type { ConnectionView, PanelState } from "../src/panel/contract";
import { productStartOptions } from "../src/product/start-options";
import { RunPanelApp } from "../src/run-panel/RunPanelApp";
import { createBrowserHost, RunPanelHostProvider, type RunPanelHost } from "../src/run-panel/host";
import type { HostRunPanelMessage, RunPanelHostMessage } from "../src/run-panel/host-contract";
import "../src/ui/tailwind.css";

type Subscription = { id: string; runId?: string; message: (event: unknown) => void };
const subscriptions = new Set<Subscription>();
const commands = new Set<(message: HostRunPanelMessage) => void>();
const panelRenewals = new Set<() => void>();
const query = new URLSearchParams(location.search);

function TopicGuide({ onCancel, onComplete }: EntryGuideContext) {
  return <div className="grid gap-3 p-6">
    <p>What is it about?</p>
    <div className="flex gap-2">
      <button onClick={() => onComplete("Clarify the hosting choice.")} type="button">Use topic</button>
      <button onClick={onCancel} type="button">Cancel guide</button>
    </div>
  </div>;
}

const startEntries = [
  { id: "demo.board", owner: "demo", action: "skill" as const, skill: "board", category: "Mini-apps", title: "Collection board",
    description: "A list helper with its own function, mini-app and shared state.", prompt: "Build a board for groceries." },
  { id: "demo.decision", owner: "demo", action: "skill" as const, skill: "decision", category: "Discuss", title: "Clarify decision",
    description: "The guide asks for the topic first, then the task is discussed.", prompt: "Clarify a decision.", guide: "demo.topic" },
  { id: "demo.circle", owner: "demo", action: "script" as const, category: "Moderation", title: "Discussion circle",
    description: "Four helpers speak in turn, the coordinator leads the rounds.", coordinator: true },
  { id: "demo.word", owner: "demo", action: "script" as const, title: "Word game",
    description: "Four models pass words along, an actor ends after twelve.", coordinator: false },
];

const registry = new PluginRegistry({
  brand: { title: "Start check" }, product: { id: "demo", title: "Start check" },
  plugins: [
    ...(query.has("coordinator") ? [overseerPlugin] : []),
    { id: "demo", startOptions: productStartOptions, guides: [{ id: "demo.topic", Guide: TopicGuide }] },
    { id: "ragents.workspace", startOptions: [{ id: WORKSPACE_BINDING_OPTION_ID, Control: WorkspaceBindingControl }] },
  ],
  startEntries,
});

const workstation = { id: "laptop-01", label: "Notebook", hostname: "notebook", platform: "darwin",
  folders: ["/home/user/project"], runsDirectory: "/home/user/.local/share/ragents/workspace/runs", ripgrep: true };
const presentations: Record<string, { owner: string; initial: unknown; presentation: unknown }> = {
  "ragents.model": { owner: "demo", initial: { model: "z-ai/glm-5.3-flash", thinking: "high" },
    presentation: { kind: "model", provider: "openrouter", options: ["z-ai/glm-5.3-flash", "qwen/qwen3.8-max"], thinkingOptions: ["off", "low", "high"] } },
  "ragents.system-prompt": { owner: "demo", initial: { promptIds: [], shareWithAgents: false },
    presentation: { kind: "system-prompt", options: [{ id: "brief", label: "Short and concise", text: "Answer briefly." }, { id: "careful", label: "Thorough", text: "Check every step." }] } },
  [WORKSPACE_BINDING_OPTION_ID]: { owner: "ragents.workspace", initial: { machine: "server", folder: "fresh" },
    presentation: { kind: "workspace-binding", clients: [workstation], fresh: { server: "Empty folder per run", client: "Empty folder per run" }, serverFolders: true } },
};
const chosen = new Map<string, unknown>();
/** Like the server: model and prompt choice only with runs.inspect, the model choice stays open after the start. */
const inspecting = query.get("rights") !== "plain";
const technical = new Set(["ragents.model", "ragents.system-prompt"]);
const optionsOf = (runId: string) => Object.entries(presentations).filter(([id]) => inspecting || !technical.has(id)).map(([id, { owner, initial, presentation }]) => ({
  id, owner, presentation, value: chosen.get(`${runId}:${id}`) ?? initial, selectable: true,
  locked: fixture.views.has(runId) && id !== "ragents.model", chosen: !fixture.views.has(runId) && chosen.has(`${runId}:${id}`),
}));
const emptyView = (runId: string) => ({ id: runId, revision: 1, title: "Run", ownerId: "tester", primaryActorId: null, createdAt: "2026-09-24T10:00:00.000Z", forkedFrom: null,
  actors: [], inputs: [], turns: [], subscriptions: [], pluginStates: [], actions: [], artifacts: [] });
const connection: ConnectionView = {
  name: "local", kind: "profile", address: "/home/user/ragents.config.core.ts", route: { kind: "profile", profile: "core" }, state: { kind: "connected" },
  runs: [{ id: "existing", title: "Existing run", state: "idle", pendingActions: 0, updatedAt: Date.now() - 180_000 }],
  entries: startEntries.map((entry) => ({ id: entry.id, title: entry.title, description: entry.description, kind: entry.action,
    category: entry.category ?? "Run scripts", ...(entry.action === "skill" && entry.guide !== undefined ? { guided: true } : {}) })),
  canCreate: true,
};

const fixture = {
  calls: [] as Array<{ id: string; params: Record<string, unknown> }>,
  notifications: [] as RunPanelHostMessage[],
  views: new Set<string>(),
  command(message: HostRunPanelMessage) { commands.forEach((listener) => listener(message)); },
  /** The extension's next state message: the same content as a new object. */
  renewPanel() { panelRenewals.forEach((renew) => renew()); },
  async call(contract: { id: string }, params: Record<string, unknown>) {
    fixture.calls.push({ id: contract.id, params });
    const runId = typeof params.runId === "string" ? params.runId : "";
    switch (contract.id) {
      case "ragents.overseer.coordinator": return { runId: "global" };
      case "ragents.overseer.settings.read": return { provider: "demo", model: "demo-model", thinking: "off", models: [{ id: "demo-model", provider: "demo", label: "Demo", thinking: ["off"] }] };
      case "ragents.runs.list": return [{ id: "existing", title: "Existing run", updatedAt: Date.now() - 180_000, running: false, state: "idle", pendingActions: 0, workspaceAccessible: true }];
      case "ragents.runs.markViewed": return null;
      case "ragents.startOptions.list": return optionsOf(runId);
      case "ragents.startOptions.select": {
        if (!inspecting && technical.has(String(params.optionId))) throw new Error(`The right runs.inspect is missing for the start option ${String(params.optionId)}.`);
        chosen.set(`${runId}:${String(params.optionId)}`, params.value);
        return optionsOf(runId).find((option) => option.id === params.optionId);
      }
      case "ragents.runs.view": return fixture.views.has(runId) ? emptyView(runId) : null;
      case "ragents.chat.actorHistory": return { actors: {} };
      case "ragents.chat.capabilities": return { input: ["text", "image", "file"], model: "z-ai/glm-5.3-flash" };
      case "ragents.chat.start":
      case "ragents.chat.send": {
        fixture.views.add(runId);
        subscriptions.forEach((entry) => { if (entry.runId === runId && entry.id !== "ragents.chat") entry.message({ kind: "run" }); });
        return null;
      }
      default: return null;
    }
  },
  subscribe(contract: { id: string }, params: { runId?: string }, message: Subscription["message"]) {
    const entry = { id: contract.id, runId: params.runId, message };
    subscriptions.add(entry);
    if (contract.id === "ragents.chat") queueMicrotask(() => { message({ kind: "reset", conversationId: null }); message({ kind: "replay-end", conversationId: null }); });
    return () => { subscriptions.delete(entry); };
  },
};

declare global { interface Window { startPageFixture: typeof fixture; startPageActivation: PluginActivationState } }
window.startPageFixture = fixture;

const vsCodeHost: RunPanelHost = {
  ...createBrowserHost(window),
  kind: "vscode",
  machines: "all",
  onCommand(listener) { commands.add(listener); return () => { commands.delete(listener); }; },
  notify(message) {
    fixture.notifications.push(message);
    if (message.type === "newRun") queueMicrotask(() => fixture.command({ ...message,
      startOptions: { [WORKSPACE_BINDING_OPTION_ID]: { machine: { client: workstation.id, label: workstation.label }, folder: { path: workstation.folders[0] } } },
    }));
  },
} as RunPanelHost;
window.startPageActivation = { status: "ready", registry, bootstrap: { product: registry.profile.product, plugins: [], startEntries }, failures: [] } as unknown as PluginActivationState;

const access = createAccessContext({ enabled: true, user: { id: "tester", label: "Tester",
  rights: ["runs.read", "runs.write", "runs.create", ...(inspecting ? ["runs.inspect"] : []), "runs.delete", "settings.read", "ragents.overseer.read", "ragents.overseer.write"], startEntries: startEntries.map((entry) => entry.id) } });
const view = query.get("view") ?? "web";
function PanelFixture() {
  const [state, setState] = useState<PanelState>({ theme: "dark", page: "start", profileSuggestions: [], connections: [connection] });
  useEffect(() => {
    const renew = () => setState((current) => ({ ...current }));
    panelRenewals.add(renew);
    return () => { panelRenewals.delete(renew); };
  }, []);
  return <PanelPage state={state} send={(action) => {
    if (action.action === "page") setState((current) => ({ ...current, page: action.page }));
    if (action.action === "newRun") fixture.calls.push({ id: "panel.newRun", params: { ...action } });
  }} />;
}
const page = view === "start"
  ? <PanelFixture />
  : view === "panel"
    ? <RunPanelHostProvider value={query.get("host") === "vscode" ? vsCodeHost : createBrowserHost(window)}>
      <RunPanelApp location={{ layout: "panel", runId: undefined, host: query.get("host") === "vscode" ? "vscode" : "browser", connection: "local", theme: undefined, access: undefined }} />
    </RunPanelHostProvider>
    : <RunPanelHostProvider value={createBrowserHost(window)}><RunPanelApp location={parseRunPanelLocation(location.search)} /></RunPanelHostProvider>;
createRoot(document.getElementById("root")!).render(<AccessContext.Provider value={{ ...access, logout: async () => {} }}>{page}</AccessContext.Provider>);
