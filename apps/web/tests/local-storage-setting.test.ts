import assert from "node:assert/strict";
import test from "node:test";
import { subscribeStorageChanges } from "../src/lib/local-storage-setting";
import { actorHeaderStorageKey, saveActorHeaderMode } from "../../../plugins/ragents.orchestration/web/actor-header-settings";
import { surfaceViewStorageKey, DEFAULT_SURFACE_VIEW_PREFERENCES, saveSurfaceViewPreferences } from "../../../plugins/ragents.orchestration/web/surface-view-settings";
import { surfacePresentationStorageKey, saveSurfacePresentation } from "../../../plugins/ragents.orchestration/web/tiled-view-settings";

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
  for (const event of ["ragents-actor-header-change", "ragents-actor-visibility-change", "ragents-tile-presentation-change"]) {
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
  saveSurfaceViewPreferences("first", DEFAULT_SURFACE_VIEW_PREFERENCES);
  saveSurfacePresentation("first", { root: { entity: "@anna" } });
  assert.deepEqual(values, new Map([
    [actorHeaderStorageKey("first"), "agent"],
    [actorHeaderStorageKey("second"), "script"],
    [surfaceViewStorageKey("first"), JSON.stringify(DEFAULT_SURFACE_VIEW_PREFERENCES)],
    [surfacePresentationStorageKey("first"), '{"root":{"entity":"@anna"}}'],
  ]));
  assert.deepEqual(notifications, ["ragents-actor-header-change", "ragents-actor-header-change", "ragents-actor-visibility-change", "ragents-tile-presentation-change"]);

  const stored = new Map(values);
  assert.throws(() => saveActorHeaderMode("first", "invalid" as "all"), /ungültig/);
  assert.throws(() => saveSurfaceViewPreferences("first", { actorVisibility: { anna: "no" as unknown as boolean } }), /ungültig/);
  assert.throws(() => saveSurfacePresentation("first", { root: { entity: "shape:thema" } }), /erwartet @handle oder app:/);
  assert.deepEqual(values, stored);
  assert.equal(notifications.length, 4);

  browser.localStorage.setItem = () => { throw new Error("Speicher voll"); };
  for (const save of [
    () => saveActorHeaderMode("first", "all"),
    () => saveSurfaceViewPreferences("first", DEFAULT_SURFACE_VIEW_PREFERENCES),
    () => saveSurfacePresentation("first", { root: { entity: "@anna" } }),
  ]) assert.throws(save, /Speicher voll/);
  assert.deepEqual(values, stored);
  assert.equal(notifications.length, 4);
});
