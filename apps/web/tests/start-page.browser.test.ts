import assert from "node:assert/strict";
import test from "node:test";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { build } from "esbuild";
import { chromium, type Locator, type Page } from "playwright-core";
import { tailwindPlugin } from "./tailwind-plugin";
import { WORKSPACE_BINDING_OPTION_ID } from "../../../plugins/ragents.workspace/contract";
import type {} from "./start-page-fixture";

/** Builds the browser and VS Code panel with the same server templates and a connected workstation. */
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
    try {
      await run(page);
      assert.deepEqual(errors, []);
    } catch (cause) {
      const shots = join(tmpdir(), "ragents-browser-shots");
      await mkdir(shots, { recursive: true });
      const failureName = `start-page-failed-${query.replace(/[^a-zA-Z0-9]/g, "-")}-${width}`;
      await page.screenshot({ path: join(shots, `${failureName}.png`) });
      await writeFile(join(shots, `${failureName}.html`), await page.content());
      throw cause;
    }
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
  const machines = page.getByRole("group", { name: "Workspace machine", exact: true });
  await machines.waitFor();
  return machines.getByRole("button").allTextContents();
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

test("Start marks the clicked template as starting until its next state", browserOnly, async () => {
  await withPage("view=start", 1280, async (page) => {
    const templates = page.getByRole("list", { name: "Templates", exact: true });
    const tile = (title: string) => templates.locator(`button[data-tile="${title}"]`);
    const busy = () => page.locator('[aria-busy="true"]').evaluateAll((elements) => elements.map((element) => element.getAttribute("data-tile") ?? element.getAttribute("aria-label")));
    await tile("Discussion circle").click();
    assert.deepEqual(await calls(page, "panel.newRun"), [{ action: "newRun", name: "local", entryId: "demo.circle" }]);
    assert.deepEqual(await busy(), ["Discussion circle"]);
    assert.equal(await tile("Discussion circle").locator('[data-slot="start-action"]').textContent(), "Starting ...");
    assert.equal(await tile("Discussion circle").locator('[data-slot="start-action"] [data-slot="spinner"]').count(), 1);
    assert.equal(await tile("Discussion circle").getAttribute("aria-label"), "Start Discussion circle");
    assert.equal(await templates.getByRole("button", { disabled: false }).count(), 0, "no second start while one is under way");
    await tile("Word game").click({ force: true });
    assert.equal((await calls(page, "panel.newRun")).length, 1, "a locked tile sends nothing");

    await page.evaluate(() => window.startPageFixture.renewPanel());
    await page.waitForFunction(() => document.querySelector('[aria-busy="true"]') === null);
    assert.doesNotMatch(await tile("Discussion circle").textContent() ?? "", /Starting/, "the next state ends the marker, also when no run opened");
    assert.equal(await templates.getByRole("button", { disabled: true }).count(), 0);

    await tile("New chat").click();
    assert.deepEqual((await calls(page, "panel.newRun")).at(-1), { action: "newRun", name: "local" });
    assert.deepEqual(await busy(), ["New chat"]);
    await page.evaluate(() => window.startPageFixture.renewPanel());
    await page.waitForFunction(() => document.querySelector('[aria-busy="true"]') === null);
    assert.equal(await tile("New chat").isEnabled(), true);
  });
});

test("compact Start cards keep top-right actions visible and highlight hover and keyboard focus in both themes and hosts", browserOnly, async () => {
  const shots = join(tmpdir(), "ragents-browser-shots");
  await mkdir(shots, { recursive: true });
  for (const view of ["web", "start"] as const) {
    for (const theme of ["light", "dark"] as const) {
      await withPage(`view=${view}`, 1600, async (page) => {
        const templates = page.getByRole("list", { name: "Templates", exact: true });
        await templates.waitFor();
        await page.evaluate((value) => document.documentElement.setAttribute("data-theme", value), theme);
        await page.mouse.move(0, 0);
        assert.deepEqual(await templates.getByRole("button").evaluateAll((buttons) => buttons.map((button) => button.getAttribute("aria-label"))),
          ["New chat", "Start Collection board", "Set up Clarify decision", "Start Discussion circle", "Start Word game"]);
        const cards = await templates.getByRole("button").evaluateAll((buttons) => buttons.map((button) => {
          const title = button.querySelector<HTMLElement>('[data-slot="start-title"]')!;
          const action = button.querySelector<HTMLElement>('[data-slot="start-action"]')!;
          const description = button.querySelector<HTMLElement>('[data-slot="start-description"]')!;
          return { text: button.textContent, children: button.children.length, action: action.dataset.action, icons: action.querySelectorAll('svg[aria-hidden="true"]').length,
            title: title.getBoundingClientRect().toJSON(), icon: action.getBoundingClientRect().toJSON(), description: description.getBoundingClientRect().toJSON(),
            height: button.getBoundingClientRect().height, clamp: getComputedStyle(description).webkitLineClamp, shadow: getComputedStyle(button).boxShadow };
        }));
        assert.deepEqual(cards.map((card) => card.action), ["chat", "start", "setup", "start", "start"]);
        for (const card of cards) {
          assert.equal(card.children, 2, "only the title row and description remain");
          assert.equal(card.icons, 1, "every action is always visible");
          assert.doesNotMatch(card.text ?? "", /No template|Mini-apps|\bDiscuss\b|Moderation|Run scripts|Set up|Start/);
          assert.ok(Math.abs(card.icon.top - card.title.top) < 1 && card.icon.left >= card.title.right, "action sits to the right of the title");
          assert.ok(card.description.top >= card.title.bottom, "description is below the title row");
          assert.equal(card.clamp, "2");
          assert.ok(card.height < 100, `compact card: ${card.height}px`);
          assert.notEqual(card.shadow, "none", "a resting tile lifts off the backdrop with the card shadow");
        }
        assert.equal(new Set(cards.map((card) => card.shadow)).size, 1, "every resting tile has the same shadow");
        await page.screenshot({ animations: "disabled", path: join(shots, `start-compact-${view}-${theme}.png`) });
        const tile = templates.getByRole("button", { name: "Start Collection board", exact: true });
        const action = tile.locator('[data-slot="start-action"]');
        const color = () => action.evaluate((element) => getComputedStyle(element).color);
        const resting = await color();
        assert.equal(await action.isVisible(), true);
        await tile.hover();
        const hovered = await color();
        assert.notEqual(hovered, resting, "hover highlights the action");
        await page.screenshot({ animations: "disabled", path: join(shots, `start-compact-${view}-${theme}-hover.png`) });
        await page.mouse.move(0, 0);
        assert.equal(await color(), resting);
        await page.keyboard.press("Tab");
        await tile.focus();
        assert.equal(await tile.evaluate((element) => element.matches(":focus-visible")), true);
        assert.equal(await color(), hovered, "keyboard focus highlights the same action");
        await tile.press("Enter");
        if (view === "start") assert.deepEqual(await calls(page, "panel.newRun"), [{ action: "newRun", name: "local", entryId: "demo.board" }]);
        else await page.getByRole("list", { name: "Templates", exact: true }).waitFor({ state: "detached" });
      });
    }
  }
});

test("a template clicked on VS Code Start asks the host and retains its workstation folder", browserOnly, async () => {
  await withPage("view=panel&host=vscode", 520, async (page) => {
    const templates = page.getByRole("list", { name: "Templates", exact: true });
    await templates.waitFor();
    assert.equal(await page.getByRole("list", { name: "Server", exact: true }).count(), 0);
    await templates.locator('button[data-tile="Discussion circle"]').click();
    await page.waitForFunction(() => window.startPageFixture.calls.some((call) => call.id === "ragents.chat.start"));
    const notifications = await page.evaluate(() => window.startPageFixture.notifications);
    assert.ok(notifications.some((message) => message.type === "newRun" && message.entryId === "demo.circle"));
    const binding = (await calls(page, "ragents.startOptions.select")).find((call) => call.optionId === WORKSPACE_BINDING_OPTION_ID);
    assert.deepEqual(binding?.value, { machine: { client: "laptop-01", label: "Notebook" }, folder: { path: "/home/user/project" } },
      "The host's selection reaches the server before the template starts.");
    const order = await page.evaluate(() => window.startPageFixture.calls.map((call) => call.id));
    assert.ok(order.indexOf("ragents.startOptions.select") < order.indexOf("ragents.chat.start"));
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
      const options = page.locator('[data-slot="select-content"][data-open]').getByRole("option");
      await model.click();
      await options.first().waitFor();
      assert.deepEqual(await options.allTextContents(), ["openrouter/z-ai/glm-5.3-flash", "openrouter/qwen/qwen3.8-max"], "only the models of the profile");
      await options.filter({ hasText: "openrouter/qwen/qwen3.8-max" }).click();
      const reasoning = page.getByRole("combobox", { name: "Reasoning" });
      await reasoning.click();
      await options.first().waitFor();
      assert.deepEqual(await options.allTextContents(), ["off", "low", "high"], "only the levels of the model");
      await options.filter({ hasText: /^low$/ }).click();
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
      assert.match(await model.textContent() ?? "", /qwen\/qwen3\.8-max/);
      assert.match(await reasoning.textContent() ?? "", /low/, "the selected thinking level stays in the chat");
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
          const search = main.querySelector<HTMLInputElement>('input[aria-label="Search runs"]');
          const rect = list.parentElement!.getBoundingClientRect();
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
        assert.equal(await page.getByRole("list", { name: "Server", exact: true }).count(), 0);
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
        assert.ok(runs.searchWidth! > 0 && runs.searchWidth! <= runs.width, "search stays within the bounded column of the rows");
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
  for (const width of [1400, 420]) {
    test(`the global coordinator opens below its field with a tall chat at ${width}px in ${host}`, browserOnly, async (context) => {
      await withPage(`view=${host === "browser" ? "web" : "panel"}&host=${host}&coordinator=1`, width, async (page) => {
        const trigger = page.getByRole("button", { name: "Global coordinator", exact: true });
        const history = page.getByRole("region", { name: "Global coordinator", exact: true });
        const measure = async () => {
          await page.evaluate(async () => {
            await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
            await Promise.all(document.getAnimations().filter((animation) => animation.effect?.getComputedTiming().iterations !== Infinity)
              .map((animation) => animation.finished.catch(() => undefined)));
          });
          const [field, panel, chat, composer] = await Promise.all([
            trigger.boundingBox(), history.boundingBox(), history.locator('[data-chat="panel"]').boundingBox(), history.locator('[data-chat="composer"]').boundingBox(),
          ]);
          const viewport = page.viewportSize()!;
          assert.ok(field && panel && chat && composer);
          const left = Math.max(8, Math.min(field.x, viewport.width - panel.width - 8));
          assert.ok(Math.abs(panel.x - left) < 1, `The chat aligns with its field, shifted only for viewport padding: ${JSON.stringify({ field, panel })}`);
          assert.ok(Math.abs(panel.y - field.y - field.height - 8) < 1, "The chat opens directly below its field, including in a two-row header.");
          assert.ok(panel.height >= viewport.height * 0.8, `The chat uses at least 80 percent of the viewport height: ${panel.height}/${viewport.height}`);
          assert.ok(panel.x >= 8 && panel.x + panel.width <= viewport.width - 8 && panel.y + panel.height <= viewport.height - 8 + 1, `The whole chat respects viewport padding: ${JSON.stringify({ panel, viewport })}`);
          assert.ok(Math.abs(panel.width - Math.min(800, viewport.width - 16)) < 1, "The chat keeps a readable width when its field is narrow.");
          assert.ok(Math.abs(chat.y + chat.height - panel.y - panel.height + 8) < 1, "The chat fills the panel down to its bottom padding.");
          assert.ok(Math.abs(composer.y + composer.height - chat.y - chat.height) < 1, "The composer stays at the bottom of the chat.");
          assert.equal(await history.evaluate((element) => element.scrollWidth > element.clientWidth), false);
        };
        await trigger.click();
        await history.getByRole("textbox", { name: "Ask the global coordinator", exact: true }).waitFor();
        await measure();
        await page.keyboard.press("Escape");
        await history.waitFor({ state: "hidden" });
        if (host === "browser") {
          await page.getByRole("list", { name: "Recent", exact: true }).getByRole("button").first().click();
        } else {
          await page.evaluate(() => window.startPageFixture.command({ type: "selectRun", runId: "existing" }));
        }
        await page.getByRole("button", { name: "Stop run", exact: true }).waitFor();
        await trigger.click();
        await history.waitFor();
        await measure();
        const shots = join(tmpdir(), "ragents-browser-shots");
        await mkdir(shots, { recursive: true });
        const screenshot = join(shots, `global-coordinator-${host}-${width}.png`);
        await page.screenshot({ path: screenshot });
        context.diagnostic(`Screenshot: ${screenshot}`);
        for (const height of [1400, 300]) {
          await page.setViewportSize({ width, height });
          await measure();
        }
      });
    });
  }

  test(`one shared header retains the coordinator and run actions (${host})`, browserOnly, async () => {
    await withPage(`view=${host === "browser" ? "web" : "panel"}&host=${host}&coordinator=1`, 1280, async (page) => {
      await page.getByRole("list", { name: "Templates", exact: true }).waitFor();
      assert.equal(await page.getByRole("list", { name: "Server", exact: true }).count(), 0, "The selected server supplies its own home page.");
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
      const visibleAction = async (button: Locator) => {
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
      if (host === "browser") {
        const reset = header.getByRole("button", { name: "Reset layout", exact: true });
        await reset.waitFor();
        assert.equal(await page.locator('[data-docking="workspace"]').getByRole("button", { name: "Reset layout", exact: true }).count(), 0, "Layout actions are mounted in the shared header.");
        await page.getByRole("button", { name: "Close Chat", exact: true }).click();
        await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
        const openChat = header.getByRole("group", { name: "Layout actions" }).getByRole("button", { name: "Chat", exact: true });
        await openChat.waitFor();
        assert.equal(await openChat.getAttribute("aria-pressed"), "false", "A closed view keeps its button.");
        await page.screenshot({ path: join(shots, "header-browser-direct-actions.png") });
        await visibleAction(openChat);
        await visibleAction(reset);
        await openChat.click();
        await page.getByRole("tab", { name: "Chat", exact: true }).waitFor();
        assert.equal(await openChat.getAttribute("aria-pressed"), "true", "A shown view stays listed as pressed.");
        await page.getByRole("button", { name: "Close Chat", exact: true }).click();
        await page.setViewportSize({ width: 520, height: 820 });
        await visibleAction(openChat);
        await visibleAction(reset);
        await visibleAction(header.getByRole("button", { name: "Empty space", exact: true }));
        assert.equal(await openChat.getAttribute("aria-pressed"), "false");
        assert.equal(await header.getByRole("button", { name: /^All windows/ }).count(), 0);
        await page.screenshot({ path: join(shots, "header-browser-narrow-actions.png") });
        await openChat.click();
        await page.getByRole("tab", { name: "Chat", exact: true }).waitFor();
        assert.equal(await openChat.getAttribute("aria-pressed"), "true", "A narrow direct button restores Chat.");
        await page.setViewportSize({ width: 1280, height: 820 });
        await openChat.waitFor();
      } else {
        assert.equal(await header.getByRole("button", { name: "Reset layout", exact: true }).count(), 0);
      }
      const wideHeader = await header.boundingBox();
      for (const width of [520, 320, 200]) {
        await page.setViewportSize({ width, height: 820 });
        const narrowHeader = await header.boundingBox();
        assert.ok(wideHeader && narrowHeader && narrowHeader.height > wideHeader.height, "Both hosts grow the header when its controls wrap.");
        for (const button of await header.getByRole("button").all()) await visibleAction(button);
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, "The panel has no horizontal scroll.");
        const content = await page.locator("main").boundingBox();
        assert.ok(content && content.y >= narrowHeader.y + narrowHeader.height, "The content starts below the wrapping header.");
        await page.screenshot({ path: join(shots, `header-${host}-wrapped-${width}.png`) });
      }
      await page.setViewportSize({ width: 1280, height: 820 });
      await coordinator.click();
      await history.waitFor();
      await page.screenshot({ path: join(shots, `header-${host}-run-coordinator.png`) });
      await page.keyboard.press("Escape");
      await history.waitFor({ state: "hidden" });
      await logo.focus();
      await page.keyboard.press("Enter");
      const templates = page.getByRole("list", { name: "Templates", exact: true });
      await templates.waitFor();
      assert.equal(await header.getByRole("button", { name: "Stop run", exact: true }).count(), 0, "The logo leads back to this server's Start page.");
      if (host === "vscode") {
        assert.ok((await page.evaluate(() => window.startPageFixture.notifications)).some((message) => message.type === "showStart"));
      }
      await page.getByRole("button", { name: /All .* runs/ }).click();
      await page.getByRole("heading", { name: "Runs", exact: true }).waitFor();
      if (host === "vscode") assert.ok((await page.evaluate(() => window.startPageFixture.notifications)).some((message) => message.type === "pageChanged" && message.page === "runs"));
      const runs = page.getByRole("list", { name: "Runs", exact: true });
      assert.equal(await runs.getByRole("listitem").count(), 1);
      assert.equal(await runs.getByRole("button").filter({ hasText: "Existing run" }).count(), 1);
      assert.equal(await page.locator('[data-cell="connection"]').count(), 0);
      await coordinator.click();
      await history.waitFor();
      assert.equal(await draft.evaluate((element, original) => element === original, input), true, "Start, run, and Runs keep the server's coordinator mounted.");
      assert.equal(await draft.inputValue(), "Unsent coordinator draft");
      await page.keyboard.press("Escape");
      await history.waitFor({ state: "hidden" });
      await page.locator("main").getByRole("button", { name: "Back to Start", exact: true }).click();
      await templates.waitFor();
      if (host === "vscode") assert.ok((await page.evaluate(() => window.startPageFixture.notifications)).some((message) => message.type === "pageChanged" && message.page === "start"));
      await templates.locator('button[data-tile="Clarify decision"]').click();
      await page.getByRole("button", { name: "Cancel guide", exact: true }).click();
      await templates.waitFor();
      await coordinator.click();
      await history.waitFor();
      assert.equal(await draft.evaluate((element, original) => element === original, input), true, "Cancelling a guide stays in this server's frame.");
      assert.equal(await draft.inputValue(), "Unsent coordinator draft");
    });
  });
}

test("the VS Code run header packs the global and the run controls into at most two gapless rows", browserOnly, async () => {
  await withPage("view=panel&host=vscode&windows=1&coordinator=1", 700, async (page) => {
    await page.getByRole("list", { name: "Templates", exact: true }).waitFor();
    await page.evaluate(() => {
      window.startPageFixture.views.add("existing");
      window.startPageFixture.command({ type: "selectRun", runId: "existing" });
    });
    const header = page.locator("header").filter({ has: page.locator('[data-slot="overseer-toolbar"]') });
    const rect = async (name: string) => {
      const box = await header.getByRole("button", { name, exact: true }).boundingBox();
      assert.ok(box, name);
      return box;
    };
    await header.getByRole("button", { name: "Run script", exact: true }).waitFor();
    const [coordinator, settings, agents, share, script] = await Promise.all(["Global coordinator", "Settings", "Agents", "Share", "Run script"].map(rect));
    const headerBox = await header.boundingBox();
    assert.ok(headerBox && headerBox.height < 100, `two rows at most: ${headerBox?.height}`);
    assert.ok(Math.abs(coordinator!.y + coordinator!.height / 2 - (settings!.y + settings!.height / 2)) < 4, "the coordinator shares its row with the global actions");
    assert.ok(Math.abs(agents!.y + agents!.height / 2 - (script!.y + script!.height / 2)) < 4 && Math.abs(share!.y + share!.height / 2 - (script!.y + script!.height / 2)) < 4, "Agents, Share, and Run script share one row");
    assert.ok(script!.y > settings!.y + settings!.height / 2, "the run controls form their own row below the global ones");
    const rowEnd = await header.locator('[data-slot="overseer-toolbar"]').evaluate((element) => {
      const next = element.closest("header")!.querySelector('[aria-label="Environment local"], [title="Environment local"]');
      return next ? next.getBoundingClientRect().left - element.getBoundingClientRect().right : -1;
    });
    assert.ok(rowEnd >= 0 && rowEnd < 24, `the coordinator grows up to the global actions: ${rowEnd}`);
    await page.setViewportSize({ width: 1280, height: 820 });
    const wide = await header.boundingBox();
    assert.ok(wide && wide.height < 50, "a wide VS Code panel keeps one row");
    for (const name of ["Global coordinator", "Settings", "Agents", "Share", "Run script"]) {
      const box = await rect(name);
      assert.ok(box.y >= wide.y && box.y + box.height <= wide.y + wide.height, `${name} fits the single row`);
    }
  });
});

test("a narrow VS Code panel keeps more than five mini-app buttons direct and opens their editor tabs", browserOnly, async () => {
  await withPage("view=panel&host=vscode&windows=1", 320, async (page) => {
    await page.getByRole("list", { name: "Templates", exact: true }).waitFor();
    await page.evaluate(() => {
      window.startPageFixture.views.add("existing");
      window.startPageFixture.command({ type: "selectRun", runId: "existing" });
    });
    const apps = page.getByRole("navigation", { name: "Mini-apps of the run" });
    await apps.waitFor();
    assert.deepEqual(await apps.getByRole("button").evaluateAll((buttons) => buttons.map((button) => button.getAttribute("aria-label"))),
      ["Notes", "Board", "Plan", "Map", "Log", "Preview"]);
    for (const width of [320, 200]) {
      await page.setViewportSize({ width, height: 820 });
      const bounds = await apps.boundingBox();
      assert.ok(bounds);
      for (const button of await apps.getByRole("button").all()) {
        assert.equal(await button.isVisible(), true);
        const rect = await button.boundingBox();
        assert.ok(rect && rect.x >= bounds.x && rect.x + rect.width <= bounds.x + bounds.width);
        assert.ok(rect.y >= bounds.y && rect.y + rect.height <= bounds.y + bounds.height);
        await button.click();
      }
      assert.ok(new Set(await apps.getByRole("button").evaluateAll((buttons) => buttons.map((button) => button.getBoundingClientRect().top))).size > 1);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
      assert.equal(await apps.getByRole("button", { name: /^All windows/ }).count(), 0);
    }
    assert.deepEqual(await page.evaluate(() => window.startPageFixture.notifications.filter((entry) => entry.type === "openInCenter").map((entry) => entry.elementId)),
      ["notes", "board", "plan", "map", "log", "preview", "notes", "board", "plan", "map", "log", "preview"], "every direct button requests its editor tab");
  });
});
