import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";
import { chromium } from "playwright-core";
import { tailwindPlugin } from "./tailwind-plugin";
import type {} from "./workspace-access-fixture";

const browserOnly = { skip: process.env.RAGENTS_BROWSER_TESTS !== "1", timeout: 120_000 };

async function fixturePage(context: test.TestContext) {
  const directory = await mkdtemp(join(tmpdir(), "ragents-workspace-access-"));
  context.after(() => rm(directory, { recursive: true, force: true }));
  const root = fileURLToPath(new URL("../../../", import.meta.url));
  await build({ entryPoints: [fileURLToPath(new URL("workspace-access-fixture.tsx", import.meta.url))], bundle: true,
    platform: "browser", format: "iife", jsx: "automatic", outfile: join(directory, "fixture.js"),
    plugins: [tailwindPlugin([`${root}apps/web/src`, `${root}plugins/ragents.workspace/web`])], logLevel: "silent" });
  await writeFile(join(directory, "index.html"), '<!doctype html><html><head><link rel="stylesheet" href="fixture.css"></head><body><div id="root"></div><script src="fixture.js"></script></body></html>');
  const browser = await chromium.launch({ headless: true, executablePath: process.env.BROWSER_EXECUTABLE_PATH ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" });
  context.after(() => browser.close());
  const page = await browser.newPage({ viewport: { width: 700, height: 700 } });
  page.setDefaultTimeout(8000);
  return { page, url: pathToFileURL(join(directory, "index.html")).href };
}

test("the access composer chooses both levels and full access uses the theme warning color", browserOnly, async (context) => {
  const { page, url } = await fixturePage(context);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(url + "?workstation");
  const control = page.getByRole("combobox", { name: "Run access" });
  await control.waitFor();
  assert.match(await control.textContent() ?? "", /Isolated/);
  await page.getByText("Reads follow the machine's blocked and allowed areas; writes stay in the run's writable folders and write grants. Secrets are removed from the environment. Commands are isolated by the workstation OS sandbox. Network access is unrestricted.", { exact: true }).waitFor();
  await control.click();
  await page.getByRole("option", { name: "Full access", exact: true }).click();
  await page.waitForFunction(() => window.workspaceAccessFixture.changes.length === 1);
  assert.deepEqual(await page.evaluate(() => window.workspaceAccessFixture.changes), ["full"]);
  assert.match(await control.textContent() ?? "", /Full access/);
  await page.getByText("File tools accept every path and commands inherit the workstation environment, including secrets. Local confirmation is required.", { exact: true }).waitFor();
  await page.waitForFunction(() => {
    const element = document.querySelector('[aria-label="Run access"]')!;
    const probe = document.createElement("span");
    probe.style.color = "var(--warning)";
    element.append(probe);
    const matches = getComputedStyle(element).color === getComputedStyle(probe).color;
    probe.remove();
    return matches;
  });
  await control.click();
  await page.getByRole("option", { name: "Isolated", exact: true }).click();
  await page.waitForFunction(() => window.workspaceAccessFixture.changes.length === 2);
  assert.deepEqual(await page.evaluate(() => window.workspaceAccessFixture.changes), ["full", "isolated"]);
  assert.equal(await page.locator("[title]").count(), 0);
  assert.deepEqual(errors, []);
});

test("a disallowed access increase is disabled with its reason and a full run can return to isolated", browserOnly, async (context) => {
  const { page, url } = await fixturePage(context);
  await page.goto(url + "?disabled");
  const control = page.getByRole("combobox", { name: "Run access" });
  await control.waitFor();
  assert.equal(await control.isDisabled(), true);
  const reason = "Full access on the server requires an administrator.";
  await page.getByText(reason, { exact: true }).waitFor();
  assert.equal(await control.getAttribute("aria-describedby"), await page.getByText(reason, { exact: true }).getAttribute("id"));
  assert.deepEqual(await page.evaluate(() => window.workspaceAccessFixture.changes), []);
  await page.goto(url + "?disabled&full");
  await control.waitFor();
  assert.equal(await control.isDisabled(), false);
  await control.click();
  assert.equal(await page.getByRole("option", { name: "Full access", exact: true }).getAttribute("aria-disabled"), "true");
  await page.getByRole("option", { name: "Isolated", exact: true }).click();
  await page.waitForFunction(() => window.workspaceAccessFixture.changes.length === 1);
  assert.deepEqual(await page.evaluate(() => window.workspaceAccessFixture.changes), ["isolated"]);
  assert.equal(await control.isDisabled(), true);
  await page.goto(url + "?locked");
  await control.waitFor();
  assert.equal(await control.isDisabled(), true);
});

test("Windows shows the command-isolation limit in the composer and details", browserOnly, async (context) => {
  const { page, url } = await fixturePage(context);
  await page.goto(url + "?workstation&windows");
  const control = page.getByRole("combobox", { name: "Run access" });
  await control.waitFor();
  assert.match(await control.textContent() ?? "", /Isolated/);
  const notice = page.getByText("Commands are not isolated on this machine.", { exact: true });
  await notice.waitFor();
  assert.equal(await control.getAttribute("aria-describedby"), await notice.getAttribute("id"));
  await page.getByText("Reads follow the machine's blocked and allowed areas; writes stay in the run's writable folders and write grants. Secrets are removed from the environment. Commands are not isolated on this machine; the file rule applies to file tools only. Network access is unrestricted.", { exact: true }).waitFor();
  assert.equal(await page.locator("[title]").count(), 0);
  await page.goto(url + "?workstation&disconnected");
  await page.getByText("Command isolation is unknown until the workstation reconnects.", { exact: true }).waitFor();
});
