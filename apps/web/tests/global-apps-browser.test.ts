import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import test from "node:test";
import { build } from "esbuild";
import { chromium, type Page } from "playwright-core";
import { tailwindPlugin } from "./tailwind-plugin";
import type {} from "./global-apps-fixture";

const buildFixture = async (directory: string) => {
  const root = fileURLToPath(new URL("../../../", import.meta.url));
  await build({
    entryPoints: [fileURLToPath(new URL("global-apps-fixture.tsx", import.meta.url))], bundle: true, platform: "browser", format: "iife", jsx: "automatic",
    outfile: join(directory, "fixture.js"), define: { "process.env.NODE_ENV": '"production"' },
    plugins: [
      { name: "global-apps-services", setup(builder) {
        builder.onLoad({ filter: /\/apps\/web\/src\/rpc\.ts$/ }, () => ({ contents: 'export const rpc = { call: (contract, input) => window.globalAppsFixture.call(contract.id, input), subscribe: (contract, _params, message, error) => window.globalAppsFixture.subscribe(contract.id, message, error) };', loader: "js" }));
      } },
      tailwindPlugin([`${root}apps/web/src`, `${root}apps/web/tests`, `${root}plugins/ragents.global-apps/web`]),
    ], logLevel: "silent",
  });
  await writeFile(join(directory, "index.html"), '<!doctype html><html><head><meta charset="utf-8"><title>Global apps</title><link rel="stylesheet" href="fixture.css"></head><body><div id="root"></div><script src="fixture.js"></script></body></html>');
  return pathToFileURL(join(directory, "index.html")).href;
};

const counts = (page: Page) => page.evaluate(() => window.globalAppsFixture.counts());
const calls = (page: Page, id: string) => page.evaluate((method) => window.globalAppsFixture.calls.filter((call) => call.id === method).map((call) => call.input), id);
const noOverflow = async (page: Page) => assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);

test("the Apps page keeps open details through live updates, recovers its subscription, and disposes it when leaving", {
  skip: process.env.RAGENTS_BROWSER_TESTS !== "1", timeout: 120_000,
}, async (context) => {
  const directory = await mkdtemp(join(tmpdir(), "ragents-global-apps-"));
  context.after(() => rm(directory, { recursive: true, force: true }));
  const url = await buildFixture(directory);
  const browser = await chromium.launch({ headless: true, executablePath: process.env.BROWSER_EXECUTABLE_PATH ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" });
  context.after(() => browser.close());
  const page = await browser.newPage({ viewport: { width: 400, height: 850 }, reducedMotion: "reduce" });
  page.setDefaultTimeout(8000);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(url);
  const card = page.getByRole("region", { name: "daily-summary", exact: true });
  await card.getByRole("button", { name: "Run now", exact: true }).waitFor();
  assert.deepEqual(await counts(page), { opened: 1, closed: 0, active: 1 });
  const staticApp = page.getByRole("region", { name: "static-summary", exact: true });
  assert.equal(await staticApp.getByRole("button", { name: /^(Run now|Pause)$/ }).count(), 0);
  await noOverflow(page);

  await card.getByRole("button", { name: "Open details", exact: true }).click();
  const details = page.getByRole("dialog", { name: "daily-summary", exact: true });
  await details.getByText("Snapshot 1", { exact: false }).waitFor();
  await page.evaluate(() => window.globalAppsFixture.update("Updated summary with " + "long-example-output-".repeat(20)));
  await details.getByText("Snapshot 2", { exact: false }).waitFor();
  assert.equal(await details.isVisible(), true, "the same app keeps its open details when a new snapshot arrives");
  assert.deepEqual(await counts(page), { opened: 1, closed: 0, active: 1 }, "live data does not replace the subscription");
  await noOverflow(page);
  await details.getByRole("button", { name: "Close", exact: true }).first().click();
  await details.waitFor({ state: "hidden" });
  await card.getByText("completed: The summary was updated.", { exact: true }).waitFor();
  await noOverflow(page);

  await card.getByRole("button", { name: "Run now", exact: true }).click();
  await page.waitForFunction(() => window.globalAppsFixture.calls.some((call) => call.id === "ragents.actor-programs.trigger"));
  assert.deepEqual(await calls(page, "ragents.actor-programs.trigger"), [{ runId: "global-space", actorId: "summary-actor" }]);
  await card.getByRole("button", { name: "Pause", exact: true }).click();
  await card.getByRole("button", { name: "Resume", exact: true }).waitFor();
  await card.getByRole("button", { name: "Resume", exact: true }).click();
  await card.getByRole("button", { name: "Pause", exact: true }).waitFor();
  assert.deepEqual(await calls(page, "ragents.actor-programs.pause"), [
    { runId: "global-space", actorId: "summary-actor", paused: true },
    { runId: "global-space", actorId: "summary-actor", paused: false },
  ]);
  const unavailable = page.getByRole("region", { name: "unavailable-app", exact: true });
  await unavailable.getByRole("button", { name: "Remove", exact: true }).click();
  await unavailable.waitFor({ state: "hidden" });
  assert.deepEqual(await calls(page, "ragents.global-apps.remove"), [{ name: "unavailable-app" }]);
  await page.waitForFunction(() => window.globalAppsFixture.counts().opened === 2);
  assert.deepEqual(await counts(page), { opened: 2, closed: 1, active: 1 });

  await page.evaluate(() => window.globalAppsFixture.fail("The apps connection was interrupted."));
  const failure = page.getByRole("region", { name: "Global apps unavailable", exact: true });
  await failure.getByRole("alert").filter({ hasText: "The apps connection was interrupted." }).waitFor();
  await failure.getByRole("button", { name: "Retry", exact: true }).click();
  await card.getByRole("button", { name: "Run now", exact: true }).waitFor();
  assert.deepEqual(await counts(page), { opened: 3, closed: 2, active: 1 });
  assert.equal(await failure.count(), 0);

  await page.getByRole("button", { name: "Leave apps", exact: true }).click();
  await page.getByText("Apps closed.", { exact: true }).waitFor();
  assert.deepEqual(await counts(page), { opened: 3, closed: 3, active: 0 });
  await page.evaluate(() => window.globalAppsFixture.update("A summary prepared while the Apps page was closed."));
  await page.getByRole("button", { name: "Open apps", exact: true }).click();
  await card.getByText("A summary prepared while the Apps page was closed.", { exact: true }).waitFor();
  assert.deepEqual(await counts(page), { opened: 4, closed: 3, active: 1 });
  assert.equal(await page.getByRole("dialog").count(), 0);
  await noOverflow(page);

  for (const rights of ["", "ragents.global-apps.write", "runs.write"]) {
    await page.goto(`${url}?rights=${encodeURIComponent(rights)}`);
    await card.getByRole("button", { name: "Open details", exact: true }).waitFor();
    assert.equal(await card.getByRole("button", { name: /^(Run now|Pause|Resume)$/ }).count(), 0, `management needs both write rights: ${rights}`);
    assert.equal(await unavailable.getByRole("button", { name: "Remove", exact: true }).count(), 0);
    await card.getByRole("button", { name: "Open details", exact: true }).click();
    await details.getByText("Snapshot 1", { exact: false }).waitFor();
    assert.equal(await details.getByRole("button", { name: "Remove", exact: true }).count(), 0);
    await noOverflow(page);
  }
  assert.deepEqual(errors, []);
});
