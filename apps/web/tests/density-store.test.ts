import assert from "node:assert/strict";
import test from "node:test";
import { createThemeStore, THEME_STORAGE_KEY } from "../src/theme";
import { DENSITY_STORAGE_KEY, parseTableDensity, type TableDensity } from "../src/table-density";

function browserFixture(saved?: string) {
  const values = new Map<string, string>(saved === undefined ? [] : [[DENSITY_STORAGE_KEY, saved]]);
  const writes: Array<{ key: string; value: string }> = [];
  let denied = false;
  const storage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      if (denied) throw new Error("Storage is full");
      values.set(key, value);
      writes.push({ key, value });
    },
  };
  const target = Object.assign(new EventTarget(), {
    localStorage: storage,
    document: { documentElement: { dataset: {} as Record<string, string> } },
    matchMedia: () => Object.assign(new EventTarget(), { matches: false }),
  });
  const otherTab = (value: string | null, key: string | null = DENSITY_STORAGE_KEY, area: unknown = storage) => {
    if (key === null) values.clear();
    else if (value === null) values.delete(key);
    else values.set(key, value);
    target.dispatchEvent(Object.assign(new Event("storage"), { key, storageArea: area, newValue: value }));
  };
  return { browser: target as unknown as Window, target, storage, values, writes, otherTab,
    denyWrites: (next: boolean) => { denied = next; } };
}

test("table spacing starts comfortable and applies every saved choice without writing at bootstrap", () => {
  for (const saved of [undefined, "compact", "comfortable", "spacious"]) {
    const fixture = browserFixture(saved);
    const store = createThemeStore(fixture.browser);
    const density = saved ?? "comfortable";
    assert.equal(store.getSnapshot().density, density);
    assert.equal(fixture.target.document.documentElement.dataset.density, density);
    assert.equal(fixture.values.get(DENSITY_STORAGE_KEY), saved);
    assert.deepEqual(fixture.writes, []);
    store.dispose();
  }
});

test("table spacing is saved independently of the color scheme and survives reinitialization", () => {
  const fixture = browserFixture();
  const store = createThemeStore(fixture.browser);
  store.setPreference("light");
  for (const density of ["compact", "spacious", "comfortable"] as const) {
    store.setDensity(density);
    assert.equal(store.getSnapshot().density, density);
    assert.equal(store.getSnapshot().appearance, "light");
    assert.equal(fixture.values.get(DENSITY_STORAGE_KEY), density);
    assert.equal(fixture.values.get(THEME_STORAGE_KEY), "light");
    assert.equal(fixture.target.document.documentElement.dataset.density, density);
  }
  store.setDensity("spacious");
  store.dispose();
  const restored = createThemeStore(fixture.browser);
  assert.equal(restored.getSnapshot().density, "spacious");
  assert.equal(restored.getSnapshot().appearance, "light");
  restored.dispose();
});

test("table spacing follows other tabs and deleted settings without writing back", () => {
  const fixture = browserFixture("compact");
  const store = createThemeStore(fixture.browser);
  fixture.otherTab("spacious");
  assert.equal(store.getSnapshot().density, "spacious");
  fixture.otherTab(null);
  assert.equal(store.getSnapshot().density, "comfortable");
  fixture.otherTab("compact");
  fixture.otherTab(null, null);
  assert.equal(store.getSnapshot().density, "comfortable");
  fixture.otherTab("compact", "another.setting");
  fixture.otherTab("spacious", DENSITY_STORAGE_KEY, {});
  assert.equal(store.getSnapshot().density, "comfortable");
  assert.deepEqual(fixture.writes, []);
  store.dispose();
});

test("invalid saved table spacing aborts bootstrap; an invalid external choice preserves the active density", () => {
  for (const value of ["", "Compact", "large", "null"]) {
    assert.throws(() => parseTableDensity(value), /Allowed are compact, comfortable, and spacious/);
    assert.throws(() => createThemeStore(browserFixture(value).browser), /saved theme.*Invalid table spacing/);
  }
  const fixture = browserFixture("compact");
  const store = createThemeStore(fixture.browser);
  fixture.otherTab("invalid");
  assert.equal(store.getSnapshot().density, "compact");
  assert.equal(fixture.target.document.documentElement.dataset.density, "compact");
  assert.match(store.getSnapshot().error!, /another browser tab.*Invalid table spacing/);
  fixture.otherTab("spacious");
  assert.equal(store.getSnapshot().density, "spacious");
  assert.equal(store.getSnapshot().error, null);
  store.dispose();
});

test("a refused table spacing write preserves the saved choice and a retry clears the error", () => {
  const fixture = browserFixture("comfortable");
  const store = createThemeStore(fixture.browser);
  fixture.denyWrites(true);
  store.setDensity("compact");
  assert.equal(store.getSnapshot().density, "comfortable");
  assert.equal(fixture.values.get(DENSITY_STORAGE_KEY), "comfortable");
  assert.equal(fixture.target.document.documentElement.dataset.density, "comfortable");
  assert.match(store.getSnapshot().error!, /table spacing could not be saved.*Storage is full/);
  fixture.denyWrites(false);
  store.setDensity("compact");
  assert.equal(store.getSnapshot().density, "compact");
  assert.equal(store.getSnapshot().error, null);
  store.setDensity("invalid" as TableDensity);
  assert.equal(store.getSnapshot().density, "compact");
  assert.equal(fixture.values.get(DENSITY_STORAGE_KEY), "compact");
  store.dispose();
  assert.throws(() => store.setDensity("spacious"), /already been disposed/);
});
