import { strict as assert } from "node:assert";
import { test } from "node:test";
import { createThemeStore, parseThemePreference, THEME_STORAGE_KEY } from "../src/theme";

class TrackedEvents extends EventTarget {
  readonly handlers = new Map<string, Set<EventListenerOrEventListenerObject>>();
  override addEventListener(type: string, listener: EventListenerOrEventListenerObject | null, options?: AddEventListenerOptions | boolean) {
    if (listener) {
      const entries = this.handlers.get(type) ?? new Set<EventListenerOrEventListenerObject>();
      entries.add(listener);
      this.handlers.set(type, entries);
    }
    super.addEventListener(type, listener, options);
  }
  override removeEventListener(type: string, listener: EventListenerOrEventListenerObject | null, options?: EventListenerOptions | boolean) {
    if (listener) this.handlers.get(type)?.delete(listener);
    super.removeEventListener(type, listener, options);
  }
  listenerCount(type: string) { return this.handlers.get(type)?.size ?? 0; }
}

function browserFixture(stored: string | null = null, dark = false) {
  let value = stored;
  let writes = 0;
  let writeError: Error | undefined;
  let readError: Error | undefined;
  const storage = {
    getItem: (key: string) => {
      assert.equal(key, THEME_STORAGE_KEY);
      if (readError) throw readError;
      return value;
    },
    setItem: (key: string, next: string) => {
      assert.equal(key, THEME_STORAGE_KEY);
      if (writeError) throw writeError;
      writes++;
      value = next;
    },
  };
  const media = Object.assign(new TrackedEvents(), { matches: dark });
  const target = Object.assign(new TrackedEvents(), {
    localStorage: storage,
    document: { documentElement: { dataset: {} as Record<string, string> } },
    matchMedia: (query: string) => {
      assert.equal(query, "(prefers-color-scheme: dark)");
      return media;
    },
  });
  return {
    browser: target as unknown as Window,
    target,
    media,
    storage,
    stored: () => value,
    writes: () => writes,
    applied: () => target.document.documentElement.dataset.theme,
    denyWrites: () => { writeError = new Error("Browser storage is full"); },
    allowWrites: () => { writeError = undefined; },
    denyReads: () => { readError = new Error("Browser storage is blocked"); },
    systemDark: (next: boolean) => {
      media.matches = next;
      media.dispatchEvent(new Event("change"));
    },
    otherTab: (next: string | null, key: string | null = THEME_STORAGE_KEY, storageArea: unknown = storage) => {
      value = next;
      target.dispatchEvent(Object.assign(new Event("storage"), { key, storageArea, newValue: next }));
    },
  };
}

test("the interface starts dark without changing the system preference or the browser storage", () => {
  const fixture = browserFixture(null, false);
  const store = createThemeStore(fixture.browser);
  assert.deepEqual(store.getSnapshot(), { preference: "dark", appearance: "dark", error: null });
  assert.equal(fixture.applied(), "dark");
  assert.equal(fixture.stored(), null);
  assert.equal(fixture.writes(), 0);
  assert.equal(fixture.media.listenerCount("change"), 0);
  store.dispose();
});

test("the saved theme is applied right at bootstrap", () => {
  for (const [preference, systemDark, appearance] of [
    ["light", true, "light"], ["dark", false, "dark"], ["system", true, "dark"], ["system", false, "light"],
  ] as const) {
    const fixture = browserFixture(preference, systemDark);
    const store = createThemeStore(fixture.browser);
    assert.deepEqual(store.getSnapshot(), { preference, appearance, error: null });
    assert.equal(fixture.applied(), appearance);
    store.dispose();
  }
});

test("only system follows ongoing preference changes and has an active listener for it", () => {
  const fixture = browserFixture("system");
  const store = createThemeStore(fixture.browser);
  let updates = 0;
  store.subscribe(() => { updates++; });
  assert.equal(fixture.media.listenerCount("change"), 1);
  fixture.systemDark(true);
  assert.equal(fixture.applied(), "dark");
  assert.equal(store.getSnapshot().preference, "system");
  assert.equal(updates, 1);
  fixture.systemDark(true);
  assert.equal(updates, 1);
  store.setPreference("light");
  assert.equal(fixture.applied(), "light");
  assert.equal(fixture.media.listenerCount("change"), 0);
  fixture.systemDark(false);
  fixture.systemDark(true);
  assert.equal(fixture.applied(), "light");
  store.setPreference("system");
  assert.equal(fixture.applied(), "dark");
  assert.equal(fixture.media.listenerCount("change"), 1);
  assert.equal(fixture.stored(), "system");
  store.dispose();
});

test("browser tabs sync the theme and deleted settings without writing back", () => {
  const fixture = browserFixture();
  const store = createThemeStore(fixture.browser);
  fixture.otherTab("light");
  assert.equal(fixture.applied(), "light");
  fixture.otherTab("system");
  assert.equal(store.getSnapshot().preference, "system");
  assert.equal(fixture.media.listenerCount("change"), 1);
  fixture.otherTab(null, null);
  assert.equal(fixture.applied(), "dark");
  assert.equal(store.getSnapshot().preference, "dark");
  assert.equal(fixture.media.listenerCount("change"), 0);
  assert.equal(fixture.writes(), 0);
  fixture.otherTab("light", "another.setting");
  assert.equal(fixture.applied(), "dark");
  fixture.otherTab("light", THEME_STORAGE_KEY, {});
  assert.equal(fixture.applied(), "dark");
  store.dispose();
});

test("invalid values and blocked storage abort the initialization with a specific message", () => {
  for (const value of ["", "LIGHT", "sepia", "null"]) {
    assert.throws(() => parseThemePreference(value), /Allowed are light, dark, and system/);
    const fixture = browserFixture(value);
    assert.throws(() => createThemeStore(fixture.browser), /The saved theme could not be loaded/);
    assert.equal(fixture.applied(), undefined);
    assert.equal(fixture.target.listenerCount("storage"), 0);
  }
  const fixture = browserFixture();
  fixture.denyReads();
  assert.throws(() => createThemeStore(fixture.browser), /Browser storage is blocked/);
});

test("a storage error stays visible and leaves the saved and active choice unchanged", () => {
  const fixture = browserFixture("dark");
  const store = createThemeStore(fixture.browser);
  fixture.denyWrites();
  store.setPreference("light");
  assert.equal(fixture.applied(), "dark");
  assert.equal(fixture.stored(), "dark");
  assert.equal(store.getSnapshot().preference, "dark");
  assert.match(store.getSnapshot().error!, /The theme could not be saved.*Browser storage is full/);
  fixture.allowWrites();
  store.setPreference("light");
  assert.equal(store.getSnapshot().error, null);
  assert.equal(fixture.stored(), "light");
  assert.equal(fixture.applied(), "light");
  store.dispose();
});

test("a corrupted value from another tab is reported as an error and never applied as a theme", () => {
  const fixture = browserFixture("dark");
  const store = createThemeStore(fixture.browser);
  fixture.otherTab("sepia");
  assert.match(store.getSnapshot().error!, /another browser tab.*Allowed are light, dark, and system/);
  assert.equal(store.getSnapshot().preference, "dark");
  assert.equal(fixture.applied(), "dark");
  fixture.otherTab("light");
  assert.equal(store.getSnapshot().error, null);
  assert.equal(fixture.applied(), "light");
  store.dispose();
});

test("subscriptions and the theme lifecycle clean up all listeners", () => {
  const fixture = browserFixture("system");
  const store = createThemeStore(fixture.browser);
  let updates = 0;
  const unsubscribe = store.subscribe(() => { updates++; });
  assert.equal(fixture.target.listenerCount("storage"), 1);
  fixture.systemDark(true);
  assert.equal(updates, 1);
  unsubscribe();
  fixture.systemDark(false);
  assert.equal(updates, 1);
  store.dispose();
  store.dispose();
  assert.equal(fixture.target.listenerCount("storage"), 0);
  assert.equal(fixture.media.listenerCount("change"), 0);
  fixture.systemDark(true);
  fixture.otherTab("dark");
  assert.equal(fixture.applied(), "light");
  assert.throws(() => store.setPreference("light"), /already been disposed/);
});
