import assert from "node:assert/strict";
import test from "node:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
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

/** Pan position, pan range, and cursor of the graph canvas in a pop-out. */
const canvasOf = (popout: Locator) => popout.evaluate((node) => {
  let scroller = node.querySelector<HTMLElement>('ul[aria-label="Actors by creator"]')?.parentElement;
  while (scroller && getComputedStyle(scroller).overflowY !== "auto") scroller = scroller.parentElement;
  if (!scroller) throw new Error("The pop-out has no graph canvas.");
  return { left: scroller.scrollLeft, top: scroller.scrollTop, maxLeft: scroller.scrollWidth - scroller.clientWidth, maxTop: scroller.scrollHeight - scroller.clientHeight, cursor: getComputedStyle(scroller).cursor };
});

const box = async (element: Locator) => {
  const bounds = await element.boundingBox();
  assert.ok(bounds, "the element is rendered");
  return bounds;
};
const near = (actual: number, expected: number) => Math.abs(actual - expected) <= 1;
const center = (bounds: { x: number; y: number; width: number; height: number }) => ({ x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 });

/** A left mouse button press that moves by the offset in several steps. */
const drag = async (page: Page, from: { x: number; y: number }, dx: number, dy: number) => {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x + dx, from.y + dy, { steps: 8 });
  await page.mouse.up();
};

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
  /** Waits for the opening animation of a pop-out, which scales it. */
  const settle = () => page.evaluate(async () => {
    const finite = document.getAnimations().filter((animation) => animation.effect?.getComputedTiming().iterations !== Infinity);
    await Promise.all(finite.map((animation) => animation.finished.catch(() => undefined)));
  });
  const shoot = async (name: string) => {
    if (!screenshots) return;
    await settle();
    await page.screenshot({ path: `${screenshots}/${name}.png` });
  };

  assert.equal(await page.getByRole("button", { name: /^Back to @/ }).count(), 0, "the chip has no way back while it addresses the primary actor");
  await page.locator("button[title^=\"Addressee: @coordinator\"]").click();
  const dialog = page.getByRole("dialog", { name: "Addressee" });
  const card = (handle: string) => dialog.locator(`button[data-actor-handle="${handle}"]`);
  const node = (key: string) => dialog.locator(`li[data-graph-node="${key}"]`);
  const group = dialog.locator("button[data-addressee-group=\"@review-*\"]");
  const members = dialog.locator("button[data-actor-handle^=\"review-\"]");
  await card("coordinator").waitFor();
  assert.equal(await card("coordinator").getAttribute("aria-current"), "true");
  assert.equal(await dialog.getByRole("searchbox").count(), 0, "the picker has no search");
  await dialog.getByText("Addressee", { exact: true }).waitFor();
  const closeBox = await dialog.getByRole("button", { name: "Close addressee" }).boundingBox();
  const firstCard = await card("coordinator").boundingBox();
  assert.ok(closeBox && firstCard && closeBox.y + closeBox.height <= firstCard.y, "the close button sits in the pop-out's title bar, clear of the actor cards");
  assert.equal(await page.locator('[data-slot="popover-backdrop"]:visible').count(), 0, "the addressee pop-out leaves the page undimmed, like the model menus");
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
  await settle();
  const compact = await box(dialog);
  const titleBar = await box(dialog.locator("header"));
  const fits = await canvasOf(dialog);
  assert.ok(compact.width < 1000 && compact.height - titleBar.height < 360, `a small graph keeps the pop-out compact below its title bar (${compact.width} x ${compact.height})`);
  assert.deepEqual([fits.maxLeft, fits.maxTop], [0, 0], "a graph that fits does not pan");
  assert.notEqual(fits.cursor, "grab");

  await group.click();
  assert.equal(await group.getAttribute("aria-expanded"), "true");
  await page.waitForFunction(() => {
    const bounds = document.querySelector('[role="dialog"][aria-label="Addressee"]')?.getBoundingClientRect();
    return bounds !== undefined && bounds.y <= 9 && bounds.width >= 1280 - 17;
  });
  const grown = await box(dialog);
  assert.ok(grown.y <= 9 && grown.width >= 1280 - 17, `the large graph grows the pop-out up to the top and across the window (${grown.x}, ${grown.y}, ${grown.width} x ${grown.height})`);
  assert.equal(await inView(group), true, "the clicked group card stays in view");
  assert.equal(await members.count(), 37);
  assert.equal(await dialog.locator(`[data-graph-frame="${reviewGroup}"]`).count(), 1, "the members stand in a frame below the group");
  assert.equal(await node("actor:review-visibility").getAttribute("data-graph-parent"), reviewGroup);
  assert.equal(await card("review-visibility").locator("[data-addressee-status]").textContent(), "stopped");
  assert.equal(await card("review-dates").locator("[data-addressee-status]").textContent(), "waiting for input");
  const rows = new Set(await members.evaluateAll((buttons) => buttons.map((button) => Math.round(button.getBoundingClientRect().top))));
  assert.ok(rows.size > 1, "37 members wrap into rows");
  await shoot("actor-graph-group-open");

  const pannable = await canvasOf(dialog);
  assert.ok(pannable.maxLeft > 0 && pannable.maxTop > 0, "the graph is larger than the window and pans");
  assert.equal(pannable.cursor, "grab");
  await drag(page, center(await box(group)), 400, 400);
  assert.equal(await group.getAttribute("aria-expanded"), "true", "a drag that starts on the group card pans instead of toggling it");
  const first = await canvasOf(dialog);
  assert.deepEqual([first.left, first.top], [0, 0]);
  assert.ok(near((await box(card("test-writer"))).x, grown.x + 40), "panning stops 40 pixels left of the leftmost card");
  const grownTitle = await box(dialog.locator("header"));
  assert.ok(near((await box(card("coordinator"))).y, grownTitle.y + grownTitle.height + 40), "panning stops 40 pixels above the top card, below the title bar");
  await drag(page, { x: grown.x + grown.width - 60, y: grown.y + grown.height - 60 }, -1100, -700);
  assert.equal(await dialog.count(), 1, "a drag that starts on a card pans instead of picking it");
  const last = await canvasOf(dialog);
  assert.deepEqual([last.left, last.top], [last.maxLeft, last.maxTop], "a long drag stops at the far corner");
  const summaryBox = await box(card("summary"));
  const frameBox = await box(dialog.locator(`[data-graph-frame="${reviewGroup}"]`));
  assert.ok(near(summaryBox.x + summaryBox.width, grown.x + grown.width - 40), "panning stops 40 pixels right of the rightmost card");
  assert.ok(near(frameBox.y + frameBox.height, grown.y + grown.height - 40), "panning stops 40 pixels below the lowest frame");
  await shoot("actor-graph-panned");
  await page.mouse.move(grown.x + grown.width / 2, grown.y + grown.height / 2);
  await page.mouse.wheel(-120, -90);
  await page.waitForFunction((limit) => {
    const scroller = [...document.querySelectorAll<HTMLElement>("[role=dialog] *")].find((element) => getComputedStyle(element).overflowY === "auto");
    return scroller !== undefined && scroller.scrollLeft < limit.left && scroller.scrollTop < limit.top;
  }, { left: last.left, top: last.top });
  await page.mouse.wheel(5000, 5000);
  await page.waitForFunction((limit) => {
    const scroller = [...document.querySelectorAll<HTMLElement>("[role=dialog] *")].find((element) => getComputedStyle(element).overflowY === "auto");
    return scroller !== undefined && scroller.scrollLeft === limit.left && scroller.scrollTop === limit.top;
  }, { left: last.maxLeft, top: last.maxTop });
  assert.equal(await inView(card("coordinator")), false);
  await dialog.getByRole("button", { name: "Close addressee" }).focus();
  await page.keyboard.press("Tab");
  assert.equal(await card("coordinator").evaluate((node) => node === document.activeElement), true);
  assert.equal(await inView(card("coordinator")), true, "a card reached with Tab pans into view");

  await group.click();
  assert.equal(await members.count(), 0);

  await group.click();
  await card("review-strings").scrollIntoViewIfNeeded();
  const pressAt = await box(card("review-strings"));
  await page.mouse.move(pressAt.x + 40, pressAt.y + 30);
  await page.mouse.down();
  await page.mouse.move(pressAt.x + 43, pressAt.y + 32);
  await page.mouse.up();
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
  const agentsGroup = agents.locator("button[data-addressee-group=\"@review-*\"]");
  await agents.locator("button[data-actor-handle=\"review-strings\"]").waitFor();
  assert.equal(await agents.locator("button[data-actor-handle=\"review-strings\"]").getAttribute("aria-current"), "true");
  assert.equal(await agents.locator("button[data-actor-handle^=\"review-\"]").count(), 37, "the group holding the addressee is open");
  assert.equal(await agents.locator("g[data-tone]").count(), 6, "one line leads into the open group's frame, none to each member");
  await settle();
  const agentsBox = await box(agents);
  assert.ok(agentsBox.y + agentsBox.height <= 860 - 7 && near(agentsBox.width, 1264), `the agents view uses the shared header width and stays inside the window (${agentsBox.x}, ${agentsBox.y}, ${agentsBox.width} x ${agentsBox.height})`);
  await shoot("actor-graph-agents");
  await agentsGroup.click();
  assert.equal(await agentsGroup.getAttribute("aria-expanded"), "false");
  const closedAt = await box(agentsGroup);
  await agentsGroup.click();
  assert.equal(await agentsGroup.getAttribute("aria-expanded"), "true");
  const openAt = await box(agentsGroup);
  assert.ok(near(openAt.x, closedAt.x) && near(openAt.y, closedAt.y), `the clicked group card stays where it was clicked while the view grows (${closedAt.x}, ${closedAt.y} -> ${openAt.x}, ${openAt.y})`);
  await agents.locator("button[data-actor-handle=\"test-writer\"]").click();
  await page.locator("button[title^=\"Addressee: @test-writer\"]:visible").waitFor();
  await agents.waitFor({ state: "detached" });
  assert.equal(await agents.count(), 0, "picking in the agents view closes it");

  await shoot("actor-graph-back");
  await page.getByRole("button", { name: "Back to @coordinator" }).click();
  await page.locator("button[title^=\"Addressee: @coordinator\"]:visible").waitFor();
  assert.equal(await page.getByRole("button", { name: /^Back to @/ }).count(), 0, "back at the primary actor the x disappears");
  assert.equal(await dialog.count(), 0, "the x does not open the pop-out");

  await page.evaluate(() => { document.documentElement.style.zoom = "1.25"; });
  await page.getByRole("button", { name: "Agents", exact: true }).click();
  await agentsGroup.click();
  await agents.locator("button[data-actor-handle^=\"review-\"]").first().waitFor();
  await settle();
  const zoomedBox = await box(agents);
  assert.ok(zoomedBox.x >= 7 && zoomedBox.y + zoomedBox.height <= 860 - 7, `with a page zoom the agents view stays inside the window (${zoomedBox.x}, ${zoomedBox.y}, ${zoomedBox.width} x ${zoomedBox.height})`);
  const zoomedStart = await canvasOf(agents);
  const direction = zoomedStart.left >= 80 ? 1 : -1;
  await drag(page, center(await box(agentsGroup)), 100 * direction, 0);
  const zoomedEnd = await canvasOf(agents);
  assert.ok(near(zoomedStart.left - zoomedEnd.left, 80 * direction), `a drag follows the pointer under a page zoom (${zoomedStart.left} -> ${zoomedEnd.left})`);
  assert.deepEqual(errors, []);
});

test("the Agents header dropdown shares square responsive bounds and restores focus", {
  skip: process.env.RAGENTS_BROWSER_TESTS !== "1", timeout: 90_000,
}, async (context) => {
  await mkdir("/private/tmp/ragents-actor-graph", { recursive: true });
  const directory = await mkdtemp("/private/tmp/ragents-actor-graph/browser-");
  context.after(() => rm(directory, { recursive: true, force: true }));
  const url = await buildFixture(directory);
  const screenshots = join(tmpdir(), "ragents-browser-shots");
  await mkdir(screenshots, { recursive: true });
  for (const width of [1400, 420]) {
    const errors: string[] = [];
    const page = await openPage(url, errors, { width, height: 900 });
    try {
      await page.locator("[data-chat=composer]").waitFor();
      await page.evaluate(() => {
        window.actorGraphFixture.chat("demo", { kind: "status", running: false });
        window.actorGraphFixture.chat("demo", { kind: "replay-end", conversationId: null });
      });
      const trigger = page.getByRole("button", { name: "Agents", exact: true });
      const panel = page.getByRole("dialog", { name: "Agents", exact: true });
      await trigger.click();
      await panel.locator('button[data-actor-handle="coordinator"]').waitFor();
      await page.evaluate(async () => {
        await Promise.all(document.getAnimations().filter((animation) => animation.effect?.getComputedTiming().iterations !== Infinity)
          .map((animation) => animation.finished.catch(() => undefined)));
      });
      const header = await box(page.locator("header").filter({ has: trigger }));
      const bounds = await box(panel);
      assert.ok(near(bounds.y, header.y + header.height + 8), "Agents opens below the entire wrapping header.");
      assert.ok(near(bounds.x + bounds.width, header.x + header.width - 8), "Agents shares the header's right gutter.");
      assert.ok(near(bounds.width, header.width - 16), "Agents shares the header dropdown width.");
      assert.ok(bounds.y + bounds.height <= 893, "The graph stays inside the visible viewport.");
      const style = await panel.evaluate((element) => {
        const computed = getComputedStyle(element);
        return { corners: [computed.borderTopLeftRadius, computed.borderTopRightRadius, computed.borderBottomLeftRadius, computed.borderBottomRightRadius],
          padding: [computed.paddingTop, computed.paddingRight, computed.paddingBottom, computed.paddingLeft], focused: element.contains(document.activeElement) };
      });
      assert.deepEqual(style.corners, ["0px", "0px", "0px", "0px"]);
      assert.deepEqual(style.padding, ["8px", "8px", "8px", "8px"]);
      assert.equal(style.focused, true);
      assert.equal(await page.locator('[data-slot="popover-backdrop"]:visible').count(), 1);
      await page.screenshot({ path: join(screenshots, `header-agents-${width}.png`) });
      await page.keyboard.press("Escape");
      await panel.waitFor({ state: "detached" });
      assert.equal(await trigger.evaluate((element) => element === document.activeElement), true);
      await trigger.click();
      await panel.waitFor();
      await trigger.click();
      await panel.waitFor({ state: "detached" });
      await trigger.click();
      await panel.waitFor();
      await page.mouse.click(2, 898);
      await panel.waitFor({ state: "detached" });
      assert.equal(await trigger.evaluate((element) => element === document.activeElement), true);
      assert.deepEqual(errors, []);
    } finally { await page.close(); }
  }
});
