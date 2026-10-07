import assert from "node:assert/strict";
import test from "node:test";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { chromium, type Locator, type Page } from "playwright-core";
import { STARTUP_SETTLE_MS } from "../../../plugins/ragents.orchestration/web/run-panel/run-panel-startup.ts";
import { tailwindPlugin } from "./tailwind-plugin";
import type {} from "./run-panel-start-fixture";

const activationOverride = `import { useEffect, useState } from "react";
export const usePluginActivation = () => {
  const [state, setState] = useState(window.runStartFixture.activation);
  useEffect(() => window.runStartFixture.onActivation(setState), []);
  return state;
};`;

const center = async (locator: Locator) => {
  const box = await locator.boundingBox();
  assert.ok(box, "The loading state is visible.");
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
};

/** Builds the fixture once and returns the address of its page. */
const buildFixture = async (): Promise<string> => {
  await mkdir("/private/tmp/ragents-run-panel-start", { recursive: true });
  const directory = await mkdtemp("/private/tmp/ragents-run-panel-start/browser-");
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
const launchBrowser = () => chromium.launch({ headless: true, executablePath: process.env.BROWSER_EXECUTABLE_PATH ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" });

for (const host of ["browser", "vscode"] as const) {
  test(`a Start plugin lists metadata from all visible runs and opens the selected run in ${host}`, {
    skip: process.env.RAGENTS_BROWSER_TESTS !== "1", timeout: 90_000,
  }, async () => {
    const url = await (fixtureUrl ??= buildFixture());
    const browser = await launchBrowser();
    try {
      const page = await browser.newPage({ viewport: { width: 900, height: 900 } });
      const errors: string[] = [];
      page.on("pageerror", (error) => errors.push(error.message));
      await page.goto(`${url}?host=${host}&documents`);
      const section = page.getByRole("region", { name: "Work documents", exact: true });
      await section.waitFor();
      assert.deepEqual(await page.locator("main[data-page=start] h2").allTextContents(), ["New4", "Continue", "Work documents"]);
      assert.equal(await page.getByRole("list", { name: "Recent", exact: true }).getByRole("listitem").count(), 5);
      assert.equal(await page.getByRole("button", { name: /^All 7 runs/ }).count(), 1);
      assert.deepEqual(await section.getByRole("button").allTextContents(), Array.from({ length: 6 }, (_, index) => `Work note ${index} - Document run ${index}`));
      assert.equal(await page.getByRole("list", { name: "Recent", exact: true }).getByText("Document run 5").count(), 0);
      await section.getByRole("button", { name: "Work note 5 - Document run 5", exact: true }).click();
      await page.waitForFunction(() => window.runStartFixture.activeRun() === "document-run-5");
      assert.equal(await section.count(), 0, "opening a document uses the run navigation and leaves Start");
      await page.getByRole("button", { name: "Back to Start", exact: true }).click();
      await section.waitFor();
      await page.getByRole("list", { name: "Recent", exact: true }).getByRole("button", { name: /Document run 0/ }).click();
      await page.waitForFunction(() => window.runStartFixture.activeRun() === "document-run-0");
      assert.deepEqual(errors, []);
    } finally { await browser.close(); }
  });
}

test("the VS Code panel starts on the server's Start page and keeps one loading state from a start click to the first content", {
  skip: process.env.RAGENTS_BROWSER_TESTS !== "1", timeout: 90_000,
}, async () => {
  const url = await (fixtureUrl ??= buildFixture());
  const browser = await launchBrowser();
  try {
    const page = await browser.newPage({ viewport: { width: 520, height: 820 }, reducedMotion: "reduce" });
    page.setDefaultTimeout(8000);
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    const notice = page.locator("[data-startup]");
    const titleOf = () => notice.locator("strong").textContent();
    const detailOf = () => notice.locator("p").textContent();
    const waitForTitle = (title: string) => page.waitForFunction((expected) => document.querySelector("[data-startup] strong")?.textContent === expected, title);
    const settle = () => page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
    const chat = (event: unknown) => page.evaluate((payload) => window.runStartFixture.chat(payload), event);
    const startPage = page.getByRole("list", { name: "Recent", exact: true });

    await page.goto(`${url}?profile=pending`);
    await notice.waitFor();
    assert.equal(await titleOf(), "Loading profile");
    assert.equal(await notice.getAttribute("data-startup"), "working");
    assert.equal(await notice.locator("[role=progressbar]").count(), 1, "Loading the profile shows the same progress as the run.");
    await page.evaluate(() => window.runStartFixture.activate());
    await startPage.getByRole("button", { name: /Existing run/ }).waitFor();
    assert.equal(await notice.count(), 0, "Without a run, VS Code shows the server's Start page immediately.");
    assert.ok((await page.evaluate(() => window.runStartFixture.notifications)).some((message) => message.type === "ready"));

    await page.evaluate(() => { window.runStartFixture.holdStart = true; });
    await page.getByRole("list", { name: "Templates", exact: true }).locator('button[data-tile="Setup template"]').click();
    await page.waitForFunction(() => window.runStartFixture.calls.includes("ragents.chat.start"));
    assert.equal(await titleOf(), "Starting run");
    assert.equal(await detailOf(), "Starting the template.");
    assert.equal(await page.getByRole("region", { name: "Run title bar" }).getByRole("heading").textContent(), "Setup template");
    const launching = await center(notice);
    const launchingHeader = await page.locator("header").boundingBox();
    const statusBar = await page.getByRole("contentinfo", { name: "Run status bar" }).boundingBox();
    assert.ok(statusBar, "The pending panel reserves the run status bar.");
    assert.equal(await startPage.count(), 0, "The run takes the place of Start while it launches.");
    assert.ok((await page.evaluate(() => window.runStartFixture.notifications)).some((message) => message.type === "newRun" && message.entryId === "start.script"), "The start click asks the extension to apply its workstation selection.");

    await page.evaluate(() => window.runStartFixture.releaseStart());
    await page.waitForFunction(() => window.runStartFixture.activeRun() !== undefined);
    await waitForTitle("Loading run");
    const loading = await center(notice);
    const loadingHeader = await page.locator("header").boundingBox();
    assert.deepEqual(await page.getByRole("contentinfo", { name: "Run status bar" }).boundingBox(), statusBar, "The status bar keeps its space when the run opens.");
    assert.ok(launchingHeader && loadingHeader);
    assert.ok(Math.abs(loading.x - launching.x) < 1 && Math.abs(loading.y - launching.y - (loadingHeader.height - launchingHeader.height) / 2) < 1,
      `The run view keeps the loading state centered below its wrapping header: ${JSON.stringify({ launching, loading, launchingHeader, loadingHeader })}.`);
    assert.equal(await page.locator("textarea").count(), 1, "The chat input stays below the loading state.");

    await chat({ kind: "status", running: false, startup: { status: "preparing", message: "Preparing the working directory." } });
    await chat({ kind: "replay-end", conversationId: null });
    await waitForTitle("Preparing run");
    assert.equal(await detailOf(), "Preparing the working directory.");
    await chat({ kind: "system", text: "Workspace: /home/user/project" });
    await settle();
    assert.equal(await titleOf(), "Preparing run", "A system line does not end the setup.");
    await page.locator("textarea").fill("Noted in advance");
    assert.equal(await page.locator("textarea").inputValue(), "Noted in advance", "The chat input stays usable while the run is set up.");

    await chat({ kind: "status", running: true });
    await waitForTitle("Setting up the run");
    await chat({ kind: "status", running: false });
    await settle();
    assert.equal(await titleOf(), "Setting up the run", "A gap before the run view catches up does not flicker.");
    await page.waitForFunction(() => document.querySelector("[data-startup]") === null, undefined, { timeout: STARTUP_SETTLE_MS + 1000 });
    await chat({ kind: "status", running: true });
    await waitForTitle("Setting up the run");

    await page.evaluate(() => { window.runStartFixture.elements = [{ id: "start.app--main", title: "Setup" }]; });
    await chat({ kind: "plugin", pluginId: "start", type: "app-ready" });
    await page.getByRole("navigation", { name: "Mini-apps of the run" }).getByRole("button", { name: "Setup", exact: true }).waitFor();
    assert.equal(await notice.count(), 0, "The first mini-app ends the loading state.");
    await page.evaluate(() => { window.runStartFixture.elements = []; });
    await chat({ kind: "status", running: true });
    await settle();
    assert.equal(await notice.count(), 0, "Once content was shown, later work brings no loading state back.");
    assert.equal(await startPage.count(), 0, "A running run does not show the Start list.");

    await page.goto(url);
    await startPage.waitFor();
    await page.evaluate(() => window.runStartFixture.command({ type: "newRun" }));
    await page.waitForFunction(() => window.runStartFixture.activeRun() !== undefined);
    await waitForTitle("Loading run");
    assert.equal(await page.getByRole("region", { name: "Run title bar" }).getByRole("button", { name: "New run", exact: true }).textContent(), "New run");
    await chat({ kind: "status", running: false });
    await chat({ kind: "replay-end", conversationId: null });
    await settle();
    assert.equal(await notice.count(), 0, "An idle free run shows no loading state once connected.");
    await page.waitForTimeout(STARTUP_SETTLE_MS + 200);
    assert.equal(await notice.count(), 0, "Nor does one appear later.");
    assert.equal(await page.locator("textarea").isEnabled(), true);

    await page.evaluate(() => {
      window.runStartFixture.holdStart = false;
      window.runStartFixture.command({ type: "selectRun", runId: null });
      window.runStartFixture.command({ type: "newRun", entryId: "start.script" });
    });
    await waitForTitle("Loading run");
    await chat({ kind: "status", running: false, startup: { status: "failed", message: "The package is missing." } });
    await chat({ kind: "replay-end", conversationId: null });
    await waitForTitle("The run could not be prepared");
    assert.equal(await notice.getAttribute("role"), "alert");
    assert.equal(await detailOf(), "The package is missing.", "A failed setup shows its reason at the same place.");

    await page.evaluate(() => {
      window.runStartFixture.command({ type: "selectRun", runId: null });
      window.runStartFixture.command({ type: "newRun", entryId: "start.script" });
    });
    await waitForTitle("Loading run");
    await chat({ kind: "status", running: false, startup: { status: "preparing", message: "Preparing run." } });
    await chat({ kind: "replay-end", conversationId: null });
    await waitForTitle("Preparing run");
    await chat({ kind: "user", text: "Please get started" });
    await page.waitForFunction(() => document.querySelector("[data-startup]") === null);
    assert.equal(await startPage.count(), 0);

    await page.goto(`${url}?rights=runs.read`);
    await startPage.waitFor();
    await page.evaluate(() => window.runStartFixture.command({ type: "newRun", entryId: "start.script" }));
    await page.getByRole("alert").filter({ hasText: "New runs are not enabled for this user account." }).waitFor();
    assert.equal(await startPage.isVisible(), true, "A refused start leaves the server's Start page visible.");
    await page.getByRole("button", { name: "Back to Start", exact: true }).last().click();
    assert.ok((await page.evaluate(() => window.runStartFixture.notifications)).some((message) => message.type === "showStart"), "The refusal leads back to Start.");

    await page.goto(`${url}?rights=runs.read,runs.write`);
    await startPage.waitFor();
    await page.evaluate(() => window.runStartFixture.command({ type: "newRun" }));
    await page.getByRole("alert").filter({ hasText: "Free runs are not enabled for this user account." }).waitFor();
    await page.evaluate(() => window.runStartFixture.command({ type: "newRun", entryId: "start.script" }));
    await page.waitForFunction(() => window.runStartFixture.calls.includes("ragents.chat.start"));
    await page.waitForFunction(() => window.runStartFixture.activeRun() !== undefined);
    assert.equal(await startPage.count(), 0);

    await page.clock.install();
    await page.goto(url);
    await startPage.waitFor();
    await page.clock.fastForward(5100);
    assert.equal(await notice.count(), 0, "An idle server page has no timed-out host waiting state.");
    assert.equal(await startPage.isVisible(), true);

    await page.goto(`${url}?host=browser`);
    await page.getByText("Existing run").waitFor();
    assert.equal(await notice.count(), 0, "The browser shows the same Start page without a run.");
    assert.deepEqual(errors, []);
  } finally { await browser.close(); }
});

/** A fixture page in VS Code, ready for commands from the extension. */
const withPanel = async (run: (page: Page) => Promise<void>, query = "") => {
  const url = await (fixtureUrl ??= buildFixture());
  const browser = await launchBrowser();
  try {
    const page = await browser.newPage({ viewport: { width: 520, height: 820 }, reducedMotion: "reduce" });
    page.setDefaultTimeout(8000);
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(`${url}${query}`);
    await page.waitForFunction(() => window.runStartFixture.notifications.some((message) => message.type === "ready"));
    await run(page);
    assert.deepEqual(errors, []);
  } finally { await browser.close(); }
};
const starts = (page: Page) => page.evaluate(() => window.runStartFixture.starts);
const activeRun = (page: Page) => page.evaluate(() => window.runStartFixture.activeRun());
const pause = (page: Page) => page.evaluate(() => new Promise<void>((resolve) => setTimeout(resolve, 300)));
const browserOnly = { skip: process.env.RAGENTS_BROWSER_TESTS !== "1", timeout: 90_000 };

test("a cancelled guide returns to the same server's Start page in VS Code", browserOnly, () => withPanel(async (page) => {
  const templates = page.getByRole("list", { name: "Templates", exact: true });
  await templates.locator('button[data-tile="Round with a guide"]').click();
  await page.getByRole("button", { name: "Cancel guide", exact: true }).click();
  await templates.waitFor();
  await page.getByRole("list", { name: "Recent", exact: true }).getByRole("button", { name: /Existing run/ }).waitFor();
  assert.deepEqual(await starts(page), [], "Cancelling the guide creates no run.");
  assert.equal(await activeRun(page), undefined);
  assert.equal(await page.locator("[data-startup]").count(), 0);
  assert.ok((await page.evaluate(() => window.runStartFixture.notifications)).some((message) => message.type === "showStart"));
}));

test("host navigation switches Start and Runs within the selected server and selectRun null returns to Start", browserOnly, () => withPanel(async (page) => {
  await page.evaluate(() => window.runStartFixture.command({ type: "showPage", page: "runs" }));
  await page.getByRole("heading", { name: "Runs", exact: true }).waitFor();
  await page.getByRole("list", { name: "Runs", exact: true }).getByRole("button", { name: /Existing run/ }).waitFor();
  assert.equal(await page.getByRole("button", { name: /^Only / }).count(), 0);
  await page.evaluate(() => window.runStartFixture.command({ type: "showPage", page: "start", notice: "The run is no longer shared." }));
  await page.getByRole("status").filter({ hasText: "The run is no longer shared." }).waitFor();
  await page.evaluate(() => {
    window.runStartFixture.views.add("existing");
    window.runStartFixture.command({ type: "selectRun", runId: "existing" });
  });
  await page.waitForFunction(() => window.runStartFixture.activeRun() === "existing");
  await page.evaluate(() => window.runStartFixture.command({ type: "selectRun", runId: null }));
  await page.getByRole("list", { name: "Templates", exact: true }).waitFor();
  assert.equal(await activeRun(page), undefined);
  assert.equal(await page.getByText("The run is no longer shared.", { exact: true }).count(), 0, "Selecting the home page clears the old notice.");
}));

test("a preset start option the server refuses keeps a new run from starting and names the cause in VS Code", browserOnly, () => withPanel(async (page) => {
  const refusal = page.getByRole("alert").filter({ hasText: "The run cannot start as prepared: The workstation Notebook is not connected." });
  await page.evaluate(() => window.runStartFixture.command({ type: "newRun", startOptions: { "start.machine": { client: "notebook" } } }));
  await page.waitForFunction(() => window.runStartFixture.activeRun() !== undefined);
  await page.evaluate(() => {
    window.runStartFixture.chat({ kind: "status", running: false });
    window.runStartFixture.chat({ kind: "replay-end", conversationId: null });
  });
  await refusal.waitFor();
  const input = page.locator("textarea");
  await input.fill("Please get started");
  assert.equal(await page.getByRole("button", { name: "Send", exact: true }).isEnabled(), false, "The free run does not start with the default instead.");
  await input.press("Enter");
  await pause(page);
  assert.equal((await page.evaluate(() => window.runStartFixture.calls)).includes("ragents.chat.send"), false);

  await page.evaluate(() => {
    window.runStartFixture.command({ type: "selectRun", runId: null });
    window.runStartFixture.command({ type: "newRun", entryId: "start.guided", startOptions: { "start.machine": { client: "notebook" } } });
  });
  await refusal.waitFor();
  await pause(page);
  assert.equal(await page.getByRole("button", { name: "Apply topic" }).count(), 0, "The guide does not open with a refused preset.");
  assert.equal(await page.getByRole("list", { name: "Templates", exact: true }).getByRole("button", { disabled: false }).count(), 0, "No template starts with the default instead.");
  assert.deepEqual(await starts(page), []);
}, "?preset"));

test("a template with a guide asks first in VS Code, like in the web app, and starts with its answer", browserOnly, () => withPanel(async (page) => {
  await page.evaluate(() => window.runStartFixture.command({ type: "newRun", entryId: "start.guided" }));
  await page.getByRole("button", { name: "Apply topic" }).click();
  await page.waitForFunction(() => window.runStartFixture.starts.length === 1);
  const [guided] = await starts(page);
  assert.deepEqual({ entry: guided!.entry, input: guided!.input }, { entry: "start.guided", input: "Night bus" }, "The guide supplies the start value.");
  await page.evaluate((runId) => { window.runStartFixture.views.add(runId); window.runStartFixture.runChanged(runId); }, guided!.runId);
  await page.waitForFunction((runId) => window.runStartFixture.activeRun() === runId, guided!.runId);
  const notifications = await page.evaluate(() => window.runStartFixture.notifications);
  assert.ok(notifications.some((message) => message.type === "runChanged" && message.runId === guided!.runId), "The extension learns the new run.");
}));

test("after its guide a template shows in the start selection that it is starting until the run opens", browserOnly, () => withPanel(async (page) => {
  await page.evaluate(() => {
    window.runStartFixture.holdStart = true;
    window.runStartFixture.command({ type: "newRun", entryId: "start.guided" });
  });
  await page.getByRole("button", { name: "Apply topic" }).click();
  await page.waitForFunction(() => window.runStartFixture.starts.length === 1);
  const templates = page.getByRole("list", { name: "Templates", exact: true });
  const tile = templates.locator('button[data-tile="Round with a guide"]');
  await tile.waitFor();
  assert.equal(await tile.getAttribute("aria-busy"), "true", "The answered template shows that it is starting.");
  assert.equal(await tile.locator('[data-slot="start-action"]').textContent(), "Starting ...");
  assert.equal(await tile.getAttribute("aria-label"), "Set up Round with a guide");
  assert.equal(await templates.getByRole("button", { disabled: false }).count(), 0, "No other template starts meanwhile.");
  const [guided] = await starts(page);
  await page.evaluate((runId) => window.runStartFixture.releaseStart(runId), guided!.runId);
  await page.waitForFunction((runId) => window.runStartFixture.activeRun() === runId, guided!.runId);
}));

test("in the browser a template on Start shows the start progress at once", browserOnly, async () => {
  const url = await (fixtureUrl ??= buildFixture());
  const browser = await launchBrowser();
  try {
    const page = await browser.newPage({ viewport: { width: 1024, height: 820 }, reducedMotion: "reduce" });
    page.setDefaultTimeout(8000);
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(`${url}?host=browser`);
    await page.evaluate(() => { window.runStartFixture.holdStart = true; });
    await page.getByRole("list", { name: "Templates", exact: true }).locator('button[data-tile="Setup template"]').click();
    await page.waitForFunction(() => window.runStartFixture.starts.length === 1);
    const notice = page.locator("[data-startup]");
    assert.equal(await notice.locator("strong").textContent(), "Starting run");
    assert.equal(await notice.locator("p").textContent(), "Starting the template.");
    assert.equal(await notice.locator("[role=progressbar]").count(), 1, "The start shows progress while the server accepts it.");
    await page.evaluate(() => window.runStartFixture.releaseStart());
    await page.waitForFunction(() => window.runStartFixture.activeRun() !== undefined);
    assert.deepEqual(errors, []);
  } finally { await browser.close(); }
});

test("a second template chosen while the first still starts is started and shown, the first one no longer counts", browserOnly, () => withPanel(async (page) => {
  await page.evaluate(() => {
    window.runStartFixture.holdStart = true;
    window.runStartFixture.command({ type: "newRun", entryId: "start.script" });
  });
  await page.waitForFunction(() => window.runStartFixture.starts.length === 1);
  await page.evaluate(() => window.runStartFixture.command({ type: "newRun", entryId: "start.other" }));
  await page.waitForFunction(() => window.runStartFixture.starts.length === 2);
  const [first, second] = await starts(page);
  assert.equal(second!.entry, "start.other");
  assert.equal(await page.getByRole("region", { name: "Run title bar" }).getByRole("heading").textContent(), "Second template");
  await page.evaluate((runId) => window.runStartFixture.releaseStart(runId), first!.runId);
  await pause(page);
  assert.equal(await activeRun(page), undefined, "The superseded launch does not open its run.");
  await page.evaluate((runId) => window.runStartFixture.releaseStart(runId), second!.runId);
  await page.waitForFunction((runId) => window.runStartFixture.activeRun() === runId, second!.runId);
}));

test("a free run chosen while a template still starts stays in the panel", browserOnly, () => withPanel(async (page) => {
  await page.evaluate(() => {
    window.runStartFixture.holdStart = true;
    window.runStartFixture.command({ type: "newRun", entryId: "start.script" });
  });
  await page.waitForFunction(() => window.runStartFixture.starts.length === 1);
  await page.evaluate(() => window.runStartFixture.command({ type: "newRun" }));
  await page.waitForFunction(() => window.runStartFixture.activeRun() !== undefined);
  const free = await activeRun(page);
  await page.evaluate(() => window.runStartFixture.releaseStart());
  await pause(page);
  assert.equal(await activeRun(page), free, "A launch that finishes later does not pull the panel away.");
}));

test("the run script button lists the run scripts of the open run as start items and starts one inside it", browserOnly, () => withPanel(async (page) => {
  await page.evaluate(() => { window.runStartFixture.views.add("existing"); window.runStartFixture.command({ type: "selectRun", runId: "existing" }); });
  await page.waitForFunction(() => window.runStartFixture.activeRun() === "existing");
  const button = page.getByRole("button", { name: "Run script", exact: true });
  const list = page.getByRole("list", { name: "Run scripts" });
  const script = (title: string) => list.getByRole("button").filter({ has: page.getByText(title, { exact: true }) });
  await button.click();
  await script("Review").waitFor();
  assert.deepEqual(await list.getByRole("button").evaluateAll((tiles) => tiles.map((tile) => tile.getAttribute("data-tile"))), ["Review", "Strict review", "Setup template"],
    "Available scripts come first, unavailable ones after them, each in their listed order.");
  const dialog = page.getByRole("dialog", { name: "Run script", exact: true });
  await dialog.evaluate((element) => Promise.all(element.getAnimations().map((animation) => animation.finished)));
  const frame = await page.locator("header").filter({ has: button }).boundingBox();
  const panel = await dialog.boundingBox();
  assert.ok(frame && panel);
  assert.ok(Math.abs(panel.x + panel.width - (frame.x + frame.width - 8)) < 1, "The pop-out ends at the frame's right edge minus the gutter.");
  assert.ok(Math.abs(panel.width - Math.min(800, frame.width - 16)) < 1, "The pop-out uses the available width up to 800 pixels.");
  const [first, second] = await Promise.all([script("Review").boundingBox(), script("Strict review").boundingBox()]);
  assert.ok(first && second && Math.abs(first.y - second.y) < 1 && second.x > first.x, "A pop-out wider than 480 pixels shows two columns.");
  assert.equal(await script("Setup template").isDisabled(), true, "A script that only starts a new run cannot be chosen.");
  assert.match(await script("Setup template").textContent() ?? "", /embeddable: true/);
  await page.evaluate(() => { window.runStartFixture.holdStart = true; });
  await script("Review").click();
  await page.waitForFunction(() => window.runStartFixture.scriptStarts.length === 1);
  assert.deepEqual(await page.evaluate(() => window.runStartFixture.scriptStarts), [{ runId: "existing", entry: "start.review", input: null }]);
  assert.equal(await script("Review").getAttribute("aria-busy"), "true", "The clicked script shows that it is starting.");
  assert.equal(await script("Review").locator('[data-slot="start-action"]').textContent(), "Starting ...");
  assert.equal(await script("Review").getAttribute("aria-label"), "Start Review");
  assert.equal(await script("Strict review").isDisabled(), true, "No second script starts meanwhile.");
  await page.evaluate(() => { window.runStartFixture.holdStart = false; window.runStartFixture.releaseStart("start.review"); });
  await list.waitFor({ state: "detached" });

  await button.click();
  await script("Strict review").click();
  await page.getByRole("alert").filter({ hasText: "fixes the start option demo.mode" }).waitFor();
  assert.equal(await list.isVisible(), true, "A refused start keeps the list open with its reason.");
}));

const settleDropdown = (page: Page) => page.evaluate(async () => {
  await Promise.all(document.getAnimations().filter((animation) => animation.effect?.getComputedTiming().iterations !== Infinity)
    .map((animation) => animation.finished.catch(() => undefined)));
});

const dropdownBounds = async (page: Page, panel: Locator, trigger: Locator) => {
  await settleDropdown(page);
  const header = await page.locator("header").filter({ has: trigger }).boundingBox();
  const bounds = await panel.boundingBox();
  assert.ok(header && bounds, "The header and dropdown are visible.");
  assert.ok(Math.abs(bounds.y - header.y - header.height - 8) < 1, "Every dropdown opens below the complete wrapping header.");
  const origin = await trigger.boundingBox();
  assert.ok(origin, "The trigger is visible.");
  if (origin.x + origin.width / 2 < header.x + header.width / 2) assert.ok(Math.abs(bounds.x - header.x - 8) < 1, "A dropdown of a trigger in the left half starts at the header gutter.");
  else assert.ok(Math.abs(bounds.x + bounds.width - header.x - header.width + 8) < 1, "A dropdown of a trigger in the right half ends at the header gutter.");
  const expected = (await panel.getAttribute("aria-label")) === "Share run" ? Math.min(800, header.width - 16) : header.width - 16;
  assert.ok(Math.abs(bounds.width - expected) < 1, "A dropdown spans its header; sharing keeps a readable column.");
  assert.notEqual(await panel.getAttribute("aria-modal"), "true", "Header dropdowns keep the header available.");
  const style = await panel.evaluate((element) => {
    const computed = getComputedStyle(element);
    return { corners: [computed.borderTopLeftRadius, computed.borderTopRightRadius, computed.borderBottomLeftRadius, computed.borderBottomRightRadius],
      padding: [computed.paddingTop, computed.paddingRight, computed.paddingBottom, computed.paddingLeft], overflow: element.scrollWidth > element.clientWidth };
  });
  assert.deepEqual(style.corners, ["0px", "0px", "0px", "0px"], "Header dropdowns have square corners.");
  assert.deepEqual(style.padding, ["8px", "8px", "8px", "8px"], "Header dropdowns share their padding.");
  assert.equal(style.overflow, false, "The panel never clips its content horizontally.");
  const dim = page.locator('[data-slot="popover-backdrop"]:visible');
  assert.equal(await dim.count(), 1, "One shared dimming surface belongs to the open dropdown.");
  assert.notEqual(await dim.evaluate((element) => getComputedStyle(element).backgroundColor), "rgba(0, 0, 0, 0)");
  return bounds;
};

for (const { host, width } of [{ host: "browser", width: 1400 }, { host: "browser", width: 420 }, { host: "vscode", width: 420 }, { host: "vscode", width: 360 }, { host: "vscode", width: 320 }]) {
  test(`run details, scripts, and sharing use the same header dropdown at ${width}px in ${host}`, browserOnly, async () => {
    const url = await (fixtureUrl ??= buildFixture());
    const browser = await launchBrowser();
    try {
      const page = await browser.newPage({ viewport: { width, height: 900 }, reducedMotion: "reduce" });
      page.setDefaultTimeout(8000);
      const errors: string[] = [];
      page.on("pageerror", (error) => errors.push(error.message));
      await page.goto(`${url}?host=${host}&dropdowns`);
      await page.getByRole("list", { name: "Recent", exact: true }).waitFor();
      await page.evaluate(() => {
        window.runStartFixture.views.add("existing");
        window.runStartFixture.command({ type: "selectRun", runId: "existing" });
      });
      await page.waitForFunction(() => window.runStartFixture.activeRun() === "existing");
      await page.evaluate(() => {
        window.runStartFixture.chat({ kind: "status", running: false });
        window.runStartFixture.chat({ kind: "replay-end", conversationId: null });
      });
      const shots = join(tmpdir(), "ragents-browser-shots");
      await mkdir(shots, { recursive: true });
      const shoot = async (name: string) => {
        await settleDropdown(page);
        await page.screenshot({ path: join(shots, `header-${name}-${width}${host === "vscode" ? "-vscode" : ""}.png`) });
      };
      const title = page.getByRole("button", { name: "Existing run", exact: true });
      const details = page.getByRole("dialog", { name: "Run details", exact: true });
      await title.click();
      const texts = await page.evaluate(() => Object.values(window.runStartFixture.metadataTexts));
      for (const text of [...texts, "Careful review", "Contributed details action"]) {
        const cell = details.getByText(text, { exact: true });
        await cell.waitFor();
        assert.equal(await cell.evaluate((element) => element.scrollWidth <= element.clientWidth && element.scrollHeight <= element.clientHeight), true,
          `The whole contribution stays readable: ${text}`);
      }
      const detailBounds = await dropdownBounds(page, details, title);
      const metadataRows = await details.getByText(texts[0]!, { exact: true }).boundingBox();
      const nextMetadata = await details.getByText(texts[1]!, { exact: true }).boundingBox();
      assert.ok(metadataRows && nextMetadata);
      assert.ok(width > 420 ? Math.abs(metadataRows.y - nextMetadata.y) < 1 : nextMetadata.y > metadataRows.y, "Metadata changes from a grid to wrapped cells in a narrow panel.");
      assert.equal(await details.evaluate((element) => element.contains(document.activeElement)), true, "Opening details moves focus into the panel.");
      assert.equal(await title.getAttribute("aria-controls"), await details.getAttribute("id"));
      await shoot("run-details");
      await page.keyboard.press("Escape");
      await details.waitFor({ state: "detached" });
      assert.equal(await title.evaluate((element) => element === document.activeElement), true, "Escape restores title focus.");
      assert.equal(await title.getAttribute("aria-expanded"), "false");
      await title.click();
      await details.waitFor();
      await title.click();
      await details.waitFor({ state: "detached" });

      const scriptButton = page.getByRole("button", { name: "Run script", exact: true });
      const scripts = page.getByRole("dialog", { name: "Run script", exact: true });
      await scriptButton.click();
      await scripts.getByRole("list", { name: "Run scripts" }).waitFor();
      const scriptBounds = await dropdownBounds(page, scripts, scriptButton);
      assert.deepEqual({ y: scriptBounds.y, width: scriptBounds.width }, { y: detailBounds.y, width: detailBounds.width });
      const review = await scripts.locator('button[data-tile="Review"]').boundingBox();
      const strict = await scripts.locator('button[data-tile="Strict review"]').boundingBox();
      assert.ok(review && strict);
      assert.ok(width > 420 ? Math.abs(review.y - strict.y) < 1 : strict.y > review.y, "Script cards use two columns only when they fit.");
      await shoot("run-script");
      await page.keyboard.press("Escape");
      await scripts.waitFor({ state: "detached" });
      assert.equal(await scriptButton.evaluate((element) => element === document.activeElement), true, "Scripts restore trigger focus.");

      const shareButton = page.getByRole("button", { name: "Share", exact: true });
      const share = page.getByRole("dialog", { name: "Share run", exact: true });
      await page.evaluate(() => { window.runStartFixture.holdSharing = true; });
      await shareButton.click();
      await share.getByRole("status").filter({ hasText: "Loading ..." }).waitFor();
      const shareBounds = await dropdownBounds(page, share, shareButton);
      assert.deepEqual({ y: shareBounds.y, width: shareBounds.width }, { y: detailBounds.y, width: Math.min(800, detailBounds.width) });
      await page.evaluate(() => { window.runStartFixture.holdSharing = false; window.runStartFixture.releaseSharing(); });
      await share.getByRole("list", { name: "Shared with", exact: true }).waitFor();
      assert.equal(await share.getByRole("button", { name: /^(Save|Cancel)$/ }).count(), 0, "Access changes need no confirmation.");
      const access = (user: string, value: string) => share.getByRole("group", { name: `Access for ${user}`, exact: true }).getByRole("button", { name: value, exact: true });
      const choose = (user: string, value: string) => access(user, value).click();
      const selected = (user: string, value: string) => access(user, value).and(share.locator('[aria-pressed="true"]')).waitFor();
      assert.deepEqual(await share.getByRole("group", { name: "Access for Everyone", exact: true }).getByRole("button").allTextContents(), ["Off", "View", "Operate"]);
      assert.equal(await access("Everyone", "View").getAttribute("title"), "Sees the run");
      assert.equal(await access("Everyone", "Operate").getAttribute("title"), "Also works in it, within the user's own permissions");
      await page.evaluate(() => { window.runStartFixture.holdSharing = true; });
      await choose("Everyone", "View");
      await share.locator('[aria-busy="true"]').waitFor();
      assert.deepEqual(await page.evaluate(() => window.runStartFixture.shares), [{ everyone: "read", users: [{ userId: "bob", access: "read" }] }], "A choice immediately saves the whole sharing.");
      assert.equal(await share.getByRole("group").getByRole("button", { disabled: false }).count(), 0, "Every row waits for the pending save.");
      await page.evaluate(() => { window.runStartFixture.holdSharing = false; window.runStartFixture.releaseSharing(); });
      await selected("Everyone", "View");
      assert.equal(await share.isVisible(), true, "A successful save keeps sharing open.");
      await choose("Bob", "Operate");
      await selected("Bob", "Operate");
      await page.evaluate(() => { window.runStartFixture.holdSharing = true; window.runStartFixture.sharingError = "Sharing could not be saved."; });
      await choose("Carol", "View");
      await share.locator('[aria-busy="true"]').waitFor();
      assert.equal(await access("Carol", "Off").isDisabled(), true);
      await page.evaluate(() => { window.runStartFixture.holdSharing = false; window.runStartFixture.releaseSharing(); });
      await share.getByRole("alert").filter({ hasText: "Sharing could not be saved." }).waitFor();
      assert.equal(await access("Carol", "Off").getAttribute("aria-pressed"), "true", "A refused choice restores the saved access.");
      assert.equal(await access("Bob", "Operate").getAttribute("aria-pressed"), "true", "A refusal keeps other successful changes.");
      await page.evaluate(() => { window.runStartFixture.sharingError = undefined; });
      await choose("Carol", "View");
      await selected("Carol", "View");
      assert.equal(await share.getByRole("alert").count(), 0, "A successful retry clears the refusal.");
      const first = { everyone: "read", users: [{ userId: "bob", access: "read" }] };
      const second = { everyone: "read", users: [{ userId: "bob", access: "write" }] };
      const third = { everyone: "read", users: [{ userId: "bob", access: "write" }, { userId: "carol", access: "read" }] };
      assert.deepEqual(await page.evaluate(() => window.runStartFixture.shares), [first, second, third, third], "Each choice includes the last successful sharing.");
      const rows = await share.getByRole("list", { name: "Shared with", exact: true }).getByRole("listitem").evaluateAll((items) => items.map((item) => {
        const name = item.querySelector("span")!.getBoundingClientRect();
        const group = item.querySelector('[role="group"]')!;
        const control = group.getBoundingClientRect();
        return { left: Math.round(control.left), sameRow: Math.abs(name.top + name.height / 2 - control.top - control.height / 2) < 1,
          controlRows: new Set([...group.querySelectorAll("button")].map((button) => Math.round(button.getBoundingClientRect().top))).size };
      }));
      assert.equal(new Set(rows.map((row) => row.left)).size, 1, "All access controls share one column.");
      assert.ok(rows.every((row) => row.sameRow && row.controlRows === 1), "Names and complete segmented controls stay on one row.");
      await shoot("share");
      await page.keyboard.press("Escape");
      await share.waitFor({ state: "detached" });
      assert.equal(await shareButton.evaluate((element) => element === document.activeElement), true, "Escape restores the Share button's focus.");

      for (const [trigger, panel] of [[title, details], [scriptButton, scripts], [shareButton, share]]) {
        await trigger!.click();
        await panel!.waitFor();
        await settleDropdown(page);
        await page.mouse.click(2, 898);
        await panel!.waitFor({ state: "detached" });
        assert.equal(await trigger!.evaluate((element) => element === document.activeElement), true, "Outside closing restores the same trigger.");
      }
      assert.deepEqual(await page.evaluate(() => window.runStartFixture.shares), [first, second, third, third], "Dismissals send no further sharing changes.");
      await shareButton.click();
      await access("Bob", "Operate").waitFor();
      await page.evaluate(() => { window.runStartFixture.holdSharing = true; });
      await choose("Bob", "Off");
      await share.locator('[aria-busy="true"]').waitFor();
      await page.keyboard.press("Escape");
      await share.waitFor({ state: "detached" });
      await page.evaluate(() => { window.runStartFixture.holdSharing = false; window.runStartFixture.releaseSharing(); });
      await page.waitForFunction(() => window.runStartFixture.sharing.sharing.users.every((user) => user.userId !== "bob"));
      assert.equal(await share.count(), 0, "Finishing a pending save cannot reopen a dismissed dropdown.");
      await title.click();
      await details.waitFor();
      await scriptButton.click();
      await details.waitFor({ state: "detached" });
      await scripts.waitFor();
      await shareButton.click();
      await scripts.waitFor({ state: "detached" });
      await share.waitFor();
      await page.keyboard.press("Escape");
      await share.waitFor({ state: "detached" });
      if (host === "browser" && width === 1400) {
        await page.evaluate(() => { window.runStartFixture.sharingError = "Sharing could not be loaded."; });
        await shareButton.click();
        await share.getByRole("alert").filter({ hasText: "Sharing could not be loaded." }).waitFor();
        assert.equal(await share.getByRole("list", { name: "Shared with", exact: true }).count(), 0);
        assert.equal(await share.getByRole("button", { name: "Cancel", exact: true }).count(), 0);
        await page.keyboard.press("Escape");
        await share.waitFor({ state: "detached" });
        assert.equal(await shareButton.evaluate((element) => element === document.activeElement), true);
        await page.evaluate(() => { window.runStartFixture.sharingError = undefined; });
        await shareButton.click();
        await share.getByRole("button", { name: "Close share run", exact: true }).click();
        await share.waitFor({ state: "detached" });
        assert.equal(await shareButton.evaluate((element) => element === document.activeElement), true);
        await title.click();
        await details.getByRole("button", { name: /Contributed details action/ }).focus();
        await page.keyboard.press("Tab");
        await details.waitFor({ state: "detached" });
        assert.equal(await page.locator("header").getByRole("button", { name: "Chat", exact: true }).evaluate((element) => element === document.activeElement), true,
          "Tabbing out closes the dropdown and preserves focus on the next header control.");
      }
      assert.deepEqual(errors, []);
    } finally { await browser.close(); }
  });
}
