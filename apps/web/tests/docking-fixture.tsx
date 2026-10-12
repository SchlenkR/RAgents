import { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { NetworkIcon } from "lucide-react";
import { DockToolsContext, DockWorkspace, type DockPanelDrag, type DockPanelOpen } from "../src/run-panel/DockWorkspace";
import { activeDockTool, workspaceTabPanelId } from "../src/run-panel/dock-state";
import { useDockStorage } from "../src/run-panel/dock-storage";
import { RunPanelHeader } from "../src/run-panel/RunPanelHeader";
import { RunHeader } from "../src/run-panel/RunHeader";
import { PluginRegistry, type SessionContext, type SessionHeaderContribution, type SurfaceElementAdditionContext, type SurfaceElementContext, type WorkspaceTabContribution } from "../src/PluginRegistry";
import { createActorProgramsApi } from "../../../plugins/ragents.actor-programs/web/api";
import { ActorProgramsProvider } from "../../../plugins/ragents.actor-programs/web/AppsPanel";
import { ActorProgramSurfaceElement } from "../../../plugins/ragents.actor-programs/web/EmbeddedApps";
import { ACTOR_PROGRAMS_STATE_ID, ACTOR_STATE_ID } from "../../../apps/server/src/plugin-support/actor-programs/contract";
import type { RunView } from "../src/run-view";
import { webPlugin } from "../../../plugins/ragents.orchestration/web/index";
import { AGENTS_TAB_ID } from "../../../plugins/ragents.orchestration/web/run-panel/AgentsPanel";
import { useRunPanelState } from "../../../plugins/ragents.orchestration/web/run-panel/run-panel-state";
import type { RunApp, RunAppAddition } from "../src/run-apps";
import { Badge, Button, Dialog, DialogContent, DialogTitle } from "../src/ui";
import { initializeTheme } from "../src/theme";
import { initializeAppearance } from "../src/appearance";
import "../src/ui/tailwind.css";

// With "?header" the window buttons sit in the real run header, as in a browser run.
const withHeader = new URLSearchParams(location.search).has("header");
// With "?window" a workspace tab placed as a window joins the header windows.
const withWindowTab = new URLSearchParams(location.search).has("window");
// With "?add" a surface addition offers "Show app...", whose dialog adds a Chart app.
const withAddition = new URLSearchParams(location.search).has("add");
const withAgents = new URLSearchParams(location.search).has("agents");
const withLiveState = new URLSearchParams(location.search).has("live");
if (withLiveState) { initializeTheme(window); initializeAppearance(window); }
const agentsTab = webPlugin.workspaceTabs!.find((tab) => tab.id === AGENTS_TAB_ID)!;
const graphView: RunView = {
  id: "first", revision: 1, title: "Example", ownerId: "owner", primaryActorId: "coordinator", createdAt: "2026-10-12T08:00:00.000Z", forkedFrom: null,
  actors: ["coordinator", "worker"].map((id) => ({ id, kind: "agent", handle: id, displayName: id, createdBy: id === "worker" ? "coordinator" : "owner", grants: [], createdAt: "2026-10-12T08:00:00.000Z", lifecycle: { kind: "idle", since: "2026-10-12T08:00:00.000Z" } })),
  inputs: [], turns: [], subscriptions: [], pluginStates: [], actions: [], artifacts: [],
};
const registry = new PluginRegistry({ brand: { title: "Example" }, product: { id: "example", title: "Example" }, plugins: [{ id: "example" }], startEntries: [] });
const headers: readonly SessionHeaderContribution[] = [{ id: "example.agents", placement: "bar", order: 0, Header: () => <Button aria-label="Agents" className="flex-none self-center" size="lg" variant="ghost">
  <NetworkIcon /><span>Agents</span>
</Button> }, { id: "example.details", order: 1, Header: () => <p className="p-2">Run metadata</p> }];
const mounts: Record<string, number> = {};
const frameHtml = `<!doctype html><input aria-label="Live frame draft"><output aria-label="Live frame state"></output><script>
window.identity = Math.random();
const channel = new MessageChannel();
channel.port1.onmessage = ({ data }) => {
  if (data.type === "ragents.app.ready") channel.port1.postMessage({ type: "ragents.app.connected", version: 1 });
  if (data.type === "ragents.app.ready" || data.type === "ragents.app.state") document.querySelector("output").textContent = String(data.state.values.count);
};
channel.port1.start();
parent.postMessage({ type: "ragents.app.frame-ready", version: 1, token: new URLSearchParams(location.hash.slice(1)).get("ragentsBridge") }, "*", [channel.port2]);
</script>`;
const liveApp = { id: "notes", actorId: "worker", actorHandle: "worker", title: "Notes", revision: "installed", actions: [], invocations: [],
  state: { version: 1 as const, revision: 1, values: { count: 1 } } };
const frameApi = { ...createActorProgramsApi("/fixture"), frameUrl: () => `data:text/html,${encodeURIComponent(frameHtml)}`, list: async () => ({ apps: [liveApp], tools: [] }) };
function App(props: SurfaceElementContext) {
  useState(() => { mounts.notes = (mounts.notes ?? 0) + 1; return undefined; });
  if (withLiveState) return <ActorProgramSurfaceElement {...props} />;
  return <><input aria-label="App draft" /><iframe className="min-h-0 flex-1" title="App frame" srcDoc={'<!doctype html><input aria-label="Frame draft"><script>window.identity = Math.random()</script>'} /></>;
}
function LiveState({ session }: { session: SessionContext }) {
  const count = (session.runView as RunView).revision;
  const [received, setReceived] = useState(count);
  useEffect(() => { setReceived(count); }, [count]);
  return <output aria-label="Live panel state">{received}</output>;
}
const preview: WorkspaceTabContribution = {
  id: "preview", label: "Preview", order: 0, placement: "window", Icon: () => <svg aria-hidden />,
  openByDefault: !new URLSearchParams(location.search).has("manual"),
  Panel: ({ active, session }) => <><input aria-label="Preview draft" /><p>{active ? "Preview active" : "Preview inactive"}</p>{withLiveState && <LiveState session={session} />}</>,
  Header: () => <Button aria-label="Refresh preview" size="icon-xs" variant="ghost"><svg aria-hidden /></Button>,
  Badge: () => <Badge>2 checks</Badge>,
};
// A dialog that loads on open, like a tool panel's detail view; its effect only completes while the panel stays active.
function JournalDetails() {
  const [text, setText] = useState("Loading details");
  useEffect(() => {
    const timer = setTimeout(() => setText("Details loaded"), 500);
    return () => clearTimeout(timer);
  }, []);
  return <p>{text}</p>;
}
function JournalDialog() {
  const [open, setOpen] = useState(false);
  return <>
    <button onClick={() => setOpen(true)} type="button">Open details</button>
    <Dialog onOpenChange={setOpen} open={open}><DialogContent><DialogTitle>Journal details</DialogTitle><JournalDetails /></DialogContent></Dialog>
  </>;
}
const tools: readonly WorkspaceTabContribution[] = [...["Files", "Journal"].map((label): WorkspaceTabContribution => ({
  id: label.toLowerCase(), label, order: 0, Icon: () => <svg aria-hidden />,
  Panel: function Tool({ active, navigation }) {
    return <><input aria-label={`${label} draft`} /><p>{active ? `${label} active` : `${label} inactive`}</p><button onClick={() => navigation.openTab("files")}>Open Files</button>
      {label === "Journal" && <JournalDialog />}</>;
  },
})), ...(withWindowTab ? [preview] : []), ...(withAgents ? [agentsTab] : [])];
function AddDialog({ onClose }: SurfaceElementAdditionContext) {
  return <Dialog onOpenChange={(open) => { if (!open) onClose(); }} open><DialogContent><DialogTitle>Show app</DialogTitle>
    <button onClick={() => { window.dockingFixture.setApps(["notes", "board", "chart"]); onClose("chart"); }} type="button">Show chart</button>
  </DialogContent></Dialog>;
}
const additions: readonly RunAppAddition[] = withAddition ? [{ id: "add:example", label: "Show app...", Dialog: AddDialog }] : [];
function Run({ run, appIds, previewAvailable }: { run: string; appIds: readonly string[]; previewAvailable: boolean }) {
  const { state } = useDockStorage(run);
  const [actions, setActions] = useState<HTMLDivElement | null>(null);
  const [view, setView] = useState(graphView);
  const selected = useRunPanelState(run);
  const panelDrag = useRef<DockPanelDrag | undefined>(undefined);
  const openPanel = useRef<DockPanelOpen | undefined>(undefined);
  const runView = withLiveState ? { ...view, id: run, pluginStates: [
    { pluginId: ACTOR_PROGRAMS_STATE_ID, scope: { kind: "actor" as const, actorId: "worker" }, state: { program: { actorId: "worker", actorHandle: "worker", revision: "installed", views: [{ id: "notes", title: "Notes" }] } } },
    { pluginId: ACTOR_STATE_ID, scope: { kind: "actor" as const, actorId: "worker" }, state: { count: view.revision } },
  ] } : withAgents ? view : {};
  const session: SessionContext = { session: { id: run, title: run, updatedAt: 0, canShare: true as const }, connected: true, runView, messages: [], pluginEvents: [], running: false, send: async () => {}, start: async () => {} };
  const apps: readonly RunApp[] = appIds.map((id) => ({ runId: run, definition: { id, title: id[0].toUpperCase() + id.slice(1) }, Element: App, layoutKey: id }));
  const navigation = { activeTabId: activeDockTool(state), openTab: (id: string) => openPanel.current?.(workspaceTabPanelId(tools.find((tool) => tool.id === id)!)), revealEntity: () => false, selectionFor: () => undefined };
  useEffect(() => {
    window.dockingFixture.openTab = navigation.openTab;
    window.dockingFixture.advanceState = () => setView((current) => ({ ...current, revision: current.revision + 1 }));
    window.dockingFixture.startWorker = () => setView((current) => ({ ...current, revision: current.revision + 1, actors: current.actors.map((actor) => actor.id === "worker" ? { ...actor, lifecycle: { kind: "running", turnId: "turn", inputId: "input", startedAt: "2026-10-12T08:00:00.000Z" } } : actor) }));
  });
  const workspace = <DockToolsContext.Provider value={{ tabs: tools.filter((tab) => tab.id !== preview.id || previewAvailable), pendingTabIds: [], actionsContainer: withHeader ? actions : undefined, panelDrag, openPanel }}><DockWorkspace additions={additions} apps={apps}
    panels={withAgents ? view.actors.map((actor) => ({ id: `actor:${actor.id}`, title: `@${actor.handle}`, content: <textarea aria-label={`Message to @${actor.handle}`} /> })) : []}
    chat={<><button onClick={() => navigation.openTab("files")}>Reveal Files from chat</button>{withAgents && <output aria-label="Chat addressee">@{selected.actor ?? "coordinator"}</output>}<textarea aria-label="Chat draft" className="h-full" /></>} navigation={navigation} session={session} /></DockToolsContext.Provider>;
  const content = withHeader ? <div className="flex min-w-0 flex-1 flex-col">
    <RunHeader leading={
      <RunPanelHeader actionsRef={setActions} attention={undefined} contributions={withAgents ? [] : headers} navigation={navigation} registry={registry} runError={undefined} session={session} working={false} />
    }>
    {workspace}
    </RunHeader>
  </div> : workspace;
  return withLiveState ? <ActorProgramsProvider api={frameApi} session={session}>{content}</ActorProgramsProvider> : content;
}
function Fixture() {
  const [run, setRun] = useState("first");
  const [appIds, setApps] = useState<readonly string[]>(["notes"]);
  const [previewAvailable, setPreviewAvailable] = useState(true);
  window.dockingFixture = { ...window.dockingFixture, mounts, setApps, setRun, setPreviewAvailable };
  return <Run appIds={appIds} key={run} run={run} previewAvailable={previewAvailable} />;
}
declare global {
  interface Window {
    dockingFixture: { mounts: Record<string, number>; setApps: (ids: readonly string[]) => void; setRun: (id: string) => void; setPreviewAvailable: (available: boolean) => void; openTab?: (id: string) => void; startWorker?: () => void; advanceState?: () => void };
  }
}
createRoot(document.getElementById("root")!).render(<Fixture />);
