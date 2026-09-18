import assert from "node:assert/strict";
import test from "node:test";
import type { CanvasTileNode } from "../../../plugins/ragents.orchestration/tiled-layout.ts";
import { dockTile, removeTile, resizeTile, tileEntities, tileGeometry, tileMinimum } from "../../../plugins/ragents.orchestration/web/tile-docking.ts";

const upper: CanvasTileNode = { entity: "@upper" };
const left: CanvasTileNode = { entity: "@left" };
const right: CanvasTileNode = { entity: "@right" };
const lower: CanvasTileNode = { direction: "horizontal", weights: [2, 1], children: [left, right] };
const root: CanvasTileNode = { direction: "vertical", weights: [1, 1], children: [upper, lower] };

test("a sibling can move after its old split collapses without losing the target", () => {
  assert.deepEqual(dockTile(root, "@left", "@right", "bottom"), {
    ...root, children: [upper, { direction: "vertical", weights: [1, 1], children: [right, left] }],
  });
  assert.deepEqual(root.children[1], lower);
});

test("root docking moves an existing tile around the complete remaining tree", () => {
  assert.deepEqual(dockTile(root, "@left", null, "left"), {
    direction: "horizontal", weights: [1, 1], children: [left, { ...root, children: [upper, right] }],
  });
  assert.deepEqual(tileEntities(dockTile(root, "@left", null, "left")).sort(), ["@left", "@right", "@upper"]);
});

test("new tiles split the selected leaf and preserve all other ratios", () => {
  assert.deepEqual(dockTile(root, "@new", "@upper", "right"), {
    ...root, children: [{ direction: "horizontal", weights: [1, 1], children: [upper, { entity: "@new" }] }, lower],
  });
});

test("self docking and stale targets leave the tree untouched", () => {
  assert.equal(dockTile(root, "@left", "@left", "right"), root);
  assert.equal(dockTile(left, "@left", null, "right"), left);
  assert.equal(dockTile(root, "@left", "@gone", "left"), root);
});

test("empty layouts accept one tile and removing the last tile empties the layout", () => {
  assert.deepEqual(dockTile(null, "@left", null, "top"), left);
  assert.equal(removeTile(left, "@left"), null);
  assert.equal(removeTile(root, "@gone"), root);
});

test("removal collapses only the affected parent and keeps its surviving subtree", () => {
  assert.equal(removeTile(root, "@upper"), lower);
  assert.deepEqual(removeTile(root, "@right"), { ...root, children: [upper, left] });
});

test("minimum dimensions accumulate along each split axis", () => {
  assert.deepEqual(tileMinimum(lower), { width: 448, height: 160 });
  assert.deepEqual(tileMinimum(root), { width: 448, height: 328 });
});

test("nested ratios fill the available rectangle with divider gaps", () => {
  const geometry = tileGeometry(root, { left: 10, top: 20, width: 908, height: 648 });
  assert.deepEqual(geometry.leaves.get("@upper"), { left: 10, top: 20, width: 908, height: 320 });
  assert.deepEqual(geometry.leaves.get("@left"), { left: 10, top: 348, width: 600, height: 320 });
  assert.deepEqual(geometry.leaves.get("@right"), { left: 618, top: 348, width: 300, height: 320 });
  assert.equal(geometry.dividers.length, 2);
});

test("extreme weights cannot shrink either subtree below its minimum", () => {
  const narrow = { ...lower, weights: [1000, 1] as [number, number] };
  const geometry = tileGeometry(narrow, { left: 0, top: 0, width: 500, height: 200 });
  assert.equal(geometry.leaves.get("@right")?.width, 220);
  assert.equal(geometry.leaves.get("@left")?.width, 272);
  assert.equal(geometry.dividers[0].maximum, 1 - 220 / 492);
});

test("resizing a nested divider preserves ancestor weights and updates its two children", () => {
  assert.deepEqual(resizeTile(root, [1], 0.75), {
    ...root, children: [upper, { ...lower, weights: [0.75, 0.25] }],
  });
  assert.deepEqual(root.children[1], lower);
});

test("very large finite weights keep their proportion without overflowing the sum", () => {
  const geometry = tileGeometry({ ...lower, weights: [1e308, 1e308] }, { left: 0, top: 0, width: 608, height: 200 });
  assert.equal(geometry.leaves.get("@left")?.width, 300);
  assert.equal(geometry.leaves.get("@right")?.width, 300);
});
