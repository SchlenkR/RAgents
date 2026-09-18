import assert from "node:assert/strict";
import test from "node:test";
import {
  canvasLayoutStorageKey, parseCanvasCamera, parseCanvasElementSizes,
} from "../../../plugins/ragents.orchestration/web/canvas-layout-storage.ts";

test("camera and element storage remain separate for each run", () => {
  const keys = ["first", "second"].flatMap((runId) =>
    [canvasLayoutStorageKey(runId, "camera"), canvasLayoutStorageKey(runId, "elements")]);
  assert.equal(new Set(keys).size, 4);
});

test("an unopened run starts without a saved camera or element overrides", () => {
  assert.equal(parseCanvasCamera(null), undefined);
  assert.deepEqual(parseCanvasElementSizes(null), {
    canvasSizes: [], actorSizes: [], expandedActors: [], collapsedElements: [],
  });
});

test("camera serialization preserves negative panning, fractional coordinates and zoom", () => {
  for (const zoom of [Number.MIN_VALUE, 0.125, 1, 2.5]) {
    const camera = { x: -281.75, y: 104.125, zoom };
    assert.deepEqual(parseCanvasCamera(JSON.stringify(camera)), camera);
  }
});

test("element serialization restores map sizes and collapsed or expanded controls", () => {
  const canvasSizes = new Map([["canvas:[\"views\",\"app\"]", { width: 620.5, height: 380.25 }]]);
  const actorSizes = new Map([["worker", { width: 400, height: 520 }]]);
  const expandedActors = new Set(["worker"]);
  const collapsedElements = new Set(["canvas:[\"views\",\"app\"]"]);
  const saved = parseCanvasElementSizes(JSON.stringify({
    canvasSizes: [...canvasSizes], actorSizes: [...actorSizes],
    expandedActors: [...expandedActors], collapsedElements: [...collapsedElements],
  }));
  assert.deepEqual(new Map(saved.canvasSizes), canvasSizes);
  assert.deepEqual(new Map(saved.actorSizes), actorSizes);
  assert.deepEqual(new Set(saved.expandedActors), expandedActors);
  assert.deepEqual(new Set(saved.collapsedElements), collapsedElements);
});

test("invalid cameras fail explicitly without replacing the stored view", () => {
  for (const value of [null, [], {}, { x: 0, y: 0 },
    ...[0, -1, 2.51, "1", null].map((zoom) => ({ x: 0, y: 0, zoom })),
    { x: "0", y: 0, zoom: 1 }, { x: 0, y: null, zoom: 1 },
  ]) assert.throws(() => parseCanvasCamera(JSON.stringify(value)), /ungültig/);
  assert.throws(() => parseCanvasCamera('{"x":1e400,"y":0,"zoom":1}'), /ungültig/);
  assert.throws(() => parseCanvasCamera("broken"));
});

test("invalid element dimensions and control identifiers fail explicitly", () => {
  const empty = { canvasSizes: [], actorSizes: [], expandedActors: [], collapsedElements: [] };
  for (const field of ["canvasSizes", "actorSizes"]) {
    for (const entries of [{}, [["app"]], [[1, { width: 100, height: 100 }]],
      [["app", { width: 0, height: 100 }]], [["app", { width: 100, height: -1 }]],
      [["app", { width: "100", height: 100 }]], [["app", { width: 100 }]],
    ]) assert.throws(() => parseCanvasElementSizes(JSON.stringify({ ...empty, [field]: entries })), /ungültig/);
  }
  for (const field of ["expandedActors", "collapsedElements"]) {
    for (const entries of [{}, [null], [1]]) {
      assert.throws(() => parseCanvasElementSizes(JSON.stringify({ ...empty, [field]: entries })), /ungültig/);
    }
  }
  for (const value of [null, [], {}]) {
    assert.throws(() => parseCanvasElementSizes(JSON.stringify(value)), /ungültig/);
  }
  assert.throws(() => parseCanvasElementSizes("broken"));
});
