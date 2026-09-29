import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { chromium, type Browser, type Locator, type Page } from "playwright-core";
import { tailwindPlugin } from "./tailwind-plugin";
import type {} from "./action-dock-fixture";

const browserOnly = { skip: process.env.RAGENTS_BROWSER_TESTS !== "1", timeout: 90_000 };

const buildFixture = async (): Promise<string> => {
  await mkdir("/private/tmp/ragents-action-dock", { recursive: true });
  const directory = await mkdtemp("/private/tmp/ragents-action-dock/browser-");
  const root = fileURLToPath(new URL("../../../", import.meta.url));
  await build({
    entryPoints: [fileURLToPath(new URL("action-dock-fixture.tsx", import.meta.url))],
    bundle: true, platform: "browser", format: "iife", jsx: "automatic", outfile: `${directory}/fixture.js`,
    define: { "process.env.NODE_ENV": '"production"' },
    plugins: [
      { name: "action-dock-rpc", setup(builder) {
        builder.onLoad({ filter: /\/src\/rpc\.ts$/ }, () => ({ contents: "export const rpc = { call: async (contract, input) => { window.dockFixture.calls.push([contract.id, input]); return null; }, subscribe: () => () => {} };" }));
      } },
      tailwindPlugin([`${root}apps/web/src`, `${root}plugins/ragents.orchestration/web`, `${root}plugins/ragents.ask/web`]),
    ], logLevel: "silent",
  });
  await writeFile(`${directory}/index.html`, '<!doctype html><html><head><link rel="stylesheet" href="fixture.css"><style>html,body{height:100%;margin:0}#root{height:calc(100% - 40px);display:flex}#outside{height:40px}</style></head><body><button id="outside">Outside</button><div id="root"></div><script src="fixture.js"></script></body></html>');
  return `file://${directory}/index.html`;
};

const launch = async (context: TestContext): Promise<Browser> => {
  const browser = await chromium.launch({ headless: true, executablePath: process.env.BROWSER_EXECUTABLE_PATH ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" });
  context.after(() => browser.close());
  return browser;
};

const open = async (browser: Browser, url: string, viewport: { width: number; height: number }, chat?: { mode: string; actor?: string }): Promise<{ page: Page; errors: string[] }> => {
  const page = await browser.newPage({ viewport, reducedMotion: "reduce" });
  page.setDefaultTimeout(8000);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  if (chat) {
    await page.addInitScript(({ mode, actor }) => localStorage.setItem("ragents.orchestration.run-panel:dock",
      JSON.stringify({ element: null, actor, chat: mode, chatWidth: 380, sheetExpandedHeight: null })), { mode: chat.mode, actor: chat.actor ?? null });
  }
  await page.goto(url);
  return { page, errors };
};

const settle = (page: Page) => page.evaluate("new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))");

/** The open question sits completely visible in the dock of the given chat, directly above its input and inside the given frame. */
const assertDocked = async (chat: Locator, frame: Locator) => {
  const geometry = await chat.evaluate((element, frameElement) => {
    const dock = element.querySelector("[data-chat=actions]")!;
    const input = element.querySelector("[data-chat=composer] textarea")!;
    return {
      dock: dock.getBoundingClientRect().toJSON(), input: input.getBoundingClientRect().toJSON(), frame: frameElement!.getBoundingClientRect().toJSON(),
      scrollHeight: dock.scrollHeight, clientHeight: dock.clientHeight,
      inComposer: element.querySelector("[data-chat=composer]")!.contains(dock),
      options: [...dock.querySelectorAll("[data-question=option]")].map((option) => option.textContent),
      transcript: element.querySelector("[data-quassel-transcript]")!.textContent,
    };
  }, await frame.elementHandle());
  const layout = JSON.stringify({ dock: geometry.dock, input: geometry.input, frame: geometry.frame, scrollHeight: geometry.scrollHeight, clientHeight: geometry.clientHeight });
  assert.ok(geometry.inComposer, "The dock belongs to the composer of this chat.");
  assert.deepEqual(geometry.options, ["3 Tage", "14 Tage", "30 Tage"]);
  assert.doesNotMatch(geometry.transcript ?? "", /Which review period applies/, "An open question is not repeated in the transcript.");
  assert.ok(geometry.scrollHeight <= geometry.clientHeight + 1, `The question is not cut off: ${layout}`);
  assert.ok(geometry.dock.bottom <= geometry.input.top, `The dock sits above the input: ${layout}`);
  assert.ok(geometry.dock.top >= geometry.frame.top - 0.5 && geometry.input.bottom <= geometry.frame.bottom + 0.5, `Dock and input stay inside their frame: ${layout}`);
};

test("an open question in an actor tile is answered in the dock at its input and afterwards stays as a receipt in the transcript", browserOnly, async (context) => {
  const url = await buildFixture();
  const browser = await launch(context);
  const { page, errors } = await open(browser, `${url}?scene=tile`, { width: 520, height: 640 });
  const tile = page.locator("[data-fixture=tile]");
  const dock = tile.locator("[data-chat=actions]");
  await dock.getByText("Which review period applies?").waitFor();
  await assertDocked(tile, tile);
  assert.equal(await tile.locator("textarea").isDisabled(), false);
  await dock.getByRole("button", { name: "14 days" }).click();
  assert.deepEqual(await page.evaluate("window.dockFixture.calls"), [["ragents.ask.answer", { runId: "dock", actionId: "review-window", answer: "14 Tage" }]]);
  await page.evaluate("window.dockFixture.resolve()");
  await settle(page);
  assert.equal(await dock.evaluate((element) => element.childElementCount), 0, "The dock is empty after the answer.");
  assert.match(await tile.locator("[data-quassel-transcript]").textContent() ?? "", /Which review period applies\?14 days/);
  assert.equal(await tile.locator("[data-quassel-transcript] [data-question=answered]").count(), 1);
  assert.deepEqual(errors, []);

  const reader = await open(browser, `${url}?scene=tile&access=read`, { width: 520, height: 640 });
  const readerTile = reader.page.locator("[data-fixture=tile]");
  const readerDock = readerTile.locator("[data-chat=actions]");
  await readerDock.getByText("Which review period applies?").waitFor();
  assert.deepEqual(await readerDock.locator("li").allTextContents(), ["3 Tage", "14 Tage", "30 Tage"]);
  assert.equal(await readerDock.locator("button, input").count(), 0, "Read access shows the question without controls.");
  assert.equal(await readerTile.locator("textarea").isDisabled(), true);
  assert.deepEqual(reader.errors, []);
});

test("the run panel shows an open question completely above the input in every chat layout", browserOnly, async (context) => {
  const url = await buildFixture();
  const browser = await launch(context);
  const sheetSelector = "section[aria-label=Chat]";

  const floating = await open(browser, url, { width: 600, height: 850 }, { mode: "bottom" });
  const sheet = floating.page.locator(sheetSelector);
  const collapse = async () => {
    await floating.page.locator("#outside").focus();
    await floating.page.mouse.move(1, 1);
    await floating.page.waitForFunction((selector) => !document.querySelector(selector)?.hasAttribute("data-expanded"), sheetSelector);
    await settle(floating.page);
  };
  await sheet.locator("[data-chat=actions]").getByText("Which review period applies?").waitFor();
  await collapse();
  await assertDocked(sheet, sheet);
  assert.equal(await sheet.locator(":scope > button:not([data-run-panel])").textContent(), "Waiting for input");
  const sheetBox = await sheet.boundingBox();
  assert.ok(sheetBox && Math.abs(sheetBox.y + sheetBox.height - 850) <= 1, "The collapsed sheet rests on the bottom edge.");
  const stagePadding = await floating.page.locator("section[aria-label='Mini-app Stage']").evaluate((element) => Number.parseFloat(getComputedStyle(element).paddingBottom));
  assert.ok(Math.abs(stagePadding - sheetBox.height) <= 2, "The stage reserves the collapsed sheet including the question.");
  await floating.page.screenshot({ path: `${fileURLToPath(new URL(".", url))}floating-collapsed.png` });

  await sheet.locator("textarea").hover();
  await floating.page.waitForFunction((selector) => document.querySelector(selector)?.hasAttribute("data-expanded"), sheetSelector);
  await settle(floating.page);
  await assertDocked(sheet, sheet);
  await collapse();

  await floating.page.evaluate("window.dockFixture.resolve()");
  await floating.page.waitForFunction(([selector, height]) => document.querySelector(selector)!.getBoundingClientRect().height < height - 100, [sheetSelector, sheetBox.height] as const);
  assert.equal(await sheet.locator("[data-chat=actions]").evaluate((element) => element.childElementCount), 0);
  assert.equal(await sheet.locator("[data-quassel-transcript] [data-question=answered]").count(), 1);
  assert.deepEqual(floating.errors, []);

  const actor = await open(browser, url, { width: 600, height: 850 }, { mode: "bottom", actor: "worker" });
  const actorSheet = actor.page.locator(sheetSelector);
  await actorSheet.locator("[data-chat=actions]").getByText("Which review period applies?").waitFor();
  await actor.page.locator("#outside").focus();
  await actor.page.mouse.move(1, 1);
  await actor.page.waitForFunction((selector) => !document.querySelector(selector)?.hasAttribute("data-expanded"), sheetSelector);
  await settle(actor.page);
  assert.equal(await actorSheet.getAttribute("data-view"), "actor-chat");
  await assertDocked(actorSheet, actorSheet);
  assert.deepEqual(actor.errors, []);

  for (const [mode, width] of [["side", 1200], ["chat", 700]] as const) {
    const { page, errors } = await open(browser, url, { width, height: 850 }, { mode });
    const chat = page.locator(sheetSelector);
    await chat.locator("[data-chat=actions]").getByText("Which review period applies?").waitFor();
    assert.equal(await page.locator("[data-chat-layout]").getAttribute("data-chat-layout"), mode === "side" ? "side" : "full");
    await assertDocked(chat, chat);
    assert.deepEqual(errors, []);
  }
});
