import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";
import { chromium, type Page } from "playwright-core";
import { tailwindPlugin } from "./tailwind-plugin";
import type {} from "./start-scroll-fixture";
import type { TableDensity } from "../src/table-density";

interface ScrollWrite {
  target: string;
  before: number;
  top: number;
  stack?: string;
}

declare global {
  interface Window {
    startScrollWrites: ScrollWrite[];
  }
}

const browserOnly = { skip: process.env.RAGENTS_BROWSER_TESTS !== "1", timeout: 120_000 };
const settle = (page: Page) => page.evaluate(async () => {
  for (let frame = 0; frame < 4; frame++) await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
});
const position = (page: Page) => page.evaluate(() => ({
  page: document.querySelector<HTMLElement>('main[data-page="start"]')?.scrollTop ?? window.scrollY,
  outer: document.querySelector<HTMLElement>('[aria-label="Start viewport"]')?.scrollTop ?? 0,
  window: window.scrollY,
}));
const scrollToBoard = async (page: Page) => {
  await page.getByRole("toolbar", { name: "Board view" }).waitFor();
  await settle(page);
  await page.evaluate(() => {
    const toolbar = document.querySelector<HTMLElement>('[role="toolbar"][aria-label="Board view"]')!;
    const main = document.querySelector<HTMLElement>('main[data-page="start"]');
    const top = toolbar.getBoundingClientRect().top + (main?.scrollTop ?? window.scrollY) - (main?.getBoundingClientRect().top ?? 0) - 80;
    if (main) main.scrollTop = top;
    else window.scrollTo({ top, behavior: "instant" });
  });
  await settle(page);
  await page.evaluate(() => { window.startScrollWrites = []; });
};

const withPage = async (mode: "panel" | "window", initial: "list" | "lanes", run: (page: Page) => Promise<void>, density: TableDensity = "comfortable") => {
  const directory = await mkdtemp(join(tmpdir(), "ragents-start-scroll-"));
  const source = fileURLToPath(new URL("../src", import.meta.url));
  await build({
    entryPoints: [fileURLToPath(new URL("start-scroll-fixture.tsx", import.meta.url))], bundle: true,
    platform: "browser", format: "iife", jsx: "automatic", outfile: join(directory, "fixture.js"),
    define: { "process.env.NODE_ENV": '"production"' },
    plugins: [tailwindPlugin([source, fileURLToPath(new URL("./", import.meta.url))])], logLevel: "silent",
  });
  await writeFile(join(directory, "index.html"), '<!doctype html><html><head><meta charset="utf-8"><link rel="stylesheet" href="fixture.css"><style>html,body,#root{height:100%;margin:0}</style></head><body><div id="root"></div><script src="fixture.js"></script></body></html>');
  const browser = await chromium.launch({ headless: true,
    executablePath: process.env.BROWSER_EXECUTABLE_PATH ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" });
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 820 }, reducedMotion: "reduce" });
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    page.setDefaultTimeout(6000);
    await page.addInitScript(() => {
      window.startScrollWrites = [];
      const elementScroll = Element.prototype.scrollTo;
      Element.prototype.scrollTo = function (...args: [ScrollToOptions?] | [number, number]) {
        const options = args[0];
        window.startScrollWrites.push({ target: this.getAttribute("data-page") ?? this.getAttribute("aria-label") ?? this.tagName,
          before: this.scrollTop, top: typeof options === "number" ? args[1] ?? 0 : options?.top ?? this.scrollTop, stack: new Error().stack });
        return Reflect.apply(elementScroll, this, args);
      };
      const windowScroll = window.scrollTo;
      window.scrollTo = function (...args: [ScrollToOptions?] | [number, number]) {
        const options = args[0];
        window.startScrollWrites.push({ target: "window", before: window.scrollY,
          top: typeof options === "number" ? args[1] ?? 0 : options?.top ?? window.scrollY, stack: new Error().stack });
        return Reflect.apply(windowScroll, this, args);
      };
    });
    await page.goto(`${pathToFileURL(join(directory, "index.html")).href}?mode=${mode}&layout=${initial}&density=${density}`);
    try { await run(page); assert.deepEqual(errors, []); }
    catch (cause) {
      const shots = join(tmpdir(), "ragents-browser-shots");
      await mkdir(shots, { recursive: true });
      const name = `start-scroll-${mode}-${initial}`;
      await page.screenshot({ path: join(shots, `${name}.png`) });
      await writeFile(join(shots, `${name}.json`), JSON.stringify({ position: await position(page), writes: await page.evaluate(() => window.startScrollWrites), errors }, null, 2));
      throw cause;
    }
  } finally { await browser.close(); await rm(directory, { recursive: true, force: true }); }
};

for (const density of ["compact", "comfortable", "spacious"] as const) for (const mode of ["panel", "window"] as const) {
  test(`switching work lanes to a list preserves the ${density} ${mode} scroll position`, browserOnly, async () => {
    await withPage(mode, "lanes", async (page) => {
      await scrollToBoard(page);
      const before = await position(page);
      assert.ok(before.page > 200, "The board controls are reached by scrolling the page.");
      await page.getByRole("button", { name: "List", exact: true }).click();
      await page.getByRole("grid", { name: "Work items" }).waitFor();
      await settle(page);
      const after = await position(page);
      console.log(JSON.stringify({ mode, action: "lanes-to-list", before, after, writes: await page.evaluate(() => window.startScrollWrites) }));
      assert.ok(Math.abs(after.page - before.page) <= 1, `Mounting the list retains the ${mode} scroll position: ${before.page} -> ${after.page}.`);
      await page.getByRole("button", { name: "Lanes", exact: true }).click();
      await page.getByRole("group", { name: "Work lanes" }).waitFor();
      await settle(page);
      assert.ok(Math.abs((await position(page)).page - before.page) <= 1, "Unmounting the list retains the page position.");
      await page.getByRole("button", { name: "List", exact: true }).click();
      await page.getByRole("grid", { name: "Work items" }).waitFor();
      await settle(page);
      assert.ok(Math.abs((await position(page)).page - before.page) <= 1, "Repeated view changes retain the page position.");
    }, density);
  });

  test(`loading, grouping and sorting retain the ${density} ${mode} list's scroll position`, browserOnly, async () => {
    await withPage(mode, "list", async (page) => {
      await page.getByRole("grid", { name: "Work items" }).waitFor();
      await scrollToBoard(page);
      const before = await position(page);
      await page.evaluate(() => window.startScrollFixture.setGrouping(true));
      await settle(page);
      assert.ok(Math.abs((await position(page)).page - before.page) <= 1, "Grouping retains the page position.");
      await page.evaluate(() => window.startScrollFixture.setGrouping(false));
      await settle(page);
      await page.getByRole("button", { name: "Title", exact: true }).click();
      await settle(page);
      assert.ok(Math.abs((await position(page)).page - before.page) <= 1, "Sorting retains the page position.");
      await page.evaluate(() => window.startScrollFixture.setLoading(true));
      await page.getByRole("status").filter({ hasText: "Loading work items" }).waitFor();
      await settle(page);
      const loading = await position(page);
      await page.evaluate(() => window.startScrollFixture.setLoading(false));
      await page.getByRole("grid", { name: "Work items" }).waitFor();
      await settle(page);
      const after = await position(page);
      console.log(JSON.stringify({ mode, action: "loading-list", before, loading, after, writes: await page.evaluate(() => window.startScrollWrites) }));
      assert.ok(Math.abs(after.page - before.page) <= 1, `Reloading the list retains the ${mode} position: ${before.page} -> ${after.page}.`);
    }, density);
  });
}

test("Start state updates and an outer notice retain the nested panel's scroll position", browserOnly, async () => {
  await withPage("panel", "lanes", async (page) => {
    await scrollToBoard(page);
    const before = await position(page);
    await page.evaluate(() => window.startScrollFixture.renew());
    await settle(page);
    const renewed = await position(page);
    await page.evaluate(() => window.startScrollFixture.setNotice("The demonstration connection is available again."));
    await settle(page);
    const notice = await position(page);
    await page.evaluate(() => window.startScrollFixture.setNotice(undefined));
    await settle(page);
    const after = await position(page);
    console.log(JSON.stringify({ action: "nested-notice", before, renewed, notice, after, writes: await page.evaluate(() => window.startScrollWrites) }));
    assert.deepEqual(renewed, before);
    assert.equal(notice.page, before.page);
    assert.deepEqual(after, before);
  });
});
