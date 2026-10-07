import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import test from "node:test";
import { build } from "esbuild";
import { chromium, type Locator } from "playwright-core";
import { tailwindPlugin } from "./tailwind-plugin";

const settled = async (popup: Locator) => {
  await popup.waitFor();
  await popup.evaluate(async (element) => {
    for (let attempt = 0; attempt < 10; attempt++) {
      const animations = element.getAnimations().filter((animation) => animation.pending || animation.playState === "running");
      if (animations.length === 0) return;
      await Promise.allSettled(animations.map((animation) => animation.finished));
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    }
    throw new Error("The popup animations did not settle");
  });
};

const assertBounded = async (popup: Locator, title: string) => {
  const geometry = await popup.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    return { x: rect.x, y: rect.y, width: rect.width, height: rect.height, viewportWidth: innerWidth, viewportHeight: innerHeight, availableHeight: parseFloat(style.getPropertyValue("--available-height")), maxHeight: style.maxHeight };
  });
  const detail = JSON.stringify(geometry);
  assert.ok(Number.isFinite(geometry.availableHeight), `Available height is supplied: ${detail}`);
  assert.ok(geometry.height <= Math.min(geometry.viewportHeight * 0.7, 620, geometry.availableHeight) + 1, `The popup uses its height cap: ${detail}`);
  assert.ok(geometry.x >= -1 && geometry.x + geometry.width <= geometry.viewportWidth + 1, `The popup fits horizontally: ${detail}`);
  assert.ok(geometry.y >= -1 && geometry.y + geometry.height <= geometry.viewportHeight + 1, `The popup fits vertically: ${detail}`);
  for (const control of [popup.getByText(title, { exact: true }), popup.getByRole("button", { name: "Close", exact: true })]) {
    const bounds = await control.boundingBox();
    assert.ok(bounds && bounds.y >= geometry.y - 1 && bounds.y + bounds.height <= geometry.y + geometry.height + 1, `The heading and Close stay inside the popup: ${JSON.stringify(bounds)} ${detail}`);
  }
};

const assertScrollable = async (popup: Locator, sentinel: string) => {
  const result = await popup.getByText(sentinel, { exact: false }).evaluate((element, sentinel) => {
    const popup = element.closest('[role="dialog"]')!;
    const body = Array.from(popup.children).find((child) => /auto|scroll/.test(getComputedStyle(child).overflowY)) as HTMLElement | undefined;
    if (!body) return null;
    const header = popup.firstElementChild!.getBoundingClientRect();
    body.scrollTop = body.scrollHeight;
    const rect = body.getBoundingClientRect();
    const range = document.createRange();
    const text = element.firstChild!;
    range.setStart(text, text.textContent!.lastIndexOf(sentinel));
    range.setEnd(text, text.textContent!.length);
    const tail = range.getBoundingClientRect();
    const after = popup.firstElementChild!.getBoundingClientRect();
    return { scrollHeight: body.scrollHeight, clientHeight: body.clientHeight, scrollTop: body.scrollTop, bottom: rect.bottom, top: rect.top, tailTop: tail.top, tailBottom: tail.bottom, headerTop: header.top, headerAfter: after.top };
  }, sentinel);
  assert.ok(result, "The popup has an internal scroll area");
  assert.ok(result.scrollHeight > result.clientHeight * 2, `The long content requires internal scrolling: ${JSON.stringify(result)}`);
  assert.ok(result.scrollHeight - result.clientHeight - result.scrollTop <= 1, `The scroll area reaches its end: ${JSON.stringify(result)}`);
  assert.ok(result.tailTop >= result.top - 1 && result.tailBottom <= result.bottom + 1, `The final text is visible: ${JSON.stringify(result)}`);
  assert.equal(result.headerAfter, result.headerTop, "The header stays fixed while the body scrolls");
};

test("long thinking and tool popovers stay visible and scroll in both chat hosts", { skip: process.env.RAGENTS_BROWSER_TESTS !== "1", timeout: 120_000 }, async (context) => {
  const directory = await mkdtemp(join(tmpdir(), "ragents-thinking-popover-"));
  context.after(() => rm(directory, { recursive: true, force: true }));
  const root = fileURLToPath(new URL("../../../", import.meta.url));
  await build({ entryPoints: [fileURLToPath(new URL("thinking-popover-fixture.tsx", import.meta.url))], bundle: true, platform: "browser", format: "iife", jsx: "automatic", outfile: join(directory, "fixture.js"), define: { "process.env.NODE_ENV": '"production"' }, plugins: [tailwindPlugin([`${root}apps/web/src`, `${root}apps/web/tests/thinking-popover-fixture.tsx`])], logLevel: "silent" });
  await writeFile(join(directory, "index.html"), '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="fixture.css"></head><body><div id="root"></div><script src="fixture.js"></script></body></html>');
  const browser = await chromium.launch({ headless: true, executablePath: process.env.BROWSER_EXECUTABLE_PATH ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" });
  context.after(() => browser.close());
  const shots = join(tmpdir(), "ragents-browser-shots");
  await mkdir(shots, { recursive: true });
  const fixture = pathToFileURL(join(directory, "index.html")).href;

  for (const host of ["quassel", "ragents"]) for (const mode of ["chips", "compact"]) for (const viewport of [{ width: 1100, height: 800 }, { width: 360, height: 600 }, { width: 900, height: 300 }]) {
    await context.test(`${host}, ${mode}, ${viewport.width}x${viewport.height}`, async (context) => {
      const page = await browser.newPage({ viewport });
      context.after(() => page.close());
      const errors: string[] = [];
      page.on("pageerror", (error) => errors.push(error.message));
      await page.goto(`${fixture}?host=${host}&mode=${mode}`);
      for (const step of [{ trigger: "Thinking", title: "Thinking trace", sentinel: "End of thinking trace." }, { trigger: mode === "chips" ? "read" : "Read project notes", title: "Tool call", sentinel: "End of tool result." }]) {
        const trigger = page.getByRole("region", { name: "Chat history" }).getByRole("button", { name: step.trigger, exact: mode === "chips" });
        await trigger.click();
        const popup = page.getByRole("dialog", { name: step.title, exact: true });
        await settled(popup);
        await assertBounded(popup, step.title);
        await page.screenshot({ path: join(shots, `thinking-popover-${host}-${mode}-${viewport.width}-${step.title === "Tool call" ? "tool" : "thinking"}.png`) });
        await assertScrollable(popup, step.sentinel);
        await assertBounded(popup, step.title);
        await popup.getByRole("button", { name: "Close", exact: true }).click();
        await popup.waitFor({ state: "hidden" });
        await trigger.click();
        await settled(popup);
        await page.keyboard.press("Escape");
        await popup.waitFor({ state: "hidden" });
        assert.equal(await trigger.evaluate((element) => element === document.activeElement), true, "Escape restores focus to the step");
      }
      assert.deepEqual(errors, []);
    });
  }

  for (const host of ["quassel", "ragents"]) {
    await context.test(`${host}, resizing an open thinking popup`, async (context) => {
      const page = await browser.newPage({ viewport: { width: 1100, height: 800 } });
      context.after(() => page.close());
      await page.goto(`${fixture}?host=${host}&mode=chips`);
      const trigger = page.getByRole("button", { name: "Thinking", exact: true });
      await trigger.click();
      const popup = page.getByRole("dialog", { name: "Thinking trace", exact: true });
      await settled(popup);
      for (const viewport of [{ width: 900, height: 300 }, { width: 360, height: 600 }, { width: 1100, height: 800 }]) {
        await page.setViewportSize(viewport);
        await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
        await settled(popup);
        await page.screenshot({ path: join(shots, `thinking-popover-${host}-resized-${viewport.width}.png`) });
        await assertBounded(popup, "Thinking trace");
        await assertScrollable(popup, "End of thinking trace.");
      }
      await popup.getByRole("button", { name: "Close", exact: true }).click();
      await popup.waitFor({ state: "hidden" });
    });
  }
});
