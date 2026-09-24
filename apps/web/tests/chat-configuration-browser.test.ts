import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { chromium } from "playwright-core";
import { tailwindPlugin } from "./tailwind-plugin";
import type {} from "./chat-configuration-fixture";

test("chat settings control keyboard sending, successful-send scrolling and action errors", {
  skip: process.env.RAGENTS_BROWSER_TESTS !== "1", timeout: 60_000,
}, async () => {
  const scratch = "/private/tmp/ragents-chat-settings";
  await mkdir(scratch, { recursive: true });
  const directory = await mkdtemp(`${scratch}/browser-`);
  const root = fileURLToPath(new URL("../../../", import.meta.url));
  await build({
    entryPoints: [fileURLToPath(new URL("chat-configuration-fixture.tsx", import.meta.url))],
    bundle: true, platform: "browser", format: "iife", outfile: `${directory}/app.js`,
    plugins: [tailwindPlugin([`${root}apps/web/src/chat`])], logLevel: "silent",
  });
  await writeFile(`${directory}/index.html`, '<!doctype html><html><head><link rel="stylesheet" href="app.css"><style>#app{width:640px;height:600px;display:flex;flex-direction:column}#app>[data-chat=panel]{height:100%;width:100%}</style></head><body><div id="app"></div><script src="app.js"></script></body></html>');
  const browser = await chromium.launch({
    headless: true,
    executablePath: process.env.BROWSER_EXECUTABLE_PATH ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  });
  try {
    const page = await browser.newPage({ viewport: { width: 900, height: 800 } });
    const pageErrors: string[] = [];
    page.on("pageerror", (error) => pageErrors.push(error.message));
    await page.goto(`file://${directory}/index.html`);
    const input = page.locator("textarea");
    const history = page.locator("[aria-label=Chatverlauf]");
    const bottom = () => page.waitForFunction(() => {
      const element = document.querySelector<HTMLElement>("[aria-label=Chatverlauf]")!;
      return element.scrollHeight - element.clientHeight - element.scrollTop < 2;
    });
    const pause = async () => {
      await history.hover();
      await page.mouse.wheel(0, -500);
      await page.waitForFunction(() => !!document.querySelector("[aria-label='Zum Ende springen']"));
    };
    await bottom();
    await input.fill("Eingabe mit IME");
    await input.evaluate((element) => {
      element.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, isComposing: true }));
      element.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, keyCode: 229 }));
      element.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, repeat: true }));
    });
    assert.equal(await page.evaluate(() => window.chatFixture.sent.length), 0);
    await input.fill("Mit Zeilenumbruch");
    await input.press("Shift+Enter");
    assert.equal(await page.evaluate(() => window.chatFixture.sent.length), 0);
    assert.match(await input.inputValue(), /\n/);
    await input.press("Enter");
    await page.waitForFunction(() => window.chatFixture.sent.length === 1);

    await page.evaluate(() => { window.chatFixture.sendShortcut = "mod-enter"; window.chatFixture.update(); });
    await input.fill("Mit Modifikatortaste");
    await input.press("Enter");
    assert.equal(await page.evaluate(() => window.chatFixture.sent.length), 1);
    assert.match(await input.inputValue(), /\n/);
    await input.press("Control+Enter");
    await page.waitForFunction(() => window.chatFixture.sent.length === 2);
    await input.fill("Mit Command");
    await input.press("Meta+Enter");
    await page.waitForFunction(() => window.chatFixture.sent.length === 3);
    await bottom();

    await pause();
    const preservedPosition = await history.evaluate((element) => element.scrollTop);
    await input.fill("Leseposition behalten");
    await input.press("Control+Enter");
    await page.waitForFunction(() => window.chatFixture.sent.length === 4);
    assert.ok(Math.abs(await history.evaluate((element) => element.scrollTop) - preservedPosition) < 2);

    await page.evaluate(() => { window.chatFixture.scrollOnSend = true; window.chatFixture.rejectSend = true; window.chatFixture.update(); });
    await input.fill("Fehlgeschlagenes Senden");
    await input.press("Control+Enter");
    await page.getByText("Senden fehlgeschlagen", { exact: true }).waitFor();
    assert.equal(await page.evaluate(() => window.chatFixture.sent.length), 4);
    assert.equal(await page.locator("[aria-label='Zum Ende springen']").count(), 1);

    await page.evaluate(() => { window.chatFixture.rejectSend = false; window.chatFixture.update(); });
    await input.fill("Erfolgreiches Senden");
    await input.press("Control+Enter");
    await page.waitForFunction(() => window.chatFixture.sent.length === 5);
    await bottom();

    const action = page.getByRole("button", { name: "Aktion ausführen", exact: true });
    await action.focus();
    await action.press("Enter");
    assert.deepEqual(await page.evaluate(() => window.chatFixture.clicked), ["19"]);
    const failedAction = page.getByRole("button", { name: "Fehler auslösen", exact: true });
    await failedAction.focus();
    await failedAction.press("Enter");
    await page.getByRole("alert").filter({ hasText: "Aktion fehlgeschlagen" }).waitFor();

    await page.evaluate(() => {
      window.chatFixture.holdCompletion = true;
      window.chatFixture.update();
    });
    await pause();
    await input.fill("Späterer Abschluss der alten Eingabe");
    await input.press("Control+Enter");
    await page.waitForFunction(() => !!window.chatFixture.completeSend);
    await page.evaluate(() => {
      window.chatFixture.composerKey += 1;
      window.chatFixture.update();
    });
    await input.fill("Entwurf der neuen Eingabe");
    const replacementPosition = await history.evaluate((element) => element.scrollTop);
    await page.evaluate(async () => {
      window.chatFixture.completeSend!();
      await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
    });
    assert.ok(Math.abs(await history.evaluate((element) => element.scrollTop) - replacementPosition) < 2, "Unmounted composer completion must not scroll its replacement.");
    assert.equal(await input.inputValue(), "Entwurf der neuen Eingabe");
    assert.equal(await page.locator("[aria-label='Zum Ende springen']").count(), 1);
    await page.evaluate(() => { window.chatFixture.holdCompletion = false; });
    await input.press("Control+Enter");
    await page.waitForFunction(() => window.chatFixture.sent.length === 7);
    await bottom();
    assert.deepEqual(pageErrors, []);
    await page.screenshot({ path: `${directory}/configuration.png` });
  } finally {
    await browser.close();
  }
});
