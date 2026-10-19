import { StrictMode, useContext, useState, useSyncExternalStore } from "react";
import { createRoot } from "react-dom/client";
import { AccessContext } from "../src/AccessContext";
import { PluginRegistry, type StartWidget, type StartWidgetProps, type StartWidgetSettings, type WebPlugin } from "../src/PluginRegistry";
import { PanelPage } from "../src/panel/PanelPage";
import { StartPage } from "../src/panel/StartPage";
import { RunHeader } from "../src/run-panel/RunHeader";
import type { ConnectionView, PanelState } from "../src/panel/contract";
import type { PreferenceStore } from "../src/preferences";
import { initializeAppearance } from "../src/appearance";
import { initializeTheme } from "../src/theme";
import { DataGrid, type DataGridColumn } from "../src/ui/data-grid";
import "../src/ui/tailwind.css";

const query = new URLSearchParams(location.search);
const virtual = query.get("case") === "virtual";
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
  canCreate: !virtual,
};

/** How many runs each lane of the work board lists; grow() adds more, like a list that finishes loading. */
const lanes = { rows: 2, listeners: new Set<() => void>() };
const optionalEntries = { shown: false, listeners: new Set<() => void>() };
const virtualRows = { count: 100, listeners: new Set<() => void>() };
const entries = Array.from({ length: 200 }, (_, index) => ({ id: String(index), name: `Entry ${index}`, notes: "Review pending" }));
const entryColumns: readonly DataGridColumn<(typeof entries)[number]>[] = [
  { id: "name", label: "Name", value: (row) => row.name, width: 140, minWidth: 90 },
  { id: "notes", label: "Notes", value: (row) => row.notes, width: 260, minWidth: 100, flex: true, wrap: true },
];

function VirtualEntries() {
  const count = useSyncExternalStore((listener) => {
    virtualRows.listeners.add(listener);
    return () => virtualRows.listeners.delete(listener);
  }, () => virtualRows.count);
  return <DataGrid aria-label="Virtual entries" columns={entryColumns} id="start-virtual-entries" rowKey={(row) => row.id} rows={entries.slice(0, count)} />;
}

function OptionalEntries() {
  const shown = useSyncExternalStore((listener) => {
    optionalEntries.listeners.add(listener);
    return () => optionalEntries.listeners.delete(listener);
  }, () => optionalEntries.shown);
  return shown ? <EntryList label="Optional entries" /> : null;
}

function WorkBoard({ runs }: StartWidgetProps) {
  const rows = useSyncExternalStore((listener) => {
    lanes.listeners.add(listener);
    return () => lanes.listeners.delete(listener);
  }, () => lanes.rows);
  return <div aria-label="Work lanes" className="grid grid-cols-1 gap-3 @lg/widget:grid-cols-3" role="group">
    {["Ready", "Active", "Done"].map((lane, index) => <section aria-label={lane} className="grid content-start gap-2 rounded-xl border border-border bg-card p-3" key={lane}>
      <h3 className="type-label">{lane}</h3>
      {runs.slice(index * rows, index * rows + rows).map((run) => <p className="type-body truncate" key={run.id}>{run.title}</p>)}
    </section>)}
  </div>;
}

function TopicCards() {
  return <ul aria-label="Topics entries" className="grid grid-cols-2 gap-3">
    {Array.from({ length: 10 }, (_, index) => <li className="grid gap-1 rounded-xl border border-border bg-card p-3" key={index}>
      <span className="type-item">Topic {index + 1}</span>
      <span className="type-body text-muted-foreground">Open questions and the runs that answer them.</span>
    </li>)}
  </ul>;
}

function EntryList({ label }: { label: string }) {
  return <ul aria-label={label} className="grid gap-2 rounded-xl border border-border bg-card p-3">
    {["First entry", "Second entry", "Third entry"].map((entry) => <li className="type-body" key={entry}>{entry}</li>)}
  </ul>;
}

const widget = (id: string, order: number, title: string, columns?: number, extra: Partial<StartWidget> = {}): StartWidget =>
  ({ id, order, title, ...(columns ? { columns } : {}), render: () => <EntryList label={`${title} entries`} />, ...extra });

/** A plugin widget with a setting, configured through the same edit mode as Continue. */
const usageSettings = {
  entries: { type: "number", label: "Entries", description: "How many entries Model usage lists.", default: 3, min: 1, max: 3 },
} as const satisfies StartWidgetSettings;

function UsageList({ settings }: StartWidgetProps<typeof usageSettings>) {
  return <ul aria-label="Model usage entries" className="grid gap-2 rounded-xl border border-border bg-card p-3">
    {["First entry", "Second entry", "Third entry"].slice(0, settings.entries).map((entry) => <li className="type-body" key={entry}>{entry}</li>)}
  </ul>;
}

/** ?case=owner is the wide screen with New and Topics three columns wide and Continue after them; Topics is much taller than New. */
const owner = query.get("case") === "owner";

const holes = query.get("case") === "holes";

/** ?case=twins lists one widget and publishes its twin through a factory, with the same fields apart from ID and title. */
const twins = query.get("case") === "twins";

const twinSettings = { rows: { type: "number", label: "Rows", default: 1, min: 1, max: 3 } } as const satisfies StartWidgetSettings;

function TwinRows({ title, rows }: { title: string; rows: number }) {
  return <ul aria-label={`${title} rows`} className="grid gap-2 rounded-xl border border-border bg-card p-3">
    {["First row", "Second row", "Third row"].slice(0, rows).map((row) => <li className="type-body" key={row}>{row}</li>)}
  </ul>;
}

const twin = (id: string, title: string): StartWidget => ({
  id, title, description: "Shows as many rows as its setting says.", columns: 2, minColumns: 1, maxColumns: 3, order: 70, settings: twinSettings,
  render: ({ settings }: StartWidgetProps<typeof twinSettings>) => <TwinRows rows={settings.rows} title={title} />,
});

const listed: StartWidget[] = owner ? [
  { id: "demo.topics", order: 10, title: "Topics", columns: 3, minColumns: 2, render: () => <TopicCards /> },
] : holes ? [{ id: "demo.topics", order: 10, title: "Topics", columns: 3, render: () => null }] : twins ? [twin("demo.twin", "Listed twin")] : virtual ? [
  widget("demo.topics", 10, "Topics", 3),
  widget("demo.shared", 20, "Shared with the team", 6, { readRight: "runs.inspect", render: () => <VirtualEntries /> }),
] : [
  { id: "demo.board", order: 10, title: "Work board", description: "Runs in three lanes by their state.", render: (props) => <WorkBoard {...props} /> },
  widget("demo.auto", 20, "New auto items", 2),
  widget("demo.shared", 30, "Shared with the team", 2, { readRight: "runs.inspect" }),
  widget("demo.usage", 40, "Model usage", 2, { description: "Tokens and cost of the last runs.", minColumns: 1, maxColumns: 3, settings: usageSettings, render: (props) => <UsageList {...props} /> }),
  { id: "demo.empty", order: 50, title: "Nothing to show", columns: 2, render: () => <OptionalEntries /> },
  { id: "demo.legacy", order: 60, render: () => <section aria-label="Legacy notes" className="grid gap-3"><h2 className="type-label">Legacy notes</h2><p className="type-body">A widget without a title keeps its own heading.</p></section> },
  ...(query.get("widgets") === "many" ? [
    widget("demo.topics", 70, "Topics in review", 3),
    widget("demo.releases", 80, "Upcoming releases", 3),
    widget("demo.incidents", 90, "Open incidents this week", 2),
  ] : []),
];

function BrokenApp(): never {
  throw new Error("The app view failed to load.");
}

const plannerSettings = { days: { type: "number", label: "Days", default: 1, min: 1, max: 5 } } as const satisfies StartWidgetSettings;

function PlannerDays({ days }: { days: number }) {
  return <ul aria-label="Planner entries" className="grid gap-2 rounded-xl border border-border bg-card p-3">
    {["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"].slice(0, days).map((day) => <li className="type-body" key={day}>Review on {day}</li>)}
  </ul>;
}

const apps: Readonly<Record<string, StartWidget>> = {
  planner: {
    id: "demo.apps:planner", title: "Planner", description: "Plans the week from your runs.", columns: 3, minColumns: 2, maxColumns: 4, order: 200, settings: plannerSettings,
    render: ({ settings }: StartWidgetProps<typeof plannerSettings>) => <PlannerDays days={settings.days} />,
  },
  broken: { id: "demo.apps:broken", title: "Broken app", columns: 2, order: 200, render: () => <BrokenApp /> },
};

/** ?dynamic=1 adds two plugins that publish widgets per viewer: one whose widgets the test can change through setApps, one whose factory fails. */
const dynamic: WebPlugin[] = query.get("dynamic") === "1" ? [
  { id: "demo.apps", startWidgets: ({ update }) => {
    fixture.setApps = (names) => update(names.map((name) => apps[name]!));
    return [apps.broken!, apps.planner!];
  } },
  { id: "demo.failing", startWidgets: async () => { throw new Error("The app catalog is unreachable."); } },
] : holes ? [{ id: "demo.apps", startWidgets: async () => [{ ...apps.planner!, columns: 4 }] }]
  : twins ? [{ id: "demo.twins", startWidgets: async () => [twin("demo.twins:twin", "Published twin")] }] : [];

const registry = new PluginRegistry({
  brand: { title: "Start dashboard check" },
  product: { id: "demo", title: "Start dashboard check" },
  plugins: [{ id: "demo.widgets", startWidgets: listed }, ...dynamic],
  startEntries: [],
});

const state: PanelState = { theme: "dark", page: "start", connections: [connection], profileSuggestions: [] };

/** Stands in for the server's preference store and keeps the values across reloads; ?preferences=fail lets reading fail, failWrites saving. */
const stored = (key: string) => `start-dashboard-fixture:${key}`;
const fixture = {
  writes: [] as unknown[],
  failWrites: false,
  setApps: undefined as ((names: readonly string[]) => void) | undefined,
  setSharedAccess: undefined as ((allowed: boolean) => void) | undefined,
  setEmptyShown: (shown: boolean) => {
    optionalEntries.shown = shown;
    for (const listener of optionalEntries.listeners) listener();
  },
  setGridCount: (count: number) => {
    virtualRows.count = count;
    for (const listener of virtualRows.listeners) listener();
  },
  grow: () => {
    lanes.rows += 4;
    for (const listener of lanes.listeners) listener();
  },
};
declare global { interface Window { dashboardFixture: typeof fixture } }
window.dashboardFixture = fixture;
if (owner && localStorage.getItem(stored("start.layout")) === null) {
  localStorage.setItem(stored("start.layout"), JSON.stringify({ version: 3, order: ["start.new", "demo.topics", "start.continue"], columns: { "start.new": 3, "start.continue": 3 }, removed: [], settings: {} }));
}
if (holes && localStorage.getItem(stored("start.layout")) === null) {
  localStorage.setItem(stored("start.layout"), JSON.stringify({ version: 3, order: ["start.continue", "demo.apps:planner", "demo.topics", "start.new"], columns: { "start.continue": 3, "demo.apps:planner": 4 }, removed: [], settings: {} }));
}
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

const send = () => {};

function DashboardFixture() {
  const access = useContext(AccessContext);
  const [sharedAccess, setSharedAccess] = useState(true);
  fixture.setSharedAccess = setSharedAccess;
  const Page = virtual ? StartPage : PanelPage;
  return <AccessContext.Provider value={{ ...access, can: (right) => (right !== "runs.inspect" || sharedAccess) && access.can(right) }}>
    <div className="flex h-full min-h-0 flex-col bg-app">
      <RunHeader leading="Start dashboard check">
        <div className="min-h-0 min-w-0 flex-1"><Page preferences={query.get("preferences") === "none" ? undefined : preferences} registry={registry} send={send} state={state} /></div>
      </RunHeader>
    </div>
  </AccessContext.Provider>;
}

createRoot(document.getElementById("root")!).render(<StrictMode><DashboardFixture /></StrictMode>);
