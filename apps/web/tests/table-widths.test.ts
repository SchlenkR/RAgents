import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Table } from "../src/ui/table";
import { parseTableColumnWidths, tableColumnWidth, tableWidthsKey, validateTableColumns } from "../src/ui/table-widths";

test("saved table widths reject corrupt or non-positive values and isolate table identities", () => {
  assert.deepEqual(parseTableColumnWidths(null), {});
  assert.deepEqual(parseTableColumnWidths('{"name":120,"status":89.5}'), { name: 120, status: 89.5 });
  for (const raw of ["broken", "null", "[]", "true", '{"name":"120"}', '{"name":0}', '{"name":-1}', '{"name":1e400}', '{" ":120}']) {
    assert.throws(() => parseTableColumnWidths(raw));
  }
  assert.notEqual(tableWidthsKey("work/items"), tableWidthsKey("work%2Fitems"));
});

test("table width definitions enforce minimums and reject ambiguous columns", () => {
  assert.equal(tableColumnWidth({ id: "name" }, {}), 180);
  assert.equal(tableColumnWidth({ id: "name", width: 150, minWidth: 100 }, { name: 80 }), 100);
  assert.equal(tableColumnWidth({ id: "name", width: 150 }, { name: 220 }), 220);
  assert.equal(tableColumnWidth({ id: "constructor" }, {}), 180);
  for (const columns of [[], [{ id: "" }], [{ id: "name" }, { id: "name" }], [{ id: "name", width: Infinity }], [{ id: "name", minWidth: 0 }]]) {
    assert.throws(() => validateTableColumns(columns));
  }
  assert.throws(() => renderToStaticMarkup(createElement(Table, { columns: [{ id: "name" }] })), /table ID/);
});
