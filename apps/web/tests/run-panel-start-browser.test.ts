import assert from "node:assert/strict";
import test from "node:test";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
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

/** Baut die Fixture einmal und liefert die Adresse ihrer Seite. */
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

test("the run panel shows one loading state from the click to the first content and never a run list in VS Code", {
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
    const listSeen = () => page.evaluate(() => window.runStartFixture.listSeen);

    await page.goto(`${url}?profile=pending`);
    await notice.waitFor();
    assert.equal(await titleOf(), "Produktprofil wird geladen");
    assert.equal(await notice.getAttribute("data-startup"), "working");
    assert.equal(await notice.locator("[role=progressbar]").count(), 1, "Loading the profile shows the same progress as the run.");
    await page.evaluate(() => window.runStartFixture.activate());
    await waitForTitle("Run wird gestartet");
    assert.equal(await detailOf(), "Der neue Run wird angelegt.");
    assert.ok((await page.evaluate(() => window.runStartFixture.notifications)).some((message) => message.type === "ready"));
    const waiting = await center(notice);

    await page.evaluate(() => {
      window.runStartFixture.holdStart = true;
      window.runStartFixture.command({ type: "selectRun", runId: null });
      window.runStartFixture.command({ type: "newRun", entryId: "start.script" });
    });
    await page.waitForFunction(() => window.runStartFixture.calls.includes("ragents.chat.start"));
    assert.equal(await titleOf(), "Run wird gestartet");
    assert.equal(await detailOf(), "Die Vorlage wird gestartet.");
    assert.equal(await page.locator("header strong").textContent(), "Aufbau-Vorlage");
    const launching = await center(notice);
    assert.ok(Math.abs(launching.x - waiting.x) < 1 && Math.abs(launching.y - waiting.y) < 1, "Waiting for the host and launching share one place.");

    await page.evaluate(() => window.runStartFixture.releaseStart());
    await page.waitForFunction(() => window.runStartFixture.activeRun() !== undefined);
    await waitForTitle("Run wird geladen");
    const loading = await center(notice);
    assert.ok(Math.abs(loading.x - launching.x) < 1 && Math.abs(loading.y - launching.y) < 1, "The run view continues the loading state at the same place.");
    assert.equal(await page.locator("textarea").count(), 1, "The chat input stays below the loading state.");

    await chat({ kind: "status", running: false, startup: { status: "preparing", message: "Arbeitsverzeichnis wird vorbereitet." } });
    await chat({ kind: "replay-end", conversationId: null });
    await waitForTitle("Run wird vorbereitet");
    assert.equal(await detailOf(), "Arbeitsverzeichnis wird vorbereitet.");
    await chat({ kind: "system", text: "Arbeitsbereich: /home/user/project" });
    await settle();
    assert.equal(await titleOf(), "Run wird vorbereitet", "A system line does not end the setup.");
    await page.locator("textarea").fill("Schon mal notiert");
    assert.equal(await page.locator("textarea").inputValue(), "Schon mal notiert", "The chat input stays usable while the run is set up.");

    await chat({ kind: "status", running: true });
    await waitForTitle("Der Run wird eingerichtet");
    await chat({ kind: "status", running: false });
    await settle();
    assert.equal(await titleOf(), "Der Run wird eingerichtet", "A gap before the run view catches up does not flicker.");
    await page.waitForFunction(() => document.querySelector("[data-startup]") === null, undefined, { timeout: STARTUP_SETTLE_MS + 1000 });
    await chat({ kind: "status", running: true });
    await waitForTitle("Der Run wird eingerichtet");

    await page.evaluate(() => { window.runStartFixture.elements = [{ id: "start.app--main", title: "Aufbau" }]; });
    await chat({ kind: "extension", pluginId: "start", type: "app-ready" });
    await page.getByText("Mini-App bereit").waitFor();
    assert.equal(await notice.count(), 0, "The first mini-app ends the loading state.");
    await page.evaluate(() => { window.runStartFixture.elements = []; });
    await chat({ kind: "status", running: true });
    await settle();
    assert.equal(await notice.count(), 0, "Once content was shown, later work brings no loading state back.");
    assert.equal(await listSeen(), false, "VS Code never renders the run list, not even for a moment.");

    await page.goto(url);
    await waitForTitle("Run wird gestartet");
    await page.evaluate(() => window.runStartFixture.command({ type: "newRun" }));
    await page.waitForFunction(() => window.runStartFixture.activeRun() !== undefined);
    await waitForTitle("Run wird geladen");
    assert.equal(await page.locator("header strong").first().textContent(), "Neuer Run");
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
    await waitForTitle("Run wird geladen");
    await chat({ kind: "status", running: false, startup: { status: "failed", message: "Das Paket fehlt." } });
    await chat({ kind: "replay-end", conversationId: null });
    await waitForTitle("Der Run konnte nicht vorbereitet werden");
    assert.equal(await notice.getAttribute("role"), "alert");
    assert.equal(await detailOf(), "Das Paket fehlt.", "A failed setup shows its reason at the same place.");

    await page.evaluate(() => {
      window.runStartFixture.command({ type: "selectRun", runId: null });
      window.runStartFixture.command({ type: "newRun", entryId: "start.script" });
    });
    await waitForTitle("Run wird geladen");
    await chat({ kind: "status", running: false, startup: { status: "preparing", message: "Run wird vorbereitet." } });
    await chat({ kind: "replay-end", conversationId: null });
    await waitForTitle("Run wird vorbereitet");
    await chat({ kind: "user", text: "Bitte loslegen" });
    await page.waitForFunction(() => document.querySelector("[data-startup]") === null);
    assert.equal(await listSeen(), false);

    await page.goto(`${url}?rights=runs.read`);
    await waitForTitle("Run wird gestartet");
    await page.evaluate(() => window.runStartFixture.command({ type: "newRun", entryId: "start.script" }));
    await waitForTitle("Kein neuer Run möglich");
    assert.equal(await detailOf(), "Neue Runs sind für dieses Benutzerkonto nicht freigegeben.");
    await page.getByRole("button", { name: "Zur Start-Seite", exact: true }).last().click();
    assert.ok((await page.evaluate(() => window.runStartFixture.notifications)).some((message) => message.type === "showStart"), "The refusal leads back to Start.");

    await page.goto(`${url}?rights=runs.read,runs.write`);
    await waitForTitle("Run wird gestartet");
    await page.evaluate(() => window.runStartFixture.command({ type: "newRun" }));
    await waitForTitle("Kein neuer Run möglich");
    assert.equal(await detailOf(), "Freie Runs sind für dieses Benutzerkonto nicht freigegeben.");
    await page.evaluate(() => window.runStartFixture.command({ type: "newRun", entryId: "start.script" }));
    await page.waitForFunction(() => window.runStartFixture.calls.includes("ragents.chat.start"));
    await page.waitForFunction(() => window.runStartFixture.activeRun() !== undefined);
    assert.equal(await listSeen(), false);

    await page.clock.install();
    await page.goto(url);
    await waitForTitle("Run wird gestartet");
    await page.clock.fastForward(5100);
    await waitForTitle("Kein Run gewählt");
    assert.equal(await notice.locator("[role=progressbar]").count(), 0, "Without a start request the panel does not spin forever.");
    await page.getByRole("button", { name: "Zur Start-Seite", exact: true }).last().click();
    assert.ok((await page.evaluate(() => window.runStartFixture.notifications)).some((message) => message.type === "showStart"));
    assert.equal(await listSeen(), false);

    await page.goto(`${url}?host=browser`);
    await page.getByText("Vorhandener Run").waitFor();
    assert.equal(await notice.count(), 0, "The browser keeps its run list without a run.");
    assert.deepEqual(errors, []);
  } finally { await browser.close(); }
});

/** Eine Seite der Fixture in VS Code, bereit für Befehle der Erweiterung. */
const withPanel = async (run: (page: Page) => Promise<void>) => {
  const url = await (fixtureUrl ??= buildFixture());
  const browser = await launchBrowser();
  try {
    const page = await browser.newPage({ viewport: { width: 520, height: 820 }, reducedMotion: "reduce" });
    page.setDefaultTimeout(8000);
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(url);
    await page.waitForFunction(() => window.runStartFixture.notifications.some((message) => message.type === "ready"));
    await run(page);
    assert.deepEqual(errors, []);
  } finally { await browser.close(); }
};
const starts = (page: Page) => page.evaluate(() => window.runStartFixture.starts);
const activeRun = (page: Page) => page.evaluate(() => window.runStartFixture.activeRun());
const pause = (page: Page) => page.evaluate(() => new Promise<void>((resolve) => setTimeout(resolve, 300)));
const browserOnly = { skip: process.env.RAGENTS_BROWSER_TESTS !== "1", timeout: 90_000 };

test("a template with a guide asks first in VS Code, like in the web app, and starts with its answer", browserOnly, () => withPanel(async (page) => {
  await page.evaluate(() => window.runStartFixture.command({ type: "newRun", entryId: "start.guided" }));
  await page.getByRole("button", { name: "Thema übernehmen" }).click();
  await page.waitForFunction(() => window.runStartFixture.starts.length === 1);
  const [guided] = await starts(page);
  assert.deepEqual({ entry: guided!.entry, input: guided!.input }, { entry: "start.guided", input: "Nachtbus" }, "The guide supplies the start value.");
  await page.evaluate((runId) => { window.runStartFixture.views.add(runId); window.runStartFixture.runChanged(runId); }, guided!.runId);
  await page.waitForFunction((runId) => window.runStartFixture.activeRun() === runId, guided!.runId);
  const notifications = await page.evaluate(() => window.runStartFixture.notifications);
  assert.ok(notifications.some((message) => message.type === "runChanged" && message.runId === guided!.runId), "The extension learns the new run.");
}));

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
  assert.equal(await page.locator("header strong").textContent(), "Zweite Vorlage");
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
