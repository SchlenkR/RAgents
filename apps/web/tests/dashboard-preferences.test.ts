import assert from "node:assert/strict";
import test from "node:test";
import { dashboardLayout, type DashboardItem } from "../src/panel/dashboard-layout";
import {
  arrangeWidgets, DEFAULT_DASHBOARD_PREFERENCES, isDefaultLayout, readDashboardLayout, startLayoutStorageKey, withHidden, withSpan, withSwap, writeDashboardLayout,
  type DashboardPreferences,
} from "../src/panel/dashboard-preferences";

const widget = (key: string, span: DashboardItem["span"], framed = true): DashboardItem => ({ key, span, framed });
const start = [widget("start.new", "narrow"), widget("start.continue", "wide"), widget("demo.board", "full"), widget("demo.notes", "full", false), widget("demo.usage", "narrow")];
const framed = start.filter((item) => item.framed).map((item) => item.key);
const preferences = (overrides: Partial<DashboardPreferences>): DashboardPreferences => ({ ...DEFAULT_DASHBOARD_PREFERENCES, ...overrides });
const keys = (items: readonly DashboardItem[]) => items.map((item) => item.key);
const columns = (items: readonly DashboardItem[], width: number) => {
  const layout = dashboardLayout(items, width);
  assert.equal(layout.mode, "grid");
  return layout.mode === "grid" ? items.map((item) => layout.columns.get(item.key)) : [];
};

test("without preferences Start keeps its widgets, order, and spans", () => {
  const arranged = arrangeWidgets(start, DEFAULT_DASHBOARD_PREFERENCES);
  assert.deepEqual(arranged.shown, start);
  assert.deepEqual(arranged.hidden, []);
  assert.equal(isDefaultLayout(DEFAULT_DASHBOARD_PREFERENCES), true);
});

test("a chosen span replaces the default of a framed widget only", () => {
  const chosen = preferences({ spans: new Map([["start.continue", "narrow"], ["demo.notes", "narrow"]]) });
  const { shown } = arrangeWidgets(start, chosen);
  assert.equal(shown.find((item) => item.key === "start.continue")!.span, "narrow");
  assert.equal(shown.find((item) => item.key === "demo.notes")!.span, "full", "a section without a title keeps its full row");
  assert.deepEqual(withSpan(withSpan(DEFAULT_DASHBOARD_PREFERENCES, "start.continue", "half", "wide"), "start.continue", "wide", "wide"), DEFAULT_DASHBOARD_PREFERENCES,
    "choosing the default again stores no choice");
});

test("the order places the framed widgets it names; sections without a title and new widgets keep their default place", () => {
  const order = preferences({ order: ["demo.usage", "start.continue", "start.new"] });
  assert.deepEqual(keys(arrangeWidgets(start, order).shown), ["demo.usage", "start.continue", "demo.board", "demo.notes", "start.new"]);
  const later = [...start, widget("ragents.global-apps:planner", "half")];
  assert.deepEqual(keys(arrangeWidgets(later, order).shown).at(-1), "ragents.global-apps:planner", "a widget the order does not know appears at its default place");
  const first = [widget("ragents.global-apps:planner", "half"), ...start];
  assert.equal(keys(arrangeWidgets(first, order).shown)[0], "ragents.global-apps:planner");
});

test("unknown widget IDs in the preferences are ignored", () => {
  const stale = preferences({ order: ["gone.widget", "start.continue", "start.new"], spans: new Map([["gone.widget", "half"]]), hidden: ["gone.widget"] });
  const arranged = arrangeWidgets(start, stale);
  assert.deepEqual(keys(arranged.shown), ["start.continue", "start.new", "demo.board", "demo.notes", "demo.usage"]);
  assert.deepEqual(arranged.hidden, []);
});

test("hiding removes a framed widget from the shown ones and lists it for showing again", () => {
  const hidden = withHidden(withHidden(DEFAULT_DASHBOARD_PREFERENCES, "demo.board", true), "demo.notes", true);
  const arranged = arrangeWidgets(start, hidden);
  assert.deepEqual(keys(arranged.shown), ["start.new", "start.continue", "demo.notes", "demo.usage"], "a section without a title cannot be hidden");
  assert.deepEqual(keys(arranged.hidden), ["demo.board"]);
  assert.deepEqual(withHidden(withHidden(hidden, "demo.board", false), "demo.notes", false), DEFAULT_DASHBOARD_PREFERENCES);
});

test("moving swaps a widget with its visible neighbor and keeps hidden ones in place", () => {
  const hidden = withHidden(DEFAULT_DASHBOARD_PREFERENCES, "demo.board", true);
  const moved = withSwap(hidden, framed, "demo.usage", "start.continue");
  assert.deepEqual(moved.order, ["start.new", "demo.usage", "demo.board", "start.continue"]);
  assert.deepEqual(keys(arrangeWidgets(start, moved).shown), ["start.new", "demo.usage", "demo.notes", "start.continue"]);
  assert.deepEqual(withSwap(moved, framed, "start.continue", "demo.usage").order, [], "the default order again stores no order");
  assert.throws(() => withSwap(DEFAULT_DASHBOARD_PREFERENCES, framed, "gone.widget", "start.new"), /Start has no widget gone.widget to move/);
});

test("reset returns to the default layout", () => {
  const changed = withHidden(withSpan(withSwap(DEFAULT_DASHBOARD_PREFERENCES, framed, "start.new", "start.continue"), "start.continue", "narrow", "wide"), "demo.board", true);
  assert.equal(isDefaultLayout(changed), false);
  assert.deepEqual(arrangeWidgets(start, readDashboardLayout(writeDashboardLayout(DEFAULT_DASHBOARD_PREFERENCES)).preferences).shown, start);
});

test("two widgets with the same ID are an error", () => {
  assert.throws(() => arrangeWidgets([widget("start.new", "narrow"), widget("start.new", "full")], DEFAULT_DASHBOARD_PREFERENCES), /Start has two widgets with the ID start.new/);
});

test("the stored layout round-trips and an unreadable one names its cause", () => {
  const changed = preferences({ order: ["start.continue", "start.new"], spans: new Map([["start.continue", "narrow"]]), hidden: ["demo.board"] });
  assert.deepEqual(readDashboardLayout(writeDashboardLayout(changed)), { preferences: changed });
  assert.deepEqual(readDashboardLayout(null), { preferences: DEFAULT_DASHBOARD_PREFERENCES });
  const problem = (raw: string) => {
    const read = readDashboardLayout(raw);
    assert.deepEqual(read.preferences, DEFAULT_DASHBOARD_PREFERENCES);
    return read.problem;
  };
  assert.match(problem("{")!, /^The saved Start layout could not be read: /);
  assert.match(problem("[]")!, /expected an object/);
  assert.match(problem('{"version":2,"order":[],"spans":{},"hidden":[]}')!, /expected version 1, found 2/);
  assert.match(problem('{"version":1,"order":[],"spans":{}}')!, /expected the fields hidden, order, spans, version, found order, spans, version/);
  assert.match(problem('{"version":1,"order":["a","a"],"spans":{},"hidden":[]}')!, /order and hidden must list distinct widget IDs/);
  assert.match(problem('{"version":1,"order":[],"spans":{"a":"third"},"hidden":[]}')!, /spans must map widget IDs to narrow, half, wide, full/);
});

test("the layout is stored per server origin and signed-in user", () => {
  assert.equal(startLayoutStorageKey("http://localhost:4710", null), "ragents.start.layout:http%3A%2F%2Flocalhost%3A4710");
  assert.equal(startLayoutStorageKey("http://localhost:4710", "alice"), "ragents.start.layout:http%3A%2F%2Flocalhost%3A4710:alice");
  assert.notEqual(startLayoutStorageKey("http://localhost:4710", "a:b"), startLayoutStorageKey("http://localhost:4710:a", "b"));
});

test("the layout applies the chosen spans and order with the same responsive rules", () => {
  const narrowContinue = arrangeWidgets(start, preferences({ spans: new Map([["start.continue", "narrow"]]) })).shown;
  const two = narrowContinue.filter((item) => item.key.startsWith("start."));
  assert.deepEqual(columns(two, 1280), [6, 6], "a narrow Continue beside New shares the row evenly");
  assert.deepEqual(columns([...two, widget("demo.usage", "narrow")], 1280), [4, 4, 4], "three narrow widgets share one row");
  assert.deepEqual(columns(narrowContinue, 900), [6, 6, 12, 12, 12], "medium widths still halve the spans and stack full ones");
  const reordered = arrangeWidgets(start, withSwap(DEFAULT_DASHBOARD_PREFERENCES, framed, "start.new", "start.continue")).shown;
  assert.deepEqual(keys(reordered).slice(0, 2), ["start.continue", "start.new"]);
  assert.deepEqual(columns(reordered, 1280).slice(0, 2), [8, 4]);
  const hidden = arrangeWidgets(start, withHidden(DEFAULT_DASHBOARD_PREFERENCES, "start.new", true)).shown;
  assert.deepEqual(dashboardLayout(hidden, 560), { mode: "tabs" });
  assert.deepEqual(columns(arrangeWidgets(start, preferences({ hidden: ["start.new", "demo.board", "demo.usage"] })).shown, 560), [12, 12], "a single framed widget left fills the width instead of tabs");
});
