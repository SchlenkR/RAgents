import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";
import { chromium, type Locator } from "playwright-core";
import { tailwindPlugin } from "./tailwind-plugin";

const key = "ragents.table.widths:work-items";
const columnWidth = (table: Locator, name: string) => table.getByRole("columnheader", { name: new RegExp(`^${name}`) }).evaluate((element) => element.getBoundingClientRect().width);

test("table columns resize, fit, retain widths and expose full cell text without hiding storage failures", {
  skip: process.env.RAGENTS_BROWSER_TESTS !== "1", timeout: 120_000,
}, async (context) => {
  const directory = await mkdtemp(join(tmpdir(), "ragents-table-resize-"));
  context.after(() => rm(directory, { recursive: true, force: true }));
  const root = fileURLToPath(new URL("../../../", import.meta.url));
  await build({ entryPoints: [fileURLToPath(new URL("table-resize-fixture.tsx", import.meta.url))],
    bundle: true, platform: "browser", format: "iife", jsx: "automatic", outfile: join(directory, "fixture.js"),
    plugins: [tailwindPlugin([`${root}apps/web/src`, `${root}apps/web/tests`])], logLevel: "silent" });
  await writeFile(join(directory, "index.html"), '<!doctype html><html><head><link rel="stylesheet" href="fixture.css"></head><body><div id="root"></div><script src="fixture.js"></script></body></html>');
  const browser = await chromium.launch({ headless: true,
    executablePath: process.env.BROWSER_EXECUTABLE_PATH ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" });
  context.after(() => browser.close());
  const page = await browser.newPage({ viewport: { width: 1300, height: 850 }, reducedMotion: "reduce" });
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.setDefaultTimeout(5000);
  await page.goto(pathToFileURL(join(directory, "index.html")).href);
  const table = page.getByRole("table", { name: "Work items", exact: true });
  const mirror = page.getByRole("table", { name: "Work items mirror", exact: true });
  const handle = table.getByRole("separator", { name: "Resize Name column" });
  await handle.waitFor();
  assert.equal(await table.getByRole("separator").count(), 2, "fixed columns have no resize handle");
  assert.equal(await columnWidth(table, "Name"), 240);
  const initial = (await handle.boundingBox())!;
  await page.mouse.move(initial.x + initial.width / 2, initial.y + initial.height / 2);
  await page.mouse.down();
  await page.mouse.move(initial.x + initial.width / 2 + 75, initial.y + initial.height / 2);
  await page.mouse.up();
  assert.equal(await columnWidth(table, "Name"), 315);
  assert.equal(await columnWidth(mirror, "Name"), 315, "same-page subscribers observe persisted changes");
  assert.equal(await page.evaluate((storageKey) => JSON.parse(localStorage.getItem(storageKey)!).name, key), 315);
  await page.reload();
  await handle.waitFor();
  assert.equal(await columnWidth(table, "Name"), 315, "width survives remounting");
  await handle.focus();
  await page.keyboard.press("Home");
  assert.equal(await columnWidth(table, "Name"), 100);
  await page.keyboard.press("ArrowLeft");
  assert.equal(await columnWidth(table, "Name"), 100, "keyboard resizing respects the minimum");
  await page.keyboard.press("Shift+ArrowRight");
  assert.equal(await columnWidth(table, "Name"), 150);
  const dragging = (await handle.boundingBox())!;
  await page.mouse.move(dragging.x + dragging.width / 2, dragging.y + dragging.height / 2);
  await page.mouse.down();
  await page.mouse.move(10, dragging.y + dragging.height / 2);
  await page.mouse.up();
  assert.equal(await columnWidth(table, "Name"), 100, "pointer resizing respects the minimum");
  const description = table.getByRole("cell").first();
  const fullText = await description.textContent();
  assert.equal(await description.getAttribute("title"), fullText);
  const text = description.locator('[data-slot="table-cell-content"]');
  assert.deepEqual(await text.evaluate((element) => ({ clipped: element.scrollWidth > element.clientWidth, ellipsis: getComputedStyle(element).textOverflow })), { clipped: true, ellipsis: "ellipsis" });
  await handle.dblclick();
  const fitted = await columnWidth(table, "Name");
  assert.ok(fitted > 500, "double-click fits the entire rendered content");
  assert.equal(await text.evaluate((element) => element.scrollWidth > element.clientWidth), false);
  const app = page.getByRole("grid", { name: "Mini-app table", exact: true });
  assert.equal(await app.getByRole("separator").count(), 3, "DataTable forwards definitions and includes its action column");
  await page.evaluate((storageKey) => { localStorage.setItem(storageKey, '{"name":-1}'); window.dispatchEvent(new Event("ragents-table-widths-change")); }, key);
  await page.getByRole("alert").first().waitFor();
  assert.match(await page.getByRole("alert").first().textContent() ?? "", /saved table column widths are invalid/);
  assert.equal(await handle.getAttribute("aria-disabled"), "true");
  await page.getByRole("button", { name: "Reset column widths" }).first().click();
  await page.getByRole("alert").waitFor({ state: "hidden" });
  assert.equal(await columnWidth(table, "Name"), 240);
  await page.evaluate(() => { Storage.prototype.setItem = () => { throw new DOMException("Storage is full", "QuotaExceededError"); }; });
  await handle.focus();
  await page.keyboard.press("ArrowRight");
  await page.getByRole("alert").waitFor();
  assert.match(await page.getByRole("alert").textContent() ?? "", /Could not save table column widths/);
  assert.equal(await columnWidth(table, "Name"), 240, "a failed save does not pretend to persist the change");
  await page.reload();
  await handle.waitFor();
  await handle.focus();
  await page.keyboard.press("Home");
  if (process.env.RAGENTS_SCREENSHOT_DIR) {
    await mkdir(process.env.RAGENTS_SCREENSHOT_DIR, { recursive: true });
    await page.screenshot({ path: join(process.env.RAGENTS_SCREENSHOT_DIR, "ui-table-resized.png") });
  }
  const blocked = await browser.newPage();
  blocked.on("pageerror", (error) => errors.push(error.message));
  await blocked.addInitScript({ content: `
    const readTableStorage = Storage.prototype.getItem;
    Storage.prototype.getItem = function (storageKey) {
      if (storageKey.startsWith("ragents.table.widths:")) throw new DOMException("Storage access denied", "SecurityError");
      return readTableStorage.call(this, storageKey);
    };
    window.restoreTableStorage = () => { Storage.prototype.getItem = readTableStorage; };
  ` });
  await blocked.goto(pathToFileURL(join(directory, "index.html")).href);
  await blocked.getByRole("alert").first().waitFor();
  assert.match(await blocked.getByRole("alert").first().textContent() ?? "", /Storage access denied/);
  assert.equal(await blocked.getByRole("table").count(), 2, "storage access failure leaves all tables visible");
  await blocked.evaluate("window.restoreTableStorage()");
  await blocked.getByRole("button", { name: "Retry column widths" }).first().click();
  const recovered = blocked.getByRole("table", { name: "Work items", exact: true }).getByRole("separator", { name: "Resize Name column" });
  await recovered.waitFor();
  assert.equal(await recovered.getAttribute("aria-disabled"), null, "retry restores persistence after storage access recovers");
  assert.deepEqual(errors, []);
});
