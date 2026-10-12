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
  const browser = await chromium.launch({ headless: true, executablePath: process.env.BROWSER_EXECUTABLE_PATH ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" });
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

const settlePopouts = (page: Page) => page.evaluate(async () => {
  await Promise.all(document.getAnimations().filter((animation) => animation.effect?.getComputedTiming().iterations !== Infinity)
    .map((animation) => animation.finished.catch(() => undefined)));
  await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
});

const replayChat = (page: Page) => page.evaluate(() => {
  window.actorGraphFixture.chat("demo", { kind: "status", running: false });
  window.actorGraphFixture.chat("demo", { kind: "user", text: "The coordinator's conversation.", at: new Date().toISOString() });
  window.actorGraphFixture.chat("demo", { kind: "replay-end", conversationId: null });
});

const savedDockLayout = (page: Page) => page.evaluate(() => Object.entries(localStorage).find(([key]) => key.startsWith("ragents.docking:"))?.[1]);

const assertCardRowsFit = async (dialog: Locator, label: string) => {
  const cards = await dialog.locator("button[data-actor-handle], button[data-addressee-group]").evaluateAll((buttons) => buttons.map((button) => {
    const bounds = button.getBoundingClientRect();
    const style = getComputedStyle(button);
    const root = document.documentElement;
    const description = button.querySelector<HTMLElement>("[data-actor-description]");
    return {
      handle: button.getAttribute("data-actor-handle") ?? button.getAttribute("data-addressee-group"),
      group: button.hasAttribute("data-addressee-group"),
      width: bounds.width,
      height: bounds.height,
      fontSize: parseFloat(getComputedStyle(root).fontSize),
      zoom: parseFloat(getComputedStyle(root).zoom),
      padding: [style.paddingTop, style.paddingRight, style.paddingBottom, style.paddingLeft].map(parseFloat),
      description: description && {
        text: description.textContent,
        title: description.title,
        clamp: getComputedStyle(description).webkitLineClamp,
        height: description.getBoundingClientRect().height,
        lineHeight: parseFloat(getComputedStyle(description).lineHeight),
        clipped: description.scrollHeight > description.clientHeight,
      },
      top: bounds.top,
      bottom: bounds.bottom,
      rows: [...button.children].filter((child) => child.tagName === "SPAN").map((row) => {
        const bounds = row.getBoundingClientRect();
        const textBounds: { top: number; bottom: number }[] = [];
        const walker = document.createTreeWalker(row, NodeFilter.SHOW_TEXT);
        while (walker.nextNode()) {
          if (!walker.currentNode.textContent?.trim()) continue;
          if (walker.currentNode.parentElement?.closest('[aria-hidden="true"]')) continue;
          const range = document.createRange();
          range.selectNodeContents(walker.currentNode);
          for (const rect of range.getClientRects()) {
            if (rect.top < bounds.bottom - 1 && rect.bottom > bounds.top + 1) textBounds.push({ top: rect.top, bottom: rect.bottom });
          }
        }
        return { top: bounds.top, bottom: bounds.bottom, textBounds };
      }),
    };
  }));
  assert.ok(cards.length > 0, `${label} contains graph cards.`);
  for (const card of cards) {
    assert.equal(card.rows.length, card.group ? 3 : card.description ? 2 : 1, `${label} @${card.handle} shows only its state ring, handle, and available description.`);
    assert.ok(near(card.width, 216 * card.zoom), `${label} @${card.handle} keeps its card width.`);
    assert.ok(near(card.height, 88 / 16 * card.fontSize * card.zoom), `${label} @${card.handle} keeps its root-scaled card height.`);
    if (!card.group) {
      assert.ok(card.padding.every((padding) => Math.abs(padding - 2 * 0.235 * card.fontSize) < 0.01), `${label} @${card.handle} uses related padding on every side.`);
      if (card.description) {
        assert.equal(card.description.title, card.description.text, `${label} @${card.handle} exposes its full description as a tooltip.`);
        assert.equal(card.description.clamp, "3");
        const lines = card.description.height / (card.description.lineHeight * card.zoom);
        assert.ok(Math.abs(lines - Math.round(lines)) < 0.05 && lines >= 0.95 && lines <= 3.05, `${label} @${card.handle} fits whole description lines (${lines}).`);
        if (card.handle === "summary" || card.handle === "implementer") {
          assert.ok(card.description.clipped, `${label} @${card.handle} exercises the line clamp with a full task.`);
          assert.ok(Math.abs(lines - 3) < 0.05, `${label} @${card.handle} uses all three available description lines.`);
          assert.ok(card.description.text!.length > 90, `${label} @${card.handle} retains text beyond the former summary limit.`);
        }
      }
    }
    for (const [index, row] of card.rows.entries()) {
      assert.ok(row.top >= card.top - 1 && row.bottom <= card.bottom + 1,
        `${label} @${card.handle} row ${index + 1} stays inside its card (${row.top}..${row.bottom}, card ${card.top}..${card.bottom}).`);
      for (const text of row.textBounds) assert.ok(text.top >= card.top - 1 && text.bottom <= card.bottom + 1,
        `${label} @${card.handle} row ${index + 1} contains the full text height (${text.top}..${text.bottom}, card ${card.top}..${card.bottom}).`);
    }
  }
};

test("the addressee pop-out and the agents tool show who created whom as a graph and pick the addressee", {
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

  await card("implementer").getByText(/^Rebuild the chat's addressee list into a graph\./).waitFor();
  await dialog.getByText("formats changed files after every step", { exact: true }).waitFor();
  assert.equal(await card("implementer").getByRole("img", { name: "running", exact: true }).getAttribute("title"), "running");
  assert.equal(await card("test-writer").getByRole("img", { name: "idle", exact: true }).getAttribute("title"), "idle");
  assert.equal(await dialog.locator("[data-actor-duration], [data-addressee-status]").count(), 0, "actor cards have no state or timing row");
  assert.equal(await card("test-writer").getByText("1", { exact: true }).count(), 0, "actor cards contain only a ring, handle, and description");
  assert.equal(await card("implementer").locator("[data-actor-description]").getAttribute("title"),
    "Rebuild the chat's addressee list into a graph.\nDetails are in the task.\nKeep the creator relationships and all graph interactions intact.\nVerify the result in both hosts.");

  assert.equal(await group.getAttribute("aria-expanded"), "false");
  await group.getByText("37 actors", { exact: true }).waitFor();
  await group.getByText("4 working, 1 waiting for input, 28 waiting, 4 stopped", { exact: true }).waitFor();
  assert.equal(await members.count(), 0, "the group starts closed");
  await shoot("actor-graph-picker");
  await settle();
  const compact = await box(dialog);
  const titleBar = await box(dialog.locator("header"));
  const fits = await canvasOf(dialog);
  assert.ok(compact.width < 1000 && compact.height - titleBar.height < 430, `a small graph fits into half the viewport height below its title bar (${compact.width} x ${compact.height})`);
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
  assert.equal(await card("review-visibility").getByRole("img", { name: "stopped", exact: true }).getAttribute("title"), "stopped");
  assert.equal(await card("review-visibility").locator("[data-actor-state]").getAttribute("data-actor-state"), "cancelled");
  assert.equal(await card("review-dates").getByRole("img", { name: "waiting for input", exact: true }).getAttribute("title"), "waiting for input");
  assert.equal(await card("review-errors").getByRole("img", { name: "failed", exact: true }).getAttribute("title"), "failed");
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
  const agents = page.locator("#run-panel-workspace");
  const agentsGroup = agents.locator("button[data-addressee-group=\"@review-*\"]");
  await agents.locator("button[data-actor-handle=\"review-strings\"]").waitFor();
  assert.equal(await agents.locator("button[data-actor-handle=\"review-strings\"]").getAttribute("aria-current"), "true");
  assert.equal(await agents.locator("button[data-actor-handle^=\"review-\"]").count(), 37, "the group holding the addressee is open");
  assert.equal(await agents.locator("g[data-tone]").count(), 6, "one line leads into the open group's frame, none to each member");
  await settle();
  const agentsBox = await box(agents);
  assert.ok(agentsBox.y + agentsBox.height <= 860 && agentsBox.width > 400, "the agents tool fills the existing inspection popout");
  await shoot("actor-graph-agents");
  await agentsGroup.click();
  assert.equal(await agentsGroup.getAttribute("aria-expanded"), "false");
  const closedAt = await box(agentsGroup);
  await agentsGroup.click();
  assert.equal(await agentsGroup.getAttribute("aria-expanded"), "true");
  const openAt = await box(agentsGroup);
  const expandedCanvas = await canvasOf(agents);
  assert.ok((near(openAt.x, closedAt.x) || expandedCanvas.left === 0 || expandedCanvas.left === expandedCanvas.maxLeft)
    && (near(openAt.y, closedAt.y) || expandedCanvas.top === 0 || expandedCanvas.top === expandedCanvas.maxTop), "the clicked group stays in place as far as the fixed panel's pan limits allow");
  await agents.locator("button[data-actor-handle=\"test-writer\"]").click();
  await page.locator("button[title^=\"Addressee: @test-writer\"]:visible").waitFor();
  assert.equal(await agents.isVisible(), true, "picking keeps the agents tool open");
  await agents.getByRole("button", { name: "Close sidebar", exact: true }).click();
  await agents.waitFor({ state: "hidden" });

  await shoot("actor-graph-back");
  await page.getByRole("button", { name: "Back to @coordinator" }).click();
  await page.locator("button[title^=\"Addressee: @coordinator\"]:visible").waitFor();
  assert.equal(await page.getByRole("button", { name: /^Back to @/ }).count(), 0, "back at the primary actor the x disappears");
  assert.equal(await dialog.count(), 0, "the x does not open the pop-out");

  await page.evaluate(() => { document.documentElement.style.zoom = "1.25"; });
  await page.getByRole("button", { name: "Agents", exact: true }).click();
  if (await agentsGroup.getAttribute("aria-expanded") !== "true") await agentsGroup.click();
  await agents.locator("button[data-actor-handle^=\"review-\"]").first().waitFor();
  await settle();
  const zoomedBox = await box(agents);
  assert.ok(zoomedBox.x >= 7 && zoomedBox.y + zoomedBox.height <= 860, `with a page zoom the agents view stays inside the window (${zoomedBox.x}, ${zoomedBox.y}, ${zoomedBox.width} x ${zoomedBox.height})`);
  const zoomedStart = await canvasOf(agents);
  const direction = zoomedStart.left >= 80 ? 1 : -1;
  await drag(page, center(await box(agentsGroup)), 100 * direction, 0);
  const zoomedEnd = await canvasOf(agents);
  assert.ok(near(zoomedStart.left - zoomedEnd.left, 80 * direction), `a drag follows the pointer under a page zoom (${zoomedStart.left} -> ${zoomedEnd.left})`);
  assert.deepEqual(errors, []);
});

test("the VS Code stub opens Agents in the shared inspection popout at wide and narrow sizes", {
  skip: process.env.RAGENTS_BROWSER_TESTS !== "1", timeout: 90_000,
}, async (context) => {
  const directory = await mkdtemp(join(tmpdir(), "ragents-agents-vscode-"));
  context.after(() => rm(directory, { recursive: true, force: true }));
  const url = await buildFixture(directory);
  for (const width of [1400, 420]) {
    const errors: string[] = [];
    const page = await openPage(url, errors, { width, height: 900 });
    try {
      await page.locator("[data-chat=composer]").waitFor();
      await replayChat(page);
      const trigger = page.getByRole("navigation", { name: "Sidebar tabs" }).getByRole("button", { name: "Agents", exact: true });
      const panel = page.locator("#run-panel-workspace");
      assert.equal(await panel.isHidden(), true);
      await trigger.click();
      await panel.getByRole("heading", { name: "Agents", exact: true }).waitFor();
      await panel.locator('button[data-actor-handle="coordinator"]').waitFor();
      const graph = await panel.locator('ul[aria-label="Actors by creator"]').elementHandle();
      assert.equal(await page.locator('[data-docking="workspace"]').count(), 0);
      assert.equal(await page.locator('[data-slot="popover-backdrop"]:visible').count(), 0);
      const bounds = await box(panel);
      assert.ok(bounds.x >= 0 && bounds.y >= 0 && bounds.x + bounds.width <= width && bounds.y + bounds.height <= 900);
      assert.equal(await panel.evaluate((element) => element.contains(document.activeElement)), true);
      await panel.locator('button[data-actor-handle="implementer"]').click();
      assert.equal(await panel.isVisible(), true);
      await panel.getByRole("button", { name: "Close sidebar", exact: true }).click();
      await page.getByRole("textbox", { name: "Message to @implementer ...", exact: true }).waitFor();
      await trigger.click();
      await panel.locator('button[data-actor-handle="implementer"][aria-current="true"]').waitFor();
      assert.equal(await panel.locator('ul[aria-label="Actors by creator"]').evaluate((element, original) => element === original, graph), true);
      await page.keyboard.press("Escape");
      await panel.waitFor({ state: "hidden" });
      assert.deepEqual(errors, []);
      assert.deepEqual(await page.evaluate(() => window.actorGraphFixture.unexpected), []);
    } finally { await page.close(); }
  }
});

test("graph cards fit their text and the working subagent count keeps tight spacing at larger root fonts and page zoom in both hosts", {
  skip: process.env.RAGENTS_BROWSER_TESTS !== "1", timeout: 120_000,
}, async (context) => {
  const directory = await mkdtemp(join(tmpdir(), "ragents-actor-graph-"));
  context.after(() => rm(directory, { recursive: true, force: true }));
  const url = await buildFixture(directory);
  const screenshots = join(tmpdir(), "ragents-browser-shots");
  await mkdir(screenshots, { recursive: true });
  for (const host of ["vscode", "browser"]) {
    const errors: string[] = [];
    const page = await openPage(`${url}?host=${host}`, errors, { width: 1280, height: 900 });
    try {
      await page.locator("[data-chat=composer]").waitFor();
      await replayChat(page);
      for (const { fontSize, zoom } of [{ fontSize: 16, zoom: 1 }, { fontSize: 20, zoom: 1 }, { fontSize: 16, zoom: 1.25 }, { fontSize: 20, zoom: 1.25 }]) {
        await page.evaluate(({ fontSize, zoom }) => {
          document.documentElement.style.fontSize = `${fontSize}px`;
          document.documentElement.style.zoom = String(zoom);
        }, { fontSize, zoom });
        const label = `${host}, ${fontSize}px, ${zoom * 100}%`;
        const working = page.getByRole("button", { name: "5 subagents working. Click to show agents", exact: true });
        assert.equal(await working.textContent(), "5", `${label}, the count excludes the primary actor.`);
        const spacing = await working.evaluate((element) => {
          const probe = document.createElement("span");
          probe.style.columnGap = "var(--spacing)";
          element.append(probe);
          const tight = parseFloat(getComputedStyle(probe).columnGap);
          probe.remove();
          const style = getComputedStyle(element);
          return { gap: parseFloat(style.columnGap), padding: parseFloat(style.paddingLeft), tight };
        });
        assert.ok(Math.abs(spacing.gap - spacing.tight) < 0.01, `${label}, the spinner and count use the tight step.`);
        assert.ok(spacing.padding >= spacing.gap, `${label}, outer spacing is at least the inner gap.`);
        await page.getByRole("button", { name: "Agents", exact: true }).click();
        const header = host === "browser" ? page.locator('[data-dock-panel="tab:ragents.orchestration.agents"]') : page.locator("#run-panel-workspace");
        await header.locator('button[data-actor-handle="coordinator"]').waitFor();
        await settlePopouts(page);
        await assertCardRowsFit(header, `${label}, Agents`);
        const group = header.locator('button[data-addressee-group="@review-*"]');
        if (await group.getAttribute("aria-expanded") !== "true") await group.click();
        await header.locator('button[data-actor-handle="review-visibility"]').waitFor();
        await settlePopouts(page);
        await assertCardRowsFit(header, `${label}, expanded Agents`);
        await page.getByRole("button", { name: host === "browser" ? "Close Agents" : "Close sidebar", exact: true }).click();
        await header.waitFor({ state: "hidden" });
        await page.locator('button[title^="Addressee: @coordinator"]:visible').click();
        const picker = page.getByRole("dialog", { name: "Addressee", exact: true });
        await picker.locator('button[data-actor-handle="implementer"]').waitFor();
        await settlePopouts(page);
        await assertCardRowsFit(picker, `${label}, Addressee`);
        await page.screenshot({ path: join(screenshots, `actor-card-rows-${host}-${fontSize}-${zoom}.png`) });
        await page.keyboard.press("Escape");
        await picker.waitFor({ state: "detached" });
      }
      assert.deepEqual(errors, []);
      assert.deepEqual(await page.evaluate(() => window.actorGraphFixture.unexpected), []);
    } finally { await page.close(); }
  }
});

test("actors dragged from either graph or the addressee chip open bound chats and preserve drafts, layout, and recipient selection", {
  skip: process.env.RAGENTS_BROWSER_TESTS !== "1", timeout: 180_000,
}, async (context) => {
  const directory = await mkdtemp(join(tmpdir(), "ragents-actor-docking-"));
  context.after(() => rm(directory, { recursive: true, force: true }));
  const url = await buildFixture(directory);
  const screenshots = join(tmpdir(), "ragents-browser-shots");
  await mkdir(screenshots, { recursive: true });
  const errors: string[] = [];
  const page = await openPage(`${url}?host=browser`, errors, { width: 1280, height: 900 });
  context.after(() => page.close());
  const primary = page.locator('[data-dock-panel="chat"]');
  const panel = (id: string) => page.locator(`[data-dock-panel="view:actor:${id}"]`);
  const tab = (id: string) => page.getByRole("tab", { name: `@${id}`, exact: true });
  const groups = page.locator("[data-dock-group]");
  const chip = () => primary.locator('button[title^="Addressee: @coordinator"]:visible');
  const headerGraph = async () => {
    await page.getByRole("button", { name: "Agents", exact: true }).click();
    const graph = page.locator('[data-dock-panel="tab:ragents.orchestration.agents"]');
    await graph.locator('button[data-actor-handle="coordinator"]').waitFor();
    await settlePopouts(page);
    return graph;
  };
  const startDrag = async (source: Locator, target: Locator) => {
    await source.scrollIntoViewIfNeeded();
    const from = center(await box(source));
    const to = center(await box(target));
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await page.mouse.move(to.x, to.y, { steps: 8 });
    await page.locator('[data-dock-guide="group-center"]').waitFor();
  };
  const dropGuide = async (guide: string) => {
    const target = center(await box(page.locator(`[data-dock-guide="${guide}"]`)));
    await page.mouse.move(target.x, target.y);
    await page.locator("[data-dock-preview]").waitFor();
    await page.mouse.up();
    await page.getByLabel("Docking guides", { exact: true }).waitFor({ state: "hidden" });
  };
  const assertActorChat = async (id: string) => {
    await panel(id).waitFor({ state: "visible" });
    await panel(id).getByRole("textbox", { name: `Message to @${id} ...`, exact: true }).waitFor();
    await panel(id).getByText(`Please check the status, @${id}.`, { exact: true }).waitFor();
    assert.equal(await panel(id).getByText("The coordinator's conversation.", { exact: true }).count(), 0);
  };
  await primary.locator("[data-chat=composer]").waitFor();
  await replayChat(page);
  await primary.getByText("The coordinator's conversation.", { exact: true }).waitFor();
  await chip().waitFor();
  assert.equal(await groups.count(), 2);
  assert.equal(await page.getByRole("tab").count(), 2, "Only Chat and Agents appear before actor chats are opened.");

  let graph = await headerGraph();
  await graph.locator('button[data-actor-handle="test-writer"]').scrollIntoViewIfNeeded();
  const click = center(await box(graph.locator('button[data-actor-handle="test-writer"]')));
  await page.mouse.move(click.x, click.y);
  await page.mouse.down();
  await page.mouse.move(click.x + 3, click.y + 2);
  await page.mouse.up();
  await primary.getByRole("textbox", { name: "Message to @test-writer ...", exact: true }).waitFor();
  assert.equal(await tab("test-writer").count(), 0, "A short press still chooses the main chat's addressee.");
  await primary.getByRole("button", { name: "Back to @coordinator", exact: true }).click();
  await chip().waitFor();

  graph = await headerGraph();
  const beforeCancel = await savedDockLayout(page);
  await startDrag(graph.locator('button[data-actor-handle="implementer"]'), primary);
  await page.keyboard.press("Escape");
  await page.mouse.up();
  assert.equal(await savedDockLayout(page), beforeCancel, "Escape neither registers nor opens the dragged actor.");
  assert.equal(await tab("implementer").count(), 0);
  await chip().waitFor();

  graph = await headerGraph();
  const beforeOutside = await savedDockLayout(page);
  await startDrag(graph.locator('button[data-actor-handle="implementer"]'), primary);
  await page.mouse.move(2, 2, { steps: 4 });
  await page.mouse.up();
  assert.equal(await savedDockLayout(page), beforeOutside, "Dropping outside the workspace leaves its layout unchanged.");
  assert.equal(await tab("implementer").count(), 0);
  await chip().waitFor();

  await primary.getByRole("textbox").fill("Primary draft");
  const primaryDraft = await primary.getByRole("textbox").elementHandle();
  graph = await headerGraph();
  await startDrag(graph.locator('button[data-actor-handle="implementer"]'), primary);
  await dropGuide("group-right");
  await assertActorChat("implementer");
  assert.equal(await groups.count(), 3, "The agents window can create a new chat beside the main chat.");
  await chip().waitFor();
  assert.equal(await primary.getByRole("textbox").inputValue(), "Primary draft");
  const actorComposer = panel("implementer").getByRole("textbox", { name: "Message to @implementer ...", exact: true });
  await actorComposer.fill("A direct message for the implementer");
  await panel("implementer").getByRole("button", { name: "Send", exact: true }).click();
  await page.waitForFunction(() => window.actorGraphFixture.sent.length === 1);
  assert.deepEqual(await page.evaluate(() => window.actorGraphFixture.sent), [
    { runId: "demo", actorId: "implementer", text: "A direct message for the implementer" },
  ]);
  await actorComposer.fill("Actor draft");
  const actorDraft = await actorComposer.elementHandle();

  await chip().click();
  const picker = page.getByRole("dialog", { name: "Addressee", exact: true });
  await picker.locator('button[data-actor-handle="summary"]').click();
  await primary.getByRole("textbox", { name: "Message to @summary ...", exact: true }).waitFor();
  assert.equal(await actorComposer.inputValue(), "Actor draft", "Changing the main recipient leaves a bound actor chat on its own actor.");
  await primary.getByRole("button", { name: "Back to @coordinator", exact: true }).click();
  await chip().waitFor();
  assert.equal(await primary.getByRole("textbox").inputValue(), "Primary draft");

  await startDrag(tab("implementer"), primary);
  await dropGuide("group-center");
  assert.equal(await groups.count(), 2);
  assert.equal(await actorComposer.inputValue(), "Actor draft");
  assert.equal(await actorComposer.evaluate((element, original) => element === original, actorDraft), true, "Moving a chat keeps its composer mounted.");
  await page.getByRole("button", { name: "Close @implementer", exact: true }).click();
  await panel("implementer").waitFor({ state: "hidden" });
  graph = await headerGraph();
  await startDrag(graph.locator('button[data-actor-handle="implementer"]'), primary);
  await dropGuide("group-right");
  await assertActorChat("implementer");
  assert.equal(await actorComposer.inputValue(), "Actor draft");
  assert.equal(await actorComposer.evaluate((element, original) => element === original, actorDraft), true, "Closing and dragging the actor back retains the same draft and composer.");
  assert.equal(await primary.getByRole("textbox").evaluate((element, original) => element === original, primaryDraft), true);

  await chip().click();
  await picker.locator('button[data-actor-handle="test-writer"]').waitFor();
  await startDrag(picker.locator('button[data-actor-handle="test-writer"]'), panel("implementer"));
  await dropGuide("group-center");
  await assertActorChat("test-writer");
  assert.equal(await groups.count(), 3, "The addressee graph can add a bound chat as a tab in an existing area.");
  const actorGroup = groups.filter({ has: tab("test-writer") });
  assert.equal(await actorGroup.getByRole("tab", { name: "@implementer", exact: true }).count(), 1);
  await chip().waitFor();
  await page.getByRole("group", { name: "Layout actions", exact: true }).getByRole("button", { name: "Empty space", exact: true }).click();
  const empty = page.locator('[data-dock-panel^="empty:"]:visible');
  await empty.waitFor();
  const beforeReplace = await groups.count();
  await startDrag(chip(), empty);
  await dropGuide("group-center");
  await panel("coordinator").waitFor({ state: "visible" });
  await panel("coordinator").getByText("The coordinator's conversation.", { exact: true }).waitFor();
  assert.equal(await groups.count(), beforeReplace, "Dropping the addressee chip replaces the empty pane.");
  assert.equal(await page.locator('[data-dock-panel^="empty:"]').count(), 0);
  assert.equal(await page.getByRole("tab", { name: "Empty space", exact: true }).count(), 0);
  await chip().waitFor();
  await panel("coordinator").getByRole("textbox", { name: "Message to @coordinator ...", exact: true }).fill("A direct message for the coordinator");
  await panel("coordinator").getByRole("button", { name: "Send", exact: true }).click();
  await page.waitForFunction(() => window.actorGraphFixture.sent.length === 2);
  assert.deepEqual(await page.evaluate(() => window.actorGraphFixture.sent[1]),
    { runId: "demo", actorId: "coordinator", text: "A direct message for the coordinator" });
  await page.screenshot({ path: join(screenshots, "actor-docking-bound-chats.png") });

  const layout = JSON.parse((await savedDockLayout(page))!);
  assert.ok(layout.known.includes("view:actor:coordinator") && layout.known.includes("view:actor:implementer") && layout.known.includes("view:actor:test-writer"));
  await page.reload();
  await primary.locator("[data-chat=composer]").waitFor();
  await replayChat(page);
  await panel("coordinator").getByText("The coordinator's conversation.", { exact: true }).waitFor();
  await assertActorChat("test-writer");
  assert.equal(await groups.count(), beforeReplace);
  assert.equal(await tab("implementer").count(), 1);
  const restored = JSON.parse((await savedDockLayout(page))!);
  assert.deepEqual(restored.root, layout.root, "Reload restores the actor tabs, their active chats, and split geometry.");
  assert.deepEqual(restored.known, layout.known);
  assert.deepEqual(restored.closed, layout.closed);
  await chip().waitFor();
  await page.screenshot({ path: join(screenshots, "actor-docking-restored.png") });
  assert.deepEqual(errors, []);
  assert.deepEqual(await page.evaluate(() => window.actorGraphFixture.unexpected), []);
});
