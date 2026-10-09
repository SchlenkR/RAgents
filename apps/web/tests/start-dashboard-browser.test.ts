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

const withPage = async (width: number, query: string, run: (page: Page, browser: Browser) => Promise<void>) => {
  const url = await (fixture ??= buildFixture());
  const browser = await chromium.launch({ headless: true, executablePath: process.env.BROWSER_EXECUTABLE_PATH ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" });
  try {
    const page = await browser.newPage({ viewport: { width, height: 900 }, reducedMotion: "reduce" });
    page.setDefaultTimeout(6000);
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(`${url}?${query}`);
    await page.locator("[data-dashboard]").waitFor();
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
