import { createRoot } from "react-dom/client";
import { createAccessContext } from "../../../packages/ragents/src/access";
import { OrchestrationRunPanel } from "../../../plugins/ragents.orchestration/web/run-panel/RunPanel";
import { AccessContext } from "../src/AccessContext";
import type { PluginActivationState } from "../src/PluginActivation";
import { PluginRegistry, type SurfaceElementDefinition, type EntryGuideContext, type StartSectionContext, type WebPlugin } from "../src/PluginRegistry";
import type { ListedSession } from "../src/api";
import { ToolbarCopy, ToolbarItem, ToolbarLabel, ToolbarText } from "../src/Toolbar";
import type { RunSharing, RunSharingResult } from "../src/run-sharing";
import { RunPanelApp } from "../src/run-panel/RunPanelApp";
import { RunPanelHostProvider, type RunPanelHost } from "../src/run-panel/host";
import type { HostRunPanelMessage, RunPanelHostMessage } from "../src/run-panel/host-contract";
import "../src/ui/tailwind.css";
import { QuasselHost } from "../src/chat/QuasselHost";

type Subscription = { id: string; runId?: string; message: (event: unknown) => void };
const subscriptions = new Set<Subscription>();
const commands = new Set<(message: HostRunPanelMessage) => void>();
const activationListeners = new Set<(state: PluginActivationState) => void>();
const query = new URLSearchParams(location.search);
const rights = (query.get("rights") ?? "runs.read,runs.write,runs.create,runs.inspect").split(",");
const host: RunPanelHost = {
  kind: query.get("host") === "browser" ? "browser" : "vscode",
  machines: query.get("host") === "browser" ? "server" : "all",
  openApp() {},
  requestLogin() {},
  requestLogout() {},
  openExternal() {},
  openPage() {},
  openService() {},
  onCommand(listener) { commands.add(listener); return () => { commands.delete(listener); }; },
  notify(message) {
    fixture.notifications.push(message);
    if (message.type === "newRun") queueMicrotask(() => fixture.command(message));
  },
};
function TopicGuide({ onCancel, onComplete }: EntryGuideContext) {
  return <div>
    <button onClick={() => onComplete("Night bus")} type="button">Apply topic</button>
    <button onClick={onCancel} type="button">Cancel guide</button>
  </div>;
}
function WorkDocuments({ runs, onOpenRun }: StartSectionContext) {
  const documents = runs.flatMap((run) => {
    const titles = run.metadata?.["start.documents"];
    if (titles === undefined) return [];
    if (!Array.isArray(titles) || !titles.every((title) => typeof title === "string")) throw new Error("Invalid work document metadata.");
    return titles.map((title: string) => ({ run, title }));
  });
  if (documents.length === 0) return null;
  return <section aria-label="Work documents">
    <h2>Work documents</h2>
    <ul>{documents.map(({ run, title }) => <li key={`${run.id}:${title}`}>
      <button onClick={() => onOpenRun(run.id)} type="button">{title} - {run.title}</button>
    </li>)}</ul>
  </section>;
}
const documentPlugin: WebPlugin = {
  id: "start.documents", startSections: [{ id: "start.documents", order: 100, Section: WorkDocuments }],
};
const metadataTexts = {
  workspace: "/home/user/project/packages/an-example-package-with-a-long-name/src/features/shared-header-panels/complete-session-metadata.ts",
  source: "A prepared workflow with a descriptive source name that stays readable in a narrow editor sidebar.",
  notes: "All metadata contributions remain available, including this final note after the workspace and source.",
};
const dropdownPlugin: WebPlugin = {
  id: "start.dropdown",
  sessionMetadata: Object.entries(metadataTexts).map(([id, text], order) => ({ id: `start.dropdown.${id}`, order,
    Metadata: () => <ToolbarItem><ToolbarCopy><ToolbarLabel>{id}</ToolbarLabel><ToolbarText>{text}</ToolbarText></ToolbarCopy></ToolbarItem> })),
  sessionHeaders: [{ id: "start.dropdown.control", order: 50, Header: () => <ToolbarItem as="button" type="button">
    <ToolbarCopy><ToolbarLabel>Run controls</ToolbarLabel><ToolbarText>Contributed details action</ToolbarText></ToolbarCopy>
  </ToolbarItem> }],
  startOptions: [{ id: "start.dropdown.mode", Badge: () => <ToolbarItem><ToolbarCopy><ToolbarLabel>Mode</ToolbarLabel><ToolbarText>Careful review</ToolbarText></ToolbarCopy></ToolbarItem> }],
};
const registry = new PluginRegistry({
  brand: { title: "Start check" }, product: { id: "start", title: "Start check" },
  plugins: [{
    id: "start", needsRunView: true,
    surface: { RunPanel: OrchestrationRunPanel },
    surfaceElements: [{ id: "start.app", order: 0, select: () => fixture.elements, Element: () => <p>Mini-app ready</p> }],
    guides: [{ id: "start.topic", Guide: TopicGuide }],
  }, documentPlugin, ...(query.has("dropdowns") ? [dropdownPlugin] : [])],
  startEntries: [
    { id: "start.script", owner: "start", title: "Setup template", description: "Builds a mini-app", action: "script", coordinator: false },
    { id: "start.other", owner: "start", title: "Second template", description: "Builds something else", action: "script", coordinator: false },
    { id: "start.guided", owner: "start", title: "Round with a guide", description: "Asks for the topic first", action: "script", coordinator: false, guide: "start.topic" },
  ],
});
const heldStarts = new Map<string, () => void>();
const emptyView = (runId: string) => ({ id: runId, revision: 1, title: "Run", ownerId: "tester", primaryActorId: null, createdAt: "2026-09-24T10:00:00.000Z", forkedFrom: null,
  actors: [], inputs: [], turns: [], subscriptions: [], pluginStates: [], actions: [], artifacts: [] });

const fixture = {
  activation: (query.get("profile") === "pending" ? { status: "loading" } : { status: "ready", registry, failures: [] }) as PluginActivationState,
  elements: [] as SurfaceElementDefinition[],
  notifications: [] as RunPanelHostMessage[],
  calls: [] as string[],
  starts: [] as Array<{ runId: string; entry: string; input: unknown }>,
  scriptStarts: [] as Array<{ runId: string; entry: string; input: unknown }>,
  metadataTexts,
  shares: [] as RunSharing[],
  sharing: { sharing: { everyone: null, users: [{ userId: "bob", label: "Bob", access: "read" }] }, users: [{ id: "bob", label: "Bob" }, { id: "carol", label: "Carol" }] } as RunSharingResult,
  sharingError: undefined as string | undefined,
  holdSharing: false,
  releaseSharing: () => {},
  views: new Set<string>(),
  runs: [{ id: "existing", title: "Existing run", updatedAt: 7, running: false, state: "idle", pendingActions: 0, workspaceAccessible: true, operable: true,
    ...(query.has("dropdowns") ? { canShare: true } : {}) },
    ...(query.has("documents") ? Array.from({ length: 6 }, (_, index): ListedSession => ({
      id: `document-run-${index}`, title: `Document run ${index}`, updatedAt: 6 - index, running: false, state: "idle", pendingActions: 0,
      workspaceAccessible: true, operable: true, metadata: { "start.documents": [`Work note ${index}`] },
    })) : []),
  ] as ListedSession[],
  holdStart: false,
  activate() { fixture.activation = { status: "ready", registry, failures: [] } as PluginActivationState; activationListeners.forEach((listener) => listener(fixture.activation)); },
  onActivation(listener: (state: PluginActivationState) => void) { activationListeners.add(listener); return () => { activationListeners.delete(listener); }; },
  command(message: HostRunPanelMessage) { commands.forEach((listener) => listener(message)); },
  chat(event: unknown) { subscriptions.forEach((entry) => { if (entry.id === "ragents.chat") entry.message(event); }); },
  releaseStart(runId?: string) {
    for (const [held, release] of [...heldStarts]) {
      if (runId !== undefined && held !== runId) continue;
      heldStarts.delete(held);
      release();
    }
  },
  runChanged(runId: string) { subscriptions.forEach((entry) => { if (entry.id !== "ragents.chat" && entry.runId === runId) entry.message({ kind: "run" }); }); },
  activeRun() { return [...subscriptions].find((entry) => entry.id === "ragents.chat")?.runId; },
  async call(contract: { id: string }, params: { runId?: string; entry?: string; input?: unknown; sharing?: RunSharing }) {
    fixture.calls.push(contract.id);
    switch (contract.id) {
      case "ragents.runs.list": return fixture.runs;
      case "ragents.runs.markViewed": return null;
      case "ragents.startOptions.list": return query.has("dropdowns") ? [{ id: "start.dropdown.mode", owner: "start.dropdown", value: "careful", presentation: {}, selectable: false, locked: true, chosen: false }]
        : query.has("preset") ? [{ id: "start.machine", owner: "start", value: "server", presentation: {}, selectable: true, locked: false, chosen: false }] : [];
      case "ragents.startOptions.select": throw new Error("The workstation Notebook is not connected.");
      case "ragents.runs.sharing":
      case "ragents.runs.share": {
        if (params.sharing) fixture.shares.push(params.sharing);
        if (fixture.holdSharing) await new Promise<void>((resolve) => { fixture.releaseSharing = resolve; });
        if (fixture.sharingError) throw new Error(fixture.sharingError);
        if (params.sharing) fixture.sharing = { ...fixture.sharing, sharing: { everyone: params.sharing.everyone,
          users: params.sharing.users.map((user) => ({ ...user, label: fixture.sharing.users.find((entry) => entry.id === user.userId)?.label ?? user.userId })) } };
        return fixture.sharing;
      }
      case "ragents.runs.view": return params.runId !== undefined && fixture.views.has(params.runId) ? emptyView(params.runId) : null;
      case "ragents.chat.actorHistory": return { actors: {} };
      case "ragents.chat.start": {
        const runId = params.runId!;
        fixture.starts.push({ runId, entry: params.entry!, input: params.input });
        return fixture.holdStart ? new Promise<null>((resolve) => { heldStarts.set(runId, () => resolve(null)); }) : null;
      }
      case "ragents.runs.scripts": return [
        { id: "start.script", title: "Setup template", description: "Builds a mini-app", available: false, reason: "It starts only a new run; its RUN.md does not set embeddable: true." },
        { id: "start.review", title: "Review", description: "Reviews the run", available: true },
        { id: "start.strict", title: "Strict review", description: "Reviews strictly", available: true },
      ];
      case "ragents.runs.startScript": {
        fixture.scriptStarts.push({ runId: params.runId!, entry: params.entry!, input: params.input });
        if (params.entry === "start.strict") throw new Error("The template fixes the start option demo.mode to strict, but this run has plain.");
        const started = { actorId: "script-review", handle: "review", count: 1 };
        return fixture.holdStart ? new Promise<typeof started>((resolve) => { heldStarts.set(params.entry!, () => resolve(started)); }) : started;
      }
      default: throw new Error(`Unexpected fixture RPC: ${contract.id}`);
    }
  },
  subscribe(contract: { id: string }, params: { runId?: string }, message: Subscription["message"]) {
    const entry = { id: contract.id, runId: params.runId, message };
    subscriptions.add(entry);
    return () => { subscriptions.delete(entry); };
  },
};

declare global { interface Window { runStartFixture: typeof fixture; } }
window.runStartFixture = fixture;

const access = createAccessContext({ enabled: true, user: { id: "tester", label: "Tester", rights, startEntries: ["start.script", "start.other", "start.guided"] } });
const initialRun = query.get("run") ?? undefined;
createRoot(document.getElementById("root")!).render(<QuasselHost><AccessContext.Provider value={{ ...access, logout: async () => {} }}>
  <RunPanelHostProvider value={host}>
    <RunPanelApp location={{ layout: "panel", runId: initialRun, host: host.kind, connection: "local", theme: undefined, access: undefined }} />
  </RunPanelHostProvider>
</AccessContext.Provider></QuasselHost>);
