import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";
import { chromium, webkit, type Browser, type Page } from "playwright-core";
import { tailwindPlugin } from "./tailwind-plugin";

const browserOnly = { skip: process.env.RAGENTS_BROWSER_TESTS !== "1", timeout: 180_000 };
const shots = join(tmpdir(), "ragents-browser-shots");

let fixture: Promise<string> | undefined;
const buildFixture = async () => {
  const directory = await mkdtemp(join(tmpdir(), "ragents-start-dashboard-"));
  process.once("exit", () => void rm(directory, { recursive: true, force: true }));
  await build({
    entryPoints: [fileURLToPath(new URL("start-dashboard-fixture.tsx", import.meta.url))], bundle: true,
    platform: "browser", format: "iife", jsx: "automatic", outfile: join(directory, "fixture.js"),
    define: { "process.env.NODE_ENV": '"production"' },
    plugins: [tailwindPlugin([fileURLToPath(new URL("../src", import.meta.url)), fileURLToPath(new URL("./", import.meta.url))])], logLevel: "silent",
  });
  await writeFile(join(directory, "index.html"), '<!doctype html><html><head><meta charset="utf-8"><link rel="stylesheet" href="fixture.css"><style>html,body,#root{height:100%;margin:0}</style></head><body><div id="root"></div><script src="fixture.js"></script></body></html>');
  return pathToFileURL(join(directory, "index.html")).href;
};

/** Start shows its widgets once the stored layout is read. */
const loaded = (page: Page) => page.locator("[data-dashboard]:not([aria-busy])").waitFor();

type Engine = "chromium" | "webkit";

const launch = (engine: Engine) => engine === "webkit" ? webkit.launch({ headless: true })
  : chromium.launch({ headless: true, executablePath: process.env.BROWSER_EXECUTABLE_PATH ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" });

const withPage = async (width: number, query: string, run: (page: Page, browser: Browser) => Promise<void>, height = 900, engine: Engine = "chromium", motion: "reduce" | "no-preference" = "reduce") => {
  const url = await (fixture ??= buildFixture());
  const browser = await launch(engine);
  try {
    const page = await browser.newPage({ viewport: { width, height }, reducedMotion: motion });
    page.setDefaultTimeout(6000);
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(`${url}?${query}`);
    await loaded(page);
    try {
      await run(page, browser);
      assert.deepEqual(errors, []);
    } catch (cause) {
      await mkdir(shots, { recursive: true });
      await page.screenshot({ path: join(shots, `start-dashboard-failed-${engine}-${width}-${query.replace(/[^a-z0-9]/gi, "-")}.png`), fullPage: true });
      throw cause;
    }
  } finally { await browser.close(); }
};

const box = async (page: Page, name: string) => {
  const bounds = await page.getByRole("region", { name, exact: true }).boundingBox();
  assert.ok(bounds, `${name} is visible`);
  return bounds;
};

/** The grid's columns, gap, and the width a widget of n of them has. */
const gridOf = (page: Page) => page.locator("[data-dashboard]").evaluate((element) => {
  const columns = Number((element as HTMLElement).dataset.grid);
  const gap = parseFloat(getComputedStyle(element).columnGap);
  const column = (element.getBoundingClientRect().width - (columns - 1) * gap) / columns;
  return { columns, gap, column, pitch: column + gap };
});

const spanWidth = (grid: { column: number; gap: number }, columns: number) => columns * grid.column + (columns - 1) * grid.gap;

const settled = (page: Page) => page.evaluate(() => Promise.all(document.getAnimations().map((animation) => animation.finished.catch(() => undefined))));

/** The packed cells of the grid in their order, with boxes relative to the grid and the grid's columns and gaps. */
const packedCells = (page: Page) => page.locator("[data-dashboard]").evaluate((grid) => {
  const bounds = grid.getBoundingClientRect();
  const style = getComputedStyle(grid);
  const columns = Number((grid as HTMLElement).dataset.grid);
  const gapX = parseFloat(style.columnGap);
  const gapY = parseFloat(style.rowGap);
  const column = (bounds.width - (columns - 1) * gapX) / columns;
  const cells = [...grid.querySelectorAll<HTMLElement>(":scope > [data-pack]")].map((cell) => ({ key: cell.dataset.pack!, box: cell.getBoundingClientRect() }))
    .filter(({ box }) => box.height > 0).map(({ key, box }) => ({ key, left: box.left - bounds.left, top: box.top - bounds.top, width: box.width, height: box.height }));
  return { columns, gapX, gapY, column, pitch: column + gapX, height: bounds.height, cells };
});

type Packed = Awaited<ReturnType<typeof packedCells>>;

/** Every cell stands on whole columns, rests one gap below the cells before it in its columns, has no higher place where its columns fit, and overlaps no other cell; the grid ends at its lowest cell. */
const checkPacked = (packed: Packed, label: string) => {
  const cells = packed.cells.map((cell) => {
    const column = Math.round(cell.left / packed.pitch);
    const columns = Math.round((cell.width + packed.gapX) / packed.pitch);
    assert.ok(Math.abs(cell.left - column * packed.pitch) < 1 && Math.abs(cell.width - (columns * packed.column + (columns - 1) * packed.gapX)) < 1, `${cell.key} stands on whole columns (${label})`);
    return { ...cell, column, columns };
  });
  cells.forEach((cell, index) => {
    const before = cells.slice(0, index);
    const lowest = (from: number) => Math.max(0, ...before.filter((other) => other.column < from + cell.columns && from < other.column + other.columns).map((other) => other.top + other.height + packed.gapY));
    const best = Math.min(...Array.from({ length: packed.columns - cell.columns + 1 }, (_, from) => lowest(from)));
    assert.ok(Math.abs(cell.top - lowest(cell.column)) < 1, `${cell.key} rests one gap below the widgets above it, at ${cell.top} instead of ${lowest(cell.column)} (${label})`);
    assert.ok(cell.top <= best + 1, `${cell.key} has no higher place where its columns fit: ${cell.top} against ${best} (${label})`);
    const overlapping = before.filter((other) => other.left < cell.left + cell.width - 0.5 && cell.left < other.left + other.width - 0.5 && other.top < cell.top + cell.height - 0.5 && cell.top < other.top + other.height - 0.5);
    assert.deepEqual(overlapping.map((other) => other.key), [], `${cell.key} overlaps no other widget (${label})`);
  });
  assert.ok(Math.abs(packed.height - Math.max(0, ...cells.map((cell) => cell.top + cell.height))) < 1, `the grid ends at its lowest widget (${label})`);
};

const placeOf = (packed: Packed, key: string) => {
  const cell = packed.cells.find((entry) => entry.key === key);
  assert.ok(cell, `${key} is packed`);
  return { column: Math.round(cell.left / packed.pitch), top: cell.top, bottom: cell.top + cell.height };
};

const slides = (page: Page) => page.evaluate(() => document.getAnimations().filter((animation) => animation.id === "start-repack").length);

/** Waits for the slides of re-packing only, because a running run's spinner never ends. */
const slid = (page: Page) => page.evaluate(async () => {
  for (;;) {
    const running = document.getAnimations().filter((animation) => animation.id === "start-repack");
    if (running.length === 0) return;
    await Promise.all(running.map((animation) => animation.finished.catch(() => undefined)));
  }
});

const noHorizontalScroll = (page: Page) => page.evaluate(() => {
  const main = document.querySelector<HTMLElement>("main[data-page]")!;
  return { page: document.documentElement.scrollWidth - innerWidth, main: main.scrollWidth - main.clientWidth };
});

test("a wide dashboard places widgets in six columns by their widths and leaves out empty ones", browserOnly, async () => {
  await withPage(1280, "", async (page) => {
    assert.equal(await page.getByRole("tablist", { name: "Start widgets" }).count(), 0, "no tabs on a wide dashboard");
    const [start, more] = [await box(page, "New"), await box(page, "Continue")];
    assert.ok(Math.abs(start.y - more.y) < 1 && start.x < more.x, "New and Continue share the first row");
    const grid = await gridOf(page);
    assert.equal(grid.columns, 6);
    assert.ok(Math.abs(start.width - spanWidth(grid, 2)) < 0.5 && Math.abs(more.width - spanWidth(grid, 4)) < 0.5, "New takes two of six columns, Continue four");
    const headings = await page.getByRole("heading", { level: 2 }).evaluateAll((elements) => elements.slice(0, 2).map((element) => {
      const bounds = element.getBoundingClientRect();
      return bounds.top + bounds.height / 2;
    }));
    assert.ok(Math.abs(headings[0]! - headings[1]!) < 1, "widget titles in one row stand at the same height, with or without an action");
    const board = await box(page, "Work board");
    assert.ok(board.y > more.y && Math.abs(board.width - spanWidth(grid, 6)) < 0.5, "a widget without columns fills its own row");
    const narrow = await Promise.all(["New auto items", "Shared with the team", "Model usage"].map((name) => box(page, name)));
    assert.ok(narrow.every((entry) => Math.abs(entry.y - narrow[0]!.y) < 1), "three widgets of two columns share one row");
    assert.ok(Math.abs(narrow[0]!.width - start.width) < 1);
    assert.equal(await page.getByRole("heading", { name: "Nothing to show" }).count(), 0, "a widget that renders nothing takes no cell");
    const legacy = await page.getByRole("region", { name: "Legacy notes" }).boundingBox();
    assert.ok(legacy && legacy.y > narrow[0]!.y && Math.abs(legacy.width - board.width) < 1, "a section without a title keeps a full row");
    const description = page.getByRole("list", { name: "Templates" }).locator('[data-slot="start-description"]').first();
    assert.equal(await description.evaluate((element) => getComputedStyle(element).webkitLineClamp), "1", "templates in a narrow widget become compact rows");
    const tile = await page.getByRole("list", { name: "Templates" }).getByRole("button").first().boundingBox();
    assert.ok(tile && Math.abs(tile.width - start.width) < 1, "compact rows fill the widget");
    assert.equal(await page.getByRole("list", { name: "Recent" }).getByText("alice").first().isVisible(), true, "wide run rows keep their detail line");
    assert.deepEqual(await noHorizontalScroll(page), { page: 0, main: 0 });
    await mkdir(shots, { recursive: true });
    await page.screenshot({ path: join(shots, "start-dashboard-1280.png"), fullPage: true });
  });
});

test("medium widths have three columns and halve the widths, rounded up, so New and Continue keep one row", browserOnly, async () => {
  await withPage(900, "", async (page) => {
    const grid = await gridOf(page);
    assert.equal(grid.columns, 3);
    const [start, more] = [await box(page, "New"), await box(page, "Continue")];
    assert.ok(Math.abs(start.y - more.y) < 1 && Math.abs(start.width - spanWidth(grid, 1)) < 0.5 && Math.abs(more.width - spanWidth(grid, 2)) < 0.5);
    const narrow = await Promise.all(["New auto items", "Shared with the team", "Model usage"].map((name) => box(page, name)));
    assert.ok(narrow.every((entry) => Math.abs(entry.y - narrow[0]!.y) < 1 && Math.abs(entry.width - start.width) < 1), "three widgets of two columns take one each");
    assert.ok(Math.abs((await box(page, "Work board")).width - spanWidth(grid, 3)) < 0.5);
    assert.deepEqual(await noHorizontalScroll(page), { page: 0, main: 0 });
  });
});

test("a narrow dashboard shows one widget at a time in tabs and remembers the choice", browserOnly, async () => {
  await withPage(560, "", async (page) => {
    const tabs = page.getByRole("tablist", { name: "Start widgets" });
    await tabs.waitFor();
    const names = await tabs.getByRole("tab").allTextContents();
    assert.equal(names[0], "New", "a tab names its widget without a count");
    assert.equal(names.includes("Nothing to show"), false, "an empty widget has no tab");
    assert.equal(await page.getByRole("tabpanel").getByRole("heading", { name: /^New/ }).evaluate((element) => element.getBoundingClientRect().width <= 1), true, "the tab names the widget, its frame repeats no visible title");
    await mkdir(shots, { recursive: true });
    await page.screenshot({ path: join(shots, "start-dashboard-560.png") });
    assert.equal(await page.getByRole("tabpanel").count(), 1, "only the active widget is shown");
    assert.equal(await page.getByRole("tab", { name: "New", exact: true }).getAttribute("aria-selected"), "true");
    const panel = await page.getByRole("tabpanel").boundingBox();
    const main = await page.locator("main[data-page]").evaluate((element) => element.querySelector("[data-dashboard]")!.getBoundingClientRect().width);
    assert.ok(panel && Math.abs(panel.width - main) < 1, "the active widget fills the width");
    const description = page.getByRole("list", { name: "Templates" }).locator('[data-slot="start-description"]').first();
    assert.equal(await description.evaluate((element) => getComputedStyle(element).webkitLineClamp), "2", "a wide enough widget keeps its cards");
    assert.equal(await page.getByRole("region", { name: "Legacy notes" }).isVisible(), true, "a section without a title stays below the tabs");
    const legacy = await page.getByRole("region", { name: "Legacy notes" }).boundingBox();
    assert.ok(legacy && panel && legacy.y > panel.y);
    const visible = await tabs.getByRole("tab").count();
    const target = visible > 1 ? page.getByRole("tab", { name: "Continue" }) : undefined;
    if (target) await target.click();
    else {
      await page.getByRole("button", { name: "More tabs" }).click();
      await page.getByRole("menuitemradio", { name: "Continue" }).click();
    }
    await page.getByRole("tab", { name: "Continue", selected: true }).waitFor();
    assert.equal(await page.getByRole("tabpanel").getByRole("list", { name: "Recent" }).count(), 1);
    await page.reload();
    await loaded(page);
    await page.getByRole("tab", { name: "Continue", selected: true }).waitFor();
    assert.equal(await page.getByRole("list", { name: "Templates" }).count(), 0, "the remembered widget returns after a reload");
    assert.deepEqual(await noHorizontalScroll(page), { page: 0, main: 0 });
  });
});

test("tabs that do not fit move into a menu that lists exactly the hidden ones", browserOnly, async () => {
  for (const theme of ["light", "dark"] as const) {
    await withPage(360, "widgets=many", async (page) => {
      await page.evaluate((value) => document.documentElement.setAttribute("data-theme", value), theme);
      const tabs = page.getByRole("tablist", { name: "Start widgets" });
      await tabs.waitFor();
      const all = ["New", "Continue", "Work board", "New auto items", "Shared with the team", "Model usage", "Topics in review", "Upcoming releases", "Open incidents this week"];
      const shown = await tabs.getByRole("tab").allTextContents();
      assert.ok(shown.length >= 1 && shown.length < all.length, `some tabs fit, the rest are hidden: ${shown.join(", ")}`);
      assert.deepEqual(shown, all.slice(0, shown.length), "the leading tabs stay in their order");
      const strip = await tabs.evaluate((element) => {
        const list = element.getBoundingClientRect();
        const outer = element.parentElement!.getBoundingClientRect();
        return { right: list.right, limit: outer.right, clipped: [...element.querySelectorAll("[role=tab]")].some((tab) => tab.scrollWidth > tab.clientWidth + 1) };
      });
      assert.ok(strip.right <= strip.limit + 0.5 && !strip.clipped, "no tab is clipped");
      const more = page.getByRole("button", { name: "More tabs" });
      await more.focus();
      await page.keyboard.press("Enter");
      const menu = page.getByRole("menu");
      await menu.waitFor();
      const hidden = (await menu.getByRole("menuitemradio").allTextContents()).map((text) => text.replace(/(\D)(\d+)$/, "$1 $2"));
      assert.deepEqual(hidden, all.slice(shown.length), "the menu lists exactly the hidden tabs");
      const background = await menu.evaluate((element) => getComputedStyle(element).backgroundColor);
      assert.doesNotMatch(background, /rgba\(0, 0, 0, 0\)|transparent/, "the menu has an opaque surface");
      await settled(page);
      await mkdir(shots, { recursive: true });
      await page.screenshot({ path: join(shots, `start-dashboard-overflow-${theme}.png`) });
      const chosen = all.at(-1)!;
      await menu.getByRole("menuitemradio", { name: chosen }).focus();
      await page.keyboard.press("Enter");
      await page.getByRole("tab", { name: chosen, selected: true }).waitFor();
      assert.equal(await page.getByRole("tabpanel").getByRole("list", { name: `${chosen} entries` }).count(), 1, "the chosen widget is shown");
      const after = await tabs.getByRole("tab").allTextContents();
      assert.equal(after.at(-1), chosen, "the active tab stays visible at the end of the strip");
      await more.click();
      const marked = await page.getByRole("menu").getByRole("menuitemradio", { checked: true }).count();
      assert.equal(marked, 0, "the active tab is never among the hidden ones");
      await page.keyboard.press("Escape");
      assert.deepEqual(await noHorizontalScroll(page), { page: 0, main: 0 }, "no horizontal page scroll at 360 pixels");
      const rows = page.getByRole("list", { name: `${chosen} entries` });
      assert.equal(await rows.isVisible(), true);
    });
  }
});

test("narrow run rows drop their detail line but keep title, state, and time", browserOnly, async () => {
  await withPage(360, "", async (page) => {
    await page.getByRole("tab", { name: "Continue" }).click();
    const recent = page.getByRole("list", { name: "Recent" });
    await recent.waitFor();
    assert.equal(await recent.getByText("alice").first().isVisible(), false, "the owner line is gone");
    assert.equal(await recent.locator('[data-cell="time"]').first().isVisible(), true);
    assert.deepEqual(await noHorizontalScroll(page), { page: 0, main: 0 });
  });
});


const focused = (page: Page) => page.evaluate(() => document.activeElement?.getAttribute("aria-label") ?? document.activeElement?.textContent ?? "");

const order = (page: Page) => page.locator("[data-start-widget]").evaluateAll((cells) => cells.map((cell) => cell.getAttribute("data-start-widget")));

const announced = (page: Page) => page.locator("[aria-live=polite]").textContent();

const regions = (page: Page) => page.locator("[data-start-widget]:not([hidden]) > section").evaluateAll((sections) => sections.map((section) => {
  const bounds = section.getBoundingClientRect();
  const top = section.closest("[data-dashboard]")!.getBoundingClientRect().top;
  return { name: section.getAttribute("aria-label"), x: Math.round(bounds.x), y: Math.round(bounds.y - top), width: Math.round(bounds.width) };
}));

const writes = (page: Page) => page.evaluate(() => window.dashboardFixture.writes);

const edit = async (page: Page) => {
  await page.getByRole("button", { name: "Edit", exact: true }).click();
  await page.getByRole("group", { name: "Edit Start" }).waitFor();
};

/** The columns a widget stores in the draft. */
const size = async (page: Page, key: string) => Number(await page.locator(`[data-start-widget="${key}"] [data-widget-columns]`).getAttribute("data-widget-columns"));

/** Waits until a widget stores the given columns, because pointer moves render after the move event. */
const becomes = (page: Page, key: string, columns: number) => page.waitForFunction(([widget, expected]) =>
  document.querySelector(`[data-start-widget="${widget}"] [data-widget-columns]`)?.getAttribute("data-widget-columns") === String(expected), [key, columns] as const);

const grip = (page: Page, key: string) => page.locator(`[data-start-widget="${key}"] [data-resize-grip]`);

/** Drags with the mouse in steps, like a hand, so that the grid can follow on the way. */
const drag = async (page: Page, from: { x: number; y: number }, to: { x: number; y: number }, during?: () => Promise<void>) => {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  for (let step = 1; step <= 12; step += 1) await page.mouse.move(from.x + (to.x - from.x) * step / 12, from.y + (to.y - from.y) * step / 12);
  await during?.();
  await page.mouse.up();
};

const center = async (page: Page, locator: ReturnType<Page["locator"]>) => {
  const bounds = await locator.boundingBox();
  assert.ok(bounds, "the control is visible");
  return { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 };
};

const controlNames = (page: Page) => page.getByRole("button").evaluateAll((buttons) => buttons.map((button) => button.getAttribute("aria-label") ?? button.textContent ?? "")
  .filter((name) => /^(Move|Remove|Arrange|Add) |^(Add widget|Customize|Done|Cancel)$/.test(name)));

test("outside edit mode Start shows no arrangement controls, only Edit above the widgets or at the end of the tabs", browserOnly, async () => {
  await withPage(1280, "", async (page) => {
    assert.deepEqual(await controlNames(page), []);
    assert.equal(await page.locator("[data-resize-handle], [data-drop-indicator], [data-widget-columns], [data-column-guides]").count(), 0);
    const button = await page.getByRole("button", { name: "Edit", exact: true }).boundingBox();
    const [start, more] = [await box(page, "New"), await box(page, "Continue")];
    assert.ok(button && button.y + button.height <= start.y && Math.abs(button.x + button.width - (more.x + more.width)) < 1, "Edit stands at the top right, right above the first widget row");
    await page.setViewportSize({ width: 560, height: 900 });
    const tabs = page.getByRole("tablist", { name: "Start widgets" });
    await tabs.waitFor();
    assert.deepEqual(await controlNames(page), []);
    const [strip, icon] = [await tabs.boundingBox(), await page.getByRole("button", { name: "Edit", exact: true }).boundingBox()];
    assert.ok(strip && icon && icon.x >= strip.x + strip.width && Math.abs(icon.y + icon.height / 2 - (strip.y + strip.height / 2)) < 2, "Edit ends the tab strip");
    assert.deepEqual(await noHorizontalScroll(page), { page: 0, main: 0 });
  });
});

test("edit mode moves a widget by dragging, resizes Continue by its edge, removes and adds a widget, and Done keeps the layout across a reload", browserOnly, async () => {
  await withPage(1280, "", async (page) => {
    await edit(page);
    assert.equal(await page.getByRole("group", { name: "Edit Start" }).getByText("Editing Start").isVisible(), true, "a clear mode indicator");
    assert.equal(await focused(page), "Move New", "focus starts at the first widget's handle");
    for (const title of ["New", "Continue", "Work board", "New auto items", "Shared with the team", "Model usage", "Nothing to show"]) {
      assert.equal(await page.getByRole("button", { name: `Move ${title}`, exact: true }).count(), 1, `${title} has a drag handle`);
      assert.equal(await page.getByRole("button", { name: `Remove ${title}`, exact: true }).count(), 1, `${title} can be removed`);
    }
    assert.equal(await page.locator("[data-start-widget]").first().evaluate((cell) => getComputedStyle(cell).outlineStyle), "dashed", "every widget gets a visible frame");
    assert.equal(await page.getByRole("region", { name: "Nothing to show" }).getByText("Nothing to show right now.").isVisible(), true, "an empty widget shows its frame while editing");
    assert.equal(await page.getByRole("list", { name: "Templates" }).evaluate((list) => list.closest("[inert]") !== null), true, "widget content cannot be used while editing");
    assert.deepEqual(await noHorizontalScroll(page), { page: 0, main: 0 });

    const target = await page.getByRole("region", { name: "New", exact: true }).boundingBox();
    await drag(page, await center(page, page.getByRole("button", { name: "Move Work board", exact: true })), { x: target!.x + 24, y: target!.y + 48 }, async () => {
      assert.equal((await order(page))[0], "demo.board", "the grid follows the pointer before the drop");
      assert.equal(await page.locator('[data-start-widget="demo.board"] [data-drop-indicator]').isVisible(), true, "the drop indicator marks the new place");
      await mkdir(shots, { recursive: true });
      await page.screenshot({ path: join(shots, "start-dashboard-edit-drag-1280.png") });
    });
    assert.deepEqual(await order(page), ["demo.board", "start.new", "start.continue", "demo.auto", "demo.shared", "demo.usage", "demo.empty"]);
    assert.equal(await announced(page), "Work board moved to place 1 of 7.");
    assert.equal(await focused(page), "Move Work board");
    assert.equal(await page.locator("[data-drop-indicator]").count(), 0);

    const grid = await gridOf(page);
    const edge = await center(page, grip(page, "start.continue"));
    await drag(page, edge, { x: edge.x - 2 * grid.pitch, y: edge.y }, async () => {
      assert.equal(await size(page, "start.continue"), 2, "the target width shows while dragging");
      assert.equal(await page.locator("[data-resize-label]").textContent(), "2 of 6 columns");
      assert.equal(await page.locator("[data-column-guides] > *").count(), 6, "the guides show the grid's columns");
      assert.ok(Math.abs((await box(page, "Continue")).width - spanWidth(grid, 2)) < 0.5, "the grid follows the width while dragging");
      await page.screenshot({ path: join(shots, "start-dashboard-edit-resize-1280.png") });
    });
    assert.equal(await announced(page), "Continue is now 2 of 6 columns wide.");
    assert.equal(await page.locator("[data-column-guides], [data-resize-label]").count(), 0, "guides and label leave with the drag");

    await page.getByRole("button", { name: "Remove Model usage", exact: true }).click();
    assert.equal(await page.getByRole("region", { name: "Model usage" }).count(), 0, "a removed widget leaves the dashboard");
    assert.equal(await focused(page), "Move Nothing to show", "focus moves to the widget that took the place");
    await page.getByRole("button", { name: "Add widget", exact: true }).click();
    const gallery = page.getByRole("dialog", { name: "Add widget" });
    await gallery.waitFor();
    const offered = gallery.getByRole("button", { name: /^Add / });
    assert.deepEqual(await offered.evaluateAll((buttons) => buttons.map((button) => button.getAttribute("aria-label"))), ["Add Model usage"], "the gallery lists the widgets that are not on Start");
    assert.equal(await offered.first().evaluate((button) => document.getElementById(button.getAttribute("aria-describedby")!)!.textContent), "Tokens and cost of the last runs.Width: 2 of 6 columns, adjustable from 1 to 3");
    await settled(page);
    await page.screenshot({ path: join(shots, "start-dashboard-edit-gallery-1280.png") });
    await offered.first().click();
    await gallery.waitFor({ state: "detached" });
    assert.equal((await order(page)).at(-1), "demo.usage", "an added widget joins at the end");
    assert.equal(await size(page, "demo.usage"), 2, "in its default width");
    assert.equal(await focused(page), "Move Model usage");
    await page.screenshot({ path: join(shots, "start-dashboard-edit-1280.png"), fullPage: true });

    await page.getByRole("button", { name: "Done", exact: true }).click();
    await page.getByRole("group", { name: "Edit Start" }).waitFor({ state: "detached" });
    assert.equal(await focused(page), "Edit");
    assert.deepEqual(await controlNames(page), []);
    assert.deepEqual(await writes(page), [{
      version: 3, order: ["demo.board", "start.new", "start.continue", "demo.auto", "demo.shared", "demo.empty", "demo.usage"], columns: { "start.continue": 2 }, removed: [], settings: {},
    }]);
    const before = await regions(page);
    assert.equal(before.map((region) => region.name).join(", "), "Work board, New, Continue, New auto items, Shared with the team, Model usage");
    await page.reload();
    await loaded(page);
    assert.deepEqual(await regions(page), before, "a reload keeps order, size, and the added widget");
    assert.deepEqual(await noHorizontalScroll(page), { page: 0, main: 0 });
  }, 1500);
});

for (const engine of ["chromium", "webkit"] as const) {
  test(`resizing by the right edge snaps column by column with the real mouse, never fights moving, and Done keeps it across a reload (${engine})`, browserOnly, async () => {
    await withPage(1280, "", async (page) => {
      await edit(page);
      const grid = await gridOf(page);
      const handle = await page.locator('[data-start-widget="start.continue"] [data-resize-handle]').boundingBox();
      const cell = await page.locator('[data-start-widget="start.continue"]').boundingBox();
      assert.ok(handle && cell && handle.width >= 20 && Math.abs(handle.height - cell.height) < 1, "the whole right edge is a wide enough handle");
      assert.equal(await page.locator('[data-start-widget="start.continue"] [data-resize-handle]').evaluate((element) => getComputedStyle(element).touchAction), "none");
      const remove = await page.getByRole("button", { name: "Remove Continue", exact: true }).boundingBox();
      assert.ok(remove && remove.x + remove.width <= handle.x + 0.5, "the handle leaves the remove button free");

      const continueEdge = await center(page, grip(page, "start.continue"));
      await drag(page, continueEdge, { x: continueEdge.x - 2 * grid.pitch, y: continueEdge.y }, async () => {
        assert.equal(await page.locator("[data-resize-label]").textContent(), "2 of 6 columns");
        assert.equal(await page.locator("[data-column-guides] > *").count(), 6);
        assert.equal(await page.locator('[data-start-widget="start.continue"]').getAttribute("data-dragging"), "resize");
        assert.equal(await page.locator("[data-dragging=move]").count(), 0, "a resize never starts a move");
      });
      assert.equal(await size(page, "start.continue"), 2);
      assert.ok(Math.abs((await box(page, "Continue")).width - spanWidth(grid, 2)) < 0.5);
      assert.deepEqual(await order(page), ["start.new", "start.continue", "demo.board", "demo.auto", "demo.shared", "demo.usage", "demo.empty"], "resizing keeps the order");

      const lower = await page.locator('[data-start-widget="start.continue"] [data-resize-handle]').boundingBox();
      const low = { x: lower!.x + lower!.width / 2, y: lower!.y + lower!.height - 8 };
      await page.mouse.move(low.x, low.y);
      await page.mouse.down();
      for (let column = 1; column <= 4; column += 1) {
        await page.mouse.move(low.x + (column - 0.5) * grid.pitch + 4, low.y, { steps: 3 });
        await becomes(page, "start.continue", 2 + column);
      }
      await page.mouse.up();
      assert.equal(await announced(page), "Continue is now 6 of 6 columns wide.");
      const [start, wide] = [await box(page, "New"), await box(page, "Continue")];
      assert.ok(wide.y > start.y && Math.abs(wide.width - spanWidth(grid, 6)) < 0.5, "a widget that no longer fits moves to the next row without overlapping");

      const newEdge = await center(page, grip(page, "start.new"));
      await drag(page, newEdge, { x: newEdge.x + grid.pitch, y: newEdge.y });
      assert.equal(await size(page, "start.new"), 3);
      assert.ok(Math.abs((await box(page, "New")).width - spanWidth(grid, 3)) < 0.5);

      const escape = await center(page, grip(page, "start.new"));
      await page.mouse.move(escape.x, escape.y);
      await page.mouse.down();
      for (let step = 1; step <= 6; step += 1) await page.mouse.move(escape.x + step * grid.pitch / 3, escape.y);
      await becomes(page, "start.new", 5);
      await page.keyboard.press("Escape");
      await page.mouse.up();
      await becomes(page, "start.new", 3);
      assert.equal(await announced(page), "Resizing New was cancelled.");
      assert.equal(await page.getByRole("group", { name: "Edit Start" }).isVisible(), true, "and keeps edit mode");

      const target = await page.getByRole("region", { name: "New", exact: true }).boundingBox();
      await drag(page, await center(page, page.getByRole("button", { name: "Move Continue", exact: true })), { x: target!.x + 24, y: target!.y + 48 }, async () => {
        assert.equal(await page.locator("[data-column-guides], [data-dragging=resize]").count(), 0, "moving shows no resize guides");
      });
      assert.deepEqual((await order(page)).slice(0, 3), ["start.continue", "start.new", "demo.board"]);
      assert.deepEqual([await size(page, "start.continue"), await size(page, "start.new")], [6, 3], "moving keeps the widths");
      await mkdir(shots, { recursive: true });
      await page.screenshot({ path: join(shots, `start-dashboard-edit-resized-${engine}.png`), fullPage: true });
      await page.getByRole("button", { name: "Done", exact: true }).click();
      await page.getByRole("group", { name: "Edit Start" }).waitFor({ state: "detached" });
      assert.deepEqual(await writes(page), [{
        version: 3, order: ["start.continue", "start.new", "demo.board", "demo.auto", "demo.shared", "demo.usage", "demo.empty"], columns: { "start.continue": 6, "start.new": 3 }, removed: [], settings: {},
      }]);
      const before = await regions(page);
      await page.reload();
      await loaded(page);
      assert.deepEqual(await regions(page), before, "a reload keeps order and widths");
      assert.deepEqual(await noHorizontalScroll(page), { page: 0, main: 0 });
    }, 1500, engine);
  });
}

test("at medium widths the edge snaps to the three columns shown and stores the most columns that show the width", browserOnly, async () => {
  await withPage(900, "", async (page) => {
    await edit(page);
    const grid = await gridOf(page);
    assert.equal(grid.columns, 3);
    assert.equal(await page.locator('[data-start-widget="start.new"] [data-widget-columns]').textContent(), "1 of 3");
    const edge = await center(page, grip(page, "start.new"));
    await drag(page, edge, { x: edge.x + grid.pitch, y: edge.y }, async () => {
      assert.equal(await page.locator("[data-column-guides] > *").count(), 3);
      assert.equal(await page.locator("[data-resize-label]").textContent(), "2 of 3 columns");
    });
    assert.equal(await size(page, "start.new"), 4);
    assert.ok(Math.abs((await box(page, "New")).width - spanWidth(grid, 2)) < 0.5);
    await page.getByRole("button", { name: "Move New", exact: true }).focus();
    await page.keyboard.press("Shift+ArrowLeft");
    assert.equal(await size(page, "start.new"), 2);
    assert.equal(await announced(page), "New is now 1 of 3 columns wide.");
    assert.deepEqual(await noHorizontalScroll(page), { page: 0, main: 0 });
  });
});

test("from 360 to 2560 pixels widgets never overlap and the page never scrolls sideways, in view and edit mode", browserOnly, async () => {
  for (const width of [360, 800, 1280, 1920, 2560]) {
    await withPage(width, "widgets=many", async (page) => {
      const overlaps = () => page.locator("[data-start-widget]:not([hidden])").evaluateAll((cells) => {
        const boxes = cells.map((cell) => ({ key: cell.getAttribute("data-start-widget"), bounds: cell.getBoundingClientRect() }));
        return boxes.flatMap((left, index) => boxes.slice(index + 1).filter((right) => left.bounds.left < right.bounds.right - 0.5 && right.bounds.left < left.bounds.right - 0.5
          && left.bounds.top < right.bounds.bottom - 0.5 && right.bounds.top < left.bounds.bottom - 0.5).map((right) => `${left.key} and ${right.key}`));
      });
      const outside = () => page.locator("[data-dashboard]").evaluate((grid) => {
        const bounds = grid.getBoundingClientRect();
        return [...grid.querySelectorAll<HTMLElement>(":scope > [data-start-widget]:not([hidden])")].filter((cell) => {
          const box = cell.getBoundingClientRect();
          return box.left < bounds.left - 0.5 || box.right > bounds.right + 0.5;
        }).map((cell) => cell.dataset.startWidget);
      });
      for (const editing of [false, true]) {
        if (editing) await edit(page);
        await settled(page);
        assert.deepEqual(await overlaps(), [], `no overlap at ${width} pixels${editing ? " while editing" : ""}`);
        assert.deepEqual(await outside(), [], `every widget stays inside the grid at ${width} pixels`);
        assert.deepEqual(await noHorizontalScroll(page), { page: 0, main: 0 }, `no horizontal scroll at ${width} pixels${editing ? " while editing" : ""}`);
        if (width >= 700) checkPacked(await packedCells(page), `${width} pixels${editing ? " while editing" : ""}`);
        await mkdir(shots, { recursive: true });
        await page.screenshot({ path: join(shots, `start-dashboard-${editing ? "edit" : "view"}-${width}.png`), fullPage: true });
      }
    });
  }
});

test("Cancel and Escape discard the draft, and Escape during a drag cancels only the drag", browserOnly, async () => {
  await withPage(1280, "", async (page) => {
    const before = await regions(page);
    await edit(page);
    await page.getByRole("button", { name: "Remove Work board", exact: true }).click();
    await page.getByRole("button", { name: "Move Continue", exact: true }).focus();
    await page.keyboard.press("Shift+ArrowLeft");
    await page.getByRole("button", { name: "Cancel", exact: true }).click();
    await page.getByRole("group", { name: "Edit Start" }).waitFor({ state: "detached" });
    assert.deepEqual(await regions(page), before, "Cancel restores the stored layout");
    assert.equal(await announced(page), "Changes discarded.");
    assert.equal(await focused(page), "Edit");

    await edit(page);
    const handle = await center(page, page.getByRole("button", { name: "Move Model usage", exact: true }));
    const target = await page.getByRole("region", { name: "New", exact: true }).boundingBox();
    await page.mouse.move(handle.x, handle.y);
    await page.mouse.down();
    for (let step = 1; step <= 12; step += 1) await page.mouse.move(handle.x + (target!.x + 24 - handle.x) * step / 12, handle.y + (target!.y + 48 - handle.y) * step / 12);
    assert.equal((await order(page))[0], "demo.usage");
    await page.keyboard.press("Escape");
    await page.mouse.up();
    assert.equal((await order(page))[0], "start.new", "Escape puts the dragged widget back");
    assert.equal(await page.getByRole("group", { name: "Edit Start" }).isVisible(), true, "and keeps edit mode");
    await page.getByRole("button", { name: "Remove New", exact: true }).click();
    await page.keyboard.press("Escape");
    await page.getByRole("group", { name: "Edit Start" }).waitFor({ state: "detached" });
    assert.deepEqual(await regions(page), before, "Escape leaves edit mode without saving");
    assert.deepEqual(await writes(page), []);
  }, 1500);
});

test("the keyboard moves a widget with the arrow keys, sizes it with Shift and the arrow keys, removes it with Delete, and announces each change", browserOnly, async () => {
  await withPage(1280, "", async (page) => {
    await edit(page);
    const handle = page.getByRole("button", { name: "Move Continue", exact: true });
    assert.equal(await handle.evaluate((button) => document.getElementById(button.getAttribute("aria-describedby")!)!.textContent),
      "Arrow keys move the widget, Shift with Left or Right changes its width by one column, Delete removes it.");
    await handle.focus();
    await page.keyboard.press("ArrowLeft");
    assert.equal((await order(page))[0], "start.continue");
    assert.equal(await announced(page), "Continue moved to place 1 of 7.");
    assert.equal(await focused(page), "Move Continue", "focus stays on the moved widget");
    await page.keyboard.press("ArrowUp");
    assert.equal(await announced(page), "Continue is already first.");
    await page.keyboard.press("Shift+ArrowLeft");
    assert.equal(await size(page, "start.continue"), 3);
    assert.equal(await announced(page), "Continue is now 3 of 6 columns wide.");
    assert.ok(Math.abs((await box(page, "Continue")).width - spanWidth(await gridOf(page), 3)) < 0.5);
    await page.keyboard.press("Shift+ArrowLeft");
    assert.equal(await size(page, "start.continue"), 2);
    await page.keyboard.press("Shift+ArrowLeft");
    assert.equal(await announced(page), "Continue is already at its narrowest.", "minColumns ends the steps");
    await page.keyboard.press("Shift+ArrowUp");
    assert.equal(await size(page, "start.continue"), 2, "Shift with Up moves instead of resizing");
    assert.equal(await announced(page), "Continue is already first.");
    await page.getByRole("button", { name: "Move Model usage", exact: true }).focus();
    await page.keyboard.press("Shift+ArrowRight");
    await page.keyboard.press("Shift+ArrowRight");
    assert.equal(await size(page, "demo.usage"), 3);
    await page.keyboard.press("Shift+ArrowRight");
    assert.equal(await announced(page), "Model usage is already at its widest.", "only the widths the widget offers");
    await page.keyboard.press("ArrowDown");
    assert.equal((await order(page)).at(-1), "demo.usage");
    await handle.focus();
    await page.keyboard.press("Delete");
    assert.equal(await page.getByRole("region", { name: "Continue" }).count(), 0);
    assert.equal(await announced(page), "Continue removed from Start.");
    assert.equal(await focused(page), "Move New", "focus moves to the next widget");
    await page.getByRole("button", { name: "Add widget", exact: true }).focus();
    await page.keyboard.press("Enter");
    await page.getByRole("dialog", { name: "Add widget" }).waitFor();
    await page.keyboard.press("Escape");
    await page.getByRole("dialog", { name: "Add widget" }).waitFor({ state: "detached" });
    assert.equal(await page.getByRole("group", { name: "Edit Start" }).isVisible(), true, "Escape in the gallery closes only the gallery");
    assert.equal(await focused(page), "Add widget");
    await page.getByRole("button", { name: "Done", exact: true }).click();
    await page.getByRole("group", { name: "Edit Start" }).waitFor({ state: "detached" });
    assert.deepEqual(await writes(page), [{
      version: 3, order: ["start.new", "demo.board", "demo.auto", "demo.shared", "demo.empty", "demo.usage"], columns: { "demo.usage": 3 }, removed: ["start.continue"], settings: {},
    }]);
    assert.equal(await announced(page), "Start layout saved.");
  }, 1500);
});

test("a narrow Start edits a vertical list with handles, up and down, remove, and Add widget, without sizes", browserOnly, async () => {
  await withPage(560, "", async (page) => {
    await page.getByRole("button", { name: "Edit", exact: true }).click();
    await page.getByRole("group", { name: "Edit Start" }).waitFor();
    assert.equal(await page.locator("[data-dashboard]").getAttribute("data-dashboard"), "list");
    assert.equal(await page.getByRole("tablist").count(), 0, "the list replaces the tabs");
    assert.equal(await page.locator("[data-resize-handle], [data-widget-columns]").count(), 0, "widths are not offered");
    assert.equal(await page.getByRole("list", { name: "Templates" }).isVisible(), false, "the rows show only the titles");
    assert.equal(await page.getByRole("region", { name: "Legacy notes" }).isVisible(), false, "a section without a title waits until editing ends");
    const rows = await page.locator("[data-start-widget]").evaluateAll((cells) => cells.map((cell) => cell.getBoundingClientRect()).map(({ x, width }) => ({ x, width })));
    assert.ok(rows.every((row) => Math.abs(row.x - rows[0]!.x) < 1 && Math.abs(row.width - rows[0]!.width) < 1), "one row per widget in a single column");
    assert.equal(await page.getByRole("button", { name: "Move New up", exact: true }).isDisabled(), true);
    await page.getByRole("button", { name: "Move Continue up", exact: true }).click();
    assert.deepEqual((await order(page)).slice(0, 2), ["start.continue", "start.new"]);
    assert.equal(await focused(page), "Move Continue", "focus falls back to the handle when up is no longer possible");
    await page.keyboard.press("Shift+ArrowRight");
    assert.equal(await announced(page), "Widths are chosen on a wider Start.");
    const target = await page.locator('[data-start-widget="start.continue"]').boundingBox();
    await drag(page, await center(page, page.getByRole("button", { name: "Move Model usage", exact: true })), { x: target!.x + 40, y: target!.y + 4 }, async () => {
      assert.equal((await order(page))[0], "demo.usage", "the list follows the pointer");
    });
    assert.deepEqual((await order(page)).slice(0, 3), ["demo.usage", "start.continue", "start.new"]);
    await page.getByRole("button", { name: "Remove New auto items", exact: true }).click();
    await page.getByRole("button", { name: "Add widget", exact: true }).click();
    await page.getByRole("dialog", { name: "Add widget" }).getByRole("button", { name: "Add New auto items" }).click();
    assert.equal((await order(page)).at(-1), "demo.auto");
    await settled(page);
    await mkdir(shots, { recursive: true });
    await page.screenshot({ path: join(shots, "start-dashboard-edit-560.png") });
    assert.deepEqual(await noHorizontalScroll(page), { page: 0, main: 0 });
    await page.getByRole("button", { name: "Done", exact: true }).click();
    await page.getByRole("tablist", { name: "Start widgets" }).waitFor();
    assert.deepEqual((await tabNames(page)).slice(0, 3), ["Model usage", "Continue", "New"], "the tabs follow the saved order");
    assert.equal((await tabNames(page)).at(-1), "New auto items");
  });
  await withPage(360, "widgets=many", async (page) => {
    await edit(page);
    assert.deepEqual(await noHorizontalScroll(page), { page: 0, main: 0 }, "no horizontal page scroll at 360 pixels while editing");
    const bar = await page.getByRole("group", { name: "Edit Start" }).boundingBox();
    const done = await page.getByRole("button", { name: "Done", exact: true }).boundingBox();
    assert.ok(bar && done && done.x + done.width <= bar.x + bar.width, "the mode indicator keeps its buttons inside");
    await page.screenshot({ path: join(shots, "start-dashboard-edit-360.png"), fullPage: true });
  });
});

const tabNames = async (page: Page) => {
  const shown = await page.getByRole("tablist", { name: "Start widgets" }).getByRole("tab").allTextContents();
  const more = page.getByRole("button", { name: "More tabs" });
  if (await more.count() === 0) return shown;
  await more.click();
  await page.getByRole("menu").getByRole("menuitemradio").first().waitFor();
  const hidden = (await page.getByRole("menu").getByRole("menuitemradio").allTextContents()).map((text) => text.replace(/(\D)(\d+)$/, "$1 $2"));
  await page.keyboard.press("Escape");
  await page.getByRole("menu").waitFor({ state: "detached" });
  return [...shown, ...hidden];
};

test("edit mode reads clearly in light and dark and every palette without moving the widgets", browserOnly, async () => {
  await withPage(1280, "", async (page) => {
    const before = await regions(page);
    await edit(page);
    const shown = new Set(before.map((region) => region.name));
    assert.deepEqual((await regions(page)).filter((region) => shown.has(region.name)).map(({ name, x, width }) => ({ name, x, width })), before.map(({ name, x, width }) => ({ name, x, width })),
      "entering edit mode keeps every widget's column and width");
    for (const theme of ["light", "dark"] as const) {
      for (const palette of ["schichtwerk", "graphite", "midnight", "black"]) {
        await page.evaluate(([mode, colors]) => {
          document.documentElement.setAttribute("data-theme", mode!);
          document.documentElement.setAttribute("data-palette", colors!);
        }, [theme, palette]);
        await settled(page);
        const colors = await page.evaluate(() => {
          const bar = document.querySelector<HTMLElement>("[role=group][aria-label='Edit Start']")!;
          const cell = document.querySelector<HTMLElement>("[data-start-widget]")!;
          const app = document.querySelector<HTMLElement>(".bg-app")!;
          return { bar: getComputedStyle(bar).backgroundColor, text: getComputedStyle(bar).color, frame: getComputedStyle(cell).outlineColor, app: getComputedStyle(app).backgroundColor };
        });
        assert.doesNotMatch(colors.bar, /rgba\(0, 0, 0, 0\)|transparent/, `the mode indicator has a surface (${theme}, ${palette})`);
        assert.notEqual(colors.text, colors.bar);
        assert.notEqual(colors.frame, colors.app, `the frames stand out (${theme}, ${palette})`);
        if (palette === "schichtwerk") {
          await mkdir(shots, { recursive: true });
          await page.screenshot({ path: join(shots, `start-dashboard-edit-${theme}.png`) });
          await page.getByRole("button", { name: "Add widget", exact: true }).click();
          const gallery = page.getByRole("dialog", { name: "Add widget" });
          await gallery.waitFor();
          await settled(page);
          assert.doesNotMatch(await gallery.evaluate((element) => getComputedStyle(element).backgroundColor), /rgba\(0, 0, 0, 0\)|transparent/);
          await page.screenshot({ path: join(shots, `start-dashboard-edit-gallery-${theme}.png`) });
          await page.keyboard.press("Escape");
          await gallery.waitFor({ state: "detached" });
        }
      }
    }
  });
});

test("a layout that cannot be loaded keeps the default layout and offers Retry; one that cannot be saved keeps the draft", browserOnly, async () => {
  await withPage(1280, "preferences=fail", async (page) => {
    const alert = page.getByRole("alert");
    assert.equal(await alert.textContent(), "The Start layout could not be loaded: The server is unreachable.Retry");
    assert.equal(await page.getByRole("button", { name: "Edit", exact: true }).isDisabled(), true, "nothing can overwrite a layout that was not read");
    assert.equal((await order(page))[0], "start.new");
  });
  await withPage(1280, "", async (page) => {
    await page.evaluate(() => localStorage.setItem("start-dashboard-fixture:start.layout", JSON.stringify({ version: 1, order: ["start.continue"], spans: { "start.continue": "narrow" }, removed: ["demo.board"] })));
    await page.reload();
    await loaded(page);
    assert.equal(await page.getByRole("alert").count(), 0, "a layout with the former named sizes is ignored without a problem");
    assert.deepEqual((await order(page)).slice(0, 3), ["start.new", "start.continue", "demo.board"], "and Start shows its default layout");
    await page.evaluate(() => localStorage.setItem("start-dashboard-fixture:start.layout", JSON.stringify({ version: 2, order: ["demo.board"], columns: {}, removed: [] })));
    await page.reload();
    await loaded(page);
    assert.equal(await page.getByRole("alert").count(), 0, "a layout from before widget settings is ignored without a problem");
    assert.deepEqual((await order(page)).slice(0, 3), ["start.new", "start.continue", "demo.board"]);
    await page.evaluate(() => localStorage.setItem("start-dashboard-fixture:start.layout", JSON.stringify({ version: 3, order: [], columns: {}, hidden: [], settings: {} })));
    await page.reload();
    await loaded(page);
    assert.match((await page.getByRole("alert").textContent())!,
      /^The saved Start layout could not be read: expected the fields columns, order, removed, settings, version, found columns, hidden, order, settings, version\. Saving a layout in Edit replaces it\.$/);
    await edit(page);
    await page.evaluate(() => { window.dashboardFixture.failWrites = true; });
    await page.getByRole("button", { name: "Remove Work board", exact: true }).click();
    await page.getByRole("button", { name: "Done", exact: true }).click();
    assert.equal(await page.getByRole("alert").textContent(), "The layout could not be saved: The disk is full.");
    assert.equal(await page.getByRole("group", { name: "Edit Start" }).isVisible(), true, "the draft stays for another try");
    await page.evaluate(() => { window.dashboardFixture.failWrites = false; });
    await page.getByRole("button", { name: "Done", exact: true }).click();
    await page.getByRole("group", { name: "Edit Start" }).waitFor({ state: "detached" });
    assert.equal(await page.getByRole("alert").count(), 0, "saving replaced the unreadable layout");
    assert.deepEqual(await writes(page), [{ version: 3, order: [], columns: {}, removed: ["demo.board"], settings: {} }]);
  });
});

const setApps = (page: Page, names: readonly string[]) => page.evaluate((list) => window.dashboardFixture.setApps!(list), names);

test("published widgets are moved, resized, removed, and added back like listed ones, survive disappearing while Start is edited, and a failing one keeps its error in its own cell", browserOnly, async () => {
  await withPage(1280, "dynamic=1", async (page) => {
    await page.getByRole("region", { name: "Planner", exact: true }).waitFor();
    const broken = page.locator('[data-start-widget="demo.apps:broken"]');
    assert.equal(await broken.getByRole("alert").textContent(), "The app view failed to load.", "a widget that throws shows its cause in its own cell");
    assert.equal(await broken.getByRole("button", { name: "Retry" }).count(), 1);
    const failing = page.locator('[data-start-widget="demo.failing:unavailable"]');
    assert.equal(await failing.getByRole("alert").textContent(), "The app catalog is unreachable.", "a failing factory shows its cause in a widget of its own");
    assert.equal(await page.getByRole("list", { name: "Recent" }).isVisible(), true, "the other widgets stay usable");
    assert.deepEqual((await order(page)).slice(-3), ["demo.apps:broken", "demo.apps:planner", "demo.failing:unavailable"], "published widgets follow the listed ones by order and ID");

    await edit(page);
    assert.equal(await broken.getByRole("alert").isVisible(), true, "the error stays in its cell while editing");
    const target = await page.getByRole("region", { name: "New", exact: true }).boundingBox();
    await drag(page, await center(page, page.getByRole("button", { name: "Move Planner", exact: true })), { x: target!.x + 24, y: target!.y + 48 });
    assert.equal((await order(page))[0], "demo.apps:planner");
    await setApps(page, ["broken"]);
    await page.getByRole("region", { name: "Planner", exact: true }).waitFor({ state: "detached" });
    assert.equal(await page.getByRole("group", { name: "Edit Start" }).isVisible(), true, "a widget that disappears leaves edit mode working");
    await setApps(page, ["broken", "planner"]);
    await page.getByRole("region", { name: "Planner", exact: true }).waitFor();
    assert.equal((await order(page))[0], "demo.apps:planner", "and returns to its place in the draft");

    await page.getByRole("button", { name: "Remove Planner", exact: true }).click();
    assert.equal(await page.getByRole("region", { name: "Planner", exact: true }).count(), 0);
    await page.getByRole("button", { name: "Add widget", exact: true }).click();
    const gallery = page.getByRole("dialog", { name: "Add widget" });
    const offer = gallery.getByRole("button", { name: "Add Planner" });
    assert.equal(await offer.evaluate((button) => document.getElementById(button.getAttribute("aria-describedby")!)!.textContent), "Plans the week from your runs.Width: 3 of 6 columns, adjustable from 2 to 4");
    await offer.click();
    await gallery.waitFor({ state: "detached" });
    assert.equal((await order(page)).at(-1), "demo.apps:planner", "an added dynamic widget joins at the end");
    assert.equal(await size(page, "demo.apps:planner"), 3);
    await page.keyboard.press("Shift+ArrowRight");
    assert.equal(await size(page, "demo.apps:planner"), 4);
    await page.keyboard.press("Shift+ArrowRight");
    assert.equal(await announced(page), "Planner is already at its widest.", "only the widths the widget offers");
    await page.getByRole("button", { name: "Remove Broken app", exact: true }).click();
    await page.getByRole("button", { name: "Done", exact: true }).click();
    await page.getByRole("group", { name: "Edit Start" }).waitFor({ state: "detached" });
    assert.deepEqual(await writes(page), [{
      version: 3, order: ["start.new", "start.continue", "demo.board", "demo.auto", "demo.shared", "demo.usage", "demo.empty", "demo.failing:unavailable", "demo.apps:planner"],
      columns: { "demo.apps:planner": 4 }, removed: ["demo.apps:broken"], settings: {},
    }]);
    await mkdir(shots, { recursive: true });
    await page.screenshot({ path: join(shots, "start-dashboard-dynamic-1280.png"), fullPage: true });

    await page.reload();
    await loaded(page);
    await page.getByRole("region", { name: "Planner", exact: true }).waitFor();
    assert.equal((await order(page)).at(-1), "demo.apps:planner", "a reload keeps the place of a dynamic widget");
    assert.equal(await broken.count(), 0, "and its removal");
    const [planner, more] = [await box(page, "Planner"), await box(page, "Continue")];
    assert.ok(Math.abs(planner.width - more.width) < 1, "and its width");
    await setApps(page, []);
    await page.getByRole("region", { name: "Planner", exact: true }).waitFor({ state: "detached" });
    await edit(page);
    await setApps(page, ["broken", "planner"]);
    await page.getByRole("region", { name: "Planner", exact: true }).waitFor();
    assert.equal((await order(page)).at(-1), "demo.apps:planner", "a widget that arrives while Start is edited takes its saved place");
    assert.equal(await size(page, "demo.apps:planner"), 4, "and its saved width");
    assert.equal(await broken.count(), 0, "a removed one stays removed");
    await page.getByRole("button", { name: "Cancel", exact: true }).click();
    await page.getByRole("group", { name: "Edit Start" }).waitFor({ state: "detached" });
  }, 2400);
});

/** A widget's cell without its place and with its own ID and title neutralized, so two cells compare by everything else. */
const cellMarkup = (page: Page, key: string, title: string) => page.locator(`[data-start-widget="${key}"]`).evaluate((cell, [id, name]) =>
  cell.outerHTML.replace(/ style="[^"]*"/g, "").replaceAll(id, "ID").replaceAll(name, "TITLE"), [key, title] as const);

test("a listed and a published widget with the same fields behave identically in layout, edit mode, and settings", browserOnly, async () => {
  await withPage(1280, "case=twins", async (page) => {
    await page.getByRole("region", { name: "Published twin", exact: true }).waitFor();
    const twins = [["demo.twin", "Listed twin"], ["demo.twins:twin", "Published twin"]] as const;
    const same = async (label: string) => {
      const [listed, published] = await Promise.all(twins.map(([key, title]) => cellMarkup(page, key, title)));
      assert.equal(published, listed, label);
    };
    assert.deepEqual(await order(page), ["start.new", "start.continue", "demo.twin", "demo.twins:twin"], "both sort among Start's widgets by order and then ID");
    const [listed, published] = [await box(page, "Listed twin"), await box(page, "Published twin")];
    const grid = await gridOf(page);
    assert.ok(Math.abs(listed.width - spanWidth(grid, 2)) < 0.5 && Math.abs(published.width - listed.width) < 0.5, "both take their two columns");
    assert.ok(Math.abs(listed.height - published.height) < 1, "both have the same height");
    checkPacked(await packedCells(page), "listed and published twins");
    await same("the same frame and content in view mode");

    await edit(page);
    await same("the same controls in edit mode");
    for (const [key, title] of twins) {
      await page.getByRole("button", { name: `Move ${title}`, exact: true }).focus();
      await page.keyboard.press("Shift+ArrowRight");
      assert.equal(await announced(page), `${title} is now 3 of 6 columns wide.`);
      await page.keyboard.press("Shift+ArrowRight");
      assert.equal(await announced(page), `${title} is already at its widest.`, "both offer the same widths");
      assert.equal(await size(page, key), 3);
      await configureNumber(page, title, "Rows", "3");
      assert.equal(await rows(page, `${title} rows`), 3);
    }
    await same("the same width and settings after the same changes");
    await click(page, page.getByRole("button", { name: "Done", exact: true }));
    await page.getByRole("group", { name: "Edit Start" }).waitFor({ state: "detached" });
    const [saved] = await writes(page) as { columns: unknown; settings: unknown }[];
    assert.deepEqual([saved?.columns, saved?.settings], [{ "demo.twin": 3, "demo.twins:twin": 3 }, { "demo.twin": { rows: 3 }, "demo.twins:twin": { rows: 3 } }]);

    await edit(page);
    for (const [, title] of twins) await page.getByRole("button", { name: `Remove ${title}`, exact: true }).click();
    await page.getByRole("button", { name: "Add widget", exact: true }).click();
    const gallery = page.getByRole("dialog", { name: "Add widget" });
    const offers = await Promise.all(twins.map(([, title]) => gallery.getByRole("button", { name: `Add ${title}` })
      .evaluate((button) => document.getElementById(button.getAttribute("aria-describedby")!)!.textContent)));
    assert.match(offers[0] ?? "", /^Shows as many rows as its setting says\.Width: \d of 6 columns, adjustable from 1 to 3$/);
    assert.equal(offers[1], offers[0], "the gallery offers both alike");
  }, 2400);
});

test("the owner's case: Continue moves up under the short New beside the tall Topics, from 800 to 2560 pixels, without holes, overlap, or sideways scrolling", browserOnly, async () => {
  for (const width of [800, 1280, 1920, 2560]) {
    await withPage(width, "case=owner", async (page) => {
      await page.getByRole("list", { name: "Topics entries" }).waitFor();
      const packed = await packedCells(page);
      checkPacked(packed, `${width} pixels`);
      assert.deepEqual(packed.cells.map((cell) => cell.key), ["start.new", "demo.topics", "start.continue"]);
      const [start, topics, more] = ["start.new", "demo.topics", "start.continue"].map((key) => placeOf(packed, key));
      if (width >= 1100) {
        assert.equal(packed.columns, 6);
        assert.ok(start.column === 0 && topics.column === 3 && start.top === 0 && topics.top === 0, "New and Topics share the first row");
        assert.ok(topics.bottom > start.bottom + 100, "Topics is much taller than New");
        assert.equal(more.column, 0, "Continue stands under New");
        assert.ok(Math.abs(more.top - (start.bottom + packed.gapY)) < 1 && more.top < topics.bottom, "one gap below New, beside Topics instead of below it");
      } else assert.equal(packed.columns, 3);
      assert.deepEqual(await noHorizontalScroll(page), { page: 0, main: 0 });
      await mkdir(shots, { recursive: true });
      await page.screenshot({ path: join(shots, `start-dashboard-owner-${width}.png`), fullPage: true });
    });
  }
});

test("in the owner's case the mouse moves Continue before New and back, resizing New re-packs live, the keyboard moves Continue, and a reload keeps the packed layout", browserOnly, async () => {
  await withPage(1280, "case=owner", async (page) => {
    await page.getByRole("list", { name: "Topics entries" }).waitFor();
    await edit(page);
    const start = await page.getByRole("region", { name: "New", exact: true }).boundingBox();
    await drag(page, await center(page, page.getByRole("button", { name: "Move Continue", exact: true })), { x: start!.x + 24, y: start!.y + 48 }, async () => {
      assert.deepEqual(await order(page), ["start.continue", "start.new", "demo.topics"], "the grid follows the pointer before the drop");
      checkPacked(await packedCells(page), "while dragging Continue before New");
    });
    assert.deepEqual(await order(page), ["start.continue", "start.new", "demo.topics"]);
    assert.equal(await announced(page), "Continue moved to place 1 of 3.");
    const before = await packedCells(page);
    checkPacked(before, "Continue before New");
    assert.equal(await page.locator("[data-pack]").evaluateAll((cells) => cells.filter((cell) => cell.getAnimations().length > 0).length), 0, "with reduced motion nothing slides or transitions");
    assert.deepEqual([placeOf(before, "start.continue"), placeOf(before, "start.new")].map(({ column, top }) => [column, top]), [[0, 0], [3, 0]], "Continue takes the first place, New the one beside it");
    await mkdir(shots, { recursive: true });
    await page.screenshot({ path: join(shots, "start-dashboard-owner-moved.png"), fullPage: true });

    const grid = await page.locator("[data-dashboard]").boundingBox();
    const handle = await center(page, page.getByRole("button", { name: "Move Continue", exact: true }));
    await drag(page, handle, { x: handle.x, y: grid!.y + grid!.height + 24 });
    assert.deepEqual(await order(page), ["start.new", "demo.topics", "start.continue"], "below every widget the pointer puts Continue back at the end");
    const back = await packedCells(page);
    checkPacked(back, "Continue back at the end");
    assert.deepEqual([placeOf(back, "start.continue").column, placeOf(back, "demo.topics").column], [0, 3], "and under New again");

    const edge = await center(page, grip(page, "start.new"));
    await drag(page, edge, { x: edge.x + back.pitch, y: edge.y }, async () => {
      assert.equal(await size(page, "start.new"), 4);
      const live = await packedCells(page);
      checkPacked(live, "while New grows");
      assert.deepEqual([placeOf(live, "demo.topics").column, placeOf(live, "start.continue").column], [0, 3], "Topics no longer fits beside New and Continue fills the room beside Topics");
      await page.screenshot({ path: join(shots, "start-dashboard-owner-resize.png"), fullPage: true });
    });
    assert.equal(await announced(page), "New is now 4 of 6 columns wide.");
    const wider = await grip(page, "start.new").boundingBox();
    await drag(page, { x: wider!.x + wider!.width / 2, y: wider!.y + wider!.height / 2 }, { x: wider!.x + wider!.width / 2 - back.pitch, y: wider!.y + wider!.height / 2 });
    assert.equal(await size(page, "start.new"), 3);
    assert.deepEqual((await packedCells(page)).cells.map(({ key, left, top }) => ({ key, left, top })), back.cells.map(({ key, left, top }) => ({ key, left, top })), "the former width brings back the former places");

    await page.getByRole("button", { name: "Move Continue", exact: true }).focus();
    await page.keyboard.press("ArrowUp");
    assert.equal(await announced(page), "Continue moved to place 2 of 3.");
    assert.equal(await slides(page), 0, "with reduced motion nothing slides");
    const keyed = await packedCells(page);
    checkPacked(keyed, "after ArrowUp");
    assert.deepEqual(["start.new", "start.continue", "demo.topics"].map((key) => [placeOf(keyed, key).column, Math.round(placeOf(keyed, key).top)]),
      [[0, 0], [3, 0], [0, Math.round(placeOf(keyed, "start.new").bottom + keyed.gapY)]], "Continue moves beside New and Topics under the shorter New");
    await page.keyboard.press("ArrowDown");
    assert.deepEqual(await order(page), ["start.new", "demo.topics", "start.continue"]);
    assert.equal(await focused(page), "Move Continue");
    await page.keyboard.press("ArrowUp");

    await page.getByRole("button", { name: "Done", exact: true }).click();
    await page.getByRole("group", { name: "Edit Start" }).waitFor({ state: "detached" });
    assert.deepEqual(await writes(page), [{ version: 3, order: [], columns: { "start.new": 3, "start.continue": 3 }, removed: [], settings: {} }]);
    const saved = await packedCells(page);
    checkPacked(saved, "after Done");
    await page.reload();
    await loaded(page);
    await page.getByRole("list", { name: "Topics entries" }).waitFor();
    assert.deepEqual(await packedCells(page), saved, "a reload keeps order, widths, and places");
  }, 1500);
});

test("a widget whose content grows pushes the widgets below it before the next paint", browserOnly, async () => {
  await withPage(1280, "", async (page) => {
    const before = await packedCells(page);
    const result = await page.evaluate(() => new Promise<{ grown: number; problems: string[] }>((resolve) => {
      const grid = document.querySelector<HTMLElement>("[data-dashboard]")!;
      const board = grid.querySelector<HTMLElement>('[data-start-widget="demo.board"]')!;
      const gap = parseFloat(getComputedStyle(grid).rowGap);
      const height = board.getBoundingClientRect().height;
      const problems: string[] = [];
      // An observer made after Start's own one runs after it in the same frame, right before the paint.
      const observer = new ResizeObserver(() => {
        const bottom = board.getBoundingClientRect().bottom;
        for (const key of ["demo.auto", "demo.shared", "demo.usage"]) {
          const top = grid.querySelector(`[data-start-widget="${key}"]`)!.getBoundingClientRect().top;
          if (top < bottom + gap - 0.5) problems.push(`${key} at ${top} overlaps the board ending at ${bottom}`);
        }
        observer.disconnect();
        resolve({ grown: board.getBoundingClientRect().height - height, problems });
      });
      observer.observe(board);
      window.dashboardFixture.grow();
    }));
    assert.ok(result.grown > 100, `the board grew by ${result.grown} pixels`);
    assert.deepEqual(result.problems, []);
    const after = await packedCells(page);
    checkPacked(after, "after the board grew");
    const moved = (key: string) => placeOf(after, key).top - placeOf(before, key).top;
    assert.ok(["demo.auto", "demo.shared", "demo.usage"].every((key) => Math.abs(moved(key) - result.grown) < 1), "the widgets below move down by exactly the growth");
    assert.equal(moved("start.continue"), 0, "the widgets above stay");
  });
});

test("re-packing slides the widgets that move unless reduced motion is preferred, and the first paint slides nothing", browserOnly, async () => {
  await withPage(1280, "case=owner", async (page) => {
    await page.getByRole("list", { name: "Topics entries" }).waitFor();
    assert.equal(await slides(page), 0, "the first paint slides nothing");
    await edit(page);
    await slid(page);
    await page.getByRole("button", { name: "Move Continue", exact: true }).focus();
    await page.keyboard.press("ArrowUp");
    assert.ok(await slides(page) > 0, "the widgets that move slide to their new places");
    await slid(page);
    assert.equal(await slides(page), 0);
    checkPacked(await packedCells(page), "after the slides");
    const start = await page.getByRole("region", { name: "New", exact: true }).boundingBox();
    await drag(page, await center(page, page.getByRole("button", { name: "Move Continue", exact: true })), { x: start!.x + 24, y: start!.y + 48 }, async () => {
      assert.ok(await slides(page) > 0, "the grid slides while the pointer moves");
    });
    assert.deepEqual(await order(page), ["start.continue", "start.new", "demo.topics"], "the drop target follows the packed places, not the slides");
    await slid(page);
    checkPacked(await packedCells(page), "after dragging with slides");
  }, 1200, "chromium", "no-preference");
});

/** The rows a list renders, also while edit mode makes the widget's content inert. */
const rows = (page: Page, list: string) => page.locator(`ul[aria-label="${list}"] > li`).count();

const configureNames = (page: Page) => page.getByRole("button", { name: /^Configure / }).evaluateAll((buttons) => buttons.map((button) => button.getAttribute("aria-label")));

const click = async (page: Page, locator: ReturnType<Page["locator"]>) => {
  const point = await center(page, locator);
  await page.mouse.click(point.x, point.y);
};

/** Opens a widget's Configure dialog with the mouse, types a number into its field, and applies it. */
const configureNumber = async (page: Page, title: string, label: string, value: string) => {
  await click(page, page.getByRole("button", { name: `Configure ${title}`, exact: true }));
  const dialog = page.getByRole("dialog", { name: `Configure ${title}` });
  await dialog.waitFor();
  await dialog.getByLabel(label, { exact: true }).fill(value);
  await click(page, dialog.getByRole("button", { name: "Apply", exact: true }));
  await dialog.waitFor({ state: "detached" });
};

test("Configure in edit mode sets Continue to five runs with the mouse, Done keeps it across a reload, and Cancel discards a change", browserOnly, async () => {
  await withPage(1280, "", async (page) => {
    assert.equal(await rows(page, "Recent"), 15, "Continue lists fifteen runs by default");
    assert.deepEqual(await configureNames(page), [], "Configure belongs to edit mode only");
    await edit(page);
    assert.deepEqual(await configureNames(page), ["Configure New", "Configure Continue", "Configure Model usage"], "only widgets with settings offer Configure");

    await click(page, page.getByRole("button", { name: "Configure Continue", exact: true }));
    const dialog = page.getByRole("dialog", { name: "Configure Continue" });
    await dialog.waitFor();
    const field = dialog.getByLabel("Number of runs", { exact: true });
    assert.equal(await field.inputValue(), "15");
    assert.equal(await dialog.getByText("How many of the most recent runs Continue lists.").isVisible(), true);
    assert.equal(await dialog.evaluate((element) => element.contains(document.activeElement)), true, "the dialog takes focus");
    await field.fill("500");
    assert.equal(await dialog.getByRole("alert").textContent(), "This value is above the maximum 100.");
    await click(page, dialog.getByRole("button", { name: "Apply", exact: true }));
    assert.equal(await dialog.isVisible(), true, "an invalid value is not applied");
    assert.equal(await field.evaluate((input) => input === document.activeElement), true, "focus goes to the invalid field");
    await field.fill("5");
    assert.equal(await dialog.getByRole("alert").count(), 0);
    await mkdir(shots, { recursive: true });
    await settled(page);
    await page.screenshot({ path: join(shots, "start-dashboard-configure-1280.png") });
    await click(page, dialog.getByRole("button", { name: "Apply", exact: true }));
    await dialog.waitFor({ state: "detached" });
    assert.equal(await announced(page), "Continue settings applied; Done saves them.");
    assert.equal(await focused(page), "Configure Continue", "focus returns to Configure");
    assert.equal(await rows(page, "Recent"), 5, "the draft shows the new value at once");
    assert.deepEqual(await writes(page), [], "nothing is saved before Done");

    await click(page, page.getByRole("button", { name: "Done", exact: true }));
    await page.getByRole("group", { name: "Edit Start" }).waitFor({ state: "detached" });
    assert.deepEqual(await writes(page), [{ version: 3, order: [], columns: {}, removed: [], settings: { "start.continue": { runs: 5 } } }]);
    assert.equal(await rows(page, "Recent"), 5);
    assert.equal(await page.getByRole("button", { name: /^All 18 runs/ }).isVisible(), true, "the way to every run follows the shorter list");
    await page.reload();
    await loaded(page);
    assert.equal(await rows(page, "Recent"), 5, "a reload keeps the setting");

    await edit(page);
    await configureNumber(page, "Continue", "Number of runs", "8");
    assert.equal(await rows(page, "Recent"), 8);
    await click(page, page.getByRole("button", { name: "Cancel", exact: true }));
    await page.getByRole("group", { name: "Edit Start" }).waitFor({ state: "detached" });
    assert.equal(await rows(page, "Recent"), 5, "Cancel discards the applied setting");

    await edit(page);
    await click(page, page.getByRole("button", { name: "Configure Continue", exact: true }));
    await dialog.waitFor();
    assert.equal(await field.inputValue(), "5", "the dialog starts from the saved value");
    await field.fill("9");
    await click(page, dialog.getByRole("button", { name: "Cancel", exact: true }));
    await dialog.waitFor({ state: "detached" });
    assert.equal(await focused(page), "Configure Continue");
    await click(page, page.getByRole("button", { name: "Configure Continue", exact: true }));
    await dialog.waitFor();
    await field.fill("9");
    await page.keyboard.press("Escape");
    await dialog.waitFor({ state: "detached" });
    assert.equal(await page.getByRole("group", { name: "Edit Start" }).isVisible(), true, "Escape closes only the dialog");
    assert.equal(await rows(page, "Recent"), 5, "a dialog closed without Apply changes nothing");

    await click(page, page.getByRole("button", { name: "Configure New", exact: true }));
    const create = page.getByRole("dialog", { name: "Configure New" });
    await create.getByRole("switch", { name: "Show descriptions" }).click();
    await click(page, create.getByRole("button", { name: "Apply", exact: true }));
    await create.waitFor({ state: "detached" });
    assert.equal(await page.locator('ul[aria-label="Templates"] [data-slot="start-description"]').count(), 0, "New shows its templates without descriptions");
    await click(page, page.getByRole("button", { name: "Reset layout", exact: true }));
    assert.equal(await announced(page), "Start shows its default layout and settings again; Done saves them.");
    assert.equal(await rows(page, "Recent"), 15, "Reset layout also resets the settings");
    assert.equal(await page.locator('ul[aria-label="Templates"] [data-slot="start-description"]').count(), 5);
    await click(page, page.getByRole("button", { name: "Done", exact: true }));
    await page.getByRole("group", { name: "Edit Start" }).waitFor({ state: "detached" });
    assert.deepEqual((await writes(page)).at(-1), null, "the default layout and settings store nothing");
  }, 1500);
});

test("a plugin's listed and published widgets are configured exactly like Continue, also in the narrow list", browserOnly, async () => {
  await withPage(1280, "dynamic=1", async (page) => {
    await page.getByRole("region", { name: "Planner", exact: true }).waitFor();
    assert.equal(await rows(page, "Model usage entries"), 3);
    assert.equal(await rows(page, "Planner entries"), 1);
    await edit(page);
    assert.deepEqual(await configureNames(page), ["Configure New", "Configure Continue", "Configure Model usage", "Configure Planner"]);
    await configureNumber(page, "Continue", "Number of runs", "4");
    await configureNumber(page, "Model usage", "Entries", "2");
    await configureNumber(page, "Planner", "Days", "3");
    assert.deepEqual([await rows(page, "Recent"), await rows(page, "Model usage entries"), await rows(page, "Planner entries")], [4, 2, 3], "each widget renders its applied value");
    await click(page, page.getByRole("button", { name: "Done", exact: true }));
    await page.getByRole("group", { name: "Edit Start" }).waitFor({ state: "detached" });
    assert.deepEqual(await writes(page), [{
      version: 3, order: [], columns: {}, removed: [], settings: { "start.continue": { runs: 4 }, "demo.usage": { entries: 2 }, "demo.apps:planner": { days: 3 } },
    }]);
    await page.reload();
    await loaded(page);
    await page.getByRole("region", { name: "Planner", exact: true }).waitFor();
    assert.deepEqual([await rows(page, "Recent"), await rows(page, "Model usage entries"), await rows(page, "Planner entries")], [4, 2, 3], "a reload keeps every widget's setting");
  }, 1500);
  await withPage(560, "", async (page) => {
    await page.getByRole("button", { name: "Edit", exact: true }).click();
    await page.getByRole("group", { name: "Edit Start" }).waitFor();
    assert.deepEqual(await configureNames(page), ["Configure New", "Configure Continue", "Configure Model usage"], "the narrow list offers Configure as well");
    await configureNumber(page, "Model usage", "Entries", "1");
    await configureNumber(page, "Continue", "Number of runs", "3");
    await click(page, page.getByRole("button", { name: "Done", exact: true }));
    await page.getByRole("group", { name: "Edit Start" }).waitFor({ state: "detached" });
    assert.deepEqual(await writes(page), [{ version: 3, order: [], columns: {}, removed: [], settings: { "demo.usage": { entries: 1 }, "start.continue": { runs: 3 } } }]);
    await page.getByRole("tab", { name: "Continue" }).click();
    assert.equal(await rows(page, "Recent"), 3);
  });
});

test("a saved value a widget rejects is reported in that widget, which shows its default, the same for Continue and a plugin's widget", browserOnly, async () => {
  await withPage(1280, "", async (page) => {
    await page.evaluate(() => localStorage.setItem("start-dashboard-fixture:start.layout", JSON.stringify({
      version: 3, order: [], columns: {}, removed: [], settings: { "start.continue": { runs: 500 }, "demo.usage": { entries: "all", former: true } },
    })));
    await page.reload();
    await loaded(page);
    const problem = (key: string) => page.locator(`[data-start-widget="${key}"] [data-settings-problem]`).textContent();
    assert.equal(await problem("start.continue"), "Number of runs: the saved value 500 is above the maximum 100, so the default 15 applies.");
    assert.equal(await problem("demo.usage"), "Entries: the saved value \"all\" is not a number, so the default 3 applies.", "a key the widget does not declare is ignored");
    assert.equal(await rows(page, "Recent"), 15);
    assert.equal(await rows(page, "Model usage entries"), 3);
    await edit(page);
    await click(page, page.getByRole("button", { name: "Configure Continue", exact: true }));
    const dialog = page.getByRole("dialog", { name: "Configure Continue" });
    await dialog.waitFor();
    assert.equal(await dialog.getByRole("alert").textContent(), "Number of runs: the saved value 500 is above the maximum 100, so the default 15 applies. Apply replaces the saved values.");
    assert.equal(await dialog.getByLabel("Number of runs", { exact: true }).inputValue(), "15", "the form starts from the value the widget shows");
    await click(page, dialog.getByRole("button", { name: "Apply", exact: true }));
    await dialog.waitFor({ state: "detached" });
    assert.equal(await page.locator('[data-start-widget="start.continue"] [data-settings-problem]').count(), 0, "applying replaces the rejected value");
    await click(page, page.getByRole("button", { name: "Done", exact: true }));
    await page.getByRole("group", { name: "Edit Start" }).waitFor({ state: "detached" });
    assert.deepEqual(await writes(page), [{ version: 3, order: [], columns: {}, removed: [], settings: { "demo.usage": { entries: "all", former: true } } }],
      "a widget that was not configured keeps its saved values as they are");
  });
});
