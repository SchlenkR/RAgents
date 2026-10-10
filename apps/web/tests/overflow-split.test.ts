import assert from "node:assert/strict";
import test from "node:test";
import { splitOverflow, type OverflowMeasure } from "../src/ui/overflow-split";

const strip = (available: number, items = [60, 80, 70, 90, 50]): OverflowMeasure => ({ items, gap: 4, inset: 6, more: 32, available });

test("a strip that fits shows every item and no menu", () => {
  assert.deepEqual(splitOverflow(strip(6 + 350 + 16), 0), { visible: [0, 1, 2, 3, 4], hidden: [] });
  assert.deepEqual(splitOverflow(strip(1000), 4), { visible: [0, 1, 2, 3, 4], hidden: [] });
});

test("items that do not fit beside the menu button move into it in their order", () => {
  assert.deepEqual(splitOverflow(strip(6 + 350 + 15), 0), { visible: [0, 1, 2, 3], hidden: [4] }, "one pixel short also reserves the button");
  assert.deepEqual(splitOverflow(strip(250), 0), { visible: [0, 1], hidden: [2, 3, 4] });
  assert.deepEqual(splitOverflow(strip(250), 1), { visible: [0, 1], hidden: [2, 3, 4] });
});

test("the active item stays visible and displaces the last leading items", () => {
  assert.deepEqual(splitOverflow(strip(250), 4), { visible: [0, 1, 4], hidden: [2, 3] });
  assert.deepEqual(splitOverflow(strip(200), 3), { visible: [0, 3], hidden: [1, 2, 4] });
  assert.deepEqual(splitOverflow(strip(110), 3), { visible: [3], hidden: [0, 1, 2, 4] }, "only the active item when nothing else fits beside it");
  assert.deepEqual(splitOverflow(strip(40), 2), { visible: [2], hidden: [0, 1, 3, 4] }, "the active item stays even when it alone is too wide");
});

test("without an active item a too narrow strip keeps only the menu", () => {
  assert.deepEqual(splitOverflow(strip(60), -1), { visible: [], hidden: [0, 1, 2, 3, 4] });
  assert.deepEqual(splitOverflow(strip(0, []), -1), { visible: [], hidden: [] });
});
