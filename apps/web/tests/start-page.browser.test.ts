import assert from "node:assert/strict";
import test from "node:test";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { join } from "node:path";
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
      tailwindPlugin([source, `${root}plugins/ragents.workspace/web`, `${root}plugins/ragents.overseer/web`]),
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
    const tiles = await dialog.getByRole("list", { name: "Templates" }).getByRole("button").evaluateAll((buttons) => buttons.map((button) => button.getAttribute("data-tile")));
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


for (const view of ["web", "start"] as const) {
  for (const width of [220, 380, 900, 1600, 2600, 6000]) {
    test(`panel content stays bounded at ${width}px (${view})`, browserOnly, async (context) => {
      await withPage(`view=${view}`, width, async (page) => {
        await openStartSelection(page);
        const shots = join(tmpdir(), "ragents-browser-shots");
        await mkdir(shots, { recursive: true });
        const measure = () => page.evaluate(() => {
          const main = document.querySelector("main")!;
          const grid = main.querySelector<HTMLElement>('ul[aria-label="Templates"]');
          const list = main.querySelector<HTMLElement>('ul[aria-label="Recent"], ul[aria-label="Runs"]')!;
          const servers = main.querySelector<HTMLElement>('ul[aria-label="Server"]');
          const search = main.querySelector<HTMLInputElement>('input[aria-label="Search runs"]');
          const rect = list.getBoundingClientRect();
          const sections = [...main.querySelectorAll(":scope > div > div > section")].map((section) => ({
            box: section.getBoundingClientRect(), heading: section.children[0]!.getBoundingClientRect(), content: section.children[1]!.getBoundingClientRect(),
          }));
          return {
            top: main.querySelector(":scope > div > div > :first-child")!.getBoundingClientRect().top - main.getBoundingClientRect().top,
            headingGap: sections.length > 1 ? sections[0]!.content.top - sections[0]!.heading.bottom : undefined,
            sectionGap: sections.length > 1 ? sections[1]!.box.top - sections[0]!.box.bottom : undefined,
            back: main.querySelector('button[aria-label="Back to Start"]') !== null,
            left: rect.left, width: rect.width, hostWidth: main.clientWidth, hostLeft: main.getBoundingClientRect().left,
            gridWidth: grid?.getBoundingClientRect().width,
            columns: grid ? getComputedStyle(grid).gridTemplateColumns.split(" ").length : undefined,
            serverWidth: servers?.getBoundingClientRect().width,
            searchWidth: search?.getBoundingClientRect().width,
            rows: [...list.children].map((row) => row.getBoundingClientRect().width),
            cards: grid ? [...grid.children].map((card) => ({ width: card.getBoundingClientRect().width, top: card.getBoundingClientRect().top })) : [],
            overflow: main.scrollWidth > main.clientWidth || document.documentElement.scrollWidth > innerWidth,
          };
        });
        const checkColumn = (metrics: Awaited<ReturnType<typeof measure>>) => {
          assert.ok(metrics.width > 0 && metrics.width <= 1280, JSON.stringify(metrics));
          assert.ok(Math.abs(metrics.left - metrics.hostLeft - (metrics.hostWidth - metrics.width) / 2) < 2, "content is centered in its host");
          assert.ok(metrics.rows.every((row) => row <= metrics.width + 1));
          assert.equal(metrics.overflow, false, JSON.stringify(metrics));
        };
        const start = await measure();
        await page.screenshot({ path: join(shots, `panel-${view}-start-${width}.png`) });
        checkColumn(start);
        assert.ok(start.serverWidth! <= 720);
        assert.ok(Math.abs(start.gridWidth! - start.width) < 1);
        assert.equal(start.columns, width < 900 ? 1 : width === 900 ? 3 : 5);
        assert.equal(start.cards.filter((card) => card.top === start.cards[0]!.top).length, start.columns, "cards occupy each column");
        assert.ok(start.cards.every((card) => card.width <= 320 && card.width >= Math.min(240, start.gridWidth!)));
        assert.equal(start.back, false, "Start has no back arrow");
        assert.ok(start.headingGap! >= 8 && start.sectionGap! >= 2 * start.headingGap!, `sections are set apart more than a heading from its content: ${JSON.stringify(start)}`);
        if (width === 2600) {
          await page.evaluate(() => { document.getElementById("root")!.style.width = "220px"; });
          const narrow = await measure();
          assert.equal(narrow.columns, 1, "container width controls the grid, even in a wide window");
          assert.equal(narrow.overflow, false);
          await page.evaluate(() => { document.getElementById("root")!.style.width = ""; });
        }
        await page.getByRole("button", { name: /All .* runs/ }).click();
        await page.getByRole("searchbox", { name: "Search runs" }).waitFor();
        const runs = await measure();
        await page.screenshot({ path: join(shots, `panel-${view}-runs-${width}.png`) });
        checkColumn(runs);
        assert.ok(Math.abs(runs.searchWidth! - runs.width) < 1, "search and rows use the same bounded column");
        assert.equal(runs.width, start.width);
        assert.ok(Math.abs(runs.top - start.top) < 1, `Runs begins at the height of Start: ${runs.top} and ${start.top}`);
        assert.equal(runs.back, true, "Runs leads back to Start next to its title, also below the browser's logo");
        await page.locator("main").getByRole("button", { name: "Back to Start", exact: true }).click();
        await page.getByRole("list", { name: "Recent", exact: true }).waitFor();
        context.diagnostic(`Screenshots: ${shots}`);
      });
    });
  }
}

for (const host of ["browser", "vscode"] as const) {
  test(`one shared header retains the coordinator and run actions (${host})`, browserOnly, async () => {
    await withPage(`view=${host === "browser" ? "web" : "panel"}&host=${host}&coordinator=1`, 1280, async (page) => {
      const header = page.locator("header").filter({ has: page.locator('[data-slot="overseer-toolbar"]') });
      const coordinator = header.getByRole("button", { name: "Global coordinator", exact: true });
      await coordinator.click();
      const history = page.getByRole("region", { name: "Global coordinator", exact: true });
      await history.waitFor();
      const draft = history.getByRole("textbox", { name: "Ask the global coordinator", exact: true });
      await page.waitForFunction(() => document.activeElement?.closest("#overseer-dropdown") !== null && document.activeElement instanceof HTMLTextAreaElement);
      const input = await draft.elementHandle();
      await page.keyboard.type("Unsent coordinator draft");
      await page.keyboard.press("Escape");
      await history.waitFor({ state: "hidden" });
      await page.waitForFunction(() => document.activeElement?.textContent === "Global coordinator", undefined, { timeout: 2000 });
      assert.equal(await header.count(), 1);
      const rect = await header.boundingBox();
      assert.ok(rect && rect.height < 50, "the global header occupies a single row");
      const shots = join(tmpdir(), "ragents-browser-shots");
      await mkdir(shots, { recursive: true });
      await page.screenshot({ path: join(shots, `header-${host}-start.png`) });
      const logo = header.getByRole("button", { name: "Back to Start", exact: true });
      assert.equal(await logo.count(), 1, "the logo is the way back to Start");
      assert.equal(await page.getByPlaceholder("Ask the global coordinator").count(), 1, "Start has no second coordinator chat");
      if (host === "browser") {
        await page.getByRole("list", { name: "Recent", exact: true }).getByRole("button").first().click();
      } else {
        await page.evaluate(() => window.startPageFixture.command({ type: "selectRun", runId: "existing" }));
      }
      await header.getByRole("button", { name: "Stop run", exact: true }).waitFor();
      assert.equal(await logo.count(), 1, "the run header has no separate back arrow");
      await coordinator.click();
      await history.waitFor();
      assert.equal(await draft.evaluate((element, original) => element === original, input), true);
      assert.equal(await draft.inputValue(), "Unsent coordinator draft");
      await page.keyboard.press("Escape");
      await history.waitFor({ state: "hidden" });
      if (host === "browser") {
        const reset = header.getByRole("button", { name: "Reset layout", exact: true });
        await reset.waitFor();
        assert.equal(await page.locator('[data-docking="workspace"]').getByRole("button", { name: "Reset layout", exact: true }).count(), 0, "Layout actions are mounted in the shared header.");
        await page.getByRole("button", { name: "Close Chat", exact: true }).click();
        await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
        const openChat = header.getByRole("group", { name: "Layout actions" }).getByRole("button", { name: "Chat", exact: true });
        await openChat.waitFor();
        assert.equal(await openChat.getAttribute("aria-pressed"), "false", "A closed view keeps its button.");
        const visibleAction = async (button: typeof openChat) => {
          const bounds = await button.boundingBox();
          const headerBounds = await header.boundingBox();
          assert.ok(bounds && headerBounds);
          assert.ok(bounds.x >= headerBounds.x && bounds.x + bounds.width <= headerBounds.x + headerBounds.width, JSON.stringify({ bounds, headerBounds }));
          assert.ok(bounds.y >= headerBounds.y && bounds.y + bounds.height <= headerBounds.y + headerBounds.height, "Layout controls fit the shared header height.");
          assert.equal(await button.evaluate((element) => {
            const rect = element.getBoundingClientRect();
            return [[rect.left + 2, rect.top + rect.height / 2], [rect.right - 2, rect.top + rect.height / 2], [rect.left + rect.width / 2, rect.top + 2], [rect.left + rect.width / 2, rect.bottom - 2]].every(([x, y]) => element.contains(document.elementFromPoint(x!, y!)));
          }), true, "The action container does not clip the buttons.");
        };
        await page.screenshot({ path: join(shots, "header-browser-direct-actions.png") });
        await visibleAction(openChat);
        await visibleAction(reset);
        await openChat.click();
        await page.getByRole("tab", { name: "Chat", exact: true }).waitFor();
        assert.equal(await openChat.getAttribute("aria-pressed"), "true", "A shown view stays listed as pressed.");
        await page.getByRole("button", { name: "Close Chat", exact: true }).click();
        await page.setViewportSize({ width: 520, height: 820 });
        await openChat.waitFor();
        await page.screenshot({ path: join(shots, "header-browser-narrow-actions.png") });
        await visibleAction(openChat);
        await visibleAction(reset);
        await openChat.click();
        await page.getByRole("tab", { name: "Chat", exact: true }).waitFor();
        assert.equal(await reset.isVisible(), true, "Reset remains visible in the narrow header.");
        await page.setViewportSize({ width: 1280, height: 820 });
      } else {
        assert.equal(await header.getByRole("button", { name: "Reset layout", exact: true }).count(), 0);
      }
      await coordinator.click();
      await history.waitFor();
      await page.screenshot({ path: join(shots, `header-${host}-run-coordinator.png`) });
      if (host === "browser") {
        await page.keyboard.press("Escape");
        await history.waitFor({ state: "hidden" });
        await logo.focus();
        await page.keyboard.press("Enter");
        await page.getByRole("list", { name: "Templates", exact: true }).waitFor();
        assert.equal(await header.getByRole("button", { name: "Stop run", exact: true }).count(), 0, "the logo leads back to Start");
      }
    });
  });
}
