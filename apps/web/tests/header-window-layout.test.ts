import assert from "node:assert/strict";
import test from "node:test";
import { headerWindowLayout } from "../src/run-panel/header-window-layout";

const bounds = { width: 1000, height: 36, start: 240, end: 760, gap: 4 };
const sizes = (widths: readonly number[]) => widths.map((width) => ({ width, height: 32 }));

test("windows fill the first-row gap then continue across the full width", () => {
  const layout = headerWindowLayout(bounds, sizes([160, 160, 160, 160, 700]));
  assert.deepEqual(layout, { positions: [{ left: 240, top: 2 }, { left: 404, top: 2 }, { left: 568, top: 2 }, { left: 0, top: 40 }, { left: 164, top: 40 }], height: 72 });
});

test("a first window wider than the remaining gap starts below the fixed controls", () => {
  assert.deepEqual(headerWindowLayout(bounds, sizes([600, 300])), {
    positions: [{ left: 0, top: 40 }, { left: 604, top: 40 }], height: 72,
  });
});

test("narrow headers cap long windows and preserve ordered continuation rows", () => {
  assert.deepEqual(headerWindowLayout({ ...bounds, width: 200, start: 200, end: 0, height: 72 }, sizes([700, 90, 90, 90])), {
    positions: [{ left: 0, top: 76 }, { left: 0, top: 112 }, { left: 94, top: 112 }, { left: 0, top: 148 }], height: 180,
  });
});

test("removing windows restores the fixed height without a reserved overflow row", () => {
  assert.equal(headerWindowLayout(bounds, sizes([600])).height, 72);
  assert.equal(headerWindowLayout(bounds, sizes([100])).height, 36);
  assert.deepEqual(headerWindowLayout(bounds, []), { positions: [], height: 36 });
});
