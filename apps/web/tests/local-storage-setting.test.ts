import assert from "node:assert/strict";
import test from "node:test";
import { subscribeStorageChanges } from "../src/lib/local-storage-setting";
import { actorHeaderStorageKey, saveActorHeaderMode } from "../../../plugins/ragents.orchestration/web/actor-header-settings";
import { canvasViewStorageKey, DEFAULT_CANVAS_VIEW_PREFERENCES, saveCanvasViewPreferences } from "../../../plugins/ragents.orchestration/web/canvas-view-settings";
import { ACTOR_CARD_SIZE_STORAGE_KEY, saveActorCardSize } from "../../../plugins/ragents.orchestration/web/card-size-settings";
import { PINCH_ZOOM_STORAGE_KEY, savePinchZoomSensitivity } from "../../../plugins/ragents.orchestration/web/zoom-settings";

test("storage subscriptions accept their keys and clear events and remove their listener", () => {
  const browser = new EventTarget() as unknown as Window;
  const keys: (string | null)[] = [];
  const unsubscribe = subscribeStorageChanges(browser, (key) => key.startsWith("setting:"), (event) => keys.push(event.key));
  const change = (key: string | null) => browser.dispatchEvent(Object.assign(new Event("storage"), { key }));
  change("setting:first");
  change("unrelated");
  change("setting:second");
  change(null);
  assert.deepEqual(keys, ["setting:first", "setting:second", null]);
  unsubscribe();
  change("setting:third");
  assert.equal(keys.length, 3);
});

function settingsBrowser() {
  const values = new Map<string, string>();
  const notifications: string[] = [];
  const browser = Object.assign(new EventTarget(), {
    localStorage: {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => { values.set(key, value); },
    },
  });
  for (const event of ["ragents-actor-header-change", "ragents-canvas-view-change", "ragents-actor-card-size-change", "ragents-pinch-zoom-change"]) {
    browser.addEventListener(event, () => notifications.push(event));
  }
  return { browser, values, notifications };
}

test("orchestration settings keep their formats, run scopes and same-tab change events", (context) => {
  const { browser, values, notifications } = settingsBrowser();
  const previous = Object.getOwnPropertyDescriptor(globalThis, "window");
  Object.defineProperty(globalThis, "window", { configurable: true, value: browser });
  context.after(() => {
    if (previous) Object.defineProperty(globalThis, "window", previous);
    else Reflect.deleteProperty(globalThis, "window");
  });

  saveActorHeaderMode("first", "agent");
  saveActorHeaderMode("second", "script");
  saveCanvasViewPreferences("first", DEFAULT_CANVAS_VIEW_PREFERENCES);
  saveActorCardSize({ width: 500, height: 320 });
  savePinchZoomSensitivity(3.5);
  assert.deepEqual(values, new Map([
    [actorHeaderStorageKey("first"), "agent"],
    [actorHeaderStorageKey("second"), "script"],
    [canvasViewStorageKey("first"), JSON.stringify(DEFAULT_CANVAS_VIEW_PREFERENCES)],
    [ACTOR_CARD_SIZE_STORAGE_KEY, '{"width":500,"height":320}'],
    [PINCH_ZOOM_STORAGE_KEY, "3.5"],
  ]));
  assert.deepEqual(notifications, ["ragents-actor-header-change", "ragents-actor-header-change", "ragents-canvas-view-change", "ragents-actor-card-size-change", "ragents-pinch-zoom-change"]);

  const stored = new Map(values);
  assert.throws(() => saveActorHeaderMode("first", "invalid" as "all"), /ungültig/);
  assert.throws(() => saveCanvasViewPreferences("first", { ...DEFAULT_CANVAS_VIEW_PREFERENCES, showConnections: "false" as unknown as boolean }), /ungültig/);
  assert.throws(() => saveActorCardSize({ width: 200, height: 320 }), /ungültig/);
  assert.throws(() => saveActorCardSize({ width: 500, height: 180 }), /mindestens 260/);
  assert.throws(() => savePinchZoomSensitivity(11), /zwischen/);
  assert.deepEqual(values, stored);
  assert.equal(notifications.length, 5);

  browser.localStorage.setItem = () => { throw new Error("Speicher voll"); };
  for (const save of [
    () => saveActorHeaderMode("first", "all"),
    () => saveCanvasViewPreferences("first", DEFAULT_CANVAS_VIEW_PREFERENCES),
    () => saveActorCardSize({ width: 500, height: 320 }),
    () => savePinchZoomSensitivity(2),
  ]) assert.throws(save, /Speicher voll/);
  assert.deepEqual(values, stored);
  assert.equal(notifications.length, 5);
});
