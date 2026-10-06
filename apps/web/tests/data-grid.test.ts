import assert from "node:assert/strict";
import test from "node:test";
import { createTable, getCoreRowModel, getSortedRowModel } from "@tanstack/react-table";
import { gridColumnDefinitions, gridColumnSizes } from "../src/ui/data-grid-model";
import { gridWidthSetting, gridWidthsKey } from "../src/ui/data-grid-storage";
import type { DataGridColumn, DataGridSort } from "../src/ui/data-grid";

interface Entry { id: string; title: string; count: number | null; active: boolean }
const rows = Object.freeze([
  Object.freeze({ id: "a", title: "Item 10", count: 10, active: true }),
  Object.freeze({ id: "b", title: "Item 2", count: 2, active: false }),
  Object.freeze({ id: "c", title: "Item 3", count: 2, active: true }),
  Object.freeze({ id: "d", title: "Item 1", count: null, active: false }),
]);
const columns: readonly DataGridColumn<Entry>[] = [
  { id: "title", label: "Title", value: (row) => row.title, sortable: true, width: 240, minWidth: 100, flex: true },
  { id: "count", label: "Count", value: (row) => row.count, sortable: true, width: 90, minWidth: 60 },
  { id: "active", label: "Active", value: (row) => row.active, sortable: true, width: 80 },
];

function sortedRows(sorting: DataGridSort[]) {
  return createTable({
    data: [...rows], columns: gridColumnDefinitions(columns), state: { sorting },
    onStateChange: () => {}, renderFallbackValue: null,
    getCoreRowModel: getCoreRowModel(), getSortedRowModel: getSortedRowModel(), getRowId: (row) => row.id,
  }).getRowModel().rows.map((row) => row.original);
}

test("grid sorting uses the TanStack model, stable numeric order and nulls last in both directions", () => {
  assert.deepEqual(sortedRows([{ id: "count", desc: false }]).map((row) => row.id), ["b", "c", "a", "d"]);
  assert.deepEqual(sortedRows([{ id: "count", desc: true }]).map((row) => row.id), ["a", "b", "c", "d"]);
  assert.deepEqual(sortedRows([{ id: "title", desc: false }]).map((row) => row.id), ["d", "b", "c", "a"]);
  assert.deepEqual(sortedRows([{ id: "active", desc: false }, { id: "title", desc: true }]).map((row) => row.id), ["b", "d", "a", "c"]);
  assert.equal(sortedRows([{ id: "count", desc: false }])[0], rows[1]);
  assert.deepEqual(rows.map((row) => row.id), ["a", "b", "c", "d"]);
  assert.deepEqual(sortedRows([]), rows);
});

test("one flexible column fills the parent while saved sizes and minimum widths survive narrow panels", () => {
  assert.deepEqual(gridColumnSizes(columns, {}, 1000, 40), { title: 790, count: 90, active: 80 });
  assert.deepEqual(gridColumnSizes(columns, { count: 150, title: 1 }, 1000), { title: 770, count: 150, active: 80 });
  assert.deepEqual(gridColumnSizes(columns, { title: 1, count: 1 }, 160), { title: 100, count: 60, active: 80 });
  assert.deepEqual(gridColumnSizes([{ id: "name", label: "Name", width: 120 }, { id: "last", label: "Last", width: 100 }], {}, 700), { name: 120, last: 580 });
  assert.throws(() => gridColumnDefinitions([...columns, { id: "second-flex", label: "Second", flex: true }]), /one flexible/);
  assert.throws(() => gridColumnDefinitions([{ id: "name", label: "Name", minWidth: 0 }]), /positive/);
  assert.throws(() => gridColumnDefinitions([columns[0], columns[0]]), /unique/);
});

test("grid widths persist per identity through the shared helper, notify mirrors and surface write failures", (context) => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, "window");
  const browser = new EventTarget();
  const values = new Map<string, string>();
  const storage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
  };
  Object.defineProperty(globalThis, "window", { configurable: true, value: Object.assign(browser, { localStorage: storage }) });
  context.after(() => { if (previous) Object.defineProperty(globalThis, "window", previous); else Reflect.deleteProperty(globalThis, "window"); });
  let notifications = 0;
  browser.addEventListener("ragents-grid-widths-change", () => { notifications++; });
  gridWidthSetting.save(gridWidthsKey("items/a"), { widths: { title: 320, count: 90 } });
  gridWidthSetting.save(gridWidthsKey("items%2Fa"), { widths: { title: 480 } });
  assert.equal(notifications, 2);
  assert.deepEqual(JSON.parse(storage.getItem(gridWidthsKey("items/a"))!), { title: 320, count: 90 });
  assert.deepEqual(JSON.parse(storage.getItem(gridWidthsKey("items%2Fa"))!), { title: 480 });
  assert.throws(() => gridWidthSetting.save(gridWidthsKey("invalid"), { widths: { title: -1 } }), /invalid/);
  storage.setItem = () => { throw new DOMException("Storage is full", "QuotaExceededError"); };
  assert.throws(() => gridWidthSetting.save(gridWidthsKey("items/a"), { widths: { title: 600 } }), /Storage is full/);
  assert.equal(notifications, 2);
  assert.equal(JSON.parse(storage.getItem(gridWidthsKey("items/a"))!).title, 320);
});
