import { strict as assert } from "node:assert";
import { test } from "node:test";
import { createZoomStore, parseZoom, ZOOM_STORAGE_KEY } from "../src/zoom";

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

function browserFixture(stored: string | null = null) {
  let value = stored;
  let writes = 0;
  let writeError: Error | undefined;
  let readError: Error | undefined;
  const properties = new Map<string, string>();
  const storage = {
    getItem: (key: string) => {
      assert.equal(key, ZOOM_STORAGE_KEY);
      if (readError) throw readError;
      return value;
    },
    setItem: (key: string, next: string) => {
      assert.equal(key, ZOOM_STORAGE_KEY);
      if (writeError) throw writeError;
      writes++;
      value = next;
    },
  };
  const style = {
    setProperty: (name: string, next: string) => { properties.set(name, next); },
    removeProperty: (name: string) => { properties.delete(name); },
  };
  const target = Object.assign(new TrackedEvents(), {
    localStorage: storage,
    document: { documentElement: { style } },
  });
  return {
    browser: target as unknown as Window,
    target,
    storage,
    stored: () => value,
    writes: () => writes,
    applied: () => properties.get("transform")?.slice(6, -1),
    denyWrites: () => { writeError = new Error("Browser storage is full"); },
    allowWrites: () => { writeError = undefined; },
    denyReads: () => { readError = new Error("Browser storage is blocked"); },
    otherTab: (next: string | null, key: string | null = ZOOM_STORAGE_KEY, storageArea: unknown = storage) => {
      value = next;
      target.dispatchEvent(Object.assign(new Event("storage"), { key, storageArea, newValue: next }));
    },
  };
}

test("the page starts at 100 percent without a transform on the root element and without writing the browser storage", () => {
  const fixture = browserFixture();
  const store = createZoomStore(fixture.browser);
  assert.deepEqual(store.getSnapshot(), { zoom: 100, error: null });
  assert.equal(fixture.applied(), undefined);
  assert.equal(fixture.stored(), null);
  assert.equal(fixture.writes(), 0);
  store.dispose();
});

test("the saved zoom is applied right at bootstrap and every change is saved and applied at once", () => {
  const fixture = browserFixture("120");
  const store = createZoomStore(fixture.browser);
  assert.deepEqual(store.getSnapshot(), { zoom: 120, error: null });
  assert.equal(fixture.applied(), "1.2");
  let updates = 0;
  store.subscribe(() => { updates++; });
  store.setZoom(80);
  assert.equal(fixture.applied(), "0.8");
  assert.equal(fixture.stored(), "80");
  assert.equal(updates, 1);
  store.setZoom(80);
  assert.equal(updates, 1, "the same zoom notifies nobody");
  store.setZoom(100);
  assert.equal(fixture.applied(), undefined, "100 percent removes the transform from the root element");
  assert.equal(fixture.stored(), "100");
  store.dispose();
});

test("browser tabs sync the zoom and a deleted setting without writing back", () => {
  const fixture = browserFixture();
  const store = createZoomStore(fixture.browser);
  fixture.otherTab("150");
  assert.equal(fixture.applied(), "1.5");
  assert.equal(store.getSnapshot().zoom, 150);
  fixture.otherTab(null, null);
  assert.equal(fixture.applied(), undefined);
  assert.equal(store.getSnapshot().zoom, 100);
  assert.equal(fixture.writes(), 0);
  fixture.otherTab("90", "another.setting");
  assert.equal(fixture.applied(), undefined);
  fixture.otherTab("90", ZOOM_STORAGE_KEY, {});
  assert.equal(fixture.applied(), undefined);
  store.dispose();
});

test("only the offered steps are valid, and invalid values or blocked storage abort the initialization with a specific message", () => {
  for (const [value, zoom] of [["80", 80], ["90", 90], ["100", 100], ["110", 110], ["120", 120], ["130", 130], ["150", 150]] as const) {
    assert.equal(parseZoom(value), zoom);
  }
  for (const value of ["", "75", "140", "1.2", "120%", " 120", "200", "null"]) {
    assert.throws(() => parseZoom(value), /Invalid zoom in ragents\.zoom.*Allowed are 80, 90, 100, 110, 120, 130, 150 percent/);
    const fixture = browserFixture(value);
    assert.throws(() => createZoomStore(fixture.browser), /The saved zoom could not be loaded/);
    assert.equal(fixture.applied(), undefined);
    assert.equal(fixture.target.listenerCount("storage"), 0);
  }
  const fixture = browserFixture();
  fixture.denyReads();
  assert.throws(() => createZoomStore(fixture.browser), /Browser storage is blocked/);
});

test("a storage error stays visible and leaves the saved and active zoom unchanged", () => {
  const fixture = browserFixture("110");
  const store = createZoomStore(fixture.browser);
  fixture.denyWrites();
  store.setZoom(130);
  assert.equal(fixture.applied(), "1.1");
  assert.equal(fixture.stored(), "110");
  assert.equal(store.getSnapshot().zoom, 110);
  assert.match(store.getSnapshot().error!, /The zoom could not be saved.*Browser storage is full/);
  fixture.allowWrites();
  store.setZoom(130);
  assert.deepEqual(store.getSnapshot(), { zoom: 130, error: null });
  assert.equal(fixture.applied(), "1.3");
  store.dispose();
});

test("a corrupted value from another tab is reported and never applied", () => {
  const fixture = browserFixture("90");
  const store = createZoomStore(fixture.browser);
  fixture.otherTab("400");
  assert.match(store.getSnapshot().error!, /another browser tab.*Invalid zoom/);
  assert.equal(store.getSnapshot().zoom, 90);
  assert.equal(fixture.applied(), "0.9");
  fixture.otherTab("120");
  assert.deepEqual(store.getSnapshot(), { zoom: 120, error: null });
  store.dispose();
});

test("disposing removes every listener and locks the store", () => {
  const fixture = browserFixture();
  const store = createZoomStore(fixture.browser);
  let updates = 0;
  const unsubscribe = store.subscribe(() => { updates++; });
  assert.equal(fixture.target.listenerCount("storage"), 1);
  fixture.otherTab("110");
  assert.equal(updates, 1);
  unsubscribe();
  fixture.otherTab("120");
  assert.equal(updates, 1);
  store.dispose();
  store.dispose();
  assert.equal(fixture.target.listenerCount("storage"), 0);
  fixture.otherTab("80");
  assert.equal(fixture.applied(), "1.2");
  assert.throws(() => store.setZoom(100), /already been disposed/);
});
