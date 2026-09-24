import assert from "node:assert/strict";
import test from "node:test";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { chromium } from "playwright-core";
import { tailwindPlugin } from "./tailwind-plugin";
import type {} from "./run-panel-focus-fixture";

test("new VS Code runs focus their enabled chat once without stealing focus on replay or navigation", {
  skip: process.env.RAGENTS_BROWSER_TESTS !== "1", timeout: 60_000,
}, async () => {
  await mkdir("/private/tmp/ragents-new-run-focus", { recursive: true });
  const directory = await mkdtemp("/private/tmp/ragents-new-run-focus/browser-");
  const root = fileURLToPath(new URL("../../../", import.meta.url));
  await build({
    entryPoints: [fileURLToPath(new URL("run-panel-focus-fixture.tsx", import.meta.url))],
    bundle: true, platform: "browser", format: "iife", outfile: `${directory}/fixture.js`,
    plugins: [
      { name: "focus-fixture-services", setup(builder) {
        builder.onLoad({ filter: /\/src\/PluginActivation\.ts$/ }, () => ({ contents: 'export const usePluginActivation = () => ({ status: "ready", registry: window.runFocusFixture.registry, failures: [] });' }));
        builder.onLoad({ filter: /\/src\/rpc\.ts$/ }, () => ({ contents: 'export const rpc = { call: (...args) => window.runFocusFixture.call(...args), subscribe: (...args) => window.runFocusFixture.subscribe(...args) };' }));
      } },
      tailwindPlugin([`${root}apps/web/src`]),
    ], logLevel: "silent",
  });
  await writeFile(`${directory}/index.html`, '<!doctype html><html><head><link rel="stylesheet" href="fixture.css"><style>html,body{height:100%;margin:0}#root{height:calc(100% - 40px)}#outside{height:40px}</style></head><body><button id="outside">Außerhalb</button><div id="root"></div><script src="fixture.js"></script></body></html>');
  const browser = await chromium.launch({ headless: true, executablePath: process.env.BROWSER_EXECUTABLE_PATH ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" });
  try {
    const page = await browser.newPage({ viewport: { width: 900, height: 800 } });
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    const input = page.locator("textarea");
    const settle = () => page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
    const focused = () => input.evaluate((element) => element === document.activeElement);
    const ready = async () => { await page.evaluate(() => window.runFocusFixture.ready()); await settle(); };
    const load = async (query = "") => {
      await page.goto(`file://${directory}/index.html${query}`);
      await input.waitFor({ state: "attached" });
      if (!query.includes("mode=composer")) await page.locator("#outside").focus();
    };
    await load();
    await ready();
    assert.equal(await focused(), false, "Opening an existing run must keep focus outside the composer.");

    await page.evaluate(() => window.runFocusFixture.command({ type: "newRun" }));
    await page.waitForFunction(() => window.runFocusFixture.activeRun() !== undefined && window.runFocusFixture.activeRun() !== "existing");
    assert.equal(await input.isDisabled(), true);
    assert.equal(await focused(), false, "A new run waits for replay before focusing.");
    await ready();
    await page.waitForFunction(() => document.activeElement?.tagName === "TEXTAREA");
    await page.keyboard.type("Direkt losschreiben");
    assert.equal(await input.inputValue(), "Direkt losschreiben");

    await page.locator("#outside").click();
    await page.evaluate(() => { window.runFocusFixture.stream(); window.runFocusFixture.disconnect(); });
    await settle();
    await ready();
    assert.equal(await focused(), false, "Streaming and reconnect must not repeat the initial focus.");
    await page.evaluate(() => window.runFocusFixture.command({ type: "selectRun", runId: "existing" }));
    await page.waitForFunction(() => window.runFocusFixture.activeRun() === "existing");
    await ready();
    assert.equal(await focused(), false, "Selecting an existing run does not request focus.");

    await page.evaluate(() => window.runFocusFixture.command({ type: "newRun", entryId: "focus.template" }));
    await page.waitForFunction(() => window.runFocusFixture.calls.includes("ragents.chat.start") && window.runFocusFixture.activeRun() !== undefined && window.runFocusFixture.activeRun() !== "existing");
    assert.equal(await input.isDisabled(), true);
    await ready();
    await page.waitForFunction(() => document.activeElement?.tagName === "TEXTAREA");

    await page.locator("#outside").click();
    await page.evaluate(() => window.runFocusFixture.command({ type: "newRun" }));
    await page.waitForFunction(() => document.querySelector<HTMLTextAreaElement>("textarea")?.disabled === true);
    await page.locator("#outside").click();
    await ready();
    assert.equal(await focused(), false, "A user action while the new run connects cancels its pending focus.");

    await load("?host=browser");
    await ready();
    assert.equal(await focused(), false, "Browser run initialization retains its existing focus behavior.");
    await load("?readonly=true");
    await ready();
    assert.equal(await input.isDisabled(), true);
    assert.equal(await focused(), false);
    await page.evaluate(() => window.runFocusFixture.command({ type: "newRun" }));
    await settle();
    assert.equal(await page.evaluate(() => window.runFocusFixture.activeRun()), "existing", "Read-only access cannot create or focus a run.");

    await load("?mode=composer");
    await page.evaluate(() => { window.runFocusFixture.hidden = true; window.runFocusFixture.disabled = false; window.runFocusFixture.render(); });
    await settle();
    assert.equal(await focused(), false, "A hidden composer must not consume focus.");
    assert.equal(await page.evaluate(() => window.runFocusFixture.settled), 0);
    await page.evaluate(() => { window.runFocusFixture.hidden = false; window.runFocusFixture.render(); });
    await page.waitForFunction(() => document.activeElement?.tagName === "TEXTAREA");
    assert.equal(await page.evaluate(() => window.runFocusFixture.settled), 1);
    await page.locator("#outside").click();
    await page.evaluate(() => { window.runFocusFixture.disabled = true; window.runFocusFixture.render(); });
    await settle();
    await page.evaluate(() => { window.runFocusFixture.disabled = false; window.runFocusFixture.render(); });
    await settle();
    assert.equal(await focused(), false);
    assert.equal(await page.evaluate(() => window.runFocusFixture.settled), 1);

    await load("?mode=composer");
    await page.locator("#outside").click();
    await page.evaluate(() => { window.runFocusFixture.disabled = false; window.runFocusFixture.render(); });
    await settle();
    assert.equal(await focused(), false, "An explicit user action while connecting cancels the pending focus.");

    await load("?mode=composer");
    await page.evaluate(() => {
      const dialog = document.createElement("div");
      dialog.setAttribute("role", "dialog");
      dialog.textContent = "Anderer Dialog";
      document.body.appendChild(dialog);
      window.runFocusFixture.disabled = false;
      window.runFocusFixture.render();
    });
    await settle();
    assert.equal(await focused(), false, "An open dialog cancels the pending composer focus.");
    assert.equal(await page.evaluate(() => window.runFocusFixture.settled), 1);
    await page.locator("[role=dialog]").evaluate((element) => element.remove());
    await settle();
    assert.equal(await focused(), false, "Closing the dialog must not resurrect the consumed focus request.");
    assert.deepEqual(errors, []);
  } finally { await browser.close(); }
});
