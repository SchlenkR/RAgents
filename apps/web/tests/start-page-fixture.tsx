import { createRoot } from "react-dom/client";
import { createAccessContext } from "../../../packages/ragents/src/access";
import { WORKSPACE_BINDING_OPTION_ID } from "../../../plugins/ragents.workspace/contract";
import { WorkspaceBindingControl } from "../../../plugins/ragents.workspace/web/WorkspaceBinding";
import { App } from "../src/App";
import { AccessContext } from "../src/AccessContext";
import type { PluginActivationState } from "../src/PluginActivation";
import { PluginRegistry, type EntryGuideContext } from "../src/PluginRegistry";
import { PanelPage } from "../src/panel/PanelPage";
import type { ConnectionView } from "../src/panel/contract";
import { productStartOptions } from "../src/product/start-options";
import { RunPanelApp } from "../src/run-panel/RunPanelApp";
import { createBrowserHost, RunPanelHostProvider, type RunPanelHost } from "../src/run-panel/host";
import type { HostRunPanelMessage } from "../src/run-panel/host-contract";
import "../src/ui/tailwind.css";

type Subscription = { id: string; runId?: string; message: (event: unknown) => void };
const subscriptions = new Set<Subscription>();
const commands = new Set<(message: HostRunPanelMessage) => void>();
const query = new URLSearchParams(location.search);

function TopicGuide({ onCancel, onComplete }: EntryGuideContext) {
  return <div className="grid gap-3 p-6">
    <p>Worum geht es?</p>
    <div className="flex gap-2">
      <button onClick={() => onComplete("Kläre die Wahl des Hostings.")} type="button">Thema übernehmen</button>
      <button onClick={onCancel} type="button">Leitfaden abbrechen</button>
    </div>
  </div>;
}

const startEntries = [
  { id: "demo.board", owner: "demo", action: "skill" as const, skill: "board", category: "Mini-Apps", title: "Sammelboard",
    description: "Ein Listenhelfer mit eigener Funktion, Mini-App und gemeinsamem Zustand.", prompt: "Baue ein Board für Einkäufe." },
  { id: "demo.decision", owner: "demo", action: "skill" as const, skill: "decision", category: "Besprechen", title: "Entscheidung klären",
    description: "Der Leitfaden fragt zuerst das Thema, danach wird der Auftrag besprochen.", prompt: "Kläre eine Entscheidung.", guide: "demo.topic" },
  { id: "demo.circle", owner: "demo", action: "script" as const, category: "Moderation", title: "Gesprächsrunde",
    description: "Vier Helfer sprechen reihum, der Koordinator führt die Runden.", coordinator: true },
  { id: "demo.word", owner: "demo", action: "script" as const, title: "Wortspiel",
    description: "Vier Modelle reichen Wörter weiter, ein Actor beendet nach zwölf.", coordinator: false },
];

const registry = new PluginRegistry({
  brand: { title: "Startprüfung" }, product: { id: "demo", title: "Startprüfung" },
  plugins: [
    { id: "demo", startOptions: productStartOptions, guides: [{ id: "demo.topic", Guide: TopicGuide }] },
    { id: "ragents.workspace", startOptions: [{ id: WORKSPACE_BINDING_OPTION_ID, Control: WorkspaceBindingControl }] },
  ],
  startEntries,
});

const workstation = { id: "laptop-01", label: "Notebook", hostname: "notebook", platform: "darwin",
  folders: ["/home/user/project"], runsDirectory: "/home/user/.local/share/ragents/workspace/runs" };
const presentations: Record<string, { owner: string; initial: unknown; presentation: unknown }> = {
  "ragents.model": { owner: "demo", initial: { model: "z-ai/glm-5.3-flash", thinking: "high" },
    presentation: { kind: "model", provider: "openrouter", options: ["z-ai/glm-5.3-flash", "qwen/qwen3.8-max"], thinkingOptions: ["off", "low", "high"] } },
  "ragents.system-prompt": { owner: "demo", initial: { promptIds: [], shareWithAgents: false },
    presentation: { kind: "system-prompt", options: [{ id: "brief", label: "Kurz und knapp", text: "Antworte kurz." }, { id: "careful", label: "Gründlich", text: "Prüfe jeden Schritt." }] } },
  [WORKSPACE_BINDING_OPTION_ID]: { owner: "ragents.workspace", initial: { machine: "server", folder: "fresh" },
    presentation: { kind: "workspace-binding", clients: [workstation], fresh: { server: "Leerer Ordner je Run", client: "Leerer Ordner je Run" }, serverFolders: true } },
};
const chosen = new Map<string, unknown>();
const optionsOf = (runId: string) => Object.entries(presentations).map(([id, { owner, initial, presentation }]) => ({
  id, owner, presentation, value: chosen.get(`${runId}:${id}`) ?? initial, selectable: true, locked: fixture.views.has(runId), chosen: chosen.has(`${runId}:${id}`),
}));
const emptyView = (runId: string) => ({ id: runId, revision: 1, title: "Run", ownerId: "tester", primaryActorId: null, createdAt: "2026-09-24T10:00:00.000Z", forkedFrom: null,
  actors: [], inputs: [], turns: [], subscriptions: [], pluginStates: [], actions: [], artifacts: [] });
const connection: ConnectionView = {
  name: "lokal", kind: "profile", address: "/home/user/ragents.config.core.ts", route: { kind: "profile", profile: "core" }, state: { kind: "connected" },
  runs: [{ id: "existing", title: "Vorhandener Run", state: "idle", pendingActions: 0, updatedAt: Date.now() - 180_000 }],
  entries: startEntries.map((entry) => ({ id: entry.id, title: entry.title, description: entry.description, kind: entry.action,
    category: entry.category ?? "Run-Scripts", ...(entry.action === "skill" && entry.guide !== undefined ? { guided: true } : {}) })),
  canCreate: true,
};

const fixture = {
  calls: [] as Array<{ id: string; params: Record<string, unknown> }>,
  views: new Set<string>(),
  command(message: HostRunPanelMessage) { commands.forEach((listener) => listener(message)); },
  async call(contract: { id: string }, params: Record<string, unknown>) {
    fixture.calls.push({ id: contract.id, params });
    const runId = typeof params.runId === "string" ? params.runId : "";
    switch (contract.id) {
      case "ragents.runs.list": return [{ id: "existing", title: "Vorhandener Run", updatedAt: Date.now() - 180_000 }];
      case "ragents.startOptions.list": return optionsOf(runId);
      case "ragents.startOptions.select": {
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
  notify() {},
} as RunPanelHost;
window.startPageActivation = { status: "ready", registry, bootstrap: { product: registry.profile.product, plugins: [], startEntries }, failures: [] } as unknown as PluginActivationState;

const access = createAccessContext({ enabled: true, user: { id: "tester", label: "Tester",
  rights: ["runs.read", "runs.write", "runs.create", "runs.inspect", "runs.delete", "settings.read"], startEntries: startEntries.map((entry) => entry.id) } });
const view = query.get("view") ?? "web";
const page = view === "start"
  ? <div className="p-3"><PanelPage send={(action) => { if (action.action === "newRun") fixture.calls.push({ id: "panel.newRun", params: { ...action } }); }}
    state={{ theme: "dark", page: "start", profileSuggestions: [], connections: [connection] }} /></div>
  : view === "panel"
    ? <RunPanelHostProvider value={query.get("host") === "vscode" ? vsCodeHost : createBrowserHost(window)}>
      <RunPanelApp location={{ layout: "panel", runId: undefined, host: query.get("host") === "vscode" ? "vscode" : "browser", connection: "lokal", theme: undefined, access: undefined }} />
    </RunPanelHostProvider>
    : <App />;
createRoot(document.getElementById("root")!).render(<AccessContext.Provider value={{ ...access, logout: async () => {} }}>{page}</AccessContext.Provider>);
