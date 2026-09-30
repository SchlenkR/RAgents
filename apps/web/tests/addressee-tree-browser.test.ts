import assert from "node:assert/strict";
import test from "node:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { chromium, type Page } from "playwright-core";
import { tailwindPlugin } from "./tailwind-plugin";
import type {} from "./addressee-tree-fixture";

const activationOverride = "export const usePluginActivation = () => window.addresseeFixture.activation;";

const buildFixture = async (directory: string): Promise<string> => {
  const root = fileURLToPath(new URL("../../../", import.meta.url));
  const source = `${root}apps/web/src`;
  await build({
    entryPoints: [fileURLToPath(new URL("addressee-tree-fixture.tsx", import.meta.url))],
    bundle: true, platform: "browser", format: "iife", jsx: "automatic", outfile: `${directory}/fixture.js`,
    define: { "process.env.NODE_ENV": '"production"' },
    plugins: [
      { name: "addressee-services", setup(builder) {
        builder.onLoad({ filter: /\/src\/PluginActivation\.ts$/ }, () => ({ contents: activationOverride, loader: "js", resolveDir: source }));
        builder.onLoad({ filter: /\/src\/rpc\.ts$/ }, () => ({ contents: "export const rpc = { call: (...args) => window.addresseeFixture.call(...args), subscribe: (...args) => window.addresseeFixture.subscribe(...args) };" }));
      } },
      tailwindPlugin([source, `${root}plugins/ragents.orchestration/web`]),
    ], logLevel: "silent",
  });
  await writeFile(`${directory}/index.html`, '<!doctype html><html><head><link rel="stylesheet" href="fixture.css"><style>html,body{height:100%;margin:0}#root{height:100%}</style></head><body><div id="root"></div><script src="fixture.js"></script></body></html>');
  return `file://${directory}/index.html`;
};

const openPage = async (url: string, errors: string[], viewport: { width: number; height: number }): Promise<Page> => {
  const browser = await chromium.launch({ headless: true, executablePath: process.env.BROWSER_EXECUTABLE_PATH });
  const page = await browser.newPage({ viewport, reducedMotion: "reduce" });
  page.on("close", () => void browser.close());
  page.setDefaultTimeout(8000);
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(url);
  return page;
};

test("the addressee pop-out shows who created whom, groups the reviewers and picks the addressee", {
  skip: process.env.RAGENTS_BROWSER_TESTS !== "1", timeout: 120_000,
}, async (context) => {
  await mkdir("/private/tmp/ragents-addressee-tree", { recursive: true });
  const directory = await mkdtemp("/private/tmp/ragents-addressee-tree/browser-");
  context.after(() => rm(directory, { recursive: true, force: true }));
  const url = await buildFixture(directory);
  const screenshots = process.env.RAGENTS_SCREENSHOT_DIR;
  const errors: string[] = [];
  const page = await openPage(url, errors, { width: 560, height: 820 });
  context.after(() => page.close());
  const chat = (event: unknown) => page.evaluate((payload) => window.addresseeFixture.chat("demo", payload), event);
  await page.locator("[data-chat=composer]").waitFor();
  await chat({ kind: "status", running: false });
  await chat({ kind: "user", text: "Rebuild the addressee list as a tree and have all rules checked.", at: "2026-09-25T09:05:00.000Z" });
  await chat({ kind: "replay-end", conversationId: null });

  await page.locator("button[title^=\"Addressee: @coordinator\"]").click();
  const dialog = page.getByRole("dialog", { name: "Addressee" });
  const entry = (handle: string) => dialog.locator(`button[data-actor-handle="${handle}"]`);
  const group = dialog.locator("button[data-addressee-group=\"@review-*\"]");
  const shoot = async (name: string) => {
    if (!screenshots) return;
    await page.evaluate(async () => {
      const finite = document.getAnimations().filter((animation) => animation.effect?.getComputedTiming().iterations !== Infinity);
      await Promise.all(finite.map((animation) => animation.finished.catch(() => undefined)));
    });
    await page.screenshot({ path: `${screenshots}/${name}.png` });
  };
  await entry("coordinator").waitFor();
  assert.equal(await entry("coordinator").getAttribute("aria-current"), "true");
  const below = (parent: string, child: string) => dialog.locator(`li:has(> button[data-actor-handle="${parent}"]) > ul button[data-actor-handle="${child}"]`).count();
  assert.equal(await below("coordinator", "implementer"), 1, "the implementer sits below the coordinator");
  assert.equal(await below("implementer", "test-writer"), 1, "the test writer sits below the implementer");
  assert.equal(await below("implementer", "formatter"), 1, "the TypeScript actor sits below its creator");
  assert.equal(await below("test-writer", "implementer"), 0);
  await dialog.getByText("Rebuild the chat's addressee list into a tree.", { exact: true }).waitFor();
  await dialog.getByText("formats changed files after every step", { exact: true }).waitFor();
  assert.equal(await entry("implementer").locator("[data-addressee-status]").textContent(), "working");
  assert.equal(await entry("test-writer").locator("[data-addressee-status]").textContent(), "waiting");
  assert.equal(await group.getAttribute("aria-expanded"), "false");
  await group.getByText("37 actors", { exact: true }).waitFor();
  await group.getByText("4 working, 29 waiting, 4 stopped", { exact: true }).waitFor();
  assert.equal(await dialog.locator("button[data-actor-handle^=\"review-\"]").count(), 0, "the group starts closed");
  await dialog.getByRole("searchbox", { name: "Search actors" }).waitFor();
  await shoot("addressee-tree-group-closed");

  await group.click();
  assert.equal(await group.getAttribute("aria-expanded"), "true");
  assert.equal(await dialog.locator("button[data-actor-handle^=\"review-\"]").count(), 37);
  assert.equal(await entry("review-visibility").locator("[data-addressee-status]").textContent(), "stopped");
  await shoot("addressee-tree-group-open");
  await group.click();
  assert.equal(await dialog.locator("button[data-actor-handle^=\"review-\"]").count(), 0);

  await dialog.getByRole("searchbox", { name: "Search actors" }).fill("rule comments");
  await entry("review-comments").waitFor();
  assert.deepEqual(await dialog.locator("button[data-actor-handle]").evaluateAll((buttons) => buttons.map((button) => button.getAttribute("data-actor-handle"))), ["coordinator", "review-comments"]);
  await shoot("addressee-tree-search");
  await entry("review-comments").click();
  await page.getByPlaceholder("Message to @review-comments ...").waitFor();
  assert.equal(await dialog.count(), 0, "picking closes the pop-out");

  await page.locator("button[title^=\"Addressee: @review-comments\"]:visible").click();
  await entry("review-comments").waitFor();
  assert.equal(await entry("review-comments").getAttribute("aria-current"), "true");
  assert.equal(await group.getAttribute("aria-expanded"), "true", "the group holding the addressee opens by itself");
  await shoot("addressee-tree-selection");
  await entry("implementer").click();
  await page.locator("button[title^=\"Addressee: @implementer\"]:visible").waitFor();
  assert.deepEqual(errors, []);
});
