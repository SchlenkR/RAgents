import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { contrastRules, paletteStylesheet, palettes, paletteTokens, type PaletteMode, type PaletteName } from "../../../scripts/maintenance/palettes.ts";
import { createPaletteStore, defaultPalette, PALETTE_STORAGE_KEY, paletteOptions, parsePalette } from "../src/palette";

function browserFixture(stored: string | null = null) {
  let value = stored;
  let writeError: Error | undefined;
  let readError: Error | undefined;
  const storage = {
    getItem: (key: string) => {
      assert.equal(key, PALETTE_STORAGE_KEY);
      if (readError) throw readError;
      return value;
    },
    setItem: (key: string, next: string) => {
      assert.equal(key, PALETTE_STORAGE_KEY);
      if (writeError) throw writeError;
      value = next;
    },
  };
  const target = Object.assign(new EventTarget(), {
    localStorage: storage,
    document: { documentElement: { dataset: {} as Record<string, string> } },
  });
  return {
    browser: target as unknown as Window,
    target,
    storage,
    stored: () => value,
    applied: () => target.document.documentElement.dataset.palette,
    denyWrites: () => { writeError = new Error("Browser storage is full"); },
    denyReads: () => { readError = new Error("Browser storage is blocked"); },
    otherTab: (next: string | null, storageArea: unknown = storage) => {
      value = next;
      target.dispatchEvent(Object.assign(new Event("storage"), { key: PALETTE_STORAGE_KEY, storageArea, newValue: next }));
    },
  };
}

test("the interface starts with the default palette without writing to the browser storage", () => {
  const fixture = browserFixture();
  const store = createPaletteStore(fixture.browser);
  assert.deepEqual(store.getSnapshot(), { palette: defaultPalette, error: null });
  assert.equal(fixture.applied(), defaultPalette);
  assert.equal(fixture.stored(), null);
  store.dispose();
});

test("the saved palette is applied at bootstrap and a choice is saved and announced", () => {
  const fixture = browserFixture("graphite");
  const store = createPaletteStore(fixture.browser);
  assert.equal(fixture.applied(), "graphite");
  let updates = 0;
  store.subscribe(() => { updates++; });
  store.setPalette("black");
  assert.equal(fixture.applied(), "black");
  assert.equal(fixture.stored(), "black");
  assert.equal(store.getSnapshot().palette, "black");
  assert.equal(updates, 1);
  store.dispose();
});

test("another browser tab changes the palette without writing back", () => {
  const fixture = browserFixture();
  const store = createPaletteStore(fixture.browser);
  fixture.otherTab("midnight");
  assert.equal(fixture.applied(), "midnight");
  fixture.otherTab(null);
  assert.equal(fixture.applied(), defaultPalette);
  fixture.otherTab("black", {});
  assert.equal(fixture.applied(), defaultPalette);
  store.dispose();
});

test("invalid values, blocked storage and a failed save are reported with a cause", () => {
  for (const value of ["", "GRAPHITE", "sepia"]) {
    assert.throws(() => parsePalette(value), /Allowed are schichtwerk, graphite, midnight, black/);
    assert.throws(() => createPaletteStore(browserFixture(value).browser), /The saved palette could not be loaded/);
  }
  const blocked = browserFixture();
  blocked.denyReads();
  assert.throws(() => createPaletteStore(blocked.browser), /Browser storage is blocked/);
  const full = browserFixture();
  const store = createPaletteStore(full.browser);
  full.denyWrites();
  store.setPalette("graphite");
  assert.match(store.getSnapshot().error ?? "", /The palette could not be saved. Browser storage is full/);
  assert.equal(full.applied(), defaultPalette);
  store.dispose();
});

test("every palette defines the same tokens in a light and a dark block", () => {
  const css = readFileSync(new URL("../src/ui/palettes.css", import.meta.url), "utf8");
  const blocks = [...css.matchAll(/([^{}]+)\{([^}]*)\}/g)].map((match) => ({ selector: match[1]!.replace(/\/\*.*?\*\//gs, "").trim(), body: match[2]! }));
  const tokensOf = (body: string) => [...body.matchAll(/--([a-z0-9-]+):/g)].map((token) => token[1]!).sort();
  const reference = tokensOf(blocks[0]!.body);
  assert.ok(reference.length > 60, "the first block carries the token set");
  assert.equal(blocks.length, paletteOptions.length * 2);
  for (const option of paletteOptions) {
    for (const dark of [false, true]) {
      const block = blocks.find((entry) => entry.selector.includes(`[data-palette="${option.value}"]`) && entry.selector.includes('[data-theme="dark"]') === dark);
      assert.ok(block, `${option.value} ${dark ? "dark" : "light"} block exists`);
      assert.deepEqual(tokensOf(block.body), reference, `${option.value} ${dark ? "dark" : "light"} defines the shared token set`);
    }
  }
});

test("the palette options are the generated palettes, and palettes.css is the generator output", () => {
  assert.deepEqual(paletteOptions.map((option) => option.value), Object.keys(palettes));
  assert.deepEqual(paletteOptions.map((option) => option.label), Object.values(palettes).map((palette) => palette.label));
  assert.equal(defaultPalette, "schichtwerk");
  assert.equal(readFileSync(new URL("../src/ui/palettes.css", import.meta.url), "utf8"), paletteStylesheet(), "run pnpm generate:palettes");
});

test("every palette keeps text, boundaries and surface steps readable in light and dark", () => {
  for (const name of Object.keys(palettes) as PaletteName[]) {
    for (const mode of ["light", "dark"] as const satisfies readonly PaletteMode[]) {
      const failed = contrastRules(mode, paletteTokens(name, mode)).filter((rule) => !rule.pass).map((rule) => `${rule.pair} ${rule.ratio.toFixed(2)} < ${rule.goal}`);
      assert.deepEqual(failed, [], `${name} ${mode}`);
    }
  }
});
