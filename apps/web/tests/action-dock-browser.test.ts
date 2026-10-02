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

const open = async (browser: Browser, url: string, viewport: { width: number; height: number }, chat?: { actor?: string }): Promise<{ page: Page; errors: string[] }> => {
  const page = await browser.newPage({ viewport, reducedMotion: "reduce" });
  page.setDefaultTimeout(8000);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  if (chat) {
    await page.addInitScript(({ actor }) => localStorage.setItem("ragents.orchestration.run-navigation:dock",
      JSON.stringify({ element: null, actor })), { actor: chat.actor ?? null });
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
  assert.deepEqual(geometry.options, ["3 days", "14 days", "30 days"]);
  assert.doesNotMatch(geometry.transcript ?? "", /Which review period applies/, "An open question is not repeated in the transcript.");
  assert.ok(geometry.scrollHeight <= geometry.clientHeight + 1, `The question is not cut off: ${layout}`);
  assert.ok(geometry.dock.bottom <= geometry.input.top, `The dock sits above the input: ${layout}`);
  assert.ok(geometry.dock.top >= geometry.frame.top - 0.5 && geometry.input.bottom <= geometry.frame.bottom + 0.5, `Dock and input stay inside their frame: ${layout}`);
};

test("an open question in an actor chat is answered in the dock at its input and afterwards stays as a receipt in the transcript", browserOnly, async (context) => {
  const url = await buildFixture();
  const browser = await launch(context);
  const { page, errors } = await open(browser, `${url}?scene=actor`, { width: 520, height: 640 });
  const panel = page.locator("[data-fixture=actor]");
  const dock = panel.locator("[data-chat=actions]");
  await dock.getByText("Which review period applies?").waitFor();
  await assertDocked(panel, panel);
  assert.equal(await panel.locator("textarea").isDisabled(), false);
  await dock.getByRole("button", { name: "14 days" }).click();
  assert.deepEqual(await page.evaluate("window.dockFixture.calls"), [["ragents.ask.answer", { runId: "dock", actionId: "review-window", answer: "14 days" }]]);
  await page.evaluate("window.dockFixture.resolve()");
  await settle(page);
  assert.equal(await dock.evaluate((element) => element.childElementCount), 0, "The dock is empty after the answer.");
  assert.match(await panel.locator("[data-quassel-transcript]").textContent() ?? "", /Which review period applies\?14 days/);
  assert.equal(await panel.locator("[data-quassel-transcript] [data-question=answered]").count(), 1);
  assert.deepEqual(errors, []);

  const reader = await open(browser, `${url}?scene=actor&access=read`, { width: 520, height: 640 });
  const readerPanel = reader.page.locator("[data-fixture=actor]");
  const readerDock = readerPanel.locator("[data-chat=actions]");
  await readerDock.getByText("Which review period applies?").waitFor();
  assert.deepEqual(await readerDock.locator("li").allTextContents(), ["3 days", "14 days", "30 days"]);
  assert.equal(await readerDock.locator("button, input").count(), 0, "Read access shows the question without controls.");
  assert.equal(await readerPanel.locator("textarea").isDisabled(), true);
  assert.deepEqual(reader.errors, []);
});

test("the run panel keeps questions at the selected addressee input and retains drafts across apps and actors", browserOnly, async (context) => {
  const url = await buildFixture();
  const browser = await launch(context);
  for (const width of [600, 1200]) {
    const { page, errors } = await open(browser, url, { width, height: 850 });
    const chat = page.locator("section[aria-label=Chat]");
    const active = () => chat.locator("[data-chat=panel]:visible");
    await active().locator("[data-chat=actions]").getByText("Which review period applies?").waitFor();
    await assertDocked(active(), chat);
    await active().locator("textarea").fill("Coordinator draft");
    await page.getByRole("tab", { name: "Stage", exact: true }).click();
    await page.getByRole("button", { name: "Operate mini-app" }).waitFor();
    assert.equal(await chat.isVisible(), width >= 1000, "A narrow workspace shows the app as a tab instead of chat, a wide one keeps chat beside it.");
    await page.getByRole("textbox", { name: "App draft" }).fill("App input");
    await page.getByRole("tab", { name: "Chat", exact: true }).click();
    assert.equal(await active().locator("textarea").inputValue(), "Coordinator draft");
    await page.locator('button[title^="Addressee: @coordinator"]:visible').click();
    await page.getByRole("dialog", { name: "Addressee" }).locator('button[data-actor-handle="reviewer"]').click();
    await active().getByRole("textbox", { name: "Message to @reviewer ...", exact: true }).fill("Reviewer draft");
    await assertDocked(active(), chat);
    await page.locator('button[title^="Addressee: @reviewer"]:visible').click();
    await page.getByRole("dialog", { name: "Addressee" }).locator('button[data-actor-handle="coordinator"]').click();
    assert.equal(await active().locator("textarea").inputValue(), "Coordinator draft");
    await page.locator('button[title^="Addressee: @coordinator"]:visible').click();
    await page.getByRole("dialog", { name: "Addressee" }).locator('button[data-actor-handle="reviewer"]').click();
    assert.equal(await active().locator("textarea").inputValue(), "Reviewer draft");
    await active().locator("textarea").press("Enter");
    assert.ok((await page.evaluate(() => window.dockFixture.calls)).some((entry) => entry[1].actorId === "worker" && entry[1].text === "Reviewer draft"));
    await active().locator("[data-chat=actions]").getByRole("button", { name: "14 days" }).click();
    assert.ok((await page.evaluate(() => window.dockFixture.calls)).some((entry) => entry[0] === "ragents.ask.answer" && entry[1].actionId === "review-window"));
    await page.getByRole("tab", { name: "Stage", exact: true }).click();
    assert.equal(await page.getByRole("textbox", { name: "App draft" }).inputValue(), "App input");
    await page.getByRole("tab", { name: "Chat", exact: true }).click();
    await page.evaluate(() => window.dockFixture.resolve());
    await settle(page);
    assert.equal(await active().locator("[data-quassel-transcript] [data-question=answered]").count(), 1);
    assert.deepEqual(errors, []);
  }
});
