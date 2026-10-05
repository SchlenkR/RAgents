import assert from "node:assert/strict";
import test from "node:test";
import { constrainImage, fitImageScale, zoomImage } from "../src/ui/image-geometry";

test("fit preserves aspect ratio and keeps small images at their natural size", () => {
  assert.equal(fitImageScale({ width: 2000, height: 1000 }, { width: 1000, height: 800 }), 0.5);
  assert.equal(fitImageScale({ width: 500, height: 1000 }, { width: 1000, height: 800 }), 0.8);
  assert.equal(fitImageScale({ width: 100, height: 100 }, { width: 1000, height: 800 }), 1);
});

test("zoom keeps the image point under the pointer in place", () => {
  const previous = { scale: 0.5, x: 30, y: -20 };
  const pointer = { x: 120, y: 40 };
  const next = zoomImage(previous, 2, pointer);
  assert.equal((pointer.x - next.x) / next.scale, (pointer.x - previous.x) / previous.scale);
  assert.equal((pointer.y - next.y) / next.scale, (pointer.y - previous.y) / previous.scale);
});

test("pan stops at image edges and recenters axes smaller than the viewport", () => {
  assert.deepEqual(constrainImage({ scale: 2, x: 1000, y: -1000 }, { width: 500, height: 300 }, { width: 600, height: 600 }), { scale: 2, x: 200, y: 0 });
  assert.deepEqual(constrainImage({ scale: 0.5, x: 60, y: 70 }, { width: 500, height: 300 }, { width: 600, height: 600 }), { scale: 0.5, x: 0, y: 0 });
});
