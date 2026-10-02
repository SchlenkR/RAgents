import assert from "node:assert/strict";
import test from "node:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { join } from "node:path";
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

const hideLabel = "Hide timestamps";
const showLabel = "Show timestamps";
const allLabel = "Show intermediate replies";
const latestLabel = "Show latest reply between inputs";

/** The switch sits in the chat input and affects only that chat's message list. */
const expectSwitch = async (chat: Locator, messages: Locator = chat) => {
  await chat.getByRole("button", { name: /^Show (intermediate replies|latest reply between inputs)$/ }).first().waitFor();
  await chat.getByRole("button", { name: hideLabel, exact: true }).waitFor();
  await messages.locator("time").first().waitFor();
  await chat.getByRole("button", { name: hideLabel, exact: true }).click();
  await chat.getByRole("button", { name: showLabel, exact: true }).waitFor();
  assert.equal(await messages.locator("time").count(), 0);
  await chat.getByRole("button", { name: showLabel, exact: true }).click();
  await messages.locator("time").first().waitFor();
};

const openPage = async (url: string, errors: string[], viewport = { width: 1100, height: 1700 }): Promise<Page> => {
  const browser = await chromium.launch({ headless: true, executablePath: process.env.BROWSER_EXECUTABLE_PATH });
  const page = await browser.newPage({ viewport, reducedMotion: "reduce" });
  await page.addInitScript("window.__name = (target) => target;");
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
  await chat({ kind: "user", text: "Please check the status.", at: "2026-09-25T09:05:00.000Z" });
  await chat({ kind: "text", delta: "The status is checked.", at: "2026-09-25T09:06:00.000Z", cursor: { conversationId: "demo-conversation", sequence: 1, offset: 0 } });
  await chat({ kind: "turn-done" });
  await chat({ kind: "replay-end", conversationId: null });
  const main = panel.locator("section[aria-label=Chat] [data-chat=panel]:visible");
  await expectSwitch(main);
  if (screenshots) await panel.screenshot({ path: `${screenshots}/main-chat.png` });
  await panel.locator("button[title^=\"Addressee: @coordinator\"]:visible").click();
  await panel.getByRole("dialog", { name: "Addressee" }).getByText("@reviewer").click();
  await panel.getByPlaceholder("Message to @reviewer ...").waitFor();
  await expectSwitch(main);
  if (screenshots) await panel.screenshot({ path: `${screenshots}/actor-chat-run-panel.png` });

  const parts = await openPage(`${url}?mode=parts`, errors);
  context.after(() => parts.close());
  const region = (name: string) => parts.getByRole("region", { name, exact: true });
  for (const name of ["actor-chat", "stopped", "program", "human", "hidden-composer"]) await expectSwitch(region(name));
  await region("actor-chat").getByRole("button", { name: hideLabel, exact: true }).click();
  await region("actor-readonly").getByRole("button", { name: showLabel, exact: true }).waitFor();
  assert.equal(await region("stopped").locator("time").count(), 2, "another actor keeps its own choice");
  await region("actor-readonly").getByRole("button", { name: showLabel, exact: true }).click();
  await region("actor-chat").locator("time").first().waitFor();

  const preparation = region("preparation");
  await preparation.getByRole("button", { name: "Discuss task", exact: true }).click();
  await preparation.getByText("Good, the task is clear.").waitFor();
  await expectSwitch(preparation);

  await parts.getByRole("button", { name: "Global coordinator", exact: true }).click();
  const overseer = parts.getByRole("region", { name: "Global coordinator", exact: true });
  await overseer.waitFor();
  await parts.evaluate(() => {
    window.chatViewFixture.chat("global", { kind: "user", text: "Which runs are running?", at: "2026-09-25T09:10:00.000Z" });
    window.chatViewFixture.chat("global", { kind: "replay-end", conversationId: null });
  });
  await expectSwitch(overseer);
  await overseer.getByRole("button", { name: allLabel, exact: true }).waitFor();
  assert.equal(await overseer.getByRole("button", { name: allLabel, exact: true }).getAttribute("aria-pressed"), "true", "the global coordinator starts in the latest-reply mode");
  await overseer.getByRole("button", { name: allLabel, exact: true }).click();
  await overseer.getByRole("button", { name: latestLabel, exact: true }).waitFor();
  assert.equal(await main.getByRole("button", { name: latestLabel, exact: true }).getAttribute("aria-pressed"), "false", "ordinary chats keep all replies by default");
  if (screenshots) await parts.screenshot({ path: `${screenshots}/other-chats.png`, fullPage: true });
  assert.deepEqual(errors, []);
});

test("preparation attachments check the selected model before sending", {
  skip: process.env.RAGENTS_BROWSER_TESTS !== "1", timeout: 60_000,
}, async (context) => {
  const directory = await mkdtemp(join(tmpdir(), "ragents-preparation-images-"));
  context.after(() => rm(directory, { recursive: true, force: true }));
  const url = await buildFixture(directory);
  const errors: string[] = [];
  const imagePage = await openPage(`${url}?mode=preparation`, errors, { width: 800, height: 1000 });
  context.after(() => imagePage.close());
  const imageChat = imagePage.getByRole("region", { name: "Discuss task", exact: true });
  const image = { name: "example.png", mimeType: "image/png", buffer: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aD1sAAAAASUVORK5CYII=", "base64") };
  await imageChat.locator('input[type="file"]').setInputFiles(image);
  await imageChat.getByRole("alert").filter({ hasText: "does not support example.png" }).waitFor();
  assert.equal(await imageChat.getByRole("button", { name: "Discuss task", exact: true }).isDisabled(), true);
  await imageChat.getByRole("button", { name: "Remove example.png" }).click();
  await imagePage.evaluate(() => { window.chatViewFixture.modelInput = ["text", "image"]; });
  await imageChat.locator('input[type="file"]').setInputFiles(image);
  await imageChat.getByAltText("example.png").waitFor();
  await imageChat.getByRole("button", { name: "Discuss task", exact: true }).click();
  await imageChat.getByText("Good, the task is clear.").waitFor();
  assert.deepEqual(errors, []);
});

test("chat columns stay centered and bounded while their scrollers fill narrow and ultrawide panels", {
  skip: process.env.RAGENTS_BROWSER_TESTS !== "1", timeout: 120_000,
}, async (context) => {
  const directory = await mkdtemp(join(tmpdir(), "ragents-chat-width-"));
  context.after(() => rm(directory, { recursive: true, force: true }));
  const url = await buildFixture(directory);
  const screenshots = process.env.RAGENTS_SCREENSHOT_DIR ?? join(tmpdir(), "ragents-browser-shots");
  await mkdir(screenshots, { recursive: true });
  const errors: string[] = [];
  const longText = "This message checks that readable text wraps inside the shared chat column. ".repeat(45);
  for (const mode of ["main", "actor-panel", "actor", "preparation"]) {
    const page = await openPage(mode === "main" || mode === "actor-panel" ? url : `${url}?mode=${mode}`, errors, { width: 500, height: 900 });
    try {
      await page.locator("textarea:visible").waitFor();
      if (mode === "main" || mode === "actor-panel") await page.evaluate(({ runId, text }) => {
        window.chatViewFixture.chat(runId, { kind: "status", running: false });
        window.chatViewFixture.chat(runId, { kind: "user", text: "Check the column." });
        window.chatViewFixture.chat(runId, { kind: "text", delta: text, cursor: { conversationId: "width-check", sequence: 1, offset: 0 } });
        window.chatViewFixture.chat(runId, { kind: "turn-done" });
        window.chatViewFixture.chat(runId, { kind: "replay-end", conversationId: null });
      }, { runId: "demo", text: longText });
      if (mode === "preparation") {
        await page.locator("textarea").fill(longText);
        await page.getByRole("button", { name: "Discuss task", exact: true }).click();
      }
      if (mode === "actor-panel") {
        await page.locator('button[title^="Addressee: @coordinator"]:visible').click();
        await page.getByRole("dialog", { name: "Addressee" }).getByText("@reviewer").click();
        await page.getByPlaceholder("Message to @reviewer ...").waitFor();
      }
      const transcript = page.locator("[data-quassel-transcript]:visible");
      await transcript.locator("[data-message]").first().waitFor();
      for (const width of [500, 1000, 1600, 2600]) {
        await page.setViewportSize({ width, height: 900 });
        await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
        const current = await transcript.boundingBox();
        assert.ok(current);
        await page.setViewportSize({ width: width + Math.round(width - current.width), height: 900 });
        await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
        const geometry = await transcript.evaluate((scroller) => {
          const rect = (element: Element) => {
            const box = element.getBoundingClientRect();
            return { x: box.x, width: box.width };
          };
          const column = scroller.firstElementChild!;
          const panel = scroller.closest('[data-chat="panel"]');
          const composer = panel?.querySelector('[data-chat="composer"] > :last-child')
            ?? document.querySelector("textarea")!.closest('[data-quassel]')!.parentElement!;
          const lines = [...scroller.querySelectorAll("p")].flatMap((paragraph) => {
            const range = document.createRange();
            range.selectNodeContents(paragraph);
            return [...range.getClientRects()].map((box) => ({ x: box.x, width: box.width }));
          });
          return { scroller: rect(scroller), column: rect(column), composer: rect(composer),
            dock: panel ? rect(panel.querySelector('[data-chat="actions"]')!.parentElement!) : null,
            padding: parseFloat(getComputedStyle(scroller).getPropertyValue("--qsl-chat-horizontal-padding")) || 24, lines };
        });
        const near = (actual: number, expected: number, label: string) => assert.ok(Math.abs(actual - expected) < 2, `${mode} at ${width}: ${label}: ${actual} vs ${expected}`);
        near(geometry.scroller.width, width, "full-width scroller");
        near(geometry.column.width, Math.min(900, width - 2 * geometry.padding), "column width");
        const center = geometry.scroller.x + geometry.scroller.width / 2;
        for (const [name, box] of Object.entries({ column: geometry.column, composer: geometry.composer, dock: geometry.dock })) {
          if (!box) continue;
          near(box.width, geometry.column.width, `${name} width`);
          near(box.x + box.width / 2, center, `${name} center`);
        }
        assert.ok(geometry.lines.length > 0);
        for (const line of geometry.lines) {
          assert.ok(line.x >= geometry.column.x - 1 && line.x + line.width <= geometry.column.x + geometry.column.width + 1, `${mode}: text stays inside the column`);
        }
        await page.screenshot({ path: join(screenshots, `chat-width-${mode}-${width}.png`) });
      }
    } finally { await page.close(); }
  }
  assert.deepEqual(errors, []);
});
