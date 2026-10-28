import assert from "node:assert/strict";
import test from "node:test";
import { headerCollapse, headerCollapseOrder, type HeaderCollapseGroup } from "../src/run-panel/header-collapse";

const labels: readonly { readonly name: string; readonly group: HeaderCollapseGroup; readonly width: number }[] = [
  { name: "Runs", group: "pages", width: 40 },
  { name: "Apps", group: "pages", width: 40 },
  { name: "Global coordinator", group: "actions", width: 130 },
  { name: "@coordinator asks", group: "status", width: 120 },
  { name: "Show app...", group: "actions", width: 80 },
  { name: "Share", group: "actions", width: 50 },
  { name: "Run script", group: "actions", width: 75 },
];
const order = headerCollapseOrder(labels, (label) => label.group);

/** A header whose controls need `controls` pixels with every label collapsed and whose windows need `windows` more in the row. */
const header = (available: number, controls: number, windows: number) => {
  const attempts: string[] = [];
  const fits = (count: number, inRow: boolean) => {
    attempts.push(`${count}${inRow ? "+windows" : ""}`);
    return controls + order.slice(count).reduce((sum, label) => sum + label.width, 0) + (inRow ? windows : 0) <= available;
  };
  return { fits, attempts };
};

test("labels give way by group, page titles first and the run status last, each group from left to right", () => {
  assert.deepEqual(order.map((label) => label.name), ["Runs", "Apps", "Global coordinator", "Show app...", "Share", "Run script", "@coordinator asks"]);
});

test("a header that fits keeps every label", () => {
  const { fits } = header(2000, 600, 200);
  assert.deepEqual(headerCollapse(fits, order.length, true), { count: 0, windows: true, wrap: false });
});

test("only as many labels give way as the row needs", () => {
  assert.deepEqual(headerCollapse(header(1060, 600, 0).fits, order.length, false), { count: 2, windows: false, wrap: false },
    "the page titles alone make room");
  assert.deepEqual(headerCollapse(header(1000, 600, 0).fits, order.length, false), { count: 3, windows: false, wrap: false },
    "then the first other label, from the left");
  assert.deepEqual(headerCollapse(header(750, 600, 0).fits, order.length, false), { count: 6, windows: false, wrap: false },
    "the run status text is the last label to give way");
});

test("labels give way so that the windows share the row before any row wraps", () => {
  assert.deepEqual(headerCollapse(header(970, 600, 150).fits, order.length, true), { count: 5, windows: true, wrap: false });
});

test("windows that never fit continue below while the controls keep the labels they have room for", () => {
  const { fits, attempts } = header(1060, 600, 900);
  assert.deepEqual(headerCollapse(fits, order.length, true), { count: 2, windows: false, wrap: false });
  assert.deepEqual(attempts.slice(0, 2), ["7+windows", "7"], "the rule first checks whether even fully collapsed controls leave room for the windows");
});

test("only controls that do not fit even without labels wrap, with every label collapsed", () => {
  const { fits, attempts } = header(500, 600, 100);
  assert.deepEqual(headerCollapse(fits, order.length, true), { count: 7, windows: false, wrap: true });
  assert.deepEqual(attempts, ["7+windows", "7"]);
});

test("the search tries few counts even for many labels", () => {
  const many = Array.from({ length: 64 }, () => 10);
  const attempts: number[] = [];
  const result = headerCollapse((count) => {
    attempts.push(count);
    return many.slice(count).reduce((sum, width) => sum + width, 0) <= 333;
  }, many.length, false);
  assert.deepEqual(result, { count: 31, windows: false, wrap: false });
  assert.ok(attempts.length <= 8, `binary search: ${attempts.join(", ")}`);
});
