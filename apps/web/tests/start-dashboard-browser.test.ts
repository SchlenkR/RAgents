import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";
import { chromium, type Browser, type Page } from "playwright-core";
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

const withPage = async (width: number, query: string, run: (page: Page, browser: Browser) => Promise<void>, height = 900) => {
  const url = await (fixture ??= buildFixture());
  const browser = await chromium.launch({ headless: true, executablePath: process.env.BROWSER_EXECUTABLE_PATH ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" });
  try {
    const page = await browser.newPage({ viewport: { width, height }, reducedMotion: "reduce" });
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
      await page.screenshot({ path: join(shots, `start-dashboard-failed-${width}-${query.replace(/[^a-z0-9]/gi, "-")}.png`), fullPage: true });
      throw cause;
    }
  } finally { await browser.close(); }
};

const box = async (page: Page, name: string) => {
  const bounds = await page.getByRole("region", { name, exact: true }).boundingBox();
  assert.ok(bounds, `${name} is visible`);
  return bounds;
};

const settled = (page: Page) => page.evaluate(() => Promise.all(document.getAnimations().map((animation) => animation.finished.catch(() => undefined))));

const noHorizontalScroll = (page: Page) => page.evaluate(() => {
  const main = document.querySelector<HTMLElement>("main[data-page]")!;
  return { page: document.documentElement.scrollWidth - innerWidth, main: main.scrollWidth - main.clientWidth };
});

test("a wide dashboard places widgets side by side by their spans and leaves out empty ones", browserOnly, async () => {
  await withPage(1280, "", async (page) => {
    assert.equal(await page.getByRole("tablist", { name: "Start widgets" }).count(), 0, "no tabs on a wide dashboard");
    const [start, more] = [await box(page, "New"), await box(page, "Continue")];
    assert.ok(Math.abs(start.y - more.y) < 1 && start.x < more.x, "New and Continue share the first row");
    const { width, gap } = await page.locator("[data-dashboard]").evaluate((element) => ({ width: element.getBoundingClientRect().width, gap: parseFloat(getComputedStyle(element).columnGap) }));
    const column = (width - 11 * gap) / 12;
    assert.ok(Math.abs(start.width - (4 * column + 3 * gap)) < 0.5 && Math.abs(more.width - (8 * column + 7 * gap)) < 0.5, "New takes four of twelve columns, Continue eight");
    const headings = await page.getByRole("heading", { level: 2 }).evaluateAll((elements) => elements.slice(0, 2).map((element) => {
      const bounds = element.getBoundingClientRect();
      return bounds.top + bounds.height / 2;
    }));
    assert.ok(Math.abs(headings[0]! - headings[1]!) < 1, "widget titles in one row stand at the same height, with or without an action");
    const board = await box(page, "Work board");
    assert.ok(board.y > more.y && board.width > more.width, "a widget without span fills its own row");
    const narrow = await Promise.all(["New auto items", "Shared with the team", "Model usage"].map((name) => box(page, name)));
    assert.ok(narrow.every((entry) => Math.abs(entry.y - narrow[0]!.y) < 1), "three narrow widgets share one row");
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

test("medium widths halve the spans so New and Continue keep one row", browserOnly, async () => {
  await withPage(900, "", async (page) => {
    const [start, more] = [await box(page, "New"), await box(page, "Continue")];
    assert.ok(Math.abs(start.y - more.y) < 1 && Math.abs(start.width - more.width) < 1);
    const narrow = await Promise.all(["New auto items", "Shared with the team"].map((name) => box(page, name)));
    assert.ok(Math.abs(narrow[0]!.y - narrow[1]!.y) < 1 && Math.abs(narrow[0]!.width - start.width) < 1);
    const usage = await box(page, "Model usage");
    assert.ok(usage.y > narrow[0]!.y && usage.width > start.width * 1.9, "a widget alone in its row fills it");
  });
});

test("a narrow dashboard shows one widget at a time in tabs and remembers the choice", browserOnly, async () => {
  await withPage(560, "", async (page) => {
    const tabs = page.getByRole("tablist", { name: "Start widgets" });
    await tabs.waitFor();
    const names = await tabs.getByRole("tab").allTextContents();
    assert.equal(names[0], "New 5");
    assert.equal(names.includes("Nothing to show"), false, "an empty widget has no tab");
    assert.equal(await page.getByRole("tabpanel").getByRole("heading", { name: /^New/ }).evaluate((element) => element.getBoundingClientRect().width <= 1), true, "the tab names the widget, its frame repeats no visible title");
    await mkdir(shots, { recursive: true });
    await page.screenshot({ path: join(shots, "start-dashboard-560.png") });
    assert.equal(await page.getByRole("tabpanel").count(), 1, "only the active widget is shown");
    assert.equal(await page.getByRole("tab", { name: "New 5" }).getAttribute("aria-selected"), "true");
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
      const all = ["New 5", "Continue", "Work board", "New auto items", "Shared with the team", "Model usage", "Topics in review", "Upcoming releases", "Open incidents this week"];
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

const size = (page: Page, key: string) => page.locator(`[data-start-widget="${key}"] [data-widget-size]`).textContent();

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
    assert.equal(await page.locator("[data-resize-handle], [data-drop-indicator], [data-widget-size]").count(), 0);
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

    const wide = await box(page, "Continue");
    const column = await page.locator("[data-dashboard]").evaluate((element) => (element.clientWidth + parseFloat(getComputedStyle(element).columnGap)) / 12);
    const edge = await center(page, page.locator('[data-start-widget="start.continue"] [data-resize-handle] > span'));
    await drag(page, edge, { x: edge.x - 4 * column, y: edge.y }, async () => {
      assert.equal(await size(page, "start.continue"), "Narrow", "the target size shows while dragging");
      const [start, narrow] = [await box(page, "New"), await box(page, "Continue")];
      assert.ok(Math.abs(narrow.width - start.width) < 1 && narrow.width < wide.width - 100, "the grid follows the size while dragging");
    });
    assert.equal(await announced(page), "Continue is now Narrow.");

    await page.getByRole("button", { name: "Remove Model usage", exact: true }).click();
    assert.equal(await page.getByRole("region", { name: "Model usage" }).count(), 0, "a removed widget leaves the dashboard");
    assert.equal(await focused(page), "Move Nothing to show", "focus moves to the widget that took the place");
    await page.getByRole("button", { name: "Add widget", exact: true }).click();
    const gallery = page.getByRole("dialog", { name: "Add widget" });
    await gallery.waitFor();
    const offered = gallery.getByRole("button", { name: /^Add / });
    assert.deepEqual(await offered.evaluateAll((buttons) => buttons.map((button) => button.getAttribute("aria-label"))), ["Add Model usage"], "the gallery lists the widgets that are not on Start");
    assert.equal(await offered.first().evaluate((button) => document.getElementById(button.getAttribute("aria-describedby")!)!.textContent), "Tokens and cost of the last runs.Sizes: Narrow (usual), Half");
    await settled(page);
    await page.screenshot({ path: join(shots, "start-dashboard-edit-gallery-1280.png") });
    await offered.first().click();
    await gallery.waitFor({ state: "detached" });
    assert.equal((await order(page)).at(-1), "demo.usage", "an added widget joins at the end");
    assert.equal(await size(page, "demo.usage"), "Narrow", "in its default size");
    assert.equal(await focused(page), "Move Model usage");
    await page.screenshot({ path: join(shots, "start-dashboard-edit-1280.png"), fullPage: true });

    await page.getByRole("button", { name: "Done", exact: true }).click();
    await page.getByRole("group", { name: "Edit Start" }).waitFor({ state: "detached" });
    assert.equal(await focused(page), "Edit");
    assert.deepEqual(await controlNames(page), []);
    assert.deepEqual(await writes(page), [{
      version: 1, order: ["demo.board", "start.new", "start.continue", "demo.auto", "demo.shared", "demo.empty", "demo.usage"], spans: { "start.continue": "narrow" }, removed: [],
    }]);
    const before = await regions(page);
    assert.equal(before.map((region) => region.name).join(", "), "Work board, New, Continue, New auto items, Shared with the team, Model usage");
    await page.reload();
    await loaded(page);
    assert.deepEqual(await regions(page), before, "a reload keeps order, size, and the added widget");
    assert.deepEqual(await noHorizontalScroll(page), { page: 0, main: 0 });
  }, 1500);
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
      "Arrow keys move the widget, Shift with the arrow keys changes its size, Delete removes it.");
    await handle.focus();
    await page.keyboard.press("ArrowLeft");
    assert.equal((await order(page))[0], "start.continue");
    assert.equal(await announced(page), "Continue moved to place 1 of 7.");
    assert.equal(await focused(page), "Move Continue", "focus stays on the moved widget");
    await page.keyboard.press("ArrowUp");
    assert.equal(await announced(page), "Continue is already first.");
    await page.keyboard.press("Shift+ArrowLeft");
    assert.equal(await size(page, "start.continue"), "Half");
    assert.equal(await announced(page), "Continue is now Half.");
    await page.keyboard.press("Shift+ArrowDown");
    assert.equal(await size(page, "start.continue"), "Narrow");
    await page.keyboard.press("Shift+ArrowLeft");
    assert.equal(await announced(page), "Continue is already at its smallest size.");
    await page.getByRole("button", { name: "Move Model usage", exact: true }).focus();
    await page.keyboard.press("Shift+ArrowRight");
    assert.equal(await size(page, "demo.usage"), "Half");
    await page.keyboard.press("Shift+ArrowUp");
    assert.equal(await announced(page), "Model usage is already at its largest size.", "only the sizes the widget offers");
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
      version: 1, order: ["start.new", "demo.board", "demo.auto", "demo.shared", "demo.empty", "demo.usage"], spans: { "demo.usage": "half" }, removed: ["start.continue"],
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
    assert.equal(await page.locator("[data-resize-handle], [data-widget-size]").count(), 0, "sizes are not offered");
    assert.equal(await page.getByRole("list", { name: "Templates" }).isVisible(), false, "the rows show only the titles");
    assert.equal(await page.getByRole("region", { name: "Legacy notes" }).isVisible(), false, "a section without a title waits until editing ends");
    const rows = await page.locator("[data-start-widget]").evaluateAll((cells) => cells.map((cell) => cell.getBoundingClientRect()).map(({ x, width }) => ({ x, width })));
    assert.ok(rows.every((row) => Math.abs(row.x - rows[0]!.x) < 1 && Math.abs(row.width - rows[0]!.width) < 1), "one row per widget in a single column");
    assert.equal(await page.getByRole("button", { name: "Move New up", exact: true }).isDisabled(), true);
    await page.getByRole("button", { name: "Move Continue up", exact: true }).click();
    assert.deepEqual((await order(page)).slice(0, 2), ["start.continue", "start.new"]);
    assert.equal(await focused(page), "Move Continue", "focus falls back to the handle when up is no longer possible");
    await page.keyboard.press("Shift+ArrowRight");
    assert.equal(await announced(page), "Sizes are chosen on a wider Start.");
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
    assert.deepEqual((await tabNames(page)).slice(0, 3), ["Model usage", "Continue", "New 5"], "the tabs follow the saved order");
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
    await page.evaluate(() => localStorage.setItem("start-dashboard-fixture:start.layout", JSON.stringify({ version: 1, order: [], spans: {}, hidden: [] })));
    await page.reload();
    await loaded(page);
    assert.match((await page.getByRole("alert").textContent())!, /^The saved Start layout could not be read: expected the fields order, removed, spans, version, found hidden, order, spans, version\. Saving a layout in Edit replaces it\.$/);
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
    assert.deepEqual(await writes(page), [{ version: 1, order: [], spans: {}, removed: ["demo.board"] }]);
  });
});
