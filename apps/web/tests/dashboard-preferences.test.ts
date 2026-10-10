import assert from "node:assert/strict";
import test from "node:test";
import { dashboardLayout } from "../src/panel/dashboard-layout";
import {
  addWidget, arrangeWidgets, DEFAULT_DASHBOARD_PREFERENCES, draftOf, isDefaultLayout, moveWidget, preferencesOf, readDashboardLayout, removeWidget,
  resizeWidget, writeDashboardLayout, type ArrangeableItem, type DashboardPreferences,
} from "../src/panel/dashboard-preferences";

const widget = (key: string, columns: number, framed = true, minColumns = 1, maxColumns = 6): ArrangeableItem => ({ key, columns, framed, minColumns, maxColumns });
const start = [
  widget("start.new", 2, true, 2), widget("start.continue", 4, true, 2), widget("demo.board", 6), widget("demo.notes", 6, false), widget("demo.usage", 2, true, 1, 3),
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

test("without preferences Start keeps its widgets, order, and widths, and a draft starts from the framed ones", () => {
  const arranged = arrangeWidgets(start, DEFAULT_DASHBOARD_PREFERENCES);
  assert.deepEqual(arranged.shown, start);
  assert.deepEqual(arranged.removed, []);
  assert.deepEqual(initial, [
    { key: "start.new", columns: 2 }, { key: "start.continue", columns: 4 }, { key: "demo.board", columns: 6 }, { key: "demo.usage", columns: 2 },
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

test("resizing offers only the widths within the widget's range, and its default width stores nothing", () => {
  const narrow = resizeWidget(initial, "start.continue", 2, start[1]!);
  const stored = preferencesOf(narrow, start, DEFAULT_DASHBOARD_PREFERENCES);
  assert.deepEqual([...stored.columns], [["start.continue", 2]]);
  assert.equal(shownWith(stored).find((item) => item.key === "start.continue")!.columns, 2);
  assert.deepEqual(columns(shownWith(stored).slice(0, 2), 1280), [2, 2], "a narrow Continue is exactly as wide as New");
  assert.throws(() => resizeWidget(initial, "demo.usage", 4, start[4]!), /demo.usage cannot be 4 columns wide/);
  assert.throws(() => resizeWidget(initial, "start.new", 1, start[0]!), /start.new cannot be 1 columns wide/, "minColumns bounds the width");
  assert.throws(() => resizeWidget(initial, "start.new", 2.5, start[0]!), /cannot be 2.5 columns wide/);
  assert.throws(() => preferencesOf([...initial.slice(0, 3), { key: "demo.usage", columns: 5 }], start, DEFAULT_DASHBOARD_PREFERENCES), /demo.usage cannot be 5 columns wide/);
  assert.deepEqual(preferencesOf(resizeWidget(narrow, "start.continue", 4, start[1]!), start, DEFAULT_DASHBOARD_PREFERENCES), DEFAULT_DASHBOARD_PREFERENCES);
  assert.equal(arrangeWidgets(start, preferences({ columns: new Map([["demo.usage", 6]]) })).shown.at(-1)!.columns, 2, "a stored width the widget does not offer is ignored");
});

test("removing takes a widget off the dashboard into the gallery, and adding brings it back at the end in its default width", () => {
  const resized = resizeWidget(initial, "demo.board", 3, start[2]!);
  const removed = removeWidget(resized, "demo.board");
  const stored = preferencesOf(removed, start, DEFAULT_DASHBOARD_PREFERENCES);
  assert.deepEqual(stored.removed, ["demo.board"]);
  assert.equal(stored.columns.size, 0, "a removed widget keeps no width");
  const arranged = arrangeWidgets(start, stored);
  assert.deepEqual(keys(arranged.shown), ["start.new", "start.continue", "demo.notes", "demo.usage"]);
  assert.deepEqual(keys(arranged.removed), ["demo.board"]);
  const added = addWidget(removed, arranged.removed[0]!);
  assert.deepEqual(added.at(-1), { key: "demo.board", columns: 6 });
  const back = preferencesOf(added, start, DEFAULT_DASHBOARD_PREFERENCES);
  assert.deepEqual(back.removed, []);
  assert.deepEqual(keys(shownWith(back)), ["start.new", "start.continue", "demo.usage", "demo.notes", "demo.board"], "it is the last framed widget, the section without a title keeps its slot");
  assert.throws(() => addWidget(added, start[0]!), /start.new is already on the dashboard/);
  assert.throws(() => removeWidget(removed, "demo.board"), /no widget demo.board on the dashboard/);
  assert.throws(() => preferencesOf([...initial, { key: "demo.notes", columns: 6 }], start, DEFAULT_DASHBOARD_PREFERENCES), /no widget demo.notes to place/);
});

test("cancel keeps the stored preferences: a draft changes nothing until it is turned into preferences", () => {
  const stored = preferences({ order: ["start.continue", "start.new"], columns: new Map([["start.continue", 3]]), removed: ["demo.usage"] });
  const draft = draftOf(shownWith(stored));
  const edited = removeWidget(moveWidget(resizeWidget(draft, "start.continue", 2, start[1]!), "demo.board", 0), "start.new");
  assert.notDeepEqual(preferencesOf(edited, start, stored), stored);
  assert.deepEqual(stored, preferences({ order: ["start.continue", "start.new"], columns: new Map([["start.continue", 3]]), removed: ["demo.usage"] }));
  const unchanged = preferencesOf(draft, start, stored);
  assert.deepEqual(arrangeWidgets(start, unchanged), arrangeWidgets(start, stored), "the unchanged draft shows what is stored");
  assert.deepEqual([unchanged.columns, unchanged.removed], [stored.columns, stored.removed]);
});

test("widgets that are not there keep their removal and width, while their place falls back to the default", () => {
  const stored = preferences({ order: ["ragents.global-apps:planner", "start.continue", "start.new"], columns: new Map([["ragents.global-apps:planner", 3]]), removed: ["ragents.global-apps:notes"] });
  const arranged = arrangeWidgets(start, stored);
  assert.deepEqual(keys(arranged.shown), ["start.continue", "start.new", "demo.board", "demo.notes", "demo.usage"], "IDs of widgets that are not there are ignored");
  const saved = preferencesOf(draftOf(arranged.shown), start, stored);
  assert.deepEqual(saved.order, ["start.continue", "start.new", "demo.board", "demo.usage"]);
  assert.deepEqual([...saved.columns], [["ragents.global-apps:planner", 3]]);
  assert.deepEqual(saved.removed, ["ragents.global-apps:notes"]);
  const later = [...start, widget("ragents.global-apps:planner", 2), widget("ragents.global-apps:notes", 2)];
  const back = arrangeWidgets(later, saved);
  assert.deepEqual(keys(back.shown).at(-1), "ragents.global-apps:planner", "a widget that comes back appears at its default place");
  assert.equal(back.shown.at(-1)!.columns, 3);
  assert.deepEqual(keys(back.removed), ["ragents.global-apps:notes"]);
});

test("edit mode keeps preferences, so a widget that disappears leaves the draft and one that arrives takes its stored place and width or stays removed", () => {
  const planner = widget("ragents.global-apps:planner", 3);
  const notes = widget("ragents.global-apps:notes", 2);
  const stored = preferences({ order: ["ragents.global-apps:planner", "start.new"], columns: new Map([["ragents.global-apps:planner", 6]]), removed: ["ragents.global-apps:notes"] });
  const draftWith = (items: readonly ArrangeableItem[], prefs: DashboardPreferences) => draftOf(arrangeWidgets(items, prefs).shown);
  assert.deepEqual(keys(draftWith(start, stored)), ["start.new", "start.continue", "demo.board", "demo.usage"], "before the dynamic widgets arrive");
  const later = [...start, planner, notes];
  assert.deepEqual(draftWith(later, stored), [
    { key: "ragents.global-apps:planner", columns: 6 }, { key: "start.continue", columns: 4 }, { key: "demo.board", columns: 6 }, { key: "demo.usage", columns: 2 }, { key: "start.new", columns: 2 },
  ], "an arriving widget takes its stored place and width, and a removed one stays removed");
  const edited = preferencesOf(removeWidget(draftWith(later, stored), "demo.board"), later, stored);
  assert.deepEqual(keys(draftWith(start, edited)), ["start.continue", "demo.usage", "start.new"], "a widget that disappears leaves the draft");
  const moved = preferencesOf(moveWidget(draftWith(start, edited), "start.new", 0), start, edited);
  assert.deepEqual([...moved.columns], [["ragents.global-apps:planner", 6]], "an absent widget keeps its width through changes made without it");
  assert.deepEqual(moved.removed, ["ragents.global-apps:notes", "demo.board"]);
  assert.deepEqual(keys(draftWith(later, moved)), ["start.new", "start.continue", "demo.usage", "ragents.global-apps:planner"], "and returns at its default place, not removed");
  const shrunk = start.map((item) => item.key === "start.continue" ? { ...item, maxColumns: 4 } : item);
  assert.equal(draftWith(shrunk, preferences({ columns: new Map([["start.continue", 6]]) }))[1]!.columns, 4, "a width the widget no longer offers falls back to its default");
});

test("two widgets with the same ID are an error", () => {
  assert.throws(() => arrangeWidgets([widget("start.new", 2), widget("start.new", 6)], DEFAULT_DASHBOARD_PREFERENCES), /Start has two widgets with the ID start.new/);
});

test("the stored layout round-trips as the JSON value of start.layout, the default stores nothing, the former format is ignored, and an unreadable one names its cause", () => {
  const changed = preferences({ order: ["start.continue", "start.new"], columns: new Map([["start.continue", 2]]), removed: ["demo.board"] });
  assert.deepEqual(writeDashboardLayout(changed), { version: 2, order: ["start.continue", "start.new"], columns: { "start.continue": 2 }, removed: ["demo.board"] });
  assert.deepEqual(readDashboardLayout(writeDashboardLayout(changed)), { preferences: changed });
  assert.equal(writeDashboardLayout(DEFAULT_DASHBOARD_PREFERENCES), null);
  assert.deepEqual(readDashboardLayout(null), { preferences: DEFAULT_DASHBOARD_PREFERENCES });
  assert.deepEqual(readDashboardLayout({ version: 1, order: ["start.continue"], spans: { "start.continue": "narrow" }, removed: ["demo.board"] }), { preferences: DEFAULT_DASHBOARD_PREFERENCES },
    "a layout with the former named sizes is ignored without a problem");
  assert.equal(isDefaultLayout(changed), false);
  const problem = (value: Parameters<typeof readDashboardLayout>[0]) => {
    const read = readDashboardLayout(value);
    assert.deepEqual(read.preferences, DEFAULT_DASHBOARD_PREFERENCES);
    return read.problem;
  };
  assert.match(problem([])!, /^The saved Start layout could not be read: expected an object\.$/);
  assert.match(problem({ version: 3, order: [], columns: {}, removed: [] })!, /expected version 2, found 3/);
  assert.match(problem({ version: 2, order: [], columns: {}, hidden: [] })!, /expected the fields columns, order, removed, version, found columns, hidden, order, version/);
  assert.match(problem({ version: 2, order: ["a", "a"], columns: {}, removed: [] })!, /order and removed must list distinct widget IDs/);
  for (const width of [0, 7, 2.5, "half"]) {
    assert.match(problem({ version: 2, order: [], columns: { a: width }, removed: [] })!, /columns must map widget IDs to whole numbers from 1 to 6/);
  }
});

test("the layout applies the chosen widths and order with the same responsive rules", () => {
  const narrowContinue = shownWith(preferences({ columns: new Map([["start.continue", 3]]) }));
  assert.deepEqual(columns(narrowContinue, 1280), [2, 3, 6, 6, 2]);
  assert.deepEqual(columns(narrowContinue, 900), [1, 2, 3, 3, 1], "medium widths halve the widths, rounded up");
  const reordered = shownWith(preferencesOf(moveWidget(initial, "start.continue", 0), start, DEFAULT_DASHBOARD_PREFERENCES));
  assert.deepEqual(columns(reordered, 1280).slice(0, 2), [4, 2]);
  const without = shownWith(preferences({ removed: ["start.new"] }));
  assert.deepEqual(dashboardLayout(without, 560), { mode: "tabs" });
  assert.deepEqual(columns(shownWith(preferences({ removed: ["start.new", "demo.board", "demo.usage"] })), 560), [1, 1], "a single framed widget left fills the width instead of tabs");
});
