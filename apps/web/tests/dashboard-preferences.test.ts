import assert from "node:assert/strict";
import test from "node:test";
import { START_WIDGET_SPANS, type StartWidgetSpan } from "../src/PluginRegistry";
import { dashboardLayout } from "../src/panel/dashboard-layout";
import {
  addWidget, arrangeWidgets, DEFAULT_DASHBOARD_PREFERENCES, draftOf, isDefaultLayout, moveWidget, preferencesOf, readDashboardLayout, removeWidget,
  resizeWidget, writeDashboardLayout, type ArrangeableItem, type DashboardPreferences,
} from "../src/panel/dashboard-preferences";

const widget = (key: string, span: StartWidgetSpan, framed = true, sizes: readonly StartWidgetSpan[] = START_WIDGET_SPANS): ArrangeableItem => ({ key, span, framed, sizes });
const start = [
  widget("start.new", "narrow"), widget("start.continue", "wide"), widget("demo.board", "full"), widget("demo.notes", "full", false), widget("demo.usage", "narrow", true, ["narrow", "half"]),
];
const preferences = (overrides: Partial<DashboardPreferences>): DashboardPreferences => ({ ...DEFAULT_DASHBOARD_PREFERENCES, ...overrides });
const keys = (items: readonly { key: string }[]) => items.map((item) => item.key);
const columns = (items: readonly ArrangeableItem[], width: number) => {
  const layout = dashboardLayout(items, width);
  assert.equal(layout.mode, "grid");
  return layout.mode === "grid" ? items.map((item) => layout.columns.get(item.key)) : [];
};
const shownWith = (prefs: DashboardPreferences) => arrangeWidgets(start, prefs).shown;
const initial = draftOf(arrangeWidgets(start, DEFAULT_DASHBOARD_PREFERENCES).shown);

test("without preferences Start keeps its widgets, order, and spans, and a draft starts from the framed ones", () => {
  const arranged = arrangeWidgets(start, DEFAULT_DASHBOARD_PREFERENCES);
  assert.deepEqual(arranged.shown, start);
  assert.deepEqual(arranged.removed, []);
  assert.deepEqual(initial, [
    { key: "start.new", span: "narrow" }, { key: "start.continue", span: "wide" }, { key: "demo.board", span: "full" }, { key: "demo.usage", span: "narrow" },
  ], "a section without a title is not part of the draft");
  assert.deepEqual(preferencesOf(initial, start, DEFAULT_DASHBOARD_PREFERENCES), DEFAULT_DASHBOARD_PREFERENCES, "an unchanged draft stores nothing");
});

test("moving a widget in the draft changes the order; the default order again stores none", () => {
  const moved = moveWidget(initial, "demo.usage", 0);
  assert.deepEqual(keys(moved), ["demo.usage", "start.new", "start.continue", "demo.board"]);
  const stored = preferencesOf(moved, start, DEFAULT_DASHBOARD_PREFERENCES);
  assert.deepEqual(stored.order, ["demo.usage", "start.new", "start.continue", "demo.board"]);
  assert.deepEqual(keys(shownWith(stored)), ["demo.usage", "start.new", "start.continue", "demo.notes", "demo.board"], "a section without a title keeps its slot");
  assert.deepEqual(keys(moveWidget(initial, "start.new", 3)), ["start.continue", "demo.board", "demo.usage", "start.new"], "the place counts after taking the widget out");
  assert.deepEqual(preferencesOf(moveWidget(moved, "demo.usage", 3), start, DEFAULT_DASHBOARD_PREFERENCES).order, []);
  assert.throws(() => moveWidget(initial, "start.new", 4), /cannot move start.new to place 4 of 4/);
  assert.throws(() => moveWidget(initial, "gone.widget", 0), /no widget gone.widget on the dashboard/);
});

test("resizing offers only the sizes of the widget, and its default size stores nothing", () => {
  const narrow = resizeWidget(initial, "start.continue", "narrow", START_WIDGET_SPANS);
  const stored = preferencesOf(narrow, start, DEFAULT_DASHBOARD_PREFERENCES);
  assert.deepEqual([...stored.spans], [["start.continue", "narrow"]]);
  assert.equal(shownWith(stored).find((item) => item.key === "start.continue")!.span, "narrow");
  assert.deepEqual(columns(shownWith(stored).slice(0, 2), 1280), [6, 6], "a narrow Continue shares the row with New evenly");
  assert.throws(() => resizeWidget(initial, "demo.usage", "full", ["narrow", "half"]), /demo.usage offers no size full/);
  assert.throws(() => preferencesOf([...initial.slice(0, 3), { key: "demo.usage", span: "wide" }], start, DEFAULT_DASHBOARD_PREFERENCES), /demo.usage offers no size wide/);
  assert.deepEqual(preferencesOf(resizeWidget(narrow, "start.continue", "wide", START_WIDGET_SPANS), start, DEFAULT_DASHBOARD_PREFERENCES), DEFAULT_DASHBOARD_PREFERENCES);
  assert.equal(arrangeWidgets(start, preferences({ spans: new Map([["demo.usage", "full"]]) })).shown.at(-1)!.span, "narrow", "a stored size the widget does not offer is ignored");
});

test("removing takes a widget off the dashboard into the gallery, and adding brings it back at the end in its default size", () => {
  const resized = resizeWidget(initial, "demo.board", "half", START_WIDGET_SPANS);
  const removed = removeWidget(resized, "demo.board");
  const stored = preferencesOf(removed, start, DEFAULT_DASHBOARD_PREFERENCES);
  assert.deepEqual(stored.removed, ["demo.board"]);
  assert.equal(stored.spans.size, 0, "a removed widget keeps no size");
  const arranged = arrangeWidgets(start, stored);
  assert.deepEqual(keys(arranged.shown), ["start.new", "start.continue", "demo.notes", "demo.usage"]);
  assert.deepEqual(keys(arranged.removed), ["demo.board"]);
  const added = addWidget(removed, arranged.removed[0]!);
  assert.deepEqual(added.at(-1), { key: "demo.board", span: "full" });
  const back = preferencesOf(added, start, DEFAULT_DASHBOARD_PREFERENCES);
  assert.deepEqual(back.removed, []);
  assert.deepEqual(keys(shownWith(back)), ["start.new", "start.continue", "demo.usage", "demo.notes", "demo.board"], "it is the last framed widget, the section without a title keeps its slot");
  assert.throws(() => addWidget(added, start[0]!), /start.new is already on the dashboard/);
  assert.throws(() => removeWidget(removed, "demo.board"), /no widget demo.board on the dashboard/);
  assert.throws(() => preferencesOf([...initial, { key: "demo.notes", span: "full" }], start, DEFAULT_DASHBOARD_PREFERENCES), /no widget demo.notes to place/);
});

test("cancel keeps the stored preferences: a draft changes nothing until it is turned into preferences", () => {
  const stored = preferences({ order: ["start.continue", "start.new"], spans: new Map([["start.continue", "half"]]), removed: ["demo.usage"] });
  const draft = draftOf(shownWith(stored));
  const edited = removeWidget(moveWidget(resizeWidget(draft, "start.continue", "narrow", START_WIDGET_SPANS), "demo.board", 0), "start.new");
  assert.notDeepEqual(preferencesOf(edited, start, stored), stored);
  assert.deepEqual(stored, preferences({ order: ["start.continue", "start.new"], spans: new Map([["start.continue", "half"]]), removed: ["demo.usage"] }));
  const unchanged = preferencesOf(draft, start, stored);
  assert.deepEqual(arrangeWidgets(start, unchanged), arrangeWidgets(start, stored), "the unchanged draft shows what is stored");
  assert.deepEqual([unchanged.spans, unchanged.removed], [stored.spans, stored.removed]);
});

test("widgets that are not there keep their removal and size, while their place falls back to the default", () => {
  const stored = preferences({ order: ["ragents.global-apps:planner", "start.continue", "start.new"], spans: new Map([["ragents.global-apps:planner", "half"]]), removed: ["ragents.global-apps:notes"] });
  const arranged = arrangeWidgets(start, stored);
  assert.deepEqual(keys(arranged.shown), ["start.continue", "start.new", "demo.board", "demo.notes", "demo.usage"], "IDs of widgets that are not there are ignored");
  const saved = preferencesOf(draftOf(arranged.shown), start, stored);
  assert.deepEqual(saved.order, ["start.continue", "start.new", "demo.board", "demo.usage"]);
  assert.deepEqual([...saved.spans], [["ragents.global-apps:planner", "half"]]);
  assert.deepEqual(saved.removed, ["ragents.global-apps:notes"]);
  const later = [...start, widget("ragents.global-apps:planner", "narrow"), widget("ragents.global-apps:notes", "narrow")];
  const back = arrangeWidgets(later, saved);
  assert.deepEqual(keys(back.shown).at(-1), "ragents.global-apps:planner", "a widget that comes back appears at its default place");
  assert.equal(back.shown.at(-1)!.span, "half");
  assert.deepEqual(keys(back.removed), ["ragents.global-apps:notes"]);
});

test("edit mode keeps preferences, so a widget that disappears leaves the draft and one that arrives takes its stored place and size or stays removed", () => {
  const planner = widget("ragents.global-apps:planner", "half");
  const notes = widget("ragents.global-apps:notes", "narrow");
  const stored = preferences({ order: ["ragents.global-apps:planner", "start.new"], spans: new Map([["ragents.global-apps:planner", "full"]]), removed: ["ragents.global-apps:notes"] });
  const draftWith = (items: readonly ArrangeableItem[], prefs: DashboardPreferences) => draftOf(arrangeWidgets(items, prefs).shown);
  assert.deepEqual(keys(draftWith(start, stored)), ["start.new", "start.continue", "demo.board", "demo.usage"], "before the dynamic widgets arrive");
  const later = [...start, planner, notes];
  assert.deepEqual(draftWith(later, stored), [
    { key: "ragents.global-apps:planner", span: "full" }, { key: "start.continue", span: "wide" }, { key: "demo.board", span: "full" }, { key: "demo.usage", span: "narrow" }, { key: "start.new", span: "narrow" },
  ], "an arriving widget takes its stored place and size, and a removed one stays removed");
  const edited = preferencesOf(removeWidget(draftWith(later, stored), "demo.board"), later, stored);
  assert.deepEqual(keys(draftWith(start, edited)), ["start.continue", "demo.usage", "start.new"], "a widget that disappears leaves the draft");
  const moved = preferencesOf(moveWidget(draftWith(start, edited), "start.new", 0), start, edited);
  assert.deepEqual([...moved.spans], [["ragents.global-apps:planner", "full"]], "an absent widget keeps its size through changes made without it");
  assert.deepEqual(moved.removed, ["ragents.global-apps:notes", "demo.board"]);
  assert.deepEqual(keys(draftWith(later, moved)), ["start.new", "start.continue", "demo.usage", "ragents.global-apps:planner"], "and returns at its default place, not removed");
  const shrunk = start.map((item) => item.key === "start.continue" ? { ...item, sizes: ["narrow", "half"] as const } : item);
  assert.equal(draftWith(shrunk, preferences({ spans: new Map([["start.continue", "full"]]) }))[1]!.span, "wide", "a size the widget no longer offers falls back to its default");
});

test("two widgets with the same ID are an error", () => {
  assert.throws(() => arrangeWidgets([widget("start.new", "narrow"), widget("start.new", "full")], DEFAULT_DASHBOARD_PREFERENCES), /Start has two widgets with the ID start.new/);
});

test("the stored layout round-trips as the JSON value of start.layout, the default stores nothing, and an unreadable one names its cause", () => {
  const changed = preferences({ order: ["start.continue", "start.new"], spans: new Map([["start.continue", "narrow"]]), removed: ["demo.board"] });
  assert.deepEqual(writeDashboardLayout(changed), { version: 1, order: ["start.continue", "start.new"], spans: { "start.continue": "narrow" }, removed: ["demo.board"] });
  assert.deepEqual(readDashboardLayout(writeDashboardLayout(changed)), { preferences: changed });
  assert.equal(writeDashboardLayout(DEFAULT_DASHBOARD_PREFERENCES), null);
  assert.deepEqual(readDashboardLayout(null), { preferences: DEFAULT_DASHBOARD_PREFERENCES });
  assert.equal(isDefaultLayout(changed), false);
  const problem = (value: Parameters<typeof readDashboardLayout>[0]) => {
    const read = readDashboardLayout(value);
    assert.deepEqual(read.preferences, DEFAULT_DASHBOARD_PREFERENCES);
    return read.problem;
  };
  assert.match(problem([])!, /^The saved Start layout could not be read: expected an object\.$/);
  assert.match(problem({ version: 2, order: [], spans: {}, removed: [] })!, /expected version 1, found 2/);
  assert.match(problem({ version: 1, order: [], spans: {}, hidden: [] })!, /expected the fields order, removed, spans, version, found hidden, order, spans, version/);
  assert.match(problem({ version: 1, order: ["a", "a"], spans: {}, removed: [] })!, /order and removed must list distinct widget IDs/);
  assert.match(problem({ version: 1, order: [], spans: { a: "third" }, removed: [] })!, /spans must map widget IDs to narrow, half, wide, full/);
});

test("the layout applies the chosen spans and order with the same responsive rules", () => {
  const narrowContinue = shownWith(preferences({ spans: new Map([["start.continue", "narrow"]]) }));
  assert.deepEqual(columns(narrowContinue, 900), [6, 6, 12, 12, 12], "medium widths still halve the spans and stack full ones");
  const reordered = shownWith(preferencesOf(moveWidget(initial, "start.continue", 0), start, DEFAULT_DASHBOARD_PREFERENCES));
  assert.deepEqual(columns(reordered, 1280).slice(0, 2), [8, 4]);
  const without = shownWith(preferences({ removed: ["start.new"] }));
  assert.deepEqual(dashboardLayout(without, 560), { mode: "tabs" });
  assert.deepEqual(columns(shownWith(preferences({ removed: ["start.new", "demo.board", "demo.usage"] })), 560), [12, 12], "a single framed widget left fills the width instead of tabs");
});
