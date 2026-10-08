import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { contrastRules, paletteStylesheet, palettes, paletteTokens, type PaletteMode, type PaletteName } from "../../../scripts/maintenance/palettes.ts";
import { applyAppearance, createChoiceStore, initializeAppearance, parseAppearanceValue } from "../src/appearance";
import { appearanceChoiceIds, appearanceChoices, defaultAppearance, defaultPalette, paletteOptions, type AppearanceChoiceId } from "../src/appearance-options";

function browserFixture(id: AppearanceChoiceId = "palette", stored: string | null = null) {
  const key = appearanceChoices[id].storageKey;
  const values = new Map<string, string | null>([[key, stored]]);
  let writeError: Error | undefined;
  let readError: Error | undefined;
  const storage = {
    getItem: (name: string) => {
      if (readError) throw readError;
      return values.get(name) ?? null;
    },
    setItem: (name: string, next: string) => {
      if (writeError) throw writeError;
      values.set(name, next);
    },
  };
  const target = Object.assign(new EventTarget(), {
    localStorage: storage,
    document: { documentElement: { dataset: {} as Record<string, string> } },
  });
  return {
    browser: target as unknown as Window,
    storage,
    stored: () => values.get(key) ?? null,
    applied: () => target.document.documentElement.dataset[id],
    dataset: target.document.documentElement.dataset,
    denyWrites: () => { writeError = new Error("Browser storage is full"); },
    denyReads: () => { readError = new Error("Browser storage is blocked"); },
    otherTab: (next: string | null, storageArea: unknown = storage) => {
      values.set(key, next);
      target.dispatchEvent(Object.assign(new Event("storage"), { key, storageArea, newValue: next }));
    },
  };
}

test("the interface starts with the default palette without writing to the browser storage", () => {
  const fixture = browserFixture();
  const store = createChoiceStore(fixture.browser, "palette");
  assert.deepEqual(store.getSnapshot(), { value: defaultPalette, error: null });
  assert.equal(fixture.applied(), defaultPalette);
  assert.equal(fixture.stored(), null);
  store.dispose();
});

test("the saved palette is applied at bootstrap and a choice is saved and announced", () => {
  const fixture = browserFixture("palette", "graphite");
  const store = createChoiceStore(fixture.browser, "palette");
  assert.equal(fixture.applied(), "graphite");
  let updates = 0;
  store.subscribe(() => { updates++; });
  store.set("black");
  assert.equal(fixture.applied(), "black");
  assert.equal(fixture.stored(), "black");
  assert.equal(store.getSnapshot().value, "black");
  assert.equal(updates, 1);
  store.dispose();
});

test("another browser tab changes the palette without writing back", () => {
  const fixture = browserFixture();
  const store = createChoiceStore(fixture.browser, "palette");
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
    assert.throws(() => parseAppearanceValue("palette", value), /Allowed are schichtwerk, graphite, midnight, black/);
    assert.throws(() => createChoiceStore(browserFixture("palette", value).browser, "palette"), /The saved palette could not be loaded/);
  }
  const blocked = browserFixture();
  blocked.denyReads();
  assert.throws(() => createChoiceStore(blocked.browser, "palette"), /Browser storage is blocked/);
  const full = browserFixture();
  const store = createChoiceStore(full.browser, "palette");
  full.denyWrites();
  store.set("graphite");
  assert.match(store.getSnapshot().error ?? "", /The palette could not be saved. Browser storage is full/);
  assert.equal(full.applied(), defaultPalette);
  store.dispose();
});

test("corners, inline code and table spacing are choices with their own attribute, key and default", () => {
  assert.deepEqual(appearanceChoiceIds, ["palette", "codeStyle", "corners", "density"]);
  assert.deepEqual(defaultAppearance, { palette: "schichtwerk", codeStyle: "tint", corners: "round", density: "comfortable" });
  const fixture = browserFixture("density");
  const store = createChoiceStore(fixture.browser, "density");
  assert.equal(fixture.dataset.density, "comfortable");
  store.set("spacious");
  assert.equal(fixture.stored(), "spacious");
  assert.equal(fixture.dataset.density, "spacious");
  const code = browserFixture("codeStyle");
  createChoiceStore(code.browser, "codeStyle").set("outlined");
  assert.equal(code.dataset.codeStyle, "outlined");
  assert.throws(() => createChoiceStore(browserFixture("corners", "square").browser, "corners"), /The saved corners could not be loaded.*Allowed are round, tight/);
  assert.throws(() => createChoiceStore(browserFixture("codeStyle", "chip").browser, "codeStyle"), /The saved inline code could not be loaded.*Allowed are tint, outlined/);
  store.dispose();
});

test("a host applies several choices at once and an unknown value is a hard error", () => {
  const fixture = browserFixture();
  const appearance = initializeAppearance(fixture.browser);
  applyAppearance({ palette: "midnight", corners: "tight", density: "spacious", codeStyle: "outlined" });
  assert.deepEqual(fixture.dataset, { palette: "midnight", codeStyle: "outlined", corners: "tight", density: "spacious" });
  applyAppearance({ palette: undefined });
  assert.equal(fixture.dataset.palette, "midnight");
  assert.throws(() => applyAppearance({ corners: "square" }), /Unknown corners "square". Allowed are round, tight/);
  appearance.dispose();
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
