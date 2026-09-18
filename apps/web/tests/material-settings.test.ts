import assert from "node:assert/strict";
import test from "node:test";
import { createMaterialSettingsStore, DEFAULT_MATERIAL_SETTINGS, MATERIAL_SETTINGS_STORAGE_KEY, parseMaterialSettings } from "../src/material-settings";

function browserFixture(initial: string | null = null) {
  let value = initial, writes = 0;
  let readError = false, writeError = false;
  const storage = {
    getItem: (key: string) => { assert.equal(key, MATERIAL_SETTINGS_STORAGE_KEY); if (readError) throw Error("Lesen gesperrt"); return value; },
    setItem: (key: string, next: string) => { assert.equal(key, MATERIAL_SETTINGS_STORAGE_KEY); if (writeError) throw Error("Speicher voll"); writes++; value = next; },
    removeItem: (key: string) => { assert.equal(key, MATERIAL_SETTINGS_STORAGE_KEY); if (writeError) throw Error("Löschen gesperrt"); writes++; value = null; },
  };
  const target = Object.assign(new EventTarget(), { localStorage: storage });
  return {
    browser: target as unknown as Window, stored: () => value, writes: () => writes,
    denyReads: (next: boolean) => { readError = next; }, denyWrites: (next: boolean) => { writeError = next; },
    otherTab: (next: string | null, key: string | null = MATERIAL_SETTINGS_STORAGE_KEY, storageArea: unknown = storage) => {
      value = next;
      target.dispatchEvent(Object.assign(new Event("storage"), { key, storageArea, newValue: next }));
    },
  };
}
const custom = { steps: 4 };

test("material defaults use one fixed step and validation rejects incomplete, fractional and out-of-range values", () => {
  const fixture = browserFixture();
  const store = createMaterialSettingsStore(fixture.browser);
  assert.deepEqual(store.getSnapshot(), { settings: { steps: 1 } });
  assert.equal(fixture.writes(), 0);
  for (const settings of [{ steps: 0 }, { steps: 5 }])
    assert.deepEqual(parseMaterialSettings(JSON.stringify(settings)), settings);
  for (const value of ["", "null", "[]", "{}", JSON.stringify({ ...custom, steps: -1 }), JSON.stringify({ ...custom, steps: 6 }),
    JSON.stringify({ ...custom, steps: 2.5 }), JSON.stringify({ ...custom, steps: "3" })]) assert.throws(() => parseMaterialSettings(value));
  store.dispose();
});

test("save immediately updates all consumers, keeps snapshots stable and survives a new run store", () => {
  const fixture = browserFixture();
  const store = createMaterialSettingsStore(fixture.browser);
  let first = 0, second = 0;
  const unsubscribe = store.subscribe(() => { first++; });
  store.subscribe(() => { second++; });
  store.save(custom);
  assert.deepEqual(store.getSnapshot(), { settings: custom });
  assert.deepEqual(JSON.parse(fixture.stored()!), custom);
  assert.equal(first, 1); assert.equal(second, 1);
  const snapshot = store.getSnapshot();
  store.save({ ...custom });
  assert.equal(store.getSnapshot(), snapshot); assert.equal(first, 1);
  unsubscribe();
  store.save({ ...custom, steps: 5 });
  assert.equal(first, 1); assert.equal(second, 2);
  const restored = createMaterialSettingsStore(fixture.browser);
  assert.deepEqual(restored.getSnapshot(), store.getSnapshot());
  restored.dispose(); store.dispose();
});

test("other tabs synchronize steps and clear without writeback", () => {
  const fixture = browserFixture();
  const store = createMaterialSettingsStore(fixture.browser);
  fixture.otherTab(JSON.stringify(custom));
  assert.deepEqual(store.getSnapshot().settings, custom);
  fixture.otherTab(null, null);
  assert.deepEqual(store.getSnapshot().settings, DEFAULT_MATERIAL_SETTINGS);
  fixture.otherTab(JSON.stringify(custom), "unrelated");
  assert.deepEqual(store.getSnapshot().settings, DEFAULT_MATERIAL_SETTINGS);
  fixture.otherTab(JSON.stringify(custom), MATERIAL_SETTINGS_STORAGE_KEY, {});
  assert.deepEqual(store.getSnapshot().settings, DEFAULT_MATERIAL_SETTINGS);
  assert.equal(fixture.writes(), 0); store.dispose();
});

test("corrupt initial or cross-tab storage reports errors and recovers through reset or valid data", () => {
  const fixture = browserFixture("broken");
  const store = createMaterialSettingsStore(fixture.browser);
  assert.match(store.getSnapshot().error!, /nicht geladen.*Standardwerte/);
  assert.equal(fixture.stored(), "broken");
  assert.equal(store.reset(), true);
  assert.equal(store.getSnapshot().error, undefined); assert.equal(fixture.stored(), null);
  store.save(custom);
  fixture.otherTab("{}");
  assert.deepEqual(store.getSnapshot().settings, custom);
  assert.match(store.getSnapshot().error!, /anderen Browser-Tab/);
  fixture.otherTab(JSON.stringify(DEFAULT_MATERIAL_SETTINGS));
  assert.equal(store.getSnapshot().error, undefined); store.dispose();
});

test("read and write failures keep active values unchanged and stay visible until storage recovers", () => {
  const fixture = browserFixture(JSON.stringify(custom));
  fixture.denyReads(true);
  const initiallyBlocked = createMaterialSettingsStore(fixture.browser);
  assert.match(initiallyBlocked.getSnapshot().error!, /Lesen gesperrt/);
  initiallyBlocked.dispose(); fixture.denyReads(false);
  const store = createMaterialSettingsStore(fixture.browser);
  fixture.denyWrites(true); store.save(DEFAULT_MATERIAL_SETTINGS);
  assert.deepEqual(store.getSnapshot().settings, custom);
  assert.deepEqual(JSON.parse(fixture.stored()!), custom);
  assert.match(store.getSnapshot().error!, /nicht gespeichert.*Speicher voll/);
  assert.equal(store.reset(), false);
  assert.deepEqual(store.getSnapshot().settings, custom);
  assert.match(store.getSnapshot().error!, /nicht zurückgesetzt.*Löschen gesperrt/);
  fixture.denyWrites(false); assert.equal(store.reset(), true);
  assert.deepEqual(store.getSnapshot(), { settings: DEFAULT_MATERIAL_SETTINGS });
  assert.equal(fixture.stored(), null); store.dispose();
});

test("invalid saves never write and disposed stores stop reacting to storage changes", () => {
  const fixture = browserFixture();
  const store = createMaterialSettingsStore(fixture.browser);
  store.save({ ...custom, steps: Number.NaN });
  assert.equal(fixture.writes(), 0);
  assert.match(store.getSnapshot().error!, /Ungültiges Material/);
  store.dispose(); const snapshot = store.getSnapshot();
  fixture.otherTab(JSON.stringify(custom));
  assert.equal(store.getSnapshot(), snapshot);
  assert.throws(() => store.save(custom), /bereits beendet/);
  assert.throws(() => store.reset(), /bereits beendet/);
});
