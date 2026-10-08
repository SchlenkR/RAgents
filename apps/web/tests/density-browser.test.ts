import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";
import { chromium, type Page } from "playwright-core";
import { tailwindPlugin } from "./tailwind-plugin";
import type {} from "./density-browser-fixture";

const browserOnly = { skip: process.env.RAGENTS_BROWSER_TESTS !== "1", timeout: 120_000 };
const settle = (page: Page) => page.evaluate(async () => {
  for (let frame = 0; frame < 4; frame++) await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
});

const rowMetrics = (page: Page) => page.evaluate(() => {
  const table = document.querySelector<HTMLElement>('table[aria-label="Simple work items"]')!;
  const grid = document.querySelector<HTMLElement>('[role="grid"][aria-label="Virtual work items"]')!;
  const row = table.querySelector<HTMLElement>('tbody [data-slot="table-row"]')!;
  const virtualRow = grid.querySelector<HTMLElement>('[data-slot="data-grid-row"][data-row-id]')!;
  const cell = table.querySelector<HTMLElement>('[data-slot="table-cell"]')!;
  const virtualCell = virtualRow.querySelector<HTMLElement>('[role="gridcell"]')!;
  const tableCell = getComputedStyle(cell);
  const gridCell = getComputedStyle(virtualCell);
  const root = getComputedStyle(document.documentElement);
  return { density: document.documentElement.dataset.density,
    unit: parseFloat(root.getPropertyValue("--spacing")) * parseFloat(root.fontSize),
    table: row.getBoundingClientRect().height, grid: virtualRow.getBoundingClientRect().height,
    tableCell: { x: parseFloat(tableCell.paddingLeft), y: parseFloat(tableCell.paddingTop), lineHeight: parseFloat(tableCell.lineHeight) },
    gridCell: { x: parseFloat(gridCell.paddingLeft), y: parseFloat(gridCell.paddingTop), lineHeight: parseFloat(gridCell.lineHeight) } };
});

test("table spacing changes Table and DataGrid together, retains color choice, and survives reload", browserOnly, async () => {
  const directory = await mkdtemp(join(tmpdir(), "ragents-density-"));
  const source = fileURLToPath(new URL("../src", import.meta.url));
  await build({ entryPoints: [fileURLToPath(new URL("density-browser-fixture.tsx", import.meta.url))], bundle: true,
    platform: "browser", format: "iife", jsx: "automatic", outfile: join(directory, "fixture.js"),
    define: { "process.env.NODE_ENV": '"production"' },
    plugins: [tailwindPlugin([source, fileURLToPath(new URL("./", import.meta.url))])], logLevel: "silent" });
  await writeFile(join(directory, "index.html"), '<!doctype html><html><head><meta charset="utf-8"><link rel="stylesheet" href="fixture.css"></head><body><div id="root"></div><script src="fixture.js"></script></body></html>');
  const browser = await chromium.launch({ headless: true,
    executablePath: process.env.BROWSER_EXECUTABLE_PATH ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, reducedMotion: "reduce" });
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(pathToFileURL(join(directory, "index.html")).href);
    await page.getByRole("grid", { name: "Virtual work items" }).waitFor();
    await settle(page);
    const spacing = page.getByRole("group", { name: "Table spacing", exact: true });
    assert.equal(await spacing.getByRole("button", { name: "Comfortable", exact: true }).getAttribute("aria-pressed"), "true");
    await page.getByRole("group", { name: "Schichtwerk color scheme" }).getByRole("button", { name: "Light", exact: true }).click();
    const measured: Record<string, Awaited<ReturnType<typeof rowMetrics>>> = {};
    for (const { value, label, x, y } of [
      { value: "compact", label: "Compact", x: 2, y: 1 },
      { value: "comfortable", label: "Comfortable", x: 3, y: 2 },
      { value: "spacious", label: "Spacious", x: 4, y: 4 },
    ]) {
      await spacing.getByRole("button", { name: label, exact: true }).click();
      await page.waitForFunction((value) => document.documentElement.dataset.density === value, value);
      await settle(page);
      const metrics = await rowMetrics(page);
      measured[value] = metrics;
      for (const cell of [metrics.tableCell, metrics.gridCell]) {
        assert.ok(Math.abs(cell.x - metrics.unit * x) <= 0.15, `${label} uses ${x} units of horizontal padding.`);
        assert.ok(Math.abs(cell.y - metrics.unit * y) <= 0.15, `${label} uses ${y} units of vertical padding.`);
      }
      assert.ok(Math.abs(metrics.table - metrics.grid) <= 1.5, `${label} Table and DataGrid row heights agree: ${metrics.table} and ${metrics.grid}.`);
      assert.equal(await page.evaluate(() => localStorage.getItem("ragents.density")), value);
      assert.equal(await page.evaluate(() => document.documentElement.dataset.theme), "light");
      const shots = join(tmpdir(), "ragents-browser-shots");
      await mkdir(shots, { recursive: true });
      await page.screenshot({ path: join(shots, `table-spacing-${value}.png`) });
    }
    console.log(JSON.stringify({ measured }));
    for (const kind of ["table", "grid"] as const) assert.ok(measured.compact[kind] < measured.comfortable[kind] && measured.comfortable[kind] < measured.spacious[kind],
      "All three table spacing choices produce different actual row heights.");
    await page.reload();
    await page.getByRole("grid", { name: "Virtual work items" }).waitFor();
    await settle(page);
    assert.equal(await spacing.getByRole("button", { name: "Spacious", exact: true }).getAttribute("aria-pressed"), "true");
    assert.equal((await rowMetrics(page)).density, "spacious");
    assert.equal(await page.evaluate(() => document.documentElement.dataset.theme), "light");
    assert.deepEqual(errors, []);
  } finally { await browser.close(); await rm(directory, { recursive: true, force: true }); }
});
