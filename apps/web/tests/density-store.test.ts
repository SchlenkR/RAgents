import assert from "node:assert/strict";
import test from "node:test";
import { createChoiceStore, parseAppearanceValue } from "../src/appearance";
import { appearanceChoices, type AppearanceValue } from "../src/appearance-options";
import { createThemeStore, THEME_STORAGE_KEY } from "../src/theme";

const DENSITY_STORAGE_KEY = appearanceChoices.density.storageKey;

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
    const store = createChoiceStore(fixture.browser, "density");
    const density = saved ?? "comfortable";
    assert.equal(store.getSnapshot().value, density);
    assert.equal(fixture.target.document.documentElement.dataset.density, density);
    assert.equal(fixture.values.get(DENSITY_STORAGE_KEY), saved);
    assert.deepEqual(fixture.writes, []);
    store.dispose();
  }
});

test("table spacing is saved independently of the color scheme and survives reinitialization", () => {
  const fixture = browserFixture();
  const theme = createThemeStore(fixture.browser);
  const store = createChoiceStore(fixture.browser, "density");
  theme.setPreference("light");
  for (const density of ["compact", "spacious", "comfortable"] as const) {
    store.set(density);
    assert.equal(store.getSnapshot().value, density);
    assert.equal(theme.getSnapshot().appearance, "light");
    assert.equal(fixture.values.get(DENSITY_STORAGE_KEY), density);
    assert.equal(fixture.values.get(THEME_STORAGE_KEY), "light");
    assert.equal(fixture.target.document.documentElement.dataset.density, density);
  }
  store.set("spacious");
  store.dispose();
  theme.dispose();
  const restored = createChoiceStore(fixture.browser, "density");
  const restoredTheme = createThemeStore(fixture.browser);
  assert.equal(restored.getSnapshot().value, "spacious");
  assert.equal(restoredTheme.getSnapshot().appearance, "light");
  restored.dispose();
  restoredTheme.dispose();
});

test("table spacing follows other tabs and deleted settings without writing back", () => {
  const fixture = browserFixture("compact");
  const store = createChoiceStore(fixture.browser, "density");
  fixture.otherTab("spacious");
  assert.equal(store.getSnapshot().value, "spacious");
  fixture.otherTab(null);
  assert.equal(store.getSnapshot().value, "comfortable");
  fixture.otherTab("compact");
  fixture.otherTab(null, null);
  assert.equal(store.getSnapshot().value, "comfortable");
  fixture.otherTab("compact", "another.setting");
  fixture.otherTab("spacious", DENSITY_STORAGE_KEY, {});
  assert.equal(store.getSnapshot().value, "comfortable");
  assert.deepEqual(fixture.writes, []);
  store.dispose();
});

test("invalid saved table spacing aborts bootstrap; an invalid external choice preserves the active density", () => {
  for (const value of ["", "Compact", "large", "null"]) {
    assert.throws(() => parseAppearanceValue("density", value), /Allowed are compact, comfortable, spacious/);
    assert.throws(() => createChoiceStore(browserFixture(value).browser, "density"), /saved table spacing.*Invalid table spacing/);
  }
  const fixture = browserFixture("compact");
  const store = createChoiceStore(fixture.browser, "density");
  fixture.otherTab("invalid");
  assert.equal(store.getSnapshot().value, "compact");
  assert.equal(fixture.target.document.documentElement.dataset.density, "compact");
  assert.match(store.getSnapshot().error!, /another browser tab.*Invalid table spacing/);
  fixture.otherTab("spacious");
  assert.equal(store.getSnapshot().value, "spacious");
  assert.equal(store.getSnapshot().error, null);
  store.dispose();
});

test("a refused table spacing write preserves the saved choice and a retry clears the error", () => {
  const fixture = browserFixture("comfortable");
  const store = createChoiceStore(fixture.browser, "density");
  fixture.denyWrites(true);
  store.set("compact");
  assert.equal(store.getSnapshot().value, "comfortable");
  assert.equal(fixture.values.get(DENSITY_STORAGE_KEY), "comfortable");
  assert.equal(fixture.target.document.documentElement.dataset.density, "comfortable");
  assert.match(store.getSnapshot().error!, /table spacing could not be saved.*Storage is full/);
  fixture.denyWrites(false);
  store.set("compact");
  assert.equal(store.getSnapshot().value, "compact");
  assert.equal(store.getSnapshot().error, null);
  store.set("invalid" as AppearanceValue<"density">);
  assert.equal(store.getSnapshot().value, "compact");
  assert.equal(fixture.values.get(DENSITY_STORAGE_KEY), "compact");
  store.dispose();
  assert.throws(() => store.set("spacious"), /already been disposed/);
});
