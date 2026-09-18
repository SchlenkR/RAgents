import assert from "node:assert/strict";
import { test } from "node:test";
import { layoutScene, type SceneGroup } from "../../../plugins/ragents.orchestration/web/canvas-layout";
import { withMaterialSpacing } from "../../../plugins/ragents.orchestration/web/material-layout";

const pair = (axis: "h" | "v", gap: number): SceneGroup => ({
  kind: "group", key: "pair", layout: { type: "stack", axis, gap },
  children: [{ kind: "leaf", key: "a", width: 360, height: 260 }, { kind: "leaf", key: "b", width: 300, height: 220 }],
});

test("deep cards retain room between the front and the next extrusion", () => {
  for (const depth of [0, 12, 36, 60]) {
    for (const axis of ["h", "v"] as const) {
      const scene = layoutScene(withMaterialSpacing(pair(axis, 0), depth));
      const [a, b] = scene.boxes;
      assert.ok(a && b);
      const clearance = axis === "h" ? b.x - (a.x + a.width + depth * .5) : (b.y - depth * .7) - (a.y + a.height);
      assert.ok(clearance >= 31.99, `${axis}, depth ${depth}: ${clearance}`);
      assert.equal(a.width, 360);
      assert.equal(b.height, 220);
    }
  }
});

test("existing generous spacing and the source layout are preserved", () => {
  const original = pair("v", 160);
  const copy = structuredClone(original);
  const result = withMaterialSpacing(original, 80);
  assert.deepEqual(original, copy);
  assert.deepEqual(result, original);
});

test("horizontal wrapping leaves room for the extrusion of the next row", () => {
  const root: SceneGroup = { ...pair("h", 0), layout: { type: "wrap", axis: "h", limit: 400, gap: 0 } };
  const [a, b] = layoutScene(withMaterialSpacing(root, 80)).boxes;
  assert.ok(a && b);
  assert.ok(b.y - 56 - (a.y + a.height) >= 32);
});
