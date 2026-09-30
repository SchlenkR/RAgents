import assert from "node:assert/strict";
import test from "node:test";
import { subscribeStorageChanges } from "../src/lib/local-storage-setting";

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
