import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";
import { chromium } from "playwright-core";
import { tailwindPlugin } from "./tailwind-plugin";
import type {} from "./run-tabs-fixture";

test("browser tabs preserve drafts and mounted app identity through selection and catalog changes", {
  skip: process.env.RAGENTS_BROWSER_TESTS !== "1", timeout: 120_000,
}, async (context) => {
  const directory = await mkdtemp(join(tmpdir(), "ragents-run-tabs-"));
  context.after(() => rm(directory, { recursive: true, force: true }));
  const root = fileURLToPath(new URL("../../../", import.meta.url));
  await build({ entryPoints: [fileURLToPath(new URL("run-tabs-fixture.tsx", import.meta.url))], bundle: true,
    platform: "browser", format: "iife", jsx: "automatic", outfile: join(directory, "fixture.js"),
    plugins: [tailwindPlugin([`${root}apps/web/src`, `${root}plugins/ragents.orchestration/web`])], logLevel: "silent" });
  await writeFile(join(directory, "index.html"), '<!doctype html><html><head><link rel="stylesheet" href="fixture.css"></head><body><div id="root" style="height:700px;display:flex"></div><script src="fixture.js"></script></body></html>');
  const browser = await chromium.launch({ headless: true, executablePath: process.env.BROWSER_EXECUTABLE_PATH ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" });
  context.after(() => browser.close());
  const page = await browser.newPage();
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(pathToFileURL(join(directory, "index.html")).href);
  const tab = (name: string) => page.getByRole("tab", { name, exact: true });
  const selected = async (name: string) => {
    await page.waitForFunction((name) => [...document.querySelectorAll('[role="tab"][aria-selected="true"]')].some((el) => el.textContent === name), name);
    assert.equal(await page.locator('[data-run-panel="run"] > section:visible').count(), 1);
  };
  await selected("Chat");
  assert.deepEqual(await page.evaluate(() => window.tabsFixture.mounts), {});
  await page.getByRole("textbox", { name: "Chat draft" }).fill("Unsent message");
  await tab("Notes").click();
  await selected("Notes");
  const notes = page.getByRole("textbox", { name: "Notes draft" });
  await notes.fill("Unsent note");
  const original = await notes.elementHandle();
  await tab("Counter").click();
  await selected("Counter");
  await page.getByRole("textbox", { name: "Counter draft" }).fill("7");
  await tab("Notes").click();
  assert.equal(await notes.inputValue(), "Unsent note");
  assert.equal(await notes.evaluate((node, original) => node === original, original), true);
  await page.evaluate(() => window.tabsFixture.setApps([{ id: "counter", title: "Counter" }, { id: "notes", title: "Notes" }, { id: "new", title: "New app" }]));
  await tab("New app").waitFor();
  await selected("Notes");
  assert.deepEqual(await page.evaluate(() => window.tabsFixture.mounts), { notes: 1, counter: 1 });
  await tab("Chat").click();
  assert.equal(await page.getByRole("textbox", { name: "Chat draft" }).inputValue(), "Unsent message");
  await tab("Notes").click();
  await page.evaluate(() => window.tabsFixture.setApps([{ id: "notes", title: "Notes", visible: false }, { id: "counter", title: "Counter" }]));
  await selected("Chat");
  await page.evaluate(() => window.tabsFixture.setApps([{ id: "notes", title: "Notes" }, { id: "counter", title: "Counter" }]));
  await tab("Notes").waitFor();
  await selected("Chat");
  await tab("Counter").click();
  assert.equal(await page.getByRole("textbox", { name: "Counter draft" }).inputValue(), "7");
  await page.evaluate(() => window.tabsFixture.setRun("second"));
  await selected("Chat");
  assert.equal(await page.getByRole("textbox", { name: "Chat draft" }).inputValue(), "");
  assert.deepEqual(errors, []);
});
