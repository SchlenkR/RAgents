import assert from "node:assert/strict";
import test from "node:test";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { chromium, type Page } from "playwright-core";
import { tailwindPlugin } from "./tailwind-plugin";
import type {} from "./start-page-fixture";

/** Builds the fixture once: the web app, the run panel and the extension's Start with the same templates and a connected workstation. */
const buildFixture = async (): Promise<string> => {
  await mkdir("/private/tmp/ragents-start-page", { recursive: true });
  const directory = await mkdtemp("/private/tmp/ragents-start-page/browser-");
  const root = fileURLToPath(new URL("../../../", import.meta.url));
  const source = `${root}apps/web/src`;
  await build({
    entryPoints: [fileURLToPath(new URL("start-page-fixture.tsx", import.meta.url))],
    bundle: true, platform: "browser", format: "iife", jsx: "automatic", outfile: `${directory}/fixture.js`,
    define: { "process.env.NODE_ENV": '"production"' },
    plugins: [
      { name: "start-page-services", setup(builder) {
        builder.onLoad({ filter: /\/src\/PluginActivation\.ts$/ }, () => ({ contents: "export const usePluginActivation = () => window.startPageActivation;", loader: "js", resolveDir: source }));
        builder.onLoad({ filter: /\/src\/rpc\.ts$/ }, () => ({ contents: "export const rpc = { call: (...args) => window.startPageFixture.call(...args), subscribe: (...args) => window.startPageFixture.subscribe(...args) };", loader: "js" }));
      } },
      tailwindPlugin([source, `${root}plugins/ragents.workspace/web`]),
    ], logLevel: "silent",
  });
  await writeFile(`${directory}/index.html`, '<!doctype html><html><head><meta charset="utf-8"><link rel="stylesheet" href="fixture.css"><style>html,body{height:100%;margin:0}#root{height:100%}</style></head><body><div id="root"></div><script src="fixture.js"></script></body></html>');
  return `file://${directory}/index.html`;
};

let fixtureUrl: Promise<string> | undefined;
const browserOnly = { skip: process.env.RAGENTS_BROWSER_TESTS !== "1", timeout: 120_000 };

const withPage = async (query: string, width: number, run: (page: Page) => Promise<void>) => {
  const url = await (fixtureUrl ??= buildFixture());
  const browser = await chromium.launch({ headless: true, executablePath: process.env.BROWSER_EXECUTABLE_PATH ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" });
  try {
    const page = await browser.newPage({ viewport: { width, height: 820 }, reducedMotion: "reduce" });
    page.setDefaultTimeout(8000);
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(`${url}?${query}`);
    await run(page);
    assert.deepEqual(errors, []);
  } finally { await browser.close(); }
};

const openStartSelection = async (page: Page) => {
  const back = page.getByRole("button", { name: "Back to Start", exact: true });
  if (await back.isVisible()) await back.click();
  const templates = page.getByRole("list", { name: "Templates", exact: true });
  await templates.waitFor();
  return page;

};

/** Goes through the guide of the skill template and reads the offered machines in the preparation chat. */
const offeredMachines = async (page: Page) => {
  await page.getByRole("button", { name: "Use topic" }).click();
  await page.getByRole("combobox", { name: "Workspace machine" }).click();
  await page.getByRole("option", { name: "Server" }).waitFor();
  return page.getByRole("option").allTextContents();
};

const calls = (page: Page, id: string) => page.evaluate((method) => window.startPageFixture.calls.filter((call) => call.id === method).map((call) => call.params), id);

test("the browser offers only the server for new runs, the run panel in VS Code also the workstation", browserOnly, async () => {
  await withPage("view=web", 1280, async (page) => {
    const dialog = await openStartSelection(page);
    assert.equal(await dialog.locator("textarea").count(), 0, "the start selection has no task input");
    assert.equal(await dialog.getByRole("combobox").count(), 0, "and no start options");
    await dialog.getByRole("button", { name: /Clarify decision/ }).click();
    assert.deepEqual(await offeredMachines(page), ["Server"]);
  });
  await withPage("view=panel&host=browser", 520, async (page) => {
    await page.getByRole("button", { name: /Clarify decision/ }).click();
    assert.deepEqual(await offeredMachines(page), ["Server"], "the run panel in the browser also starts only on the server");
  });
  await withPage("view=panel&host=vscode", 520, async (page) => {
    await page.waitForTimeout(200);
    await page.evaluate(() => window.startPageFixture.command({ type: "newRun", entryId: "demo.decision" }));
    assert.deepEqual(await offeredMachines(page), ["Server", "Workstation Notebook"]);
  });
});

test("the start selection in the browser shows the tiles of Start in VS Code and starts like there", browserOnly, async () => {
  await withPage("view=web", 1280, async (page) => {
    let dialog = await openStartSelection(page);
    const tiles = await dialog.getByRole("list", { name: "Templates" }).getByRole("button").evaluateAll((buttons) => buttons.map((button) => button.getAttribute("title")));
    assert.deepEqual(tiles, ["New chat", "Collection board", "Clarify decision", "Discussion circle", "Word game"]);
    await dialog.getByRole("list", { name: "Templates", exact: true }).getByRole("button", { name: /New chat/ }).click();
    await page.getByRole("list", { name: "Templates", exact: true }).waitFor({ state: "detached" });
    await page.locator("textarea").waitFor();
    assert.deepEqual(await calls(page, "ragents.chat.send"), [], "New chat opens the empty run, its task takes shape in the chat");
    assert.deepEqual(await calls(page, "ragents.startOptions.select"), [], "nothing is preset, the run starts on the server");

    dialog = await openStartSelection(page);
    await dialog.getByRole("button", { name: /Discussion circle/ }).click();
    await page.getByRole("list", { name: "Templates", exact: true }).waitFor({ state: "detached" });
    const [script] = await calls(page, "ragents.chat.start");
    assert.deepEqual({ entry: script?.entry, input: script?.input }, { entry: "demo.circle", input: null });

    dialog = await openStartSelection(page);
    await dialog.getByRole("button", { name: /Collection board/ }).click();
    await page.getByRole("list", { name: "Templates", exact: true }).waitFor({ state: "detached" });
    const [skill] = await calls(page, "ragents.chat.send");
    assert.equal(skill?.entry, "demo.board");
    assert.match(String(skill?.text), /Use the skill board[\s\S]*Build a board for groceries\./, "a skill starts as in VS Code with its task");
  });
});

/** In the empty run after New chat: the chat input that shows model and thinking level when the right allows it. */
const openNewChat = async (page: Page, view: "web" | "panel") => {
  if (view === "web") {
    const dialog = await openStartSelection(page);
    await dialog.getByRole("list", { name: "Templates", exact: true }).getByRole("button", { name: /New chat/ }).click();
    await page.getByRole("list", { name: "Templates", exact: true }).waitFor({ state: "detached" });
  } else {
    await page.waitForTimeout(200);
    await page.evaluate(() => window.startPageFixture.command({ type: "newRun" }));
  }
  await page.locator("textarea").waitFor();
  await page.waitForFunction(() => window.startPageFixture.calls.some((call) => call.id === "ragents.startOptions.list"));
};

for (const [view, query, width] of [["web", "view=web", 1280], ["panel", "view=panel&host=vscode", 520]] as const) {
  test(`model and thinking level are in the chat of the empty run and apply from the first message (${view})`, browserOnly, async () => {
    await withPage(query, width, async (page) => {
      await openNewChat(page, view);
      const model = page.getByRole("combobox", { name: "Model" });
      await model.click();
      await page.getByRole("option").first().waitFor();
      assert.deepEqual(await page.getByRole("option").allTextContents(), ["openrouter/z-ai/glm-5.3-flash", "openrouter/qwen/qwen3.8-max"], "only the models of the profile");
      await page.getByRole("option", { name: "openrouter/qwen/qwen3.8-max" }).click();
      await page.getByRole("combobox", { name: "Reasoning" }).click();
      await page.getByRole("option", { name: "low" }).waitFor();
      assert.deepEqual(await page.getByRole("option").allTextContents(), ["off", "low", "high"], "only the levels of the model");
      await page.getByRole("option", { name: "low" }).click();
      await page.waitForFunction(() => window.startPageFixture.calls.filter((call) => call.id === "ragents.startOptions.select").length === 2);
      await page.locator("textarea").fill("First message");
      await page.locator("textarea").press("Enter");
      await page.waitForFunction(() => window.startPageFixture.calls.some((call) => call.id === "ragents.chat.send"));
      const order = await page.evaluate(() => window.startPageFixture.calls.filter((call) => call.id === "ragents.startOptions.select" || call.id === "ragents.chat.send")
        .map((call) => call.id === "ragents.chat.send" ? "send" : JSON.stringify(call.params.value)));
      assert.deepEqual(order, [JSON.stringify({ model: "qwen/qwen3.8-max" }), JSON.stringify({ model: "qwen/qwen3.8-max", thinking: "low" }), "send"], "the choice is fixed before the first message");
      await page.waitForFunction(() => window.startPageFixture.calls.filter((call) => call.id === "ragents.startOptions.list").length >= 2);
      await model.waitFor();
      assert.equal(await model.isEnabled(), true, "after the start the model choice stays in the chat");
    });
  });
}

test("without runs.inspect the chat shows no model choice, neither in the browser nor in VS Code", browserOnly, async () => {
  for (const [view, query, width] of [["web", "view=web&rights=plain", 1280], ["panel", "view=panel&host=vscode&rights=plain", 520]] as const) {
    await withPage(query, width, async (page) => {
      await openNewChat(page, view);
      assert.equal(await page.getByRole("combobox", { name: "Model" }).count(), 0, view);
      assert.equal(await page.getByRole("combobox", { name: "Reasoning" }).count(), 0, view);
    });
  }
});
