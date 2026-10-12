import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build, type Plugin } from "esbuild";
import { chromium, type Locator, type Page } from "playwright-core";
import { tailwindPlugin } from "./tailwind-plugin";
import type {} from "./run-details-fixture";

const browserOnly = { skip: process.env.RAGENTS_BROWSER_TESTS !== "1", timeout: 120_000 };
const fixtureRpc: Plugin = {
  name: "run-details-rpc",
  setup(build) {
    build.onLoad({ filter: /\/apps\/web\/src\/rpc\.ts$/ }, () => ({
      contents: `export const rpc = {
        call: (contract, input) => window.runDetailsFixture.call(contract.id, input),
        subscribe: (contract, _input, listener) => window.runDetailsFixture.subscribe(contract.id, listener),
      };`,
      loader: "ts",
    }));
  },
};

async function fixturePage(context: test.TestContext) {
  const directory = await mkdtemp(join(tmpdir(), "ragents-run-details-"));
  context.after(() => rm(directory, { recursive: true, force: true }));
  const root = fileURLToPath(new URL("../../../", import.meta.url));
  await build({ entryPoints: [fileURLToPath(new URL("run-details-fixture.tsx", import.meta.url))], bundle: true,
    platform: "browser", format: "iife", jsx: "automatic", outfile: join(directory, "fixture.js"),
    plugins: [fixtureRpc, tailwindPlugin([`${root}apps/web/src`, `${root}plugins/ragents.activity/web`, `${root}plugins/ragents.processes/web`, `${root}plugins/ragents.workspace/web`, `${root}plugins/ragents.orchestration/web`])], logLevel: "silent" });
  await writeFile(join(directory, "index.html"), '<!doctype html><html><head><link rel="stylesheet" href="fixture.css"></head><body><div id="root" style="height:900px;display:flex"></div><script src="fixture.js"></script></body></html>');
  const browser = await chromium.launch({ headless: true, executablePath: process.env.BROWSER_EXECUTABLE_PATH ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" });
  context.after(() => browser.close());
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
  page.setDefaultTimeout(8000);
  return { page, url: pathToFileURL(join(directory, "index.html")).href };
}

async function assertSheetGeometry(sheet: Locator) {
  const geometry = await sheet.evaluate((element) => {
    const rows = [...element.querySelectorAll<HTMLElement>('[data-slot="detail-row"]')].filter((row) => row.getBoundingClientRect().width > 0).map((row) => {
      const label = row.querySelector("dt")!;
      const value = row.querySelector("dd")!;
      const bounds = [row, label, value].map((node) => {
        const rectangle = node.getBoundingClientRect();
        return { left: rectangle.left, top: rectangle.top, right: rectangle.right, bottom: rectangle.bottom, width: rectangle.width };
      });
      return { label: label.textContent, row: bounds[0], labelBounds: bounds[1], valueBounds: bounds[2] };
    });
    return { rows, width: element.clientWidth, scrollWidth: element.scrollWidth };
  });
  assert.ok(geometry.rows.length >= 5, "the real contributions render labelled rows");
  assert.ok(geometry.scrollWidth <= geometry.width + 1, "the sheet has no horizontal overflow");
  for (const [index, entry] of geometry.rows.entries()) {
    assert.ok(entry.labelBounds.right <= entry.valueBounds.left + 1, `${entry.label}: label and value do not overlap`);
    assert.ok(entry.labelBounds.width >= 60 && entry.valueBounds.width >= 150, `${entry.label}: both columns retain readable widths`);
    assert.ok(entry.valueBounds.right <= entry.row.right + 1 && entry.valueBounds.bottom <= entry.row.bottom + 1, `${entry.label}: the row contains its full value`);
    if (index > 0) assert.ok(geometry.rows[index - 1].row.bottom <= entry.row.top + 1, `${entry.label}: rows do not overlap`);
  }
}

async function assertFullText(locator: Locator) {
  const layout = await locator.evaluate((element) => {
    const text = element.textContent!.trim();
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
    const rectangles: { left: number; right: number; top: number; bottom: number }[] = [];
    while (walker.nextNode()) {
      const node = walker.currentNode;
      if (!node.textContent?.trim()) continue;
      const range = document.createRange();
      range.selectNodeContents(node);
      rectangles.push(...[...range.getClientRects()].map(({ left, right, top, bottom }) => ({ left, right, top, bottom })));
    }
    const value = element.closest('[data-slot="detail-value"]') ?? element;
    const bounds = value.getBoundingClientRect();
    return { text, rectangles, bounds: { left: bounds.left, right: bounds.right, top: bounds.top, bottom: bounds.bottom }, writingMode: getComputedStyle(element).writingMode };
  });
  assert.equal(layout.writingMode, "horizontal-tb", `${layout.text}: text reads horizontally`);
  assert.ok(layout.rectangles.length > 0, `${layout.text}: text is rendered`);
  for (const rectangle of layout.rectangles) {
    assert.ok(rectangle.left >= layout.bounds.left - 1 && rectangle.right <= layout.bounds.right + 1, `${layout.text}: no horizontally clipped text`);
    assert.ok(rectangle.top >= layout.bounds.top - 1 && rectangle.bottom <= layout.bounds.bottom + 1, `${layout.text}: no vertically clipped text`);
  }
  const firstWord = await locator.evaluate((element) => {
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
      const node = walker.currentNode;
      const match = node.textContent?.match(/[A-Za-z]{4,}/);
      if (!match || match.index === undefined) continue;
      return [...match[0]].map((_, index) => {
        const range = document.createRange();
        range.setStart(node, match.index! + index);
        range.setEnd(node, match.index! + index + 1);
        const bounds = range.getBoundingClientRect();
        return { top: bounds.top, left: bounds.left };
      });
    }
    return [];
  });
  assert.ok(firstWord.length >= 4);
  assert.ok(firstWord.every((letter) => Math.abs(letter.top - firstWord[0].top) < 1), `${layout.text}: words do not become vertical letter columns ${JSON.stringify(firstWord)}`);
}

const detailRow = (page: Page, label: string) => page.locator('[data-slot="detail-row"]').filter({ has: page.locator("dt").filter({ hasText: new RegExp(`^${label}$`) }) });

test("Run details show ordered, wrapping rows and all process names at wide and narrow widths", browserOnly, async (context) => {
  const { page, url } = await fixturePage(context);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  for (const width of [1600, 700, 360]) {
    await page.setViewportSize({ width, height: 1000 });
    await page.goto(url);
    await page.locator('button[aria-description="Show run details"]').click();
    const sheet = page.locator('[data-slot="run-details-sheet"]');
    await detailRow(page, "System prompts").waitFor();
    assert.equal(await detailRow(page, "Workspace").count(), 1, "metadata replaces the matching start option badge");
    await detailRow(page, "Sandbox").getByText("Commands run isolated from other work on this machine.", { exact: true }).waitFor();
    await detailRow(page, "Workspace").getByText("Files and commands use this project folder on the server.", { exact: true }).waitFor();
    await detailRow(page, "System prompts").getByText("These instructions guide the coordinator and the agents it starts.", { exact: true }).waitFor();
    const values = await page.evaluate(() => ({ branch: window.runDetailsFixture.branch, actor: window.runDetailsFixture.actorName, processes: window.runDetailsFixture.processNames }));
    const firstLabel = await sheet.locator('[data-slot="detail-row"]:visible').first().locator("dt").textContent();
    assert.equal(firstLabel, "Branch", "order is shared across metadata and header contributions");
    const branchRow = detailRow(page, "Branch");
    await assertFullText(branchRow.getByText(values.branch, { exact: true }));
    await branchRow.getByText("Runs in its own copy of the project on this branch.", { exact: true }).waitFor();
    for (const name of values.processes) await assertFullText(sheet.getByText(name, { exact: true }));
    assert.equal(await sheet.getByText(/\+\d+ more|All \d+/).count(), 0, "processes do not hide names in a counter");
    const turn = detailRow(page, "Turn");
    const actor = turn.getByText(values.actor, { exact: true });
    await assertFullText(actor);
    const elapsed = turn.locator('[data-slot="activity-elapsed"]');
    const actorBounds = await actor.boundingBox();
    const elapsedBounds = await elapsed.boundingBox();
    assert.ok(actorBounds && elapsedBounds);
    assert.ok(actorBounds.x + actorBounds.width <= elapsedBounds.x + 1 || actorBounds.y + actorBounds.height <= elapsedBounds.y + 1 || elapsedBounds.y + elapsedBounds.height <= actorBounds.y + 1, "elapsed time never overlaps the actor name");
    const footer = page.locator('[data-slot="run-details-footer"]');
    assert.equal(await footer.getByRole("button", { name: "Stop run", exact: true }).count(), 1);
    assert.equal(await sheet.getByRole("button", { name: "Stop run", exact: true }).count(), 0, "actions are outside the fact rows");
    const lastRowBounds = await sheet.locator('[data-slot="detail-row"]').last().boundingBox();
    const footerBounds = await footer.boundingBox();
    assert.ok(lastRowBounds && footerBounds && footerBounds.y >= lastRowBounds.y + lastRowBounds.height - 1, "the footer follows all facts");
    await assertSheetGeometry(sheet);
    assert.equal(await page.locator("[title]").count(), 0, "the rendered host and plugin components have no native tooltips");
  }
  assert.deepEqual(errors, []);
});

test("Run details preserve workspace badges, full errors, and direct footer stop", browserOnly, async (context) => {
  const { page, url } = await fixturePage(context);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.setViewportSize({ width: 700, height: 1000 });
  await page.goto(url + "?badge&no-branch");
  await page.locator('button[aria-description="Show run details"]').click();
  await detailRow(page, "Workspace").waitFor();
  assert.equal(await detailRow(page, "Branch").isVisible(), false, "an absent contribution creates no empty row");
  await assertFullText(detailRow(page, "Workspace").getByText(/\/home\/user\/project\/worktrees\/example-run/));
  const footer = page.locator('[data-slot="run-details-footer"]');
  await page.evaluate(() => window.runDetailsFixture.setStopError(window.runDetailsFixture.stopError));
  await footer.getByRole("button", { name: "Stop run", exact: true }).click();
  const error = await page.evaluate(() => window.runDetailsFixture.stopError);
  const refusal = footer.getByText(error, { exact: true });
  await refusal.waitFor();
  await assertFullText(refusal);
  const footerGeometry = await footer.evaluate((element) => ({ width: element.clientWidth, scrollWidth: element.scrollWidth }));
  assert.ok(footerGeometry.scrollWidth <= footerGeometry.width + 1, "the action and full error wrap inside the footer");
  assert.equal(await footer.getByRole("button", { name: "Yes", exact: true }).count(), 0, "the stop is immediate");
  assert.equal(await footer.getByRole("button", { name: "Cancel", exact: true }).count(), 0);
  const firstStop = await page.evaluate(() => window.runDetailsFixture.calls.filter((call) => call.method === "ragents.runs.stop"));
  assert.equal(firstStop.length, 1);
  assert.deepEqual(Object.keys(firstStop[0]!.input as Record<string, unknown>).sort(), ["commandId", "reason", "runId"]);
  assert.equal((firstStop[0]!.input as { reason: string }).reason, "Stopped by the operator");
  await page.evaluate(() => window.runDetailsFixture.setStopError(undefined));
  await footer.getByRole("button", { name: "Stop run", exact: true }).click();
  await footer.getByRole("button", { name: "Stop run", exact: true }).waitFor();
  assert.equal(await page.evaluate(() => window.runDetailsFixture.calls.filter((call) => call.method === "ragents.runs.stop").length), 2);
  await page.evaluate(() => window.runDetailsFixture.monitoringError(window.runDetailsFixture.stopError));
  await assertFullText(detailRow(page, "Processes").getByText(error, { exact: true }));
  await assertSheetGeometry(page.locator('[data-slot="run-details-sheet"]'));
  assert.equal(await page.locator("[title]").count(), 0);
  assert.deepEqual(errors, []);
});
