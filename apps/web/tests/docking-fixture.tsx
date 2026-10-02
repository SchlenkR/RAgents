import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { NetworkIcon } from "lucide-react";
import { DockToolsContext, DockWorkspace } from "../src/run-panel/DockWorkspace";
import { activeDockTool, selectDockPanel, toolPanelId } from "../src/run-panel/dock-state";
import { useDockStorage } from "../src/run-panel/dock-storage";
import { RunPanelHeader } from "../src/run-panel/RunPanelHeader";
import { PluginRegistry, type SessionHeaderContribution, type WorkspaceTabContribution } from "../src/PluginRegistry";
import type { RunApp } from "../src/run-apps";
import { Button } from "../src/ui";
import "../src/ui/tailwind.css";

// With "?header" the window buttons sit in the real run header, as in a browser run.
const withHeader = new URLSearchParams(location.search).has("header");
const registry = new PluginRegistry({ brand: { title: "Example" }, product: { id: "example", title: "Example" }, plugins: [{ id: "example" }], startEntries: [] });
const headers: readonly SessionHeaderContribution[] = [{ id: "example.agents", placement: "bar", order: 0, Header: () => <Button aria-label="Agents" className="flex-none self-center" size="lg" variant="ghost">
  <NetworkIcon /><span className="hidden @xs/run-header:inline">Agents</span>
</Button> }];
const mounts: Record<string, number> = {};
function App() {
  useEffect(() => { mounts.notes = (mounts.notes ?? 0) + 1; }, []);
  return <><input aria-label="App draft" /><iframe className="min-h-0 flex-1" title="App frame" srcDoc={'<!doctype html><input aria-label="Frame draft"><script>window.identity = Math.random()</script>'} /></>;
}
const tools: readonly WorkspaceTabContribution[] = ["Files", "Journal"].map((label) => ({
  id: label.toLowerCase(), label, order: 0, Icon: () => <svg aria-hidden />,
  Panel: function Tool({ active, navigation }) {
    return <><input aria-label={`${label} draft`} /><p>{active ? `${label} active` : `${label} inactive`}</p><button onClick={() => navigation.openTab("files")}>Open Files</button></>;
  },
}));
function Run({ run, appIds }: { run: string; appIds: readonly string[] }) {
  const { state, update } = useDockStorage(run);
  const [actions, setActions] = useState<HTMLDivElement | null>(null);
  const session = { session: { id: run, title: run, updatedAt: 0, canShare: true as const }, connected: true, runView: {}, messages: [], pluginEvents: [], running: false, send: async () => {}, start: async () => {} };
  const apps: readonly RunApp[] = appIds.map((id) => ({ runId: run, definition: { id, title: id[0].toUpperCase() + id.slice(1) }, Element: App }));
  const navigation = { activeTabId: activeDockTool(state), openTab: (id: string) => update((current) => selectDockPanel(current, toolPanelId(id))), revealEntity: () => false, selectionFor: () => undefined };
  const workspace = <DockToolsContext.Provider value={{ tabs: tools, pendingTabIds: [], actionsContainer: withHeader ? actions : undefined }}><DockWorkspace apps={apps} chat={<textarea aria-label="Chat draft" className="h-full" />} navigation={navigation} session={session} /></DockToolsContext.Provider>;
  return withHeader ? <div className="flex min-w-0 flex-1 flex-col">
    <header className="flex h-header flex-none items-stretch border-b border-border bg-shell px-2">
      <RunPanelHeader actionsRef={setActions} attention={undefined} contributions={headers} navigation={navigation} registry={registry} runError={undefined} session={session} working={false} />
    </header>
    {workspace}
  </div> : workspace;
}
function Fixture() {
  const [run, setRun] = useState("first");
  const [appIds, setApps] = useState<readonly string[]>(["notes"]);
  window.dockingFixture = { mounts, setApps, setRun };
  return <Run appIds={appIds} key={run} run={run} />;
}
declare global {
  interface Window {
    dockingFixture: { mounts: Record<string, number>; setApps: (ids: readonly string[]) => void; setRun: (id: string) => void };
  }
}
createRoot(document.getElementById("root")!).render(<Fixture />);
