import { useState } from "react";
import { createRoot } from "react-dom/client";
import { PluginRegistry, type StartWidgetContext } from "../src/PluginRegistry";
import { PanelPage } from "../src/panel/PanelPage";
import type { ConnectionView, PanelState } from "../src/panel/contract";
import { DataGrid, type DataGridColumn } from "../src/ui/data-grid";
import { Button } from "../src/ui/button";
import { initializeAppearance } from "../src/appearance";
import { appearanceChoices } from "../src/appearance-options";
import { initializeTheme } from "../src/theme";
import "../src/ui/tailwind.css";

interface WorkItem {
  id: string;
  title: string;
  status: string;
}

type Layout = "list" | "lanes";
const query = new URLSearchParams(location.search);
const density = query.get("density");
if (density) localStorage.setItem(appearanceChoices.density.storageKey, density);
initializeTheme(window);
initializeAppearance(window);
const statuses = ["Ready", "In progress", "Complete"];
const columns: readonly DataGridColumn<WorkItem>[] = [
  { id: "title", label: "Title", value: (row) => row.title, width: 480, minWidth: 100, sortable: true, flex: true },
  { id: "status", label: "Status", value: (row) => row.status, width: 160, minWidth: 80, sortable: true },
];
const runs: ConnectionView["runs"] = Array.from({ length: 15 }, (_, index) => ({
  id: `run-${index + 1}`,
  title: `Run ${String(index + 1).padStart(2, "0")}`,
  state: "idle",
  updatedAt: 1_800_000_000_000 - index * 1000,
  pendingActions: 0,
}));
const connection: ConnectionView = {
  name: "demo",
  kind: "server",
  address: "http://localhost:3000",
  route: { kind: "server", host: "localhost", localHost: true },
  state: { kind: "connected" },
  runs,
  entries: Array.from({ length: 9 }, (_, index) => ({
    id: `demo.template-${index + 1}`,
    title: `Template ${index + 1}`,
    description: "Create a neutral demonstration workspace with a coordinator and a collection board.",
    kind: "script",
    category: "Demos",
  })),
  canCreate: true,
};

declare global {
  interface Window {
    startScrollFixture: {
      setLayout: (layout: Layout) => void;
      setLoading: (loading: boolean) => void;
      setGrouping: (grouped: boolean) => void;
      setNotice: (notice: string | undefined) => void;
      renew: () => void;
    };
  }
}

function BoardSection({ runs }: StartWidgetContext) {
  const [layout, setLayout] = useState<Layout>(query.get("layout") === "list" ? "list" : "lanes");
  const [loading, setLoading] = useState(false);
  const [grouped, setGrouping] = useState(false);
  window.startScrollFixture = { ...window.startScrollFixture, setLayout, setLoading, setGrouping };
  const items = runs.map((run, index) => ({ id: run.id, title: run.title, status: statuses[index % statuses.length]! }));
  return <section aria-label="Work board" className="grid min-h-[1200px] content-start gap-3">
    <div role="toolbar" aria-label="Board view" className="flex items-center gap-2">
      <h2 className="type-title mr-auto">Work board</h2>
      <Button aria-pressed={layout === "list"} onClick={() => setLayout("list")} variant="outline">List</Button>
      <Button aria-pressed={layout === "lanes"} onClick={() => setLayout("lanes")} variant="outline">Lanes</Button>
      <Button aria-pressed={grouped} onClick={() => setGrouping((current) => !current)} variant="outline">Group by status</Button>
    </div>
    {loading
      ? <p className="type-body min-h-20" role="status">Loading work items ...</p>
      : layout === "list"
        ? <DataGrid id="start-scroll-work-items" aria-label="Work items" columns={columns} rows={items} rowKey={(row) => row.id}
          grouping={grouped ? ["status"] : undefined} />
        : <div role="group" aria-label="Work lanes" className="grid grid-cols-3 gap-3">
          {statuses.map((status) => <section aria-label={status} className="grid content-start gap-3" key={status}>
            <h3 className="type-label">{status}</h3>
            {items.filter((item) => item.status === status).map((item) => <article className="min-h-24 rounded-lg border border-border p-3" key={item.id}>
              <h4 className="type-body">{item.title}</h4>
              <p className="type-meta text-muted-foreground">A neutral task for the demonstration workspace.</p>
            </article>)}
          </section>)}
        </div>}
  </section>;
}

const registry = new PluginRegistry({
  brand: { title: "Start scroll check" },
  product: { id: "demo", title: "Start scroll check" },
  plugins: [{ id: "demo.board", startWidgets: [{ id: "demo.work-board", order: 0, render: (props) => <BoardSection {...props} /> }] }],
  startEntries: [],
});

function Fixture() {
  const [state, setState] = useState<PanelState>({ theme: "dark", page: "start", connections: [connection], profileSuggestions: [] });
  const [notice, setNotice] = useState<string>();
  window.startScrollFixture = { ...window.startScrollFixture, setNotice, renew: () => setState((current) => ({ ...current })) };
  if (query.get("mode") === "window") return <main className="min-h-screen bg-app p-3">
    <section aria-label="Overview" className="h-[900px]"><h1 className="type-title">Workspace overview</h1><p className="type-body">Review the work board below.</p></section>
    <BoardSection runs={runs} onOpenRun={() => {}} />
  </main>;
  return <div className="flex h-full min-h-0 flex-col bg-app">
    <header className="flex h-12 flex-none items-center border-b border-border p-3">Start scroll check</header>
    <div aria-label="Start viewport" className="min-h-0 min-w-0 flex-1 overflow-auto">
      {notice && <p className="type-body min-h-12 p-3" role="status">{notice}</p>}
      <PanelPage preferences={{ read: async () => null, write: async () => {} }} registry={registry} send={() => {}} state={state} />
    </div>
    <footer className="h-6 flex-none border-t border-border" aria-label="Run status bar" />
  </div>;
}

createRoot(document.getElementById("root")!).render(<Fixture />);
