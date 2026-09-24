import assert from "node:assert/strict";
import test from "node:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { chromium, type Locator, type Page } from "playwright-core";
import { tailwindPlugin } from "./tailwind-plugin";
import type {} from "./chat-view-switches-fixture";

const activationOverride = "export const usePluginActivation = () => window.chatViewFixture.activation;";

const buildFixture = async (directory: string): Promise<string> => {
  const root = fileURLToPath(new URL("../../../", import.meta.url));
  const source = `${root}apps/web/src`;
  await build({
    entryPoints: [fileURLToPath(new URL("chat-view-switches-fixture.tsx", import.meta.url))],
    bundle: true, platform: "browser", format: "iife", jsx: "automatic", outfile: `${directory}/fixture.js`,
    define: { "process.env.NODE_ENV": '"production"' },
    plugins: [
      { name: "chat-view-services", setup(builder) {
        builder.onLoad({ filter: /\/src\/PluginActivation\.ts$/ }, () => ({ contents: activationOverride, loader: "js", resolveDir: source }));
        builder.onLoad({ filter: /\/src\/rpc\.ts$/ }, () => ({ contents: "export const rpc = { call: (...args) => window.chatViewFixture.call(...args), subscribe: (...args) => window.chatViewFixture.subscribe(...args) };" }));
      } },
      tailwindPlugin([source, `${root}plugins/ragents.orchestration/web`, `${root}plugins/ragents.overseer/web`]),
    ], logLevel: "silent",
  });
  await writeFile(`${directory}/index.html`, '<!doctype html><html><head><link rel="stylesheet" href="fixture.css"><style>html,body{height:100%;margin:0}#root{height:100%}</style></head><body><div id="root"></div><script src="fixture.js"></script></body></html>');
  return `file://${directory}/index.html`;
};

const hideLabel = "Zeitstempel ausblenden";
const showLabel = "Zeitstempel anzeigen";

/** Der Schalter steht in der Eingabe des Chats und wirkt nur auf dessen Nachrichtenliste. */
const expectSwitch = async (chat: Locator, messages: Locator = chat) => {
  await chat.getByRole("button", { name: hideLabel, exact: true }).waitFor();
  await messages.locator("time").first().waitFor();
  await chat.getByRole("button", { name: hideLabel, exact: true }).click();
  await chat.getByRole("button", { name: showLabel, exact: true }).waitFor();
  assert.equal(await messages.locator("time").count(), 0);
  await chat.getByRole("button", { name: showLabel, exact: true }).click();
  await messages.locator("time").first().waitFor();
};

const openPage = async (url: string, errors: string[], viewport = { width: 1100, height: 1400 }): Promise<Page> => {
  const browser = await chromium.launch({ headless: true, executablePath: process.env.BROWSER_EXECUTABLE_PATH });
  const page = await browser.newPage({ viewport, reducedMotion: "reduce" });
  page.on("close", () => void browser.close());
  page.setDefaultTimeout(8000);
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(url);
  return page;
};

test("every chat shows the timestamp switch and it toggles only its own message list", {
  skip: process.env.RAGENTS_BROWSER_TESTS !== "1", timeout: 120_000,
}, async (context) => {
  await mkdir("/private/tmp/ragents-chat-view-switches", { recursive: true });
  const directory = await mkdtemp("/private/tmp/ragents-chat-view-switches/browser-");
  context.after(() => rm(directory, { recursive: true, force: true }));
  const url = await buildFixture(directory);
  const screenshots = process.env.RAGENTS_SCREENSHOT_DIR;
  const errors: string[] = [];

  const panel = await openPage(url, errors, { width: 520, height: 760 });
  context.after(() => panel.close());
  const chat = (event: unknown) => panel.evaluate((payload) => window.chatViewFixture.chat("demo", payload), event);
  await panel.locator("[data-chat=composer]").waitFor();
  await chat({ kind: "status", running: false });
  await chat({ kind: "user", text: "Bitte prüfe den Stand.", at: "2026-09-25T09:05:00.000Z" });
  await chat({ kind: "text", delta: "Der Stand ist geprüft.", at: "2026-09-25T09:06:00.000Z", cursor: { conversationId: "demo-conversation", sequence: 1, offset: 0 } });
  await chat({ kind: "turn-done" });
  await chat({ kind: "replay-end", conversationId: null });
  const main = panel.locator("body");
  await expectSwitch(main);
  if (screenshots) await panel.screenshot({ path: `${screenshots}/main-chat.png` });
  await panel.locator("button[title^=\"Adressat: @coordinator\"]").click();
  await panel.getByRole("dialog", { name: "Adressat" }).getByText("@reviewer").click();
  await panel.getByPlaceholder("Nachricht an @reviewer ...").waitFor();
  await expectSwitch(main);
  if (screenshots) await panel.screenshot({ path: `${screenshots}/actor-chat-run-panel.png` });

  const parts = await openPage(`${url}?mode=parts`, errors);
  context.after(() => parts.close());
  const region = (name: string) => parts.getByRole("region", { name, exact: true });
  for (const name of ["tile", "stopped", "program", "human", "hidden-composer"]) await expectSwitch(region(name));
  await region("tile").getByRole("button", { name: hideLabel, exact: true }).click();
  await region("tile-readonly").getByRole("button", { name: showLabel, exact: true }).waitFor();
  assert.equal(await region("stopped").locator("time").count(), 2, "another actor keeps its own choice");
  await region("tile-readonly").getByRole("button", { name: showLabel, exact: true }).click();
  await region("tile").locator("time").first().waitFor();

  const preparation = region("preparation");
  await preparation.getByRole("button", { name: "Auftrag besprechen", exact: true }).click();
  await preparation.getByText("Gut, der Auftrag ist klar.").waitFor();
  await expectSwitch(preparation);

  const overseer = parts.getByRole("region", { name: "Globaler Koordinator", exact: true });
  await overseer.waitFor();
  await parts.evaluate(() => {
    window.chatViewFixture.chat("global", { kind: "user", text: "Welche Runs laufen?", at: "2026-09-25T09:10:00.000Z" });
    window.chatViewFixture.chat("global", { kind: "replay-end", conversationId: null });
  });
  await expectSwitch(overseer);
  if (screenshots) await parts.screenshot({ path: `${screenshots}/other-chats.png`, fullPage: true });
  assert.deepEqual(errors, []);
});
