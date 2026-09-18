import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { DataTable, tableRows } from "../../../plugins/ragents.actor-programs/client-ui/DataTable.tsx";
import type { TableColumn } from "../../../plugins/ragents.actor-programs/client-ui/table-contracts.d.ts";

interface Row { id: string; name: string; count: number | null; active: boolean }
const rows: readonly Row[] = Object.freeze([
  Object.freeze({ id: "a", name: "Anna", count: 10, active: true }),
  Object.freeze({ id: "b", name: "Berta", count: 2, active: false }),
  Object.freeze({ id: "c", name: "Anton", count: 2, active: true }),
  Object.freeze({ id: "d", name: "Delta", count: null, active: false }),
]);
const columns: readonly TableColumn<Row>[] = [
  { id: "name", label: "Name", value: (row) => row.name, sortable: true },
  { id: "count", label: "Anzahl", value: (row) => row.count, sortable: true, filterable: false },
  { id: "active", label: "Aktiv", value: (row) => row.active },
];

test("Tabelle sortiert numerisch und stabil, Nullwerte zuletzt, ohne Daten oder Objektidentität zu verändern", () => {
  const sorted = tableRows(rows, columns, "", { id: "count", direction: "asc" });
  assert.deepEqual(sorted.map((row) => row.id), ["b", "c", "a", "d"]);
  assert.equal(sorted[0], rows[1]);
  assert.deepEqual(tableRows(rows, columns, "", { id: "count", direction: "desc" }).map((row) => row.id), ["a", "b", "c", "d"]);
  assert.deepEqual(rows.map((row) => row.id), ["a", "b", "c", "d"]);
  assert.deepEqual(tableRows(rows, columns, "", { id: "active", direction: "desc" }), rows);
});

test("Tabellensuche berücksichtigt nur freigegebene Spalten und kombiniert sich mit Sortierung", () => {
  assert.deepEqual(tableRows(rows, columns, " AN ", { id: "count", direction: "asc" }).map((row) => row.id), ["c", "a"]);
  assert.deepEqual(tableRows(rows, columns, "Ja").map((row) => row.id), ["a", "c"]);
  assert.deepEqual(tableRows(rows, columns, "10"), []);
  assert.deepEqual(tableRows(rows, columns, "Unbekannt"), []);
  assert.deepEqual(tableRows([], columns, ""), []);
});

test("Tabelle rendert echte Tabellenstruktur, kontrollierte Auswahl, eigene Zellen und deaktivierte Aktionen", () => {
  const html = renderToStaticMarkup(createElement(DataTable<Row>, {
    title: "Kontakte", rows, rowKey: (row) => row.id,
    columns: [...columns, { id: "custom", label: "Anzeige", value: (row) => row.name, render: (row) => createElement("strong", null, row.name) }],
    selectedKeys: ["a"], onSelectionChange: () => {}, filterable: true,
    actions: [{ id: "open", label: "Öffnen", onClick: async () => {}, disabled: (row) => row.id === "a" }],
  }));
  assert.match(html, /<table[^>]*data-slot="table"/);
  assert.match(html, /<th[^>]*data-slot="table-head"/);
  assert.ok(html.includes('aria-checked="mixed"'));
  assert.ok(html.includes('aria-selected="true"'));
  assert.ok(html.includes('type="search"'));
  assert.ok(html.includes("<strong>Anna</strong>"));
  assert.match(html, /<button[^>]* disabled=""[^>]*data-slot="button"[^>]*>Öffnen<\/button>/);
  const empty = renderToStaticMarkup(createElement(DataTable<Row>, { rows: [], columns, rowKey: (row) => row.id, emptyText: "Keine Kontakte" }));
  assert.ok(empty.includes("Keine Kontakte"));
  assert.ok(!empty.includes('type="checkbox"'));
  const loading = renderToStaticMarkup(createElement(DataTable<Row>, { rows: [], columns, rowKey: (row) => row.id, loading: true, emptyText: "Keine Kontakte" }));
  assert.ok(loading.includes('aria-busy="true"'));
  assert.ok(loading.includes("Wird geladen"));
  assert.ok(!loading.includes("Keine Kontakte"));
});

test("mehrdeutige Zeilen, Spalten und Aktionen scheitern ausdrücklich", () => {
  const base = { rows, columns, rowKey: (row: Row) => row.id };
  assert.throws(() => renderToStaticMarkup(createElement(DataTable<Row>, { ...base, rowKey: () => "same" })), /Tabellenzeilen/);
  assert.throws(() => renderToStaticMarkup(createElement(DataTable<Row>, { ...base, columns: [columns[0], columns[0]] })), /Spalten/);
  assert.throws(() => renderToStaticMarkup(createElement(DataTable<Row>, { ...base, actions: [
    { id: "same", label: "A", onClick: () => {} }, { id: "same", label: "B", onClick: () => {} },
  ] })), /Tabellenaktionen/);
});
