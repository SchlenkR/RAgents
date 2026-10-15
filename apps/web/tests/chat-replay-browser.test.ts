import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import test from "node:test";
import { build } from "esbuild";
import { chromium, type Page } from "playwright-core";
import type { ChatEvent } from "@schlenkr/quassel/events";
import { tailwindPlugin } from "./tailwind-plugin";
import type {} from "./chat-replay-fixture";

const reset: ChatEvent = { kind: "reset", conversationId: "demo" };
const end: ChatEvent = { kind: "replay-end", conversationId: "demo" };
const history: ChatEvent[] = Array.from({ length: 60 }, (_, index) => ({ kind: "user", text: `Task ${index + 1}: Review the sample project and report the findings.`, inputId: `input-${index}` }));
const send = (page: Page, events: ChatEvent[]) => page.evaluate((events) => {
  events.forEach((event) => window.chatReplayFixture.send(event));
  return new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
}, events);

test("chat replay appears atomically and keeps a reader's history and scroll position", {
  skip: process.env.RAGENTS_BROWSER_TESTS !== "1", timeout: 90_000,
}, async (context) => {
  const directory = await mkdtemp(join(tmpdir(), "ragents-chat-replay-"));
  context.after(() => rm(directory, { recursive: true, force: true }));
  const source = fileURLToPath(new URL("../src/", import.meta.url));
  await build({
    entryPoints: [fileURLToPath(new URL("chat-replay-fixture.tsx", import.meta.url))],
    bundle: true, platform: "browser", format: "iife", jsx: "automatic", outfile: join(directory, "fixture.js"),
    define: { "process.env.NODE_ENV": '"production"' },
    plugins: [
      { name: "chat-replay-services", setup(builder) {
        builder.onLoad({ filter: /\/src\/rpc\.ts$/ }, () => ({ contents: "export const rpc = { subscribe: (...args) => window.chatReplayFixture.subscribe(...args) };" }));
      } },
      tailwindPlugin([source, fileURLToPath(new URL("chat-replay-fixture.tsx", import.meta.url))]),
    ], logLevel: "silent",
  });
  await writeFile(join(directory, "index.html"), '<!doctype html><html lang="en"><head><meta charset="utf-8"><link rel="stylesheet" href="fixture.css"></head><body><div id="root"></div><script src="fixture.js"></script></body></html>');
  const browser = await chromium.launch({ headless: true, executablePath: process.env.BROWSER_EXECUTABLE_PATH ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" });
  context.after(() => browser.close());
  const errors: string[] = [];
  const open = async () => {
    const page = await browser.newPage({ viewport: { width: 900, height: 700 } });
    page.setDefaultTimeout(8000);
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(pathToFileURL(join(directory, "index.html")).href);
    await page.getByRole("region", { name: "Chat history" }).waitFor();
    await page.waitForFunction(() => window.chatReplayFixture.renders.length > 0);
    return page;
  };

  await context.test("opening waits for the full replay, including plugin events and status", async () => {
    const page = await open();
    try {
      await send(page, [reset, ...history.slice(0, 2), { kind: "plugin", pluginId: "demo", type: "ready" }, { kind: "status", running: true }]);
      assert.equal(await page.getByRole("region", { name: "Chat history" }).textContent(), "");
      assert.deepEqual(await page.evaluate(() => window.chatReplayFixture.observed), []);
      assert.equal(await page.getByRole("status").count(), 1, "Only the connection output is visible during replay");
      await send(page, [...history.slice(2), { kind: "status", running: false }, end]);
      assert.equal(await page.getByLabel("Connection").textContent(), "Connected");
      assert.ok((await page.getByRole("region", { name: "Chat history" }).textContent())?.includes("Task 60:"));
      const renders = await page.evaluate(() => window.chatReplayFixture.renders);
      assert.ok(renders.every(({ texts }) => texts.length === 0 || texts.length === 60), "No partial history is rendered");
      assert.equal((await page.evaluate(() => window.chatReplayFixture.observed)).length, 65);
    } finally { await page.close(); }
  });

  await context.test("reconnecting never removes the visible history or jumps back to the end", async () => {
    const page = await open();
    try {
      await send(page, [reset, ...history, end]);
      const transcript = page.getByRole("region", { name: "Chat history" });
      await page.waitForFunction(() => {
        const element = document.querySelector("[data-quassel-transcript]")!;
        return element.scrollHeight - element.clientHeight - element.scrollTop <= 1;
      });
      await transcript.hover();
      await page.mouse.wheel(0, -10000);
      await page.waitForFunction(() => document.querySelector("[data-quassel-transcript]")?.scrollTop === 0);
      const before = await transcript.evaluate((element) => ({ text: element.textContent, top: element.scrollTop }));
      assert.equal(before.top, 0);
      await page.evaluate(() => window.chatReplayFixture.disconnect());
      await send(page, [reset]);
      assert.deepEqual(await transcript.evaluate((element) => ({ text: element.textContent, top: element.scrollTop })), before);
      await send(page, history.slice(0, 10));
      assert.deepEqual(await transcript.evaluate((element) => ({ text: element.textContent, top: element.scrollTop })), before);
      await send(page, [...history.slice(10), { kind: "user", text: "A new task received while disconnected." }, end]);
      assert.equal(await transcript.evaluate((element) => element.scrollTop), before.top);
      assert.equal(await page.getByLabel("Connection").textContent(), "Connected");
      await send(page, [{ kind: "user", text: "A live task after reconnect." }]);
      assert.ok((await transcript.textContent())?.includes("A live task after reconnect."));
      assert.equal(await transcript.evaluate((element) => element.scrollTop), before.top);
      await page.getByRole("button", { name: "Jump to end", exact: true }).click();
      await send(page, [{ kind: "text", delta: "The live answer", cursor: { conversationId: "demo", sequence: 100, offset: 13 } }]);
      await send(page, [{ kind: "text", delta: " continues.", cursor: { conversationId: "demo", sequence: 100, offset: 23 } }]);
      assert.ok((await transcript.textContent())?.includes("The live answer continues."));
      assert.ok(await transcript.evaluate((element) => element.scrollHeight - element.clientHeight - element.scrollTop <= 1), "Jump to end resumes following streamed replies");
    } finally { await page.close(); }
  });

  await context.test("scrolling up in a short history keeps following later messages", async () => {
    const page = await open();
    try {
      await send(page, [reset, history[0], end]);
      const transcript = page.getByRole("region", { name: "Chat history" });
      await transcript.hover();
      await page.mouse.wheel(0, -100);
      await send(page, history.slice(1));
      assert.ok(await transcript.evaluate((element) => element.scrollTop > 0 && element.scrollHeight - element.clientHeight - element.scrollTop <= 1));
    } finally { await page.close(); }
  });

  await context.test("a queued scroll event cannot resume following after scrolling up", async () => {
    const page = await open();
    try {
      await send(page, [reset, ...history, end]);
      const transcript = page.getByRole("region", { name: "Chat history" });
      const target = await transcript.evaluate((element) => {
        element.dispatchEvent(new WheelEvent("wheel", { bubbles: true, deltaY: -200 }));
        element.dispatchEvent(new Event("scroll"));
        const target = element.scrollTop - 200;
        element.scrollTop = target;
        return target;
      });
      await send(page, [{ kind: "user", text: "A live task while reading earlier messages." }]);
      assert.equal(await transcript.evaluate((element) => element.scrollTop), target);
    } finally { await page.close(); }
  });

  await context.test("an interrupted replay is discarded before retrying", async () => {
    const page = await open();
    try {
      await send(page, [reset, ...history, end]);
      await send(page, [reset, { kind: "user", text: "Incomplete replay" }]);
      await page.evaluate(() => window.chatReplayFixture.disconnect());
      await send(page, [reset, ...history, end]);
      assert.ok(!(await page.getByRole("region", { name: "Chat history" }).textContent())?.includes("Incomplete replay"));
      assert.ok(!(await page.evaluate(() => window.chatReplayFixture.observed)).some((event) => event.kind === "user" && event.text === "Incomplete replay"));
    } finally { await page.close(); }
  });

  await context.test("an explicit conversation reset clears the history immediately", async () => {
    const page = await open();
    try {
      await send(page, [reset, ...history, end]);
      await send(page, [{ kind: "reset", reason: "conversation-reset", conversationId: null }]);
      assert.equal(await page.getByRole("region", { name: "Chat history" }).textContent(), "");
      assert.ok((await page.evaluate(() => window.chatReplayFixture.observed)).some((event) => event.kind === "reset" && event.reason === "conversation-reset"));
      await send(page, [{ kind: "status", running: false }, { kind: "replay-end", conversationId: null }]);
      assert.equal(await page.getByLabel("Connection").textContent(), "Connected");
    } finally { await page.close(); }
  });
  assert.deepEqual(errors, []);
});
