import assert from "node:assert/strict";
import test from "node:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { chromium, type Locator, type Page } from "playwright-core";
import { tailwindPlugin } from "./tailwind-plugin";
import type {} from "./actor-graph-fixture";

const activationOverride = "export const usePluginActivation = () => window.actorGraphFixture.activation;";
const reviewGroup = "group:coordinator/agent/review";

const buildFixture = async (directory: string): Promise<string> => {
  const root = fileURLToPath(new URL("../../../", import.meta.url));
  const source = `${root}apps/web/src`;
  await build({
    entryPoints: [fileURLToPath(new URL("actor-graph-fixture.tsx", import.meta.url))],
    bundle: true, platform: "browser", format: "iife", jsx: "automatic", outfile: `${directory}/fixture.js`,
    define: { "process.env.NODE_ENV": '"production"' },
    plugins: [
      { name: "actor-graph-services", setup(builder) {
        builder.onLoad({ filter: /\/src\/PluginActivation\.ts$/ }, () => ({ contents: activationOverride, loader: "js", resolveDir: source }));
        builder.onLoad({ filter: /\/src\/rpc\.ts$/ }, () => ({ contents: "export const rpc = { call: (...args) => window.actorGraphFixture.call(...args), subscribe: (...args) => window.actorGraphFixture.subscribe(...args) };" }));
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

/** Whether the element lies completely inside the visible part of its scrolling graph canvas. */
const inView = (element: Locator) => element.evaluate((node) => {
  let scroller = node.parentElement;
  while (scroller && getComputedStyle(scroller).overflowY !== "auto") scroller = scroller.parentElement;
  if (!scroller) return false;
  const inner = node.getBoundingClientRect();
  const outer = scroller.getBoundingClientRect();
  return inner.top >= outer.top && inner.bottom <= outer.bottom && inner.left >= outer.left && inner.right <= outer.right;
});

test("the addressee pop-out and the header's agents view show who created whom as a graph and pick the addressee", {
  skip: process.env.RAGENTS_BROWSER_TESTS !== "1", timeout: 120_000,
}, async (context) => {
  await mkdir("/private/tmp/ragents-actor-graph", { recursive: true });
  const directory = await mkdtemp("/private/tmp/ragents-actor-graph/browser-");
  context.after(() => rm(directory, { recursive: true, force: true }));
  const url = await buildFixture(directory);
  const screenshots = process.env.RAGENTS_SCREENSHOT_DIR;
  const errors: string[] = [];
  const page = await openPage(url, errors, { width: 1280, height: 860 });
  context.after(() => page.close());
  const chat = (event: unknown) => page.evaluate((payload) => window.actorGraphFixture.chat("demo", payload), event);
  await page.locator("[data-chat=composer]").waitFor();
  await chat({ kind: "status", running: false });
  await chat({ kind: "user", text: "Rebuild the addressee list as a graph and have all rules checked.", at: new Date().toISOString() });
  await chat({ kind: "replay-end", conversationId: null });
  const shoot = async (name: string) => {
    if (!screenshots) return;
    await page.evaluate(async () => {
      const finite = document.getAnimations().filter((animation) => animation.effect?.getComputedTiming().iterations !== Infinity);
      await Promise.all(finite.map((animation) => animation.finished.catch(() => undefined)));
    });
    await page.screenshot({ path: `${screenshots}/${name}.png` });
  };

  await page.locator("button[title^=\"Addressee: @coordinator\"]").click();
  const dialog = page.getByRole("dialog", { name: "Addressee" });
  const card = (handle: string) => dialog.locator(`button[data-actor-handle="${handle}"]`);
  const node = (key: string) => dialog.locator(`li[data-graph-node="${key}"]`);
  const group = dialog.locator("button[data-addressee-group=\"@review-*\"]");
  const members = dialog.locator("button[data-actor-handle^=\"review-\"]");
  await card("coordinator").waitFor();
  assert.equal(await card("coordinator").getAttribute("aria-current"), "true");
  assert.equal(await dialog.getByRole("searchbox").count(), 0, "the picker has no search");
  assert.equal(await node("actor:implementer").getAttribute("data-graph-parent"), "actor:coordinator");
  assert.equal(await node("actor:test-writer").getAttribute("data-graph-parent"), "actor:implementer");
  assert.equal(await node("actor:formatter").getAttribute("data-graph-parent"), "actor:implementer", "the TypeScript actor hangs below its creator");
  assert.equal(await node(reviewGroup).getAttribute("data-graph-parent"), "actor:coordinator");
  const coordinatorBox = (await card("coordinator").boundingBox())!;
  const implementerBox = (await card("implementer").boundingBox())!;
  assert.ok(implementerBox.y > coordinatorBox.y + coordinatorBox.height, "children sit a level below their creator");
  assert.equal(await dialog.locator("g[data-tone]").count(), 5, "one edge per created card");
  assert.equal(await dialog.locator("g[data-active=true]").count(), 2, "edges into working actors and groups move");

  await dialog.getByText("Rebuild the chat's addressee list into a graph.", { exact: true }).waitFor();
  await dialog.getByText("formats changed files after every step", { exact: true }).waitFor();
  assert.equal(await card("implementer").locator("[data-addressee-status]").textContent(), "working");
  assert.equal(await card("test-writer").locator("[data-addressee-status]").textContent(), "waiting");
  assert.equal(await card("test-writer").locator("[data-actor-duration=finished]").textContent(), "last turn 42s");
  assert.equal(await card("test-writer").getByText("1", { exact: true }).count(), 1, "the waiting input shows as a badge");
  assert.equal(await card("summary").locator("[data-actor-duration]").count(), 0, "an actor that never finished a turn shows no duration");
  const elapsed = card("coordinator").locator("[data-actor-duration=running]");
  const before = await elapsed.textContent();
  assert.match(before ?? "", /^1m 1\ds$/);
  await page.waitForTimeout(1200);
  assert.notEqual(await elapsed.textContent(), before, "the running time ticks");

  assert.equal(await group.getAttribute("aria-expanded"), "false");
  await group.getByText("37 actors", { exact: true }).waitFor();
  await group.getByText("4 working, 1 waiting for input, 28 waiting, 4 stopped", { exact: true }).waitFor();
  assert.equal(await members.count(), 0, "the group starts closed");
  await shoot("actor-graph-picker");

  const closedAt = (await group.boundingBox())!;
  await group.click();
  assert.equal(await group.getAttribute("aria-expanded"), "true");
  const openAt = (await group.boundingBox())!;
  assert.ok(Math.abs(openAt.x - closedAt.x) <= 1 && Math.abs(openAt.y - closedAt.y) <= 1, "the clicked group card stays where it was clicked");
  assert.equal(await members.count(), 37);
  assert.equal(await dialog.locator(`[data-graph-frame="${reviewGroup}"]`).count(), 1, "the members stand in a frame below the group");
  assert.equal(await node("actor:review-visibility").getAttribute("data-graph-parent"), reviewGroup);
  assert.equal(await card("review-visibility").locator("[data-addressee-status]").textContent(), "stopped");
  assert.equal(await card("review-dates").locator("[data-addressee-status]").textContent(), "waiting for input");
  const rows = new Set(await members.evaluateAll((buttons) => buttons.map((button) => Math.round(button.getBoundingClientRect().top))));
  assert.ok(rows.size > 1, "37 members wrap into rows");
  await shoot("actor-graph-group-open");
  await group.click();
  assert.equal(await members.count(), 0);

  await group.click();
  await card("review-strings").click();
  await page.getByPlaceholder("Message to @review-strings ...").waitFor();
  assert.equal(await dialog.count(), 0, "picking closes the pop-out");

  await page.locator("button[title^=\"Addressee: @review-strings\"]:visible").click();
  await card("review-strings").waitFor();
  assert.equal(await card("review-strings").getAttribute("aria-current"), "true");
  assert.equal(await group.getAttribute("aria-expanded"), "true", "the group holding the addressee opens by itself");
  assert.equal(await inView(card("review-strings")), true, "the addressee is scrolled into view");
  await page.keyboard.press("Escape");
  assert.equal(await dialog.count(), 0, "Escape closes the pop-out");

  await page.getByRole("button", { name: "Agents", exact: true }).click();
  const agents = page.getByRole("dialog", { name: "Agents" });
  await agents.locator("button[data-actor-handle=\"review-strings\"]").waitFor();
  assert.equal(await agents.locator("button[data-actor-handle=\"review-strings\"]").getAttribute("aria-current"), "true");
  assert.equal(await agents.locator("button[data-actor-handle^=\"review-\"]").count(), 37, "the group holding the addressee is open");
  assert.equal(await agents.locator("g[data-tone]").count(), 6, "one line leads into the open group's frame, none to each member");
  await shoot("actor-graph-agents");
  await agents.locator("button[data-actor-handle=\"test-writer\"]").click();
  await page.locator("button[title^=\"Addressee: @test-writer\"]:visible").waitFor();
  assert.equal(await agents.count(), 0, "picking in the agents view closes it");
  assert.deepEqual(errors, []);
});
