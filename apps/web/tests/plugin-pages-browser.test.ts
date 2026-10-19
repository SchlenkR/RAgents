import assert from "node:assert/strict";
import test from "node:test";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { chromium, type Page } from "playwright-core";
import { tailwindPlugin } from "./tailwind-plugin";
import type {} from "./run-panel-start-fixture";

const activationOverride = `import { useEffect, useState } from "react";
export const usePluginActivation = () => {
  const [state, setState] = useState(window.runStartFixture.activation);
  useEffect(() => window.runStartFixture.onActivation(setState), []);
  return state;
};`;

/** Builds the Start fixture once and returns the address of its page. */
const buildFixture = async (): Promise<string> => {
  await mkdir("/private/tmp/ragents-plugin-pages", { recursive: true });
  const directory = await mkdtemp("/private/tmp/ragents-plugin-pages/browser-");
  const root = fileURLToPath(new URL("../../../", import.meta.url));
  const source = `${root}apps/web/src`;
  await build({
    entryPoints: [fileURLToPath(new URL("run-panel-start-fixture.tsx", import.meta.url))],
    bundle: true, platform: "browser", format: "iife", jsx: "automatic", outfile: `${directory}/fixture.js`,
    plugins: [
      { name: "start-fixture-services", setup(builder) {
        builder.onLoad({ filter: /\/src\/PluginActivation\.ts$/ }, () => ({ contents: activationOverride, loader: "js", resolveDir: source }));
        builder.onLoad({ filter: /\/src\/rpc\.ts$/ }, () => ({ contents: 'export const rpc = { call: (...args) => window.runStartFixture.call(...args), subscribe: (...args) => window.runStartFixture.subscribe(...args) };' }));
      } },
      tailwindPlugin([source, `${root}plugins/ragents.orchestration/web`]),
    ], logLevel: "silent",
  });
  await writeFile(`${directory}/index.html`, '<!doctype html><html><head><link rel="stylesheet" href="fixture.css"><style>html,body{height:100%;margin:0}#root{height:100%}</style></head><body><div id="root"></div><script src="fixture.js"></script></body></html>');
  return `file://${directory}/index.html`;
};

let fixtureUrl: Promise<string> | undefined;
const browserOnly = { skip: process.env.RAGENTS_BROWSER_TESTS !== "1", timeout: 90_000 };

/** The fixture with plugin pages in a 900 px wide browser window; the callback gets the page and the errors the page reported. */
const withPages = async (query: string, run: (page: Page, errors: string[]) => Promise<void>) => {
  const url = await (fixtureUrl ??= buildFixture());
  const browser = await chromium.launch({ headless: true, executablePath: process.env.BROWSER_EXECUTABLE_PATH ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" });
  try {
    const page = await browser.newPage({ viewport: { width: 900, height: 700 }, reducedMotion: "reduce" });
    page.setDefaultTimeout(8000);
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(`${url}?pages&${query}`);
    await run(page, errors);
  } finally { await browser.close(); }
};

const pageParameter = (page: Page) => new URL(page.url()).searchParams.get("page");
const startPage = (page: Page) => page.locator('main[data-page="start"]:visible');
const reportsPage = (page: Page) => page.locator('main[data-plugin-page="start.reports"]');
const topBar = (page: Page) => page.locator("header").first();
const button = (page: Page, name: string) => topBar(page).getByRole("button", { name, exact: true });
const activeRun = (page: Page) => page.evaluate(() => window.runStartFixture.activeRun());

for (const host of ["browser", "vscode"]) {
  test(`Edit Start follows Start visibility through pages, runs, and edit mode in ${host}`, browserOnly, () => withPages(`host=${host}&rights=runs.read,runs.write,runs.create,runs.inspect,settings.read`, async (page, errors) => {
    const edit = button(page, "Edit Start");
    await edit.waitFor();
    const [editBox, appearanceBox] = [await edit.boundingBox(), await button(page, "Appearance").boundingBox()];
    assert.ok(editBox && appearanceBox && editBox.x + editBox.width <= appearanceBox.x && Math.abs(editBox.height - appearanceBox.height) < 1,
      "the Start action uses the same icon size beside Appearance");
    await edit.click();
    const bar = page.getByRole("group", { name: "Edit Start", exact: true });
    await bar.waitFor();
    assert.equal(await edit.count(), 0, "only the existing edit bar is available during editing");
    assert.equal(await startPage(page).getByRole("group", { name: "Edit Start", exact: true }).isVisible(), true);
    await page.getByRole("button", { name: "Cancel", exact: true }).click();
    await edit.waitFor();
    assert.equal(await edit.evaluate((element) => element === document.activeElement), true, "Cancel returns focus to the top bar action");
    await button(page, "Reports").click();
    await reportsPage(page).waitFor();
    assert.equal(await edit.count(), 0, "a plugin page hides Start's action");
    await page.getByRole("button", { name: "Open existing run", exact: true }).click();
    await page.waitForFunction(() => window.runStartFixture.activeRun() === "existing");
    assert.equal(await edit.count(), 0, "an open run hides Start's action");
    await button(page, "Run script").waitFor();
    await button(page, "Reports").click();
    await reportsPage(page).waitFor();
    assert.equal(await button(page, "Run script").count(), 0, "a page also hides the run's controls in the shared slot");
    await page.getByRole("button", { name: "Open existing run", exact: true }).click();
    await button(page, "Run script").waitFor();
    assert.equal(await button(page, "Run script").count(), 1, "the run restores its controls without duplicates");
    await button(page, "Back to Start").click();
    await edit.waitFor();
    await page.getByRole("button", { name: "All 1 runs", exact: true }).click();
    await page.locator('main[data-page="runs"]').waitFor();
    assert.equal(await edit.count(), 0, "the Runs page has no Start action");
    await button(page, "Back to Start").click();
    await edit.waitFor();
    assert.equal(await edit.count(), 1, "returning to Start restores exactly one action");
    assert.deepEqual(errors, []);
  }));
}

test("the top bar shows a button per readable page and a page opens in the main area instead of Start", browserOnly, () => withPages("host=browser", async (page, errors) => {
  await startPage(page).waitFor();
  assert.deepEqual(await topBar(page).getByRole("button").evaluateAll((buttons) => buttons.map((entry) => entry.getAttribute("aria-label"))).then((names) => names.filter((name) => ["Reports", "Audit", "Broken"].includes(name ?? ""))), ["Reports", "Broken"],
    "The page without the read right has no button.");
  assert.equal(await button(page, "Reports").getAttribute("aria-current"), null);
  assert.equal(await button(page, "Reports").locator("svg").count(), 1, "The button shows the page's icon.");
  assert.equal(await button(page, "Reports").innerText(), "Reports", "The button shows the title next to the icon.");

  await button(page, "Reports").click();
  await reportsPage(page).waitFor();
  assert.equal(await startPage(page).count(), 0, "The page takes the main area from Start.");
  assert.equal(await page.getByRole("dialog").count(), 0, "The page is plain content, not a dialog.");
  assert.equal(await button(page, "Reports").getAttribute("aria-current"), "page");
  assert.equal(await button(page, "Broken").getAttribute("aria-current"), null);
  assert.equal(pageParameter(page), "start.reports");
  const frame = await reportsPage(page).evaluate((main) => {
    const style = getComputedStyle(main);
    return { background: style.backgroundColor, shadow: style.boxShadow, border: style.borderTopWidth, dialogs: main.closest("[role=dialog]") === null };
  });
  assert.deepEqual(frame, { background: "rgba(0, 0, 0, 0)", shadow: "none", border: "0px", dialogs: true }, "The page sits on the normal app background without a frame.");

  const scrolled = await reportsPage(page).evaluate((main) => {
    main.scrollTop = 600;
    return { scrolls: main.scrollHeight > main.clientHeight, top: main.scrollTop, document: document.scrollingElement!.scrollHeight <= window.innerHeight };
  });
  assert.equal(scrolled.scrolls, true, "The tall page scrolls inside the main area.");
  assert.ok(scrolled.top > 500, "The main area scrolls as a whole.");
  assert.equal(scrolled.document, true, "The browser window itself does not scroll.");

  const entries = await page.evaluate(() => history.length);
  await button(page, "Reports").click();
  assert.equal(await page.evaluate(() => history.length), entries, "A click on the open page's own button adds no history entry.");
  assert.deepEqual(errors, []);
}));

test("the address names the open page, so reload, bookmark, back and forward follow it", browserOnly, () => withPages("host=browser", async (page, errors) => {
  await startPage(page).waitFor();
  const entries = () => page.evaluate(() => history.length);
  const before = await entries();
  await button(page, "Reports").click();
  await reportsPage(page).waitFor();
  assert.equal(await entries(), before + 1, "Opening a page adds one history entry.");

  await page.goBack();
  await startPage(page).waitFor();
  assert.equal(pageParameter(page), null, "Back removes the page from the address.");
  assert.equal(await reportsPage(page).count(), 0);
  assert.equal(await button(page, "Reports").getAttribute("aria-current"), null);

  await page.goForward();
  await reportsPage(page).waitFor();
  assert.equal(pageParameter(page), "start.reports");
  assert.equal(await button(page, "Reports").getAttribute("aria-current"), "page");

  await page.reload();
  await reportsPage(page).waitFor();
  assert.equal(await button(page, "Reports").getAttribute("aria-current"), "page", "A reload shows the page the address names.");

  const bookmark = page.url();
  await page.goto("about:blank");
  await page.goto(bookmark);
  await reportsPage(page).waitFor();
  assert.equal(await startPage(page).count(), 0, "A bookmark opens the page directly.");

  await page.getByRole("button", { name: "Back to Start", exact: true }).click();
  await startPage(page).waitFor();
  assert.equal(pageParameter(page), null, "The logo returns to Start and takes the page out of the address.");
  await page.goBack();
  await reportsPage(page).waitFor();
  assert.deepEqual(errors, []);
}));

test("opening a run leaves the page and a page leaves the open run to return to it", browserOnly, () => withPages("host=browser&run=existing", async (page, errors) => {
  await page.waitForFunction(() => window.runStartFixture.activeRun() === "existing");
  await page.evaluate(() => {
    window.runStartFixture.chat({ kind: "status", running: false });
    window.runStartFixture.chat({ kind: "replay-end", conversationId: null });
  });
  await page.locator("textarea").fill("An unsent note");
  await button(page, "Reports").click();
  await reportsPage(page).waitFor();
  assert.equal(await page.locator("textarea").isVisible(), false, "The page takes the main area from the run.");
  assert.equal(await page.getByRole("region", { name: "Run title bar" }).count(), 0, "The run's title bar leaves with it.");

  await page.goBack();
  await page.waitForFunction(() => window.runStartFixture.activeRun() === "existing");
  assert.equal(await reportsPage(page).count(), 0, "Back from the page shows the run again.");
  assert.equal(await page.locator("textarea").inputValue(), "An unsent note", "The run stays mounted under the page and keeps its unsent input.");
  await page.getByRole("region", { name: "Run title bar" }).waitFor();

  await page.goForward();
  await reportsPage(page).waitFor();
  await reportsPage(page).getByRole("button", { name: "Open existing run", exact: true }).click();
  await page.waitForFunction(() => window.runStartFixture.activeRun() === "existing");
  assert.equal(await reportsPage(page).count(), 0, "Opening a run leaves the page.");
  assert.equal(pageParameter(page), null);
  assert.equal(await button(page, "Reports").getAttribute("aria-current"), null);
  assert.deepEqual(errors, []);
}));

test("an unknown page or one without the read right falls back to Start with a notice, and the right shows it", browserOnly, async () => {
  await withPages("host=browser&page=missing", async (page, errors) => {
    await startPage(page).waitFor();
    await page.getByRole("status").filter({ hasText: "The page missing is not available." }).waitFor();
    assert.equal(await button(page, "Reports").getAttribute("aria-current"), null);
    await button(page, "Reports").click();
    await reportsPage(page).waitFor();
    assert.deepEqual(errors, []);
  });
  await withPages("host=browser&page=start.audit", async (page, errors) => {
    await startPage(page).waitFor();
    await page.getByRole("status").filter({ hasText: "The page start.audit is not available." }).waitFor();
    assert.deepEqual(errors, []);
  });
  await withPages("host=browser&page=start.audit&rights=runs.read,runs.write,runs.create,start.audit", async (page, errors) => {
    await page.getByRole("heading", { name: "Audit trail", exact: true }).waitFor();
    assert.equal(await button(page, "Audit").getAttribute("aria-current"), "page");
    assert.deepEqual(errors, []);
  });
});

test("a page that throws shows its cause in the main area while the top bar and the other pages stay usable", browserOnly, () => withPages("host=browser", async (page, errors) => {
  await button(page, "Broken").click();
  await page.getByRole("heading", { name: "The page Broken could not be displayed", exact: true }).waitFor();
  await page.getByRole("alert").filter({ hasText: "The report data is damaged." }).waitFor();
  await button(page, "Reports").click();
  await reportsPage(page).waitFor();
  assert.equal(await page.getByRole("alert").filter({ hasText: "The report data is damaged." }).count(), 0);
  assert.deepEqual(errors, []);
}));

test("in VS Code the page lives in the panel only: no address change, and the host's navigation leaves it", browserOnly, () => withPages("", async (page, errors) => {
  await startPage(page).waitFor();
  const entries = await page.evaluate(() => history.length);
  await button(page, "Reports").click();
  await reportsPage(page).waitFor();
  assert.equal(pageParameter(page), null, "The panel's address is the host's, so it stays as it is.");
  assert.equal(await page.evaluate(() => history.length), entries);
  assert.equal((await page.evaluate(() => window.runStartFixture.notifications)).some((message) => message.type === "showStart"), false, "Opening a page does not tell the extension to show Start.");
  await page.evaluate(() => window.runStartFixture.command({ type: "showPage", page: "start" }));
  await startPage(page).waitFor();
  assert.equal(await reportsPage(page).count(), 0, "The extension's navigation leaves the page.");
  await button(page, "Reports").click();
  await reportsPage(page).waitFor();
  await page.evaluate(() => window.runStartFixture.command({ type: "selectRun", runId: "existing" }));
  await page.waitForFunction(() => window.runStartFixture.activeRun() === "existing");
  assert.equal(await reportsPage(page).count(), 0, "Selecting a run leaves the page.");
  assert.deepEqual(errors, []);
}));
