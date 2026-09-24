import assert from "node:assert/strict";
import test from "node:test";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { chromium, type Page } from "playwright-core";
import { tailwindPlugin } from "./tailwind-plugin";
import type {} from "./start-page-fixture";

/** Baut die Fixture einmal: die Web-App, das Run-Panel und Start der Erweiterung mit denselben Vorlagen und einem verbundenen Arbeitsplatz. */
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
  await page.getByRole("button", { name: "Übersicht öffnen" }).click();
  await page.getByRole("button", { name: "Neuer Run" }).first().click();
  const dialog = page.getByRole("dialog", { name: "Neuer Run" });
  await dialog.getByRole("list", { name: "Vorlagen" }).waitFor();
  await page.waitForFunction(() => !document.querySelector('[role=dialog] ul[aria-label="Vorlagen"] button:disabled'));
  return dialog;
};

/** Leitfaden der Skill-Vorlage durchlaufen und im Vorbereitungschat die angebotenen Rechner lesen. */
const offeredMachines = async (page: Page) => {
  await page.getByRole("button", { name: "Thema übernehmen" }).click();
  await page.getByRole("combobox", { name: "Rechner des Arbeitsbereichs" }).click();
  await page.getByRole("option", { name: "Server" }).waitFor();
  return page.getByRole("option").allTextContents();
};

const calls = (page: Page, id: string) => page.evaluate((method) => window.startPageFixture.calls.filter((call) => call.id === method).map((call) => call.params), id);

test("der Browser bietet für neue Runs nur den Server an, das Run-Panel in VS Code auch den Arbeitsplatz", browserOnly, async () => {
  await withPage("view=web", 1280, async (page) => {
    const dialog = await openStartSelection(page);
    assert.equal(await dialog.locator("textarea").count(), 0, "die Startauswahl hat keine Auftragseingabe");
    assert.equal(await dialog.getByRole("combobox").count(), 0, "und keine Startoptionen");
    await dialog.getByRole("button", { name: /Entscheidung klären/ }).click();
    assert.deepEqual(await offeredMachines(page), ["Server"]);
  });
  await withPage("view=panel&host=browser", 520, async (page) => {
    await page.getByRole("button", { name: "Neuer Run" }).first().click();
    await page.getByRole("button", { name: /Entscheidung klären/ }).click();
    assert.deepEqual(await offeredMachines(page), ["Server"], "auch das Run-Panel im Browser startet nur auf dem Server");
  });
  await withPage("view=panel&host=vscode", 520, async (page) => {
    await page.waitForTimeout(200);
    await page.evaluate(() => window.startPageFixture.command({ type: "newRun", entryId: "demo.decision" }));
    assert.deepEqual(await offeredMachines(page), ["Server", "Arbeitsplatz Notebook"]);
  });
});

test("die Startauswahl im Browser zeigt die Kacheln von Start in VS Code und startet wie dort", browserOnly, async () => {
  await withPage("view=web", 1280, async (page) => {
    let dialog = await openStartSelection(page);
    const tiles = await dialog.getByRole("list", { name: "Vorlagen" }).getByRole("button").evaluateAll((buttons) => buttons.map((button) => button.getAttribute("title")));
    assert.deepEqual(tiles, ["Neuer Chat", "Sammelboard", "Entscheidung klären", "Gesprächsrunde", "Wortspiel"]);
    await dialog.getByRole("button", { name: /Neuer Chat/ }).click();
    await dialog.waitFor({ state: "detached" });
    await page.locator("textarea").waitFor();
    assert.deepEqual(await calls(page, "ragents.chat.send"), [], "Neuer Chat öffnet den leeren Run, sein Auftrag entsteht im Chat");
    assert.deepEqual(await calls(page, "ragents.startOptions.select"), [], "nichts belegt vor, der Run startet auf dem Server");

    dialog = await openStartSelection(page);
    await dialog.getByRole("button", { name: /Gesprächsrunde/ }).click();
    await dialog.waitFor({ state: "detached" });
    const [script] = await calls(page, "ragents.chat.start");
    assert.deepEqual({ entry: script?.entry, input: script?.input }, { entry: "demo.circle", input: null });

    dialog = await openStartSelection(page);
    await dialog.getByRole("button", { name: /Sammelboard/ }).click();
    await dialog.waitFor({ state: "detached" });
    const [skill] = await calls(page, "ragents.chat.send");
    assert.equal(skill?.entry, "demo.board");
    assert.match(String(skill?.text), /Nutze den Skill board[\s\S]*Baue ein Board für Einkäufe\./, "ein Skill startet wie in VS Code mit seinem Auftrag");
  });
});
