import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";
import { chromium, type Locator, type Page } from "playwright-core";
import { tailwindPlugin } from "./tailwind-plugin";
import type {} from "./data-grid-fixture";

const rowSelector = '[data-slot="data-grid-row"][data-row-id]';
const headerSelector = '[data-slot="data-grid-header"]';
const columnWidth = (grid: Locator, name: string) => grid.getByRole("columnheader", { name: new RegExp(`^${name}`) }).evaluate((element) => element.getBoundingClientRect().width);
const scrollToEnd = (page: Page) => page.evaluate(() => window.scrollTo({ top: document.documentElement.scrollHeight, behavior: "instant" }));

test("data grids scroll with the page, retain adjustable columns, virtualize measured rows and load incrementally", {
  skip: process.env.RAGENTS_BROWSER_TESTS !== "1", timeout: 120_000,
}, async (context) => {
  const directory = await mkdtemp(join(tmpdir(), "ragents-data-grid-"));
  context.after(() => rm(directory, { recursive: true, force: true }));
  const root = fileURLToPath(new URL("../../../", import.meta.url));
  await build({ entryPoints: [fileURLToPath(new URL("data-grid-fixture.tsx", import.meta.url))], bundle: true,
    platform: "browser", format: "iife", jsx: "automatic", outfile: join(directory, "fixture.js"),
    plugins: [tailwindPlugin([`${root}apps/web/src`, `${root}apps/web/tests`])], logLevel: "silent" });
  await writeFile(join(directory, "index.html"), '<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="fixture.css"></head><body><div id="root"></div><script src="fixture.js"></script></body></html>');
  const browser = await chromium.launch({ headless: true,
    executablePath: process.env.BROWSER_EXECUTABLE_PATH ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" });
  context.after(() => browser.close());
  const page = await browser.newPage({ viewport: { width: 1500, height: 900 }, reducedMotion: "reduce", hasTouch: true });
  const errors: string[] = [];
  let checkpoint = "initial render";
  page.on("pageerror", (error) => errors.push(`${checkpoint}: ${error.stack ?? error.message}`));
  page.setDefaultTimeout(5000);
  const address = pathToFileURL(join(directory, "index.html")).href;
  await page.goto(address);
  const grid = page.getByRole("grid", { name: "Work items", exact: true });
  const rows = grid.locator(rowSelector);
  const header = grid.locator(headerSelector);
  const toolbar = page.getByRole("toolbar", { name: "Work item controls" });
  await rows.first().waitFor();
  assert.ok(await rows.count() < 100, "10,000 entries mount fewer than 100 data rows");
  assert.ok(await grid.evaluate((element) => element.scrollHeight > 100_000), "virtualized rows preserve the full page height");
  assert.deepEqual(await grid.evaluate((element) => ({ overflow: getComputedStyle(element).overflowY, border: getComputedStyle(element).borderTopWidth })),
    { overflow: "visible", border: "0px" }, "the default grid stays flat on the page canvas");
  const checkFullWidth = async () => {
    const gridBounds = await grid.boundingBox();
    const toolbarBounds = await toolbar.boundingBox();
    const headerBounds = await header.boundingBox();
    assert.ok(gridBounds && toolbarBounds && headerBounds);
    assert.ok(Math.abs(gridBounds.width - toolbarBounds.width) < 1, "the grid fills the toolbar's parent width");
    assert.ok(Math.abs(headerBounds.width - gridBounds.width) < 1, "a flexible column fills the header width");
    const widths = await grid.getByRole("columnheader").evaluateAll((elements) => elements.reduce((sum, element) => sum + element.getBoundingClientRect().width, 0));
    assert.ok(Math.abs(widths - headerBounds.width) < 1, "columns use all available width");
  };
  await checkFullWidth();
  checkpoint = "mouse resize";
  assert.equal(Math.round(await columnWidth(grid, "Name")), 260);
  const handle = grid.getByRole("separator", { name: "Resize Name column" });
  const before = (await handle.boundingBox())!;
  await page.mouse.move(before.x + before.width / 2, before.y + before.height / 2);
  await page.mouse.down();
  await page.mouse.move(before.x + before.width / 2 + 68, before.y + before.height / 2, { steps: 5 });
  await page.mouse.up();
  await page.waitForFunction(() => Math.round(document.querySelector('[role="columnheader"][data-grid-column="name"]')!.getBoundingClientRect().width) === 328);
  await checkFullWidth();
  const saved = await page.evaluate(() => Object.entries(localStorage).find(([key]) => key.endsWith(":browser-page-items"))?.[1]);
  assert.ok(saved, "resizing stores widths under the stable grid identity");
  assert.equal(JSON.parse(saved).name, 328);
  checkpoint = "touch resize";
  const touch = await page.context().newCDPSession(page);
  const touchHandle = (await handle.boundingBox())!;
  const touchStart = { x: touchHandle.x + touchHandle.width / 2, y: touchHandle.y + touchHandle.height / 2 };
  await touch.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [touchStart] });
  await touch.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ ...touchStart, x: touchStart.x + 32 }] });
  await touch.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await touch.detach();
  await page.waitForFunction(() => Math.round(document.querySelector('[role="columnheader"][data-grid-column="name"]')!.getBoundingClientRect().width) === 360);
  await page.reload();
  checkpoint = "keyboard sizing and fit";
  await rows.first().waitFor();
  assert.equal(Math.round(await columnWidth(grid, "Name")), 360, "touch resizing persists its width through a remount");
  await handle.focus();
  await page.keyboard.press("Home");
  assert.equal(Math.round(await columnWidth(grid, "Name")), 100);
  await page.keyboard.press("ArrowLeft");
  assert.equal(Math.round(await columnWidth(grid, "Name")), 100, "keyboard sizing respects the column minimum");
  await handle.dblclick();
  assert.ok(await columnWidth(grid, "Name") > 600, "double-click fits the complete column content");
  const firstName = rows.first().locator('[data-grid-column="name"] [data-slot="data-grid-cell-content"]');
  assert.equal(await firstName.getAttribute("title"), await firstName.textContent(), "full cell text is available through a tooltip");
  const statusHeader = grid.getByRole("columnheader", { name: /^Status/ });
  checkpoint = "header sorting";
  await statusHeader.getByRole("button", { name: "Status", exact: true }).click();
  assert.equal(await statusHeader.getAttribute("aria-sort"), "ascending");
  assert.equal(await rows.first().getAttribute("data-row-id"), "item-1", "header sorting changes the visible data order");
  await page.evaluate(() => { localStorage.clear(); });
  checkpoint = "reload initial widths";
  await page.reload();
  await rows.first().waitFor();
  const shortName = rows.first().locator('[data-grid-column="name"]');
  assert.equal(await shortName.evaluate((element) => {
    const content = [element, ...element.querySelectorAll("*")].find((candidate) => getComputedStyle(candidate).textOverflow === "ellipsis");
    return !!content && content.scrollWidth > content.clientWidth;
  }), true, "narrow cells truncate with an ellipsis");
  const noteHeights = await rows.getByRole("gridcell").filter({ hasText: /^This row has a longer note/ }).evaluateAll((elements) => elements.map((element) => element.getBoundingClientRect().height));
  const plainHeights = await rows.getByRole("gridcell").filter({ hasText: /^Review pending$/ }).evaluateAll((elements) => elements.map((element) => element.getBoundingClientRect().height));
  assert.ok(noteHeights[0] > plainHeights[0], "wrapped columns contribute measured row height");
  checkpoint = "page scroll";
  await page.evaluate(() => window.scrollTo({ top: 18_000, behavior: "instant" }));
  await page.waitForFunction(() => Number(document.querySelector('[data-slot="data-grid-row"][data-row-id]')?.getAttribute("aria-rowindex")) > 100);
  assert.ok(await rows.count() < 100, "the rendered row count stays bounded after page scrolling");
  assert.equal(await grid.evaluate((element) => element.scrollTop), 0, "page scrolling does not scroll the grid itself");
  const headerBox = (await header.boundingBox())!;
  const toolbarBox = (await toolbar.boundingBox())!;
  assert.ok(Math.abs(headerBox.y - toolbarBox.y - toolbarBox.height) < 1, "the header sticks immediately below the caller's toolbar");
  assert.notEqual(await header.evaluate((element) => getComputedStyle(element).backgroundColor), "rgba(0, 0, 0, 0)", "the sticky header has an opaque token background");
  assert.deepEqual(await grid.getByRole("columnheader", { name: /^Name/ }).getByRole("button").evaluate((element) => [getComputedStyle(element).textTransform, getComputedStyle(element).fontWeight]), ["none", "600"], "sortable headers keep the sentence-case header style");
  assert.equal(await page.evaluate(() => window.dataGridFixture.endCalls), 0);
  checkpoint = "incremental loading";
  await page.evaluate(() => {
    const bottom = document.querySelector('[role="grid"]')!.getBoundingClientRect().bottom + window.scrollY;
    window.scrollTo({ top: bottom - window.innerHeight - 120, behavior: "instant" });
  });
  await page.waitForFunction(() => window.dataGridFixture.endCalls === 1);
  assert.equal(await grid.evaluate((element) => element.getBoundingClientRect().bottom > window.innerHeight), true, "the threshold requests more rows before the viewport reaches the grid end");
  assert.ok(await rows.count() < 100);
  assert.equal(await rows.last().getAttribute("data-row-id"), "item-9999", "the final item stays reachable through virtualization");
  await scrollToEnd(page);
  await page.evaluate(() => window.dispatchEvent(new Event("scroll")));
  await page.waitForTimeout(80);
  assert.equal(await page.evaluate(() => window.dataGridFixture.endCalls), 1, "repeated scroll events do not repeat the same load request");
  await page.evaluate(() => { window.dataGridFixture.setLoading(true); window.dataGridFixture.appendRows(); });
  await page.waitForFunction(() => document.querySelector('[role="grid"]')?.getAttribute("aria-busy") === "true" && document.querySelector('[role="status"]')?.textContent?.includes("10,200"));
  await scrollToEnd(page);
  await page.waitForTimeout(80);
  assert.equal(await page.evaluate(() => window.dataGridFixture.endCalls), 1, "loading suppresses additional requests");
  await page.evaluate(() => window.dataGridFixture.setLoading(false));
  await scrollToEnd(page);
  await page.waitForFunction(() => window.dataGridFixture.endCalls === 2);
  assert.match(await page.getByRole("status", { name: "Loading status" }).textContent() ?? "", /10,200 items; end reached 2 times/);
  const shots = join(tmpdir(), "ragents-browser-shots");
  await mkdir(shots, { recursive: true });
  for (const theme of ["light", "dark"]) {
    for (const width of [1500, 900, 420]) {
      checkpoint = `${theme} screenshot at ${width}`;
      await page.setViewportSize({ width, height: 900 });
      await page.evaluate((value) => { document.documentElement.dataset.theme = value; window.scrollTo({ top: 400, behavior: "instant" }); }, theme);
      await page.waitForTimeout(80);
      const currentGrid = await grid.evaluate((element) => element.closest('[data-slot="data-grid-root"]')!.getBoundingClientRect().width);
      const currentToolbar = (await toolbar.boundingBox())!;
      assert.ok(Math.abs(currentGrid - currentToolbar.width) < 1, "the grid uses the parent width at every screenshot size");
      const frame = await grid.evaluate((element) => {
        const box = element.closest('[data-slot="data-grid-frame"]')!;
        return { right: box.getBoundingClientRect().right + window.scrollX, scrollWidth: document.documentElement.scrollWidth, ring: getComputedStyle(box, "::after").boxShadow };
      });
      assert.ok(frame.scrollWidth >= frame.right - 1, `columns beyond the viewport stay reachable by scrolling at ${width}`);
      assert.notEqual(frame.ring, "none", "the grid has a visible frame");
      if (width >= 900) await checkFullWidth();
      await page.screenshot({ path: join(shots, `data-grid-${theme}-${width}.png`) });
    }
  }
  await page.setViewportSize({ width: 1100, height: 900 });
  checkpoint = "bounded mode";
  await page.goto(`${address}?mode=bounded`);
  const bounded = page.getByRole("grid", { name: "Panel work items" });
  await bounded.locator(rowSelector).first().waitFor();
  assert.ok(await bounded.locator(rowSelector).count() < 100);
  const boundedHeight = await bounded.evaluate((element) => element.closest('[data-slot="data-grid-root"]')!.getBoundingClientRect().height);
  assert.ok(Math.abs(boundedHeight - 360) < 1, "bounded mode fills its given height");
  const scrollPanel = await bounded.evaluateHandle((element) => [element.closest('[data-slot="data-grid-root"]')!, element, ...element.querySelectorAll<HTMLElement>("*")].find((candidate) => {
    const overflow = getComputedStyle(candidate).overflowY;
    return /auto|scroll/.test(overflow) && candidate.scrollHeight > candidate.clientHeight;
  })!);
  await scrollPanel.evaluate((element) => { element.scrollTop = 18_000; });
  await page.waitForFunction(() => Number(document.querySelector('[data-slot="data-grid-row"][data-row-id]')?.getAttribute("aria-rowindex")) > 100);
  assert.equal(await page.evaluate(() => window.scrollY), 0, "panel scrolling does not move the page");
  const scrollBounds = await scrollPanel.evaluate((element) => ({ top: element.getBoundingClientRect().top + element.clientTop, height: element.clientHeight }));
  const boundedHeader = (await bounded.locator(headerSelector).boundingBox())!;
  assert.ok(Math.abs(boundedHeader.y - scrollBounds.top) < 1, "a bounded header sticks to its panel");
  await bounded.locator(rowSelector).first().focus();
  checkpoint = "bounded keyboard navigation";
  await page.keyboard.press("End");
  await page.waitForFunction(() => document.activeElement?.getAttribute("data-row-id") === "item-9999");
  await page.keyboard.press("Home");
  await page.waitForFunction(() => document.activeElement?.getAttribute("data-row-id") === "item-0");
  assert.ok(await bounded.locator(rowSelector).count() < 100, "keyboard navigation reaches unmounted rows while keeping virtualization bounded");
  assert.equal(await page.evaluate(() => window.scrollY), 0);
  await scrollPanel.dispose();
  await page.goto(`${address}?mode=ancestor`);
  checkpoint = "nearest scroll ancestor";
  const ancestorGrid = page.getByRole("grid", { name: "Scrollable work items" });
  const ancestor = page.getByRole("region", { name: "Scrollable list panel" });
  await ancestorGrid.locator(rowSelector).first().waitFor();
  await ancestor.evaluate((element) => { element.scrollTop = 18_000; });
  await page.waitForFunction(() => Number(document.querySelector('[data-slot="data-grid-row"][data-row-id]')?.getAttribute("aria-rowindex")) > 100);
  const ancestorBox = (await ancestor.boundingBox())!;
  const ancestorHeader = (await ancestorGrid.locator(headerSelector).boundingBox())!;
  assert.ok(Math.abs(ancestorHeader.y - ancestorBox.y - 52) < 1, "the nearest scroll ancestor supplies the virtual viewport and sticky offset");
  assert.ok(await ancestorGrid.locator(rowSelector).count() < 100);
  checkpoint = "unbounded overflow ancestor";
  await page.goto(`${address}?mode=unbounded`);
  const unbounded = page.getByRole("grid", { name: "Unbounded work items" });
  const inertWrapper = page.getByRole("region", { name: "Unbounded list wrapper" });
  await unbounded.locator(rowSelector).first().waitFor();
  assert.equal(await inertWrapper.evaluate((element) => getComputedStyle(element).overflowY), "auto");
  assert.equal(await inertWrapper.evaluate((element) => element.scrollHeight > element.clientHeight), false, "the overflow wrapper has no bounded vertical viewport");
  await page.evaluate(() => window.scrollTo({ top: 18_000, behavior: "instant" }));
  await page.waitForFunction(() => Number(document.querySelector('[data-slot="data-grid-row"][data-row-id]')?.getAttribute("aria-rowindex")) > 100);
  assert.ok(await unbounded.locator(rowSelector).count() < 100, "an unbounded overflow wrapper does not defeat page virtualization");
  assert.equal(await inertWrapper.evaluate((element) => element.scrollTop), 0);
  assert.ok(Math.abs((await unbounded.locator(headerSelector).boundingBox())!.y - 52) < 1, "the header follows page scrolling through an inert overflow wrapper");
  await page.goto(`${address}?mode=grouped`);
  checkpoint = "group rows";
  const grouped = page.getByRole("grid", { name: "Grouped work items" });
  const group = grouped.locator(`${rowSelector}[aria-expanded]`).filter({ hasText: /Ready/ }).first();
  await group.waitFor();
  const toggle = group.getByRole("button");
  assert.match(await group.textContent() ?? "", /Ready\s*40/, "group headers show the child count");
  assert.equal(await group.getAttribute("aria-expanded"), "true");
  await toggle.click();
  assert.equal(await group.getAttribute("aria-expanded"), "false", "group headers collapse their child rows");
  await toggle.click();
  assert.equal(await group.getAttribute("aria-expanded"), "true");
  checkpoint = "rows are told apart";
  const toldApart = `(([nextPalette, nextTheme]) => {
    document.documentElement.dataset.palette = nextPalette;
    document.documentElement.dataset.theme = nextTheme;
    const canvas = document.createElement("canvas").getContext("2d", { willReadFrequently: true });
    const parse = (color) => {
      canvas.clearRect(0, 0, 1, 1);
      canvas.fillStyle = color;
      canvas.fillRect(0, 0, 1, 1);
      const [r, g, b, a] = canvas.getImageData(0, 0, 1, 1).data;
      return { r, g, b, a: a / 255 };
    };
    const channel = (value) => { const unit = value / 255; return unit <= 0.03928 ? unit / 12.92 : ((unit + 0.055) / 1.055) ** 2.4; };
    const luminance = (color) => { const { r, g, b } = parse(color); return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b); };
    const ratio = (first, second) => { const [high, low] = [luminance(first), luminance(second)].sort((left, right) => right - left); return (high + 0.05) / (low + 0.05); };
    const surface = (element) => {
      for (let node = element; node; node = node.parentElement) {
        const color = getComputedStyle(node).backgroundColor;
        if (parse(color).a > 0.99) return color;
      }
      return "rgb(255, 255, 255)";
    };
    const item = document.querySelector('[role="grid"] [data-slot="data-grid-row"][data-row-id]:not([aria-expanded])');
    const bandRow = document.querySelector('[role="grid"] [data-slot="data-grid-row"][aria-expanded]');
    const head = document.querySelector('[data-slot="data-grid-header"]');
    const rowSurface = surface(item);
    return { divider: ratio(getComputedStyle(item).borderBottomColor, rowSurface), group: ratio(surface(bandRow), rowSurface), header: ratio(surface(head), rowSurface), edge: ratio(getComputedStyle(head).borderBottomColor, surface(head)) };
  })`;
  for (const palette of ["schichtwerk", "graphite", "midnight", "black"]) {
    for (const theme of ["light", "dark"]) {
      const told = await page.evaluate<{ divider: number; group: number; header: number; edge: number }>(`${toldApart}(${JSON.stringify([palette, theme])})`);
      assert.ok(told.divider >= 1.3, `${palette} ${theme}: the dividers between rows are visible (${told.divider.toFixed(2)}:1)`);
      assert.ok(told.group >= 1.18, `${palette} ${theme}: group rows differ from item rows (${told.group.toFixed(2)}:1)`);
      assert.ok(told.header >= 1.1, `${palette} ${theme}: the header differs from item rows (${told.header.toFixed(2)}:1)`);
      assert.ok(told.edge >= 2.2, `${palette} ${theme}: the header edge separates it from the first group row (${told.edge.toFixed(2)}:1)`);
    }
  }
  await page.evaluate("delete document.documentElement.dataset.palette; delete document.documentElement.dataset.theme;");
  const interactiveRow = grouped.locator('[data-slot="data-grid-row"][data-row-id="item-0"]');
  checkpoint = "row navigation and selection";
  await interactiveRow.click();
  assert.equal(await page.evaluate(() => window.dataGridFixture.clicked), "item-0");
  await interactiveRow.dblclick();
  assert.equal(await page.evaluate(() => window.dataGridFixture.opened), "item-0", "double-click opens the clicked item");
  await interactiveRow.focus();
  await page.keyboard.press("ArrowDown");
  assert.equal(await page.evaluate(() => document.activeElement?.getAttribute("data-row-id")), "item-2", "arrow navigation follows the visible group order");
  await page.keyboard.press("Space");
  assert.deepEqual(await page.evaluate(() => window.dataGridFixture.selected), ["item-2"]);
  assert.equal(await grouped.locator('[data-row-id="item-2"]').getAttribute("aria-selected"), "true");
  const selectedLook = await page.evaluate(() => {
    const row = document.querySelector('[data-row-id="item-2"]')!;
    const probe = document.createElement("span");
    probe.style.color = "var(--selected-border)";
    document.body.append(probe);
    const frame = getComputedStyle(probe).color;
    probe.remove();
    return { fill: getComputedStyle(row).backgroundColor, base: getComputedStyle(row.closest('[data-slot="data-grid-frame"]')!).backgroundColor, shadow: getComputedStyle(row).boxShadow, frame };
  });
  const channels = (color: string) => color.match(/[\d.]+/g)!.slice(0, 3).map((value) => { const unit = Number(value) / 255; return unit <= 0.03928 ? unit / 12.92 : ((unit + 0.055) / 1.055) ** 2.4; });
  const luminanceOf = (color: string) => { const [r, g, b] = channels(color); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
  const ratioOf = (first: string, second: string) => { const [high, low] = [luminanceOf(first), luminanceOf(second)].sort((left, right) => right - left); return (high + 0.05) / (low + 0.05); };
  assert.ok(ratioOf(selectedLook.fill, selectedLook.base) >= 1.3, "a selected row differs clearly from the grid surface");
  assert.ok(selectedLook.shadow.includes(selectedLook.frame), "a selected row carries the selection frame");
  await page.keyboard.press("Enter");
  assert.equal(await page.evaluate(() => window.dataGridFixture.opened), "item-2", "Enter opens the focused item");
  assert.equal(await grouped.getByRole("gridcell").filter({ hasText: /^Ready$/ }).first().locator('[data-slot="badge"]').count(), 1, "custom renderers are used for ordinary cells");
  checkpoint = "corrupt width storage";
  await page.evaluate(() => {
    localStorage.setItem("ragents.grid.widths:browser-grouped-items", '{"name":-1}');
    window.dispatchEvent(new Event("ragents-grid-widths-change"));
  });
  await page.getByRole("alert").waitFor();
  assert.match(await page.getByRole("alert").textContent() ?? "", /widths are invalid/);
  assert.equal(await grouped.getByRole("separator", { name: "Resize Name column" }).getAttribute("aria-disabled"), "true");
  await page.getByRole("button", { name: "Reset column widths", exact: true }).click();
  await page.getByRole("alert").waitFor({ state: "hidden" });
  assert.equal(Math.round(await columnWidth(grouped, "Name")), 260);
  checkpoint = "failed width storage write";
  await page.evaluate(() => {
    const write = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key, value) {
      if (key.startsWith("ragents.grid.widths:")) throw new DOMException("Storage is full", "QuotaExceededError");
      write.call(this, key, value);
    };
  });
  await grouped.getByRole("separator", { name: "Resize Name column" }).focus();
  await page.keyboard.press("Home");
  await page.getByRole("alert").waitFor();
  assert.match(await page.getByRole("alert").textContent() ?? "", /Could not save grid column widths/);
  assert.equal(Math.round(await columnWidth(grouped, "Name")), 260, "failed saves preserve the last persisted width");
  checkpoint = "denied width storage read";
  const blocked = await browser.newPage();
  blocked.on("pageerror", (error) => errors.push(`${checkpoint}: ${error.stack ?? error.message}`));
  await blocked.addInitScript({ content: `
    const readGridStorage = Storage.prototype.getItem;
    Storage.prototype.getItem = function (key) {
      if (key.startsWith("ragents.grid.widths:")) throw new DOMException("Storage access denied", "SecurityError");
      return readGridStorage.call(this, key);
    };
    window.restoreDataGridStorage = () => { Storage.prototype.getItem = readGridStorage; };
  ` });
  await blocked.goto(address);
  await blocked.getByRole("alert").waitFor();
  assert.match(await blocked.getByRole("alert").textContent() ?? "", /Storage access denied/);
  const blockedGrid = blocked.getByRole("grid", { name: "Work items", exact: true });
  await blockedGrid.locator(rowSelector).first().waitFor();
  assert.equal(await blockedGrid.getByRole("separator", { name: "Resize Name column" }).getAttribute("aria-disabled"), "true");
  assert.ok(await blockedGrid.locator(rowSelector).count() < 100, "storage failure leaves the grid visible and virtualized");
  await blocked.evaluate("window.restoreDataGridStorage()");
  await blocked.getByRole("button", { name: "Retry column widths", exact: true }).click();
  await blocked.getByRole("alert").waitFor({ state: "hidden" });
  assert.equal(await blockedGrid.getByRole("separator", { name: "Resize Name column" }).getAttribute("aria-disabled"), null);
  assert.deepEqual(errors, []);
});
