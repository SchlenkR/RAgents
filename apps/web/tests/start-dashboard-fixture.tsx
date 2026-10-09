import { createRoot } from "react-dom/client";
import { PluginRegistry, type StartSectionContext, type StartSectionContribution } from "../src/PluginRegistry";
import { PanelPage } from "../src/panel/PanelPage";
import type { ConnectionView, PanelState } from "../src/panel/contract";
import { initializeAppearance } from "../src/appearance";
import { initializeTheme } from "../src/theme";
import "../src/ui/tailwind.css";

const query = new URLSearchParams(location.search);
initializeTheme(window);
initializeAppearance(window);

const runs: ConnectionView["runs"] = Array.from({ length: 18 }, (_, index) => ({
  id: `run-${index + 1}`,
  title: `Review the quarterly checklist ${String(index + 1).padStart(2, "0")}`,
  state: index === 0 ? "running" : "idle",
  updatedAt: 1_800_000_000_000 - index * 60_000,
  pendingActions: 0,
  owner: "alice",
  details: [{ label: "Workspace", text: "/home/user/project", icon: "folder" }],
}));

const connection: ConnectionView = {
  name: "demo",
  kind: "server",
  address: "http://localhost:3000",
  route: { kind: "server", host: "localhost", localHost: true },
  state: { kind: "connected" },
  runs,
  entries: Array.from({ length: 4 }, (_, index) => ({
    id: `demo.template-${index + 1}`,
    title: `Template ${index + 1}`,
    description: "Create a neutral demonstration workspace with a coordinator and a collection board.",
    kind: "script",
    category: "Demos",
  })),
  canCreate: true,
};

function WorkBoard({ runs }: StartSectionContext) {
  return <div aria-label="Work lanes" className="grid grid-cols-1 gap-3 @lg/widget:grid-cols-3" role="group">
    {["Ready", "Active", "Done"].map((lane, index) => <section aria-label={lane} className="grid content-start gap-2 rounded-xl border border-border bg-card p-3" key={lane}>
      <h3 className="type-label">{lane}</h3>
      {runs.slice(index * 2, index * 2 + 2).map((run) => <p className="type-body truncate" key={run.id}>{run.title}</p>)}
    </section>)}
  </div>;
}

const list = (label: string) => function List() {
  return <ul aria-label={label} className="grid gap-2 rounded-xl border border-border bg-card p-3">
    {["First entry", "Second entry", "Third entry"].map((entry) => <li className="type-body" key={entry}>{entry}</li>)}
  </ul>;
};

const widget = (id: string, order: number, title: string, span?: StartSectionContribution["span"]): StartSectionContribution =>
  ({ id, order, title, ...(span ? { span } : {}), Section: list(`${title} entries`) });

const sections: StartSectionContribution[] = [
  { id: "demo.board", order: 10, title: "Work board", Section: WorkBoard },
  widget("demo.auto", 20, "New auto items", "narrow"),
  widget("demo.shared", 30, "Shared with the team", "narrow"),
  widget("demo.usage", 40, "Model usage", "narrow"),
  { id: "demo.empty", order: 50, title: "Nothing to show", span: "narrow", Section: () => null },
  { id: "demo.legacy", order: 60, Section: () => <section aria-label="Legacy notes" className="grid gap-3"><h2 className="type-label">Legacy notes</h2><p className="type-body">A section without a title keeps its own heading.</p></section> },
  ...(query.get("widgets") === "many" ? [
    widget("demo.topics", 70, "Topics in review", "half"),
    widget("demo.releases", 80, "Upcoming releases", "half"),
    widget("demo.incidents", 90, "Open incidents this week", "narrow"),
  ] : []),
];

const registry = new PluginRegistry({
  brand: { title: "Start dashboard check" },
  product: { id: "demo", title: "Start dashboard check" },
  plugins: [{ id: "demo.widgets", startSections: sections }],
  startEntries: [],
});

const state: PanelState = { theme: "dark", page: "start", connections: [connection], profileSuggestions: [] };

createRoot(document.getElementById("root")!).render(<div className="flex h-full min-h-0 flex-col bg-app">
  <header className="flex h-12 flex-none items-center border-b border-border p-3">Start dashboard check</header>
  <div className="min-h-0 min-w-0 flex-1"><PanelPage registry={registry} send={() => {}} state={state} /></div>
</div>);
