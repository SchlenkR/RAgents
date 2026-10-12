import assert from "node:assert/strict";
import test from "node:test";
import {
  DASHBOARD_TABS_BELOW, DASHBOARD_WIDE_FROM, dashboardLayout, draggedColumns, dropPlace, gridColumnsAt, packWidgets, resizedColumns, shownColumns, widgetWidth, widthProblem,
  type DashboardItem, type PackItem, type WidgetBox,
} from "../src/panel/dashboard-layout";

const widget = (key: string, columns: number, framed = true): DashboardItem => ({ key, columns, framed });
const start = [widget("new", 2), widget("continue", 4)];
const layoutAt = (items: readonly DashboardItem[], width: number | undefined) => {
  const layout = dashboardLayout(items, width);
  assert.equal(layout.mode, "grid");
  return layout.mode === "grid" ? { grid: layout.grid, columns: items.map((item) => layout.columns.get(item.key)) } : undefined;
};

test("a wide dashboard has six columns and uses configured widths as each widget's minimum", () => {
  assert.deepEqual(layoutAt(start, 1280), { grid: 6, columns: [2, 4] });
  assert.deepEqual(layoutAt(start, DASHBOARD_WIDE_FROM), { grid: 6, columns: [2, 4] });
  assert.deepEqual(layoutAt(start, undefined), { grid: 6, columns: [2, 4] }, "without a measurement Start assumes a wide screen");
  assert.deepEqual(layoutAt([1, 2, 3, 4, 5, 6].map((columns) => widget(`w${columns}`, columns)), 2560)!.columns, [1, 2, 3, 4, 5, 6]);
  assert.deepEqual(layoutAt([widget("lonely", 2), widget("legacy", 2, false)], 1400)!.columns, [2, 6], "packing starts at the configured width, and a section without a title fills its row");
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
  assert.equal(draggedColumns(continueWidth, 6, 0, pitch, 4), 4);
  assert.equal(draggedColumns(continueWidth, 6, -99, pitch, 4), 4, "less than half a column keeps the width");
  assert.equal(draggedColumns(continueWidth, 6, -101, pitch, 4), 3, "past half a column snaps to the next one");
  assert.equal(draggedColumns(continueWidth, 6, -400, pitch, 4), 2);
  assert.equal(draggedColumns(continueWidth, 6, -900, pitch, 4), 2, "never below minColumns");
  assert.equal(draggedColumns(continueWidth, 6, 380, pitch, 4), 6);
  assert.equal(draggedColumns(continueWidth, 6, 2000, pitch, 4), 6, "never beyond maxColumns");
  assert.equal(draggedColumns({ columns: 2, minColumns: 2, maxColumns: 6 }, 6, 210, pitch, 2), 3);
  assert.equal(draggedColumns({ columns: 3, minColumns: 1, maxColumns: 4 }, 6, 900, pitch, 3), 4);
});

test("at medium widths resizing moves in the three columns shown and stores the most columns that show the width", () => {
  const newWidth = { columns: 2, minColumns: 2, maxColumns: 6 };
  assert.equal(draggedColumns(newWidth, 3, 0, 400, 1), 2);
  assert.equal(draggedColumns(newWidth, 3, 410, 400, 1), 4, "one shown column more is two of six");
  assert.equal(draggedColumns(newWidth, 3, 810, 400, 1), 6);
  assert.equal(draggedColumns({ columns: 3, minColumns: 1, maxColumns: 6 }, 3, 100, 400, 2), 3, "columns that already show the width stay");
  assert.equal(draggedColumns({ columns: 3, minColumns: 1, maxColumns: 6 }, 3, -400, 400, 2), 2);
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

const item = (key: string, columns: number, height: number, maxColumns = 6): PackItem => ({ key, columns, height, maxColumns });
const GAP = 30;
const places = (items: readonly PackItem[], grid = 6) => packWidgets(items, grid, GAP).widgets.map(({ key, column, top }) => `${key}@${column},${top}`);

test("packing fills the sixth column beside Continue without changing configured widths", () => {
  const items = Object.freeze([Object.freeze(item("new", 3, 200)), Object.freeze(item("continue", 2, 500)), Object.freeze(item("plugin", 3, 300))]);
  const expected = { widgets: [
    { key: "new", column: 0, columns: 3, top: 0 },
    { key: "continue", column: 3, columns: 3, top: 0 },
    { key: "plugin", column: 0, columns: 3, top: 230 },
  ], height: 530 };
  assert.deepEqual(packWidgets(items, 6, GAP), expected);
  assert.deepEqual(packWidgets(items, 6, GAP), expected, "the same input produces the same growth");
  assert.deepEqual(items.map(({ columns }) => columns), [3, 2, 3]);
});

test("growth stops at maxColumns even when more columns are free", () => {
  assert.deepEqual(packWidgets([item("bounded", 2, 100, 3)], 6, GAP), {
    widgets: [{ key: "bounded", column: 0, columns: 3, top: 0 }], height: 100,
  });
});

test("growth cannot fill a column that a lower widget occupies within its full height", () => {
  const items = [item("first", 4, 200, 4), item("second", 5, 100, 5), item("short", 2, 50, 2),
    item("right", 1, 350, 1), item("target", 4, 350), item("lower", 2, 200, 2)];
  const packed = packWidgets(items, 6, GAP);
  assert.deepEqual(packed.widgets.find(({ key }) => key === "target"), { key: "target", column: 0, columns: 4, top: 360 });
  assert.deepEqual(packed.widgets.find(({ key }) => key === "lower"), { key: "lower", column: 4, columns: 2, top: 460 });
  assert.equal(packed.height, 710);
});

test("growth preserves tabs mode and one-column grids", () => {
  assert.deepEqual(dashboardLayout(start, 600), { mode: "tabs" });
  assert.deepEqual(packWidgets([item("one", 1, 50), item("two", 1, 70)], 1, GAP), {
    widgets: [{ key: "one", column: 0, columns: 1, top: 0 }, { key: "two", column: 0, columns: 1, top: 80 }], height: 150,
  });
});

test("resizing starts at the grown width and preserves the preference until a column changes", () => {
  const width = Object.freeze({ columns: 2, minColumns: 1, maxColumns: 6 });
  assert.equal(draggedColumns(width, 6, 0, 200, 3), 2);
  assert.equal(draggedColumns(width, 6, -99, 200, 3), 2);
  assert.equal(draggedColumns(width, 6, -101, 200, 3), 2);
  assert.equal(draggedColumns(width, 6, 101, 200, 3), 4);
  assert.equal(draggedColumns(width, 3, 201, 400, 2), 6);
  assert.equal(resizedColumns(width, 3 + 1, 6), 4, "keyboard resizing also starts at the grown span");
  assert.equal(width.columns, 2);
});

test("packing puts a widget under a short one beside a tall one instead of below the whole row", () => {
  const owner = [item("new", 3, 200), item("topics", 3, 500), item("continue", 3, 300)];
  assert.deepEqual(places(owner), ["new@0,0", "topics@3,0", "continue@0,230"], "Continue moves up under New, one gap below it");
  assert.equal(packWidgets(owner, 6, GAP).height, 530, "the grid ends at the lowest bottom, without a gap after it");
  assert.deepEqual(places([item("new", 3, 500), item("topics", 3, 200), item("continue", 3, 300)]), ["new@0,0", "topics@3,0", "continue@3,230"], "and under Topics when that is the shorter one");
});

test("packing breaks ties to the left and ignores differences below half a pixel", () => {
  assert.deepEqual(places([item("a", 2, 100), item("b", 2, 100), item("c", 2, 100), item("d", 2, 100)]), ["a@0,0", "b@2,0", "c@4,0", "d@0,130"], "equal heights fill rows from the left");
  assert.deepEqual(places([item("a", 3, 100.3), item("b", 3, 100), item("c", 3, 50)]), ["a@0,0", "b@3,0", "c@0,130.3"], "a fraction of a pixel does not move a widget to the right");
  assert.deepEqual(places([item("a", 3, 101), item("b", 3, 100), item("c", 3, 50)]), ["a@0,0", "b@3,0", "c@3,130"], "a whole pixel does");
});

test("a wide widget goes below every column it spans, and a narrower one after it may fill the room beside an earlier one", () => {
  assert.deepEqual(places([item("new", 2, 100), item("continue", 4, 300), item("board", 6, 200)]), ["new@0,0", "continue@2,0", "board@0,330"]);
  assert.deepEqual(places([item("a", 4, 200), item("b", 4, 50), item("c", 2, 50)]), ["a@0,0", "b@0,230", "c@4,0"], "the leftmost highest place that fits");
  assert.deepEqual(places([item("a", 3, 100), item("b", 6, 50), item("c", 3, 50)]), ["a@0,0", "b@0,130", "c@3,0"], "the room beside a narrower widget above a full row is filled");
  assert.deepEqual(places([item("new", 1, 100), item("continue", 2, 300), item("board", 3, 200)], 3), ["new@0,0", "continue@1,0", "board@0,330"], "the same at three columns");
});

test("the owner's stored order puts New at columns four and five beside Continue above the global app", () => {
  const owner = [item("continue", 3, 500), item("global-app", 4, 200), item("topics", 3, 0), item("new", 2, 100)];
  assert.deepEqual(places(owner), ["continue@0,0", "global-app@0,530", "new@3,0"]);
  assert.equal(packWidgets(owner, 6, GAP).height, 730);
});

test("a hole above a wide lower widget is filled only when the later widget's own height and gaps fit", () => {
  const before = [item("tall", 2, 180), item("short", 4, 50), item("wide", 6, 100)];
  assert.deepEqual(places([...before, item("filler", 2, 100)]), ["tall@0,0", "short@2,0", "wide@0,210", "filler@2,80"]);
  assert.deepEqual(places([...before, item("filler", 2, 100.1)]), ["tall@0,0", "short@2,0", "wide@0,210", "filler@0,340"], "a fraction beyond the available height cannot overlap the gap");
  assert.deepEqual(places([item("tall", 2, 180), item("wide", 3, 100), item("filler", 1, 50)], 3), ["tall@0,0", "wide@0,210", "filler@2,0"]);
});

test("widgets that fit the same hole claim it in their order and break equal tops to the left", () => {
  const before = [item("tall", 2, 180), item("wide", 6, 100)];
  assert.deepEqual(places([...before, item("first", 2, 80), item("second", 2, 80)]), ["tall@0,0", "wide@0,210", "first@2,0", "second@4,0"]);
  assert.deepEqual(places([...before, item("second", 2, 80), item("first", 2, 80)]), ["tall@0,0", "wide@0,210", "second@2,0", "first@4,0"]);
});

test("packing keeps the order of the widgets, skips those without height, and gives the same result for the same input", () => {
  const items = [item("a", 2, 120), item("empty", 2, 0), item("b", 4, 80), item("c", 1, 40), item("d", 5, 60)];
  const first = packWidgets(items, 6, GAP);
  assert.deepEqual(first.widgets.map((widget) => widget.key), ["a", "b", "c", "d"], "a widget without height takes no place and no gap");
  assert.deepEqual(packWidgets(items, 6, GAP), first);
  assert.deepEqual(packWidgets([], 6, GAP), { widgets: [], height: 0 });
  const single = packWidgets([item("one", 1, 50), item("two", 1, 70)], 1, GAP);
  assert.deepEqual(single, { widgets: [{ key: "one", column: 0, columns: 1, top: 0 }, { key: "two", column: 0, columns: 1, top: 80 }], height: 150 }, "one column stacks the widgets");
  assert.throws(() => packWidgets([item("wide", 4, 10)], 3, GAP), /Start widget wide cannot take 4 of 3 columns/);
});

const boxes: readonly WidgetBox[] = [
  { key: "new", left: 0, top: 0, width: 590, height: 200 },
  { key: "topics", left: 610, top: 0, width: 590, height: 500 },
  { key: "continue", left: 0, top: 230, width: 590, height: 300 },
];

test("a dragged widget goes before or after the widget under the pointer by its middle and keeps its place elsewhere", () => {
  assert.equal(dropPlace(boxes, "continue", { x: 100, y: 100 }, 1200), 0, "the left half of New puts Continue before it");
  assert.equal(dropPlace(boxes, "continue", { x: 400, y: 100 }, 1200), 1, "the right half after it");
  assert.equal(dropPlace(boxes, "continue", { x: 1000, y: 400 }, 1200), 2, "the right half of Topics after it");
  assert.equal(dropPlace(boxes, "continue", { x: 100, y: 300 }, 1200), undefined, "over its own place it stays");
  assert.equal(dropPlace(boxes, "continue", { x: 600, y: 100 }, 1200), undefined, "in a gap it stays");
  assert.equal(dropPlace(boxes, "new", { x: 400, y: 515 }, 1200), 2, "the right half of the place below counts as well");
  assert.equal(dropPlace(boxes, "new", { x: 300, y: 600 }, 1200), 2, "below every widget it goes to the end");
  assert.equal(dropPlace(boxes, "new", { x: 100, y: 515 }, 1200, { key: "", left: 610, top: 530, width: 390, height: 96 }), 1, "the end tile changes nothing over a widget");
  assert.equal(dropPlace(boxes, "new", { x: 700, y: 560 }, 1200, { key: "", left: 610, top: 530, width: 390, height: 96 }), 2, "over the end tile it goes to the end");
});

test("over a widget as wide as the grid and in the narrow list only the vertical middle counts", () => {
  const rows: readonly WidgetBox[] = [{ key: "board", left: 0, top: 0, width: 1200, height: 400 }, { key: "new", left: 0, top: 430, width: 590, height: 100 }];
  assert.equal(dropPlace(rows, "new", { x: 1100, y: 100 }, 1200), 0, "the upper half of a full row puts it before");
  assert.equal(dropPlace(rows, "new", { x: 10, y: 300 }, 1200), 1, "the lower half after");
  const list: readonly WidgetBox[] = ["a", "b", "c"].map((key, index) => ({ key, left: 0, top: index * 50, width: 500, height: 40 }));
  assert.equal(dropPlace(list, "c", { x: 490, y: 10 }, 500), 0);
  assert.equal(dropPlace(list, "a", { x: 10, y: 85 }, 500), 1);
  assert.equal(dropPlace(list, "a", { x: 10, y: 125 }, 500), 2);
});

test("once a dragged widget takes the place under the pointer the pointer is over its own box, so the place holds", () => {
  const moved = packWidgets([item("continue", 3, 300), item("new", 3, 200), item("topics", 3, 500)], 6, GAP).widgets;
  assert.deepEqual(moved.map(({ key, column, top }) => `${key}@${column},${top}`), ["continue@0,0", "new@3,0", "topics@3,230"]);
  const after: readonly WidgetBox[] = moved.map(({ key, column, top }) => ({ key, left: column * 610, top, width: 590, height: key === "continue" ? 300 : key === "new" ? 200 : 500 }));
  assert.equal(dropPlace(after, "continue", { x: 100, y: 100 }, 1200), undefined);
});
