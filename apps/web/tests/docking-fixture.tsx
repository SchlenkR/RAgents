import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { NetworkIcon } from "lucide-react";
import { DockToolsContext, DockWorkspace } from "../src/run-panel/DockWorkspace";
import { activeDockTool, selectDockPanel, workspaceTabPanelId } from "../src/run-panel/dock-state";
import { useDockStorage } from "../src/run-panel/dock-storage";
import { RunPanelHeader } from "../src/run-panel/RunPanelHeader";
import { PluginRegistry, type SessionHeaderContribution, type WorkspaceTabContribution } from "../src/PluginRegistry";
import type { RunApp } from "../src/run-apps";
import { Badge, Button, Dialog, DialogContent, DialogTitle } from "../src/ui";
import "../src/ui/tailwind.css";

// With "?header" the window buttons sit in the real run header, as in a browser run.
const withHeader = new URLSearchParams(location.search).has("header");
// With "?window" a workspace tab placed as a window joins the header windows.
const withWindowTab = new URLSearchParams(location.search).has("window");
const registry = new PluginRegistry({ brand: { title: "Example" }, product: { id: "example", title: "Example" }, plugins: [{ id: "example" }], startEntries: [] });
const headers: readonly SessionHeaderContribution[] = [{ id: "example.agents", placement: "bar", order: 0, Header: () => <Button aria-label="Agents" className="flex-none self-center" size="lg" variant="ghost">
  <NetworkIcon /><span>Agents</span>
</Button> }, { id: "example.details", order: 1, Header: () => <p className="p-2">Run metadata</p> }];
const mounts: Record<string, number> = {};
function App() {
  useState(() => { mounts.notes = (mounts.notes ?? 0) + 1; return undefined; });
  return <><input aria-label="App draft" /><iframe className="min-h-0 flex-1" title="App frame" srcDoc={'<!doctype html><input aria-label="Frame draft"><script>window.identity = Math.random()</script>'} /></>;
}
const preview: WorkspaceTabContribution = {
  id: "preview", label: "Preview", order: 0, placement: "window", Icon: () => <svg aria-hidden />,
  Panel: ({ active }) => <><input aria-label="Preview draft" /><p>{active ? "Preview active" : "Preview inactive"}</p></>,
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
})), ...(withWindowTab ? [preview] : [])];
function Run({ run, appIds }: { run: string; appIds: readonly string[] }) {
  const { state, update } = useDockStorage(run);
  const [actions, setActions] = useState<HTMLDivElement | null>(null);
  const session = { session: { id: run, title: run, updatedAt: 0, canShare: true as const }, connected: true, runView: {}, messages: [], pluginEvents: [], running: false, send: async () => {}, start: async () => {} };
  const apps: readonly RunApp[] = appIds.map((id) => ({ runId: run, definition: { id, title: id[0].toUpperCase() + id.slice(1) }, Element: App }));
  const navigation = { activeTabId: activeDockTool(state), openTab: (id: string) => update((current) => selectDockPanel(current, workspaceTabPanelId(tools.find((tool) => tool.id === id)!))), revealEntity: () => false, selectionFor: () => undefined };
  useEffect(() => { window.dockingFixture.openTab = navigation.openTab; });
  const workspace = <DockToolsContext.Provider value={{ tabs: tools, pendingTabIds: [], actionsContainer: withHeader ? actions : undefined }}><DockWorkspace apps={apps} chat={<><button onClick={() => navigation.openTab("files")}>Reveal Files from chat</button><textarea aria-label="Chat draft" className="h-full" /></>} navigation={navigation} session={session} /></DockToolsContext.Provider>;
  return withHeader ? <div className="flex min-w-0 flex-1 flex-col">
    <header className="flex min-h-header flex-none items-center border-b border-border bg-shell px-2">
      <RunPanelHeader actionsRef={setActions} attention={undefined} contributions={headers} navigation={navigation} registry={registry} runError={undefined} session={session} working={false} />
    </header>
    {workspace}
  </div> : workspace;
}
function Fixture() {
  const [run, setRun] = useState("first");
  const [appIds, setApps] = useState<readonly string[]>(["notes"]);
  window.dockingFixture = { ...window.dockingFixture, mounts, setApps, setRun };
  return <Run appIds={appIds} key={run} run={run} />;
}
declare global {
  interface Window {
    dockingFixture: { mounts: Record<string, number>; setApps: (ids: readonly string[]) => void; setRun: (id: string) => void; openTab?: (id: string) => void };
  }
}
createRoot(document.getElementById("root")!).render(<Fixture />);
