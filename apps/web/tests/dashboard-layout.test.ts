import assert from "node:assert/strict";
import test from "node:test";
import {
  DASHBOARD_TABS_BELOW, DASHBOARD_WIDE_FROM, dashboardLayout, draggedColumns, gridColumnsAt, resizedColumns, shownColumns, widgetWidth, widthProblem, type DashboardItem,
} from "../src/panel/dashboard-layout";

const widget = (key: string, columns: number, framed = true): DashboardItem => ({ key, columns, framed });
const start = [widget("new", 2), widget("continue", 4)];
const layoutAt = (items: readonly DashboardItem[], width: number | undefined) => {
  const layout = dashboardLayout(items, width);
  assert.equal(layout.mode, "grid");
  return layout.mode === "grid" ? { grid: layout.grid, columns: items.map((item) => layout.columns.get(item.key)) } : undefined;
};

test("a wide dashboard has six columns and gives every widget exactly its columns, also alone in a row", () => {
  assert.deepEqual(layoutAt(start, 1280), { grid: 6, columns: [2, 4] });
  assert.deepEqual(layoutAt(start, DASHBOARD_WIDE_FROM), { grid: 6, columns: [2, 4] });
  assert.deepEqual(layoutAt(start, undefined), { grid: 6, columns: [2, 4] }, "without a measurement Start assumes a wide screen");
  assert.deepEqual(layoutAt([1, 2, 3, 4, 5, 6].map((columns) => widget(`w${columns}`, columns)), 2560)!.columns, [1, 2, 3, 4, 5, 6]);
  assert.deepEqual(layoutAt([widget("lonely", 2), widget("legacy", 2, false)], 1400)!.columns, [2, 6], "a row with space left keeps it, and a section without a title fills its row");
});

test("medium widths have three columns and a widget takes half its columns, rounded up", () => {
  assert.deepEqual(layoutAt(start, DASHBOARD_TABS_BELOW), { grid: 3, columns: [1, 2] });
  assert.deepEqual(layoutAt(start, DASHBOARD_WIDE_FROM - 1), { grid: 3, columns: [1, 2] });
  assert.deepEqual(layoutAt([1, 2, 3, 4, 5, 6].map((columns) => widget(`w${columns}`, columns)), 900)!.columns, [1, 1, 2, 2, 3, 3]);
  assert.deepEqual(layoutAt([widget("legacy", 2, false)], 900)!.columns, [3]);
});

test("below the narrow limit several framed widgets become tabs, a single one fills the width", () => {
  assert.deepEqual(dashboardLayout(start, DASHBOARD_TABS_BELOW - 1), { mode: "tabs" });
  assert.deepEqual(dashboardLayout([...start, widget("legacy", 6, false)], 360), { mode: "tabs" });
  assert.deepEqual(layoutAt([widget("continue", 4), widget("legacy", 6, false)], 360), { grid: 1, columns: [1, 1] });
  assert.deepEqual([359, 699, 700, 1099, 1100, 2560].map(gridColumnsAt), [1, 1, 3, 3, 6, 6]);
});

test("a declared width defaults to the whole row and every width, and anything Start cannot show is named", () => {
  assert.deepEqual(widgetWidth({}), { columns: 6, minColumns: 1, maxColumns: 6 });
  assert.deepEqual(widgetWidth({ columns: 4, minColumns: 2 }), { columns: 4, minColumns: 2, maxColumns: 6 });
  assert.equal(widthProblem({ columns: 2, minColumns: 1, maxColumns: 3 }), undefined);
  assert.equal(widthProblem({ columns: 7 }), "has columns 7; allowed are whole numbers from 1 to 6");
  assert.equal(widthProblem({ columns: 2.5 }), "has columns 2.5; allowed are whole numbers from 1 to 6");
  assert.equal(widthProblem({ minColumns: 0 }), "has minColumns 0; allowed are whole numbers from 1 to 6");
  assert.equal(widthProblem({ maxColumns: 4 }), "has 6 columns outside its range from minColumns 1 to maxColumns 4", "the default columns must lie in the range");
  assert.equal(widthProblem({ columns: 2, minColumns: 3 }), "has 2 columns outside its range from minColumns 3 to maxColumns 6");
  assert.throws(() => widgetWidth({ columns: 0 }), /A Start widget has columns 0/);
});

test("a resize drag snaps to the nearest column edge within the widget's range", () => {
  const continueWidth = { columns: 4, minColumns: 2, maxColumns: 6 };
  const pitch = 200;
  assert.equal(draggedColumns(continueWidth, 6, 0, pitch), 4);
  assert.equal(draggedColumns(continueWidth, 6, -99, pitch), 4, "less than half a column keeps the width");
  assert.equal(draggedColumns(continueWidth, 6, -101, pitch), 3, "past half a column snaps to the next one");
  assert.equal(draggedColumns(continueWidth, 6, -400, pitch), 2);
  assert.equal(draggedColumns(continueWidth, 6, -900, pitch), 2, "never below minColumns");
  assert.equal(draggedColumns(continueWidth, 6, 380, pitch), 6);
  assert.equal(draggedColumns(continueWidth, 6, 2000, pitch), 6, "never beyond maxColumns");
  assert.equal(draggedColumns({ columns: 2, minColumns: 2, maxColumns: 6 }, 6, 210, pitch), 3);
  assert.equal(draggedColumns({ columns: 3, minColumns: 1, maxColumns: 4 }, 6, 900, pitch), 4);
});

test("at medium widths resizing moves in the three columns shown and stores the most columns that show the width", () => {
  const newWidth = { columns: 2, minColumns: 2, maxColumns: 6 };
  assert.equal(draggedColumns(newWidth, 3, 0, 400), 2);
  assert.equal(draggedColumns(newWidth, 3, 410, 400), 4, "one shown column more is two of six");
  assert.equal(draggedColumns(newWidth, 3, 810, 400), 6);
  assert.equal(draggedColumns({ columns: 3, minColumns: 1, maxColumns: 6 }, 3, 100, 400), 3, "columns that already show the width stay");
  assert.equal(draggedColumns({ columns: 3, minColumns: 1, maxColumns: 6 }, 3, -400, 400), 2);
  assert.equal(resizedColumns({ columns: 2, minColumns: 1, maxColumns: 3 }, 2, 3), 3, "maxColumns bounds the stored columns");
  assert.equal(resizedColumns({ columns: 4, minColumns: 3, maxColumns: 6 }, 1, 3), 4, "a width below minColumns is not reachable");
  assert.equal(shownColumns(5, 3), 3);
  assert.equal(shownColumns(1, 3), 1);
});

test("keyboard steps change the width by one shown column and stop at the range", () => {
  const step = (columns: number, by: number, grid: number, range = { minColumns: 2, maxColumns: 6 }) => resizedColumns({ columns, ...range }, shownColumns(columns, grid) + by, grid);
  assert.deepEqual([step(4, -1, 6), step(4, 1, 6), step(2, -1, 6), step(6, 1, 6)], [3, 5, 2, 6]);
  assert.deepEqual([step(2, 1, 3), step(4, 1, 3), step(4, -1, 3), step(3, 1, 3, { minColumns: 1, maxColumns: 6 })], [4, 6, 2, 6]);
});
