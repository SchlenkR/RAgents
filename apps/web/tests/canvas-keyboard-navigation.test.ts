import assert from "node:assert/strict";
import test from "node:test";
import { createKeyboardNavigation, nextCanvasElement } from "../../../plugins/ragents.orchestration/web/keyboard-navigation.ts";

const box = (id: string, x: number, y: number, width = 100, height = 100) => ({ id, left: x, top: y, right: x + width, bottom: y + height });

test("arrows choose spatial neighbors in the same row or column before diagonal elements", () => {
  const current = box("center", 300, 300);
  const elements = [current, box("right", 700, 300), box("left", 0, 300), box("above", 300, 0), box("below", 300, 700), box("diagonal", 410, 410)];
  for (const [key, id] of [["ArrowLeft", "left"], ["ArrowRight", "right"], ["ArrowUp", "above"], ["ArrowDown", "below"]]) {
    assert.equal(nextCanvasElement(elements, current, key!, current.id)?.id, id);
  }
  assert.equal(nextCanvasElement(elements, current, "Enter", current.id), undefined);
  assert.equal(nextCanvasElement([current], current, "ArrowRight", current.id), undefined);
});

test("directional navigation falls back to the closest diagonal and works from a viewport point", () => {
  const current = box("center", 0, 0);
  const elements = [current, box("near", 120, 110), box("far", 250, 300), box("behind", -110, 0)];
  assert.equal(nextCanvasElement(elements, current, "ArrowRight", current.id)?.id, "near");
  assert.equal(nextCanvasElement(elements, { left: 90, right: 90, top: 90, bottom: 90 }, "ArrowDown")?.id, "near");
  assert.equal(nextCanvasElement(elements, current, "ArrowUp", current.id), undefined);
});

test("keyboard panning eases over 300 ms, handles repeats without a queue, and yields to other gestures", (t) => {
  let time = 0;
  let nextId = 0;
  const frames = new Map<number, FrameRequestCallback>();
  const originalRequest = globalThis.requestAnimationFrame;
  const originalCancel = globalThis.cancelAnimationFrame;
  globalThis.requestAnimationFrame = (callback) => { const id = ++nextId; frames.set(id, callback); return id; };
  globalThis.cancelAnimationFrame = (id) => { frames.delete(id); };
  t.after(() => { globalThis.requestAnimationFrame = originalRequest; globalThis.cancelAnimationFrame = originalCancel; });
  t.mock.method(performance, "now", () => time);
  const tick = (nextTime: number) => {
    time = nextTime;
    const callbacks = [...frames.values()];
    frames.clear();
    callbacks.forEach((callback) => callback(time));
  };
  let camera = { x: 20, y: 10, zoom: 0.5 };
  const pan = createKeyboardNavigation(() => camera, (next) => { camera = next; });
  const destination = { x: -280, y: 10, zoom: 0.5 };
  pan.moveTo(destination, false, false);
  assert.deepEqual(camera, { x: 20, y: 10, zoom: 0.5 });
  tick(75);
  const firstQuarter = 20 - camera.x;
  tick(150);
  assert.equal(camera.x, -130);
  assert.ok(firstQuarter < 75, "starts slower than linear motion");
  for (let i = 0; i < 20; i++) pan.moveTo({ x: -580, y: 10, zoom: 0.5 }, true, false);
  tick(225);
  assert.ok(-280 < camera.x && camera.x < -205, "slows toward the target");
  tick(300);
  assert.deepEqual(camera, { x: -280, y: 10, zoom: 0.5 });
  assert.equal(frames.size, 0, "held-key repeats did not create a backlog");
  pan.moveTo({ x: -580, y: 10, zoom: 0.5 }, true, false);
  tick(450);
  assert.equal(camera.x, -430, "holding continues with the next step");
  pan.cancel();
  camera = { x: 100, y: 50, zoom: 2 };
  tick(900);
  assert.deepEqual(camera, { x: 100, y: 50, zoom: 2 }, "cancelled frames cannot undo another camera action");

  pan.moveTo({ x: -200, y: 50, zoom: 2 }, false, false);
  tick(1050);
  const before = camera.x;
  pan.moveTo({ x: -500, y: 50, zoom: 2 }, false, false);
  assert.equal(camera.x, before, "a second press does not jump");
  tick(1350);
  assert.equal(camera.x, -500, "a second press centers the new destination");
  assert.equal(camera.zoom, 2);

  pan.moveTo({ x: -500, y: -130, zoom: 2 }, false, true);
  assert.deepEqual(camera, { x: -500, y: -130, zoom: 2 });
  assert.equal(frames.size, 0, "reduced motion moves directly without animation");
  pan.moveTo({ x: -500, y: -310, zoom: 2 }, true, true);
  assert.equal(camera.y, -130, "reduced motion still throttles held keys");
});
