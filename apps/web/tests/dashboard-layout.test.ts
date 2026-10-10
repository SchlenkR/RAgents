import assert from "node:assert/strict";
import test from "node:test";
import { DASHBOARD_TABS_BELOW, DASHBOARD_WIDE_FROM, dashboardLayout, type DashboardItem } from "../src/panel/dashboard-layout";

const widget = (key: string, span: DashboardItem["span"], framed = true): DashboardItem => ({ key, span, framed });
const start = [widget("new", "narrow"), widget("continue", "wide")];
const columns = (items: readonly DashboardItem[], width: number | undefined) => {
  const layout = dashboardLayout(items, width);
  assert.equal(layout.mode, "grid");
  return layout.mode === "grid" ? items.map((item) => layout.columns.get(item.key)) : [];
};

test("a wide dashboard gives every widget its preferred span of twelve columns", () => {
  assert.deepEqual(columns(start, 1280), [4, 8]);
  assert.deepEqual(columns(start, DASHBOARD_WIDE_FROM), [4, 8]);
  assert.deepEqual(columns(start, undefined), [4, 8], "without a measurement Start assumes a wide screen");
  assert.deepEqual(columns([widget("a", "narrow"), widget("b", "narrow"), widget("c", "narrow"), widget("d", "half"), widget("e", "half")], 1400), [4, 4, 4, 6, 6]);
  assert.deepEqual(columns([widget("board", "full"), widget("legacy", "full", false)], 1400), [12, 12]);
});

test("a row with space left widens its widgets in proportion up to the right edge", () => {
  assert.deepEqual(columns([widget("a", "narrow"), widget("b", "narrow"), widget("c", "full")], 1400), [6, 6, 12]);
  assert.deepEqual(columns([widget("a", "half"), widget("b", "narrow"), widget("c", "wide")], 1400), [7, 5, 12]);
  assert.deepEqual(columns([widget("a", "wide")], 1400), [12]);
});

test("medium widths halve the narrow and wide spans and stack full widgets", () => {
  assert.deepEqual(columns(start, DASHBOARD_TABS_BELOW), [6, 6]);
  assert.deepEqual(columns(start, DASHBOARD_WIDE_FROM - 1), [6, 6]);
  assert.deepEqual(columns([...start, widget("board", "full"), widget("auto", "narrow")], 900), [6, 6, 12, 12]);
});

test("below the narrow limit several framed widgets become tabs, a single one fills the width", () => {
  assert.deepEqual(dashboardLayout(start, DASHBOARD_TABS_BELOW - 1), { mode: "tabs" });
  assert.deepEqual(dashboardLayout([...start, widget("legacy", "full", false)], 360), { mode: "tabs" });
  assert.deepEqual(columns([widget("continue", "wide"), widget("legacy", "full", false)], 360), [12, 12]);
});
