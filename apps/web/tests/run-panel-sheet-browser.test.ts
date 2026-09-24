import assert from "node:assert/strict";
import test from "node:test";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { chromium } from "playwright-core";
import { tailwindPlugin } from "./tailwind-plugin";

test("the floating chat sheet keeps its complete composer visible and remembers only the dragged expanded height", {
  skip: process.env.RAGENTS_BROWSER_TESTS !== "1", timeout: 60_000,
}, async () => {
  await mkdir("/private/tmp/ragents-sheet-depth", { recursive: true });
  const directory = await mkdtemp("/private/tmp/ragents-sheet-depth/browser-");
  const root = fileURLToPath(new URL("../../../", import.meta.url));
  await build({
    entryPoints: [fileURLToPath(new URL("run-panel-sheet-fixture.tsx", import.meta.url))],
    bundle: true, platform: "browser", format: "iife", jsx: "automatic", outfile: `${directory}/fixture.js`,
    plugins: [tailwindPlugin([`${root}apps/web/src`, `${root}plugins/ragents.orchestration/web`])], logLevel: "silent",
  });
  await writeFile(`${directory}/index.html`, '<!doctype html><html><head><link rel="stylesheet" href="fixture.css"><style>html,body{height:100%;margin:0}#root{height:calc(100% - 40px);display:flex}#outside{height:40px}</style></head><body><button id="outside">Außerhalb</button><div id="root"></div><script src="fixture.js"></script></body></html>');
  const browser = await chromium.launch({ headless: true, executablePath: process.env.BROWSER_EXECUTABLE_PATH ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" });
  try {
    const page = await browser.newPage({ viewport: { width: 600, height: 850 }, reducedMotion: "reduce" });
    page.setDefaultTimeout(8000);
    const errors: string[] = [];
    page.on("pageerror", (error) => { errors.push(error.message); console.error(error.message); });
    const url = `file://${directory}/index.html`;
    const sheet = page.locator("section[aria-label=Chat]");
    const grip = page.locator('[data-run-panel="sheet-grip"]');
    const input = sheet.locator("textarea");
    const settle = () => page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
    const height = () => sheet.evaluate((element) => element.getBoundingClientRect().height);
    const saved = () => page.evaluate(() => JSON.parse(localStorage.getItem("ragents.orchestration.run-panel:sheet-a") ?? "null")?.sheetExpandedHeight ?? null);
    const collapse = async (automatic = false) => {
      if (!automatic) await page.keyboard.press("Escape");
      await page.locator("#outside").focus();
      await page.mouse.move(1, 1);
      await page.waitForFunction(() => !document.querySelector('section[aria-label="Chat"]')?.hasAttribute("data-expanded"));
      await settle();
    };
    const visibleComposer = async () => {
      const rects = await sheet.evaluate((element) => {
        return {
          sheet: element.getBoundingClientRect().toJSON(), panel: element.querySelector('[data-chat="panel"]')!.getBoundingClientRect().toJSON(),
          composer: element.querySelector('[data-chat="composer"]')!.getBoundingClientRect().toJSON(),
          grip: element.querySelector('[data-run-panel="sheet-grip"]')!.getBoundingClientRect().toJSON(),
          status: element.querySelector(':scope > button:not([data-run-panel="sheet-grip"])')!.getBoundingClientRect().toJSON(),
        };
      });
      assert.ok(rects.composer.top >= rects.panel.top - 0.05, `Composer top must not be clipped by its panel: ${JSON.stringify(rects)}`);
      assert.ok(rects.composer.bottom <= rects.sheet.bottom + 0.05);
      assert.ok(rects.grip.top >= rects.sheet.top);
      assert.ok(rects.status.top >= rects.grip.bottom - 0.05);
      assert.ok(rects.composer.top >= rects.status.bottom - 0.05);
      assert.ok(rects.composer.height > 50);
    };
    const drag = async (delta: number, finish: "up" | "cancel" | "escape" = "up") => {
      const bounds = await grip.boundingBox();
      assert.ok(bounds);
      await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
      await page.mouse.down();
      await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2 - delta, { steps: 6 });
      if (finish === "cancel") await grip.evaluate((element) => element.dispatchEvent(new PointerEvent("pointercancel", { bubbles: true, pointerId: 1 })));
      if (finish === "escape") await page.keyboard.press("Escape");
      await page.mouse.up();
      await settle();
    };

    await page.goto(url);
    await grip.waitFor();
    await collapse();
    await visibleComposer();
    const minimum = await height();
    await drag(130);
    const expanded = await saved();
    assert.ok(Math.abs(expanded - minimum - 130) <= 2);
    assert.equal(await sheet.getAttribute("data-expanded"), "true", "Dragging opens the sheet without the trailing click toggling it.");
    assert.ok(Math.abs(await height() - expanded) <= 2);
    await collapse(true);
    assert.ok(Math.abs(await height() - minimum) <= 2, "The collapsed sheet stays at the composer minimum after a drag.");
    await page.screenshot({ path: `${directory}/collapsed-after-drag.png` });
    await page.reload();
    await grip.waitFor();
    await collapse();
    assert.ok(Math.abs(await height() - minimum) <= 2, "Reload does not apply the saved expanded height to the collapsed sheet.");

    await input.hover();
    await page.waitForFunction(() => document.querySelector('section[aria-label="Chat"]')?.hasAttribute("data-expanded"));
    assert.ok(Math.abs(await height() - expanded) <= 2, "Hover opens to the saved height.");
    await collapse(true);
    assert.ok(Math.abs(await height() - minimum) <= 2);
    await input.focus();
    assert.equal(await sheet.getAttribute("data-expanded"), "true");
    assert.ok(Math.abs(await height() - expanded) <= 2);
    await drag(-40);
    const resized = await saved();
    assert.ok(Math.abs(resized - expanded + 40) <= 2, "Dragging the expanded sheet changes its remembered height.");
    await collapse();
    assert.ok(Math.abs(await height() - minimum) <= 2);

    await drag(70, "cancel");
    assert.equal(await saved(), resized, "Pointer cancellation does not save the preview.");
    assert.equal(await sheet.getAttribute("data-expanded"), null);
    assert.ok(Math.abs(await height() - minimum) <= 2);
    await input.focus();
    await drag(70, "escape");
    assert.equal(await saved(), resized, "Escape restores the previous expanded height and state.");
    assert.equal(await sheet.getAttribute("data-expanded"), "true");
    assert.ok(Math.abs(await height() - resized) <= 2);
    await collapse();
    await drag(-1500);
    assert.equal(await saved(), minimum);
    await collapse();
    await visibleComposer();
    assert.ok(Math.abs(await height() - minimum) <= 2, "Dragging down stops at the fully visible composer.");
    await grip.focus();
    await grip.press("ArrowUp");
    await settle();
    assert.equal(await saved(), minimum + 24, "The keyboard changes the expanded height.");
    assert.equal(await sheet.getAttribute("data-expanded"), "true");
    await grip.press("Home");
    await settle();
    assert.equal(await saved(), minimum);
    await collapse();
    await drag(1500);
    const parentHeight = await sheet.evaluate((element) => element.parentElement!.getBoundingClientRect().height);
    assert.ok(Math.abs(await height() - Math.floor(parentHeight * 0.9)) <= 2, "Dragging up stops at the maximum expanded sheet height.");
    await collapse();
    assert.ok(Math.abs(await height() - minimum) <= 2);

    await page.goto(`${url}?run=sheet-b`);
    await grip.waitFor();
    await collapse();
    assert.ok(Math.abs(await height() - minimum) <= 2, "A different run retains its own default resting height.");
    await page.setViewportSize({ width: 347, height: 850 });
    await page.evaluate(() => {
      const root = document.getElementById("root")!;
      root.style.width = "346.5px";
      root.style.setProperty("--chat-font-size", "13.3px");
    });
    await input.fill("Eine längere Eingabe, die bei schmaler Breite mehrere Zeilen benötigt.\nZweite Zeile\nDritte Zeile\nVierte Zeile");
    await collapse();
    await visibleComposer();
    await page.screenshot({ path: `${directory}/narrow-composer.png` });
    const narrowMinimum = await height();
    await page.emulateMedia({ reducedMotion: "no-preference" });
    await input.hover();
    await page.waitForFunction(() => {
      const sheet = document.querySelector('section[aria-label="Chat"]')!;
      const maximum = Number(document.querySelector('[data-run-panel="sheet-grip"]')!.getAttribute("aria-valuemax"));
      return sheet.hasAttribute("data-expanded") && Math.abs(sheet.getBoundingClientRect().height - maximum) < 1;
    });
    await collapse();
    await page.waitForFunction((expected) => Math.abs(document.querySelector('section[aria-label="Chat"]')!.getBoundingClientRect().height - expected) < 1, narrowMinimum);
    await visibleComposer();
    console.log(`Sheet screenshots: ${directory}`);
    assert.deepEqual(errors, []);
  } finally { await browser.close(); }
});
