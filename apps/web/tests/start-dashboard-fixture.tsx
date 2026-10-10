import { createRoot } from "react-dom/client";
import { PluginRegistry, type StartSectionContext, type StartSectionContribution, type StartWidgetContribution, type WebPlugin } from "../src/PluginRegistry";
import { PanelPage } from "../src/panel/PanelPage";
import type { ConnectionView, PanelState } from "../src/panel/contract";
import type { PreferenceStore } from "../src/preferences";
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

const widget = (id: string, order: number, title: string, span?: StartSectionContribution["span"], extra: Partial<StartSectionContribution> = {}): StartSectionContribution =>
  ({ id, order, title, ...(span ? { span } : {}), Section: list(`${title} entries`), ...extra });

const sections: StartSectionContribution[] = [
  { id: "demo.board", order: 10, title: "Work board", description: "Runs in three lanes by their state.", Section: WorkBoard },
  widget("demo.auto", 20, "New auto items", "narrow"),
  widget("demo.shared", 30, "Shared with the team", "narrow"),
  widget("demo.usage", 40, "Model usage", "narrow", { description: "Tokens and cost of the last runs.", sizes: ["narrow", "half"] }),
  { id: "demo.empty", order: 50, title: "Nothing to show", span: "narrow", Section: () => null },
  { id: "demo.legacy", order: 60, Section: () => <section aria-label="Legacy notes" className="grid gap-3"><h2 className="type-label">Legacy notes</h2><p className="type-body">A section without a title keeps its own heading.</p></section> },
  ...(query.get("widgets") === "many" ? [
    widget("demo.topics", 70, "Topics in review", "half"),
    widget("demo.releases", 80, "Upcoming releases", "half"),
    widget("demo.incidents", 90, "Open incidents this week", "narrow"),
  ] : []),
];

function BrokenApp(): never {
  throw new Error("The app view failed to load.");
}

const apps: Readonly<Record<string, StartWidgetContribution>> = {
  planner: { id: "demo.apps:planner", title: "Planner", description: "Plans the week from your runs.", span: "half", sizes: ["narrow", "half", "wide"], content: <ul aria-label="Planner entries" className="grid gap-2 rounded-xl border border-border bg-card p-3"><li className="type-body">Review on Monday</li></ul> },
  broken: { id: "demo.apps:broken", title: "Broken app", span: "narrow", content: <BrokenApp /> },
};

/** ?dynamic=1 adds two plugins that publish widgets per viewer: one whose widgets the test can change through setApps, one whose factory fails. */
const dynamic: WebPlugin[] = query.get("dynamic") === "1" ? [
  { id: "demo.apps", startWidgetsFor: ({ update }) => {
    fixture.setApps = (names) => update(names.map((name) => apps[name]!));
    return [apps.broken!, apps.planner!];
  } },
  { id: "demo.failing", startWidgetsFor: async () => { throw new Error("The app catalog is unreachable."); } },
] : [];

const registry = new PluginRegistry({
  brand: { title: "Start dashboard check" },
  product: { id: "demo", title: "Start dashboard check" },
  plugins: [{ id: "demo.widgets", startSections: sections }, ...dynamic],
  startEntries: [],
});

const state: PanelState = { theme: "dark", page: "start", connections: [connection], profileSuggestions: [] };

/** Stands in for the server's preference store and keeps the values across reloads; ?preferences=fail lets reading fail, failWrites saving. */
const stored = (key: string) => `start-dashboard-fixture:${key}`;
const fixture = { writes: [] as unknown[], failWrites: false, setApps: undefined as ((names: readonly string[]) => void) | undefined };
declare global { interface Window { dashboardFixture: typeof fixture } }
window.dashboardFixture = fixture;
const preferences: PreferenceStore = {
  read: async (key) => {
    if (query.get("preferences") === "fail") throw new Error("The server is unreachable.");
    const raw = localStorage.getItem(stored(key));
    return raw === null ? null : JSON.parse(raw);
  },
  write: async (key, value) => {
    if (fixture.failWrites) throw new Error("The disk is full.");
    fixture.writes.push(value);
    if (value === null) localStorage.removeItem(stored(key));
    else localStorage.setItem(stored(key), JSON.stringify(value));
  },
};

createRoot(document.getElementById("root")!).render(<div className="flex h-full min-h-0 flex-col bg-app">
  <header className="flex h-12 flex-none items-center border-b border-border p-3">Start dashboard check</header>
  <div className="min-h-0 min-w-0 flex-1"><PanelPage preferences={preferences} registry={registry} send={() => {}} state={state} /></div>
</div>);
