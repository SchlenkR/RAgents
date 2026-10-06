import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";
import { chromium } from "playwright-core";
import { tailwindPlugin } from "./tailwind-plugin";
import type {} from "./session-render-fixture";

test("unchanged session polls preserve context identity and hidden panels pause renders and effects without losing drafts or frames", {
  skip: process.env.RAGENTS_BROWSER_TESTS !== "1", timeout: 60_000,
}, async (context) => {
  const directory = await mkdtemp(join(tmpdir(), "ragents-session-render-"));
  context.after(() => rm(directory, { recursive: true, force: true }));
  const root = fileURLToPath(new URL("../../../", import.meta.url));
  await build({ entryPoints: [fileURLToPath(new URL("session-render-fixture.tsx", import.meta.url))], bundle: true,
    platform: "browser", format: "iife", jsx: "automatic", outfile: join(directory, "fixture.js"),
    plugins: [{ name: "session-render-services", setup(builder) {
      builder.onLoad({ filter: /\/src\/PluginActivation\.ts$/ }, () => ({ contents: 'export const usePluginActivation = () => ({ status: "ready", registry: window.sessionRenderFixture.registry, failures: [] });' }));
      builder.onLoad({ filter: /\/src\/rpc\.ts$/ }, () => ({ contents: 'export const rpc = { call: (...args) => window.sessionRenderFixture.call(...args), subscribe: (...args) => window.sessionRenderFixture.subscribe(...args) };' }));
    } }, tailwindPlugin([`${root}apps/web/src`])], logLevel: "silent" });
  await writeFile(join(directory, "index.html"), '<!doctype html><html><head><link rel="stylesheet" href="fixture.css"></head><body><div id="root" style="height:700px"></div><script src="fixture.js"></script></body></html>');
  const browser = await chromium.launch({ headless: true, executablePath: process.env.BROWSER_EXECUTABLE_PATH ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" });
  context.after(() => browser.close());
  const page = await browser.newPage({ viewport: { width: 900, height: 800 } });
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const settle = () => page.evaluate(() => new Promise<void>((resolve) => setTimeout(resolve, 100)));
  const snapshot = () => page.evaluate(() => {
    const { polls, contextChanges, renders, effects, cleanups, ticks } = window.sessionRenderFixture;
    return { polls, contextChanges, renders, effects, cleanups, ticks };
  });
  for (const host of ["browser", "vscode"]) {
    await page.goto(`${pathToFileURL(join(directory, "index.html")).href}${host === "vscode" ? "?vscode" : ""}`);
    await page.waitForFunction(() => window.sessionRenderFixture?.contextRevision === 1);
    const buttons = host === "browser" ? page.getByRole("group", { name: "Layout actions" }) : page.getByRole("navigation", { name: "Sidebar tabs" });
    await buttons.getByRole("button", { name: "Heavy", exact: true }).click();
    await page.getByText("Heavy active", { exact: true }).waitFor();
    await page.getByRole("textbox", { name: "Heavy draft", exact: true }).fill("Unsent draft");
    await page.getByRole("button", { name: "Count", exact: true }).click();
    const frame = await page.locator('iframe[title="Heavy frame"]').elementHandle();
    await page.frameLocator('iframe[title="Heavy frame"]').getByRole("textbox", { name: "Frame draft" }).fill("Frame input");
    const identity = await frame!.evaluate((element) => Reflect.get((element as HTMLIFrameElement).contentWindow!, "identity"));
    await settle();
    const shown = await snapshot();
    await page.evaluate(() => window.sessionRenderFixture.poll());
    await page.waitForFunction((polls) => window.sessionRenderFixture.polls > polls, shown.polls);
    await settle();
    assert.equal((await snapshot()).contextChanges, shown.contextChanges, "an unchanged poll retains the session context");
    assert.equal((await snapshot()).renders, shown.renders, "an unchanged poll does not render a visible heavy panel");
    await page.evaluate(() => { window.sessionRenderFixture.runs[1]!.revision += 1; window.sessionRenderFixture.poll(); });
    await settle();
    assert.equal((await snapshot()).contextChanges, shown.contextChanges, "an unrelated run update retains the selected context");
    assert.equal((await snapshot()).renders, shown.renders, "an unrelated run update does not render a visible heavy panel");
    await page.evaluate(() => window.sessionRenderFixture.render());
    await settle();
    assert.equal((await snapshot()).renders, shown.renders, "an unrelated parent render keeps the panel tree stable");

    await buttons.getByRole("button", { name: "Light", exact: true }).click();
    await page.getByText("Light panel", { exact: true }).waitFor();
    await page.waitForFunction(() => window.sessionRenderFixture.cleanups === 1);
    await settle();
    const hidden = await snapshot();
    await page.waitForFunction((polls) => window.sessionRenderFixture.polls > polls, hidden.polls, { timeout: 7000 });
    await settle();
    assert.equal((await snapshot()).contextChanges, hidden.contextChanges, "the five-second safety poll retains the context");
    assert.equal((await snapshot()).renders, hidden.renders, "a hidden heavy panel does not render on an unchanged poll");

    await page.evaluate(() => { window.sessionRenderFixture.runs[1]!.revision += 1; window.sessionRenderFixture.poll(); });
    await settle();
    assert.equal((await snapshot()).contextChanges, hidden.contextChanges, "another run's revision does not replace the selected context");
    await page.evaluate(() => { window.sessionRenderFixture.runs[0]!.revision += 1; window.sessionRenderFixture.poll(); });
    await page.waitForFunction(() => window.sessionRenderFixture.contextRevision === 2);
    await page.evaluate(() => { window.sessionRenderFixture.chat(); window.sessionRenderFixture.runChanged(); window.sessionRenderFixture.render(); });
    await page.waitForTimeout(400);
    assert.equal((await snapshot()).renders, hidden.renders, "session, chat, run-view and parent updates do not feed a hidden panel");
    assert.equal((await snapshot()).ticks, hidden.ticks, "hidden effects do no background work");

    await buttons.getByRole("button", { name: "Heavy", exact: true }).click();
    await page.getByText("Heavy active", { exact: true }).waitFor();
    await page.getByText("Revision 2", { exact: true }).waitFor();
    assert.equal(await page.getByRole("textbox", { name: "Heavy draft", exact: true }).inputValue(), "Unsent draft");
    assert.equal(await page.getByRole("status", { name: "Heavy count" }).textContent(), "1");
    assert.equal(await frame!.evaluate((element) => Reflect.get((element as HTMLIFrameElement).contentWindow!, "identity")), identity);
    assert.equal(await page.locator('iframe[title="Heavy frame"]').evaluate((element, original) => element === original, frame), true);
    assert.equal(await page.frameLocator('iframe[title="Heavy frame"]').getByRole("textbox", { name: "Frame draft" }).inputValue(), "Frame input");
    await page.waitForFunction((ticks) => window.sessionRenderFixture.ticks > ticks, hidden.ticks);
    assert.equal((await snapshot()).effects, 2, "revealing resumes the retained panel's effects");
  }
  assert.deepEqual(errors, []);
});
