import assert from "node:assert/strict";
import test from "node:test";
import { chromium } from "playwright-core";
import { frameHtml } from "../../vscode/src/webview-html";
import { nestedInputFixture } from "./nested-input-fixture";

test("clipboard images reach Quassel through the shell and both nested frame levels", {
  skip: process.env.RAGENTS_BROWSER_TESTS !== "1", timeout: 60_000,
}, async () => {
  const hull = "http://127.0.0.1:47920";
  const server = "http://127.0.0.1:47921";
  const fixture = await nestedInputFixture(server, true);
  const png = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aD1sAAAAASUVORK5CYII=";
  const browser = await chromium.launch({ headless: true, executablePath: process.env.BROWSER_EXECUTABLE_PATH ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" });
  try {
    const context = await browser.newContext();
    await context.route("http://127.0.0.1:*/**", (route) => {
      const url = new URL(route.request().url());
      return route.fulfill({ contentType: url.pathname.endsWith(".js") ? "text/javascript" : "text/html", body: url.origin === hull
        ? frameHtml({ serverUrl: server, query: { host: "vscode" }, nonce: "test", title: "Image input" }) : fixture[url.pathname] ?? "" });
    });
    await context.addInitScript({ content: `(() => {
      if (location.origin !== ${JSON.stringify(hull)}) return;
      window.acquireVsCodeApi = () => ({ postMessage() {} });
      document.execCommand = (command) => {
        if (command !== "paste") throw new Error("Unexpected shell command");
        const clipboardData = new DataTransfer();
        clipboardData.items.add(new File([Uint8Array.from(atob(${JSON.stringify(png)}), c => c.charCodeAt(0))], "clipboard.png", { type: "image/png" }));
        document.activeElement.dispatchEvent(new ClipboardEvent("paste", { clipboardData, bubbles: true, cancelable: true }));
        return true;
      };
    })();` });
    const page = await context.newPage();
    page.setDefaultTimeout(8000);
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(hull);
    const first = page.frameLocator("#frame").frameLocator("iframe");
    for (const level of [first, first.frameLocator("#nested")]) {
      const composer = level.getByRole("region", { name: "Clipboard chat" });
      const input = composer.getByRole("textbox");
      await input.press("Meta+v");
      await composer.getByAltText("clipboard.png").waitFor();
      await composer.getByRole("button", { name: "Remove clipboard.png" }).click();
      assert.equal(await composer.getByAltText("clipboard.png").count(), 0);
      await input.press("Meta+v");
      await composer.getByAltText("clipboard.png").waitFor();
      await input.press("Enter");
      await level.locator("#sent").filter({ hasText: "clipboard.png" }).waitFor();
      assert.deepEqual(JSON.parse(await level.locator("#sent").innerText()), {
        text: "", attachments: [{ name: "clipboard.png", mediaType: "image/png", data: png }],
      });
    }
    assert.deepEqual(errors, []);
  } finally { await browser.close(); }
});

test("managed mini-app frames relay editing and host shortcuts across both nested levels", {
  skip: process.env.RAGENTS_BROWSER_TESTS !== "1", timeout: 60_000,
}, async () => {
  const hull = "http://127.0.0.1:47920";
  const server = "http://127.0.0.1:47921";
  const fixture = await nestedInputFixture(server);
  const browser = await chromium.launch({ headless: true, executablePath: process.env.BROWSER_EXECUTABLE_PATH ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" });
  try {
    const context = await browser.newContext();
    await context.route("http://127.0.0.1:*/**", (route) => {
      const url = new URL(route.request().url());
      return route.fulfill({ contentType: url.pathname.endsWith(".js") ? "text/javascript" : "text/html", body: url.origin === hull
        ? frameHtml({ serverUrl: server, query: { host: "vscode" }, nonce: "test", title: "Nested input" }) : fixture[url.pathname] ?? "" });
    });
    await context.addInitScript({ content: `(() => {
      if (location.origin !== ${JSON.stringify(hull)}) return;
      const state = { keys: [], reads: 0, clipboard: "Dictated sentence." };
      window.inputHarness = state;
      window.acquireVsCodeApi = () => ({ postMessage() {} });
      for (const type of ["keydown", "keyup"]) window.addEventListener(type, key => {
        state.keys.push({ key: key.key, code: key.code, type, meta: key.metaKey, shift: key.shiftKey });
      });
      const original = document.execCommand.bind(document);
      document.execCommand = (command, showUI, value) => {
        if (command !== "paste") return original(command, showUI, value);
        state.reads += 1;
        document.activeElement.value = state.clipboard;
        return true;
      };
    })();` });
    const page = await context.newPage();
    page.setDefaultTimeout(8000);
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(hull);
    const first = page.frameLocator("#frame").frameLocator("iframe");
    const levels = [first, first.frameLocator("#nested")];
    const state = () => page.evaluate(() => (window as unknown as { inputHarness: { keys: { key: string; code: string; type: string; meta: boolean; shift: boolean }[]; reads: number } }).inputHarness);
    for (const level of levels) {
      const editor = level.locator("#editor");
      await editor.fill("before selected after");
      await editor.evaluate((element: HTMLTextAreaElement) => element.setSelectionRange(7, 15));
      const before = await state();
      await editor.press("Meta+v");
      await level.locator("#value").filter({ hasText: "before Dictated sentence. after" }).waitFor();
      assert.equal(await editor.inputValue(), "before Dictated sentence. after");
      assert.equal((await state()).reads, before.reads + 1);
      assert.equal(await page.locator("#frame").evaluate((element) => element === document.activeElement), true, "Clipboard access restores focus to the run panel frame.");
      assert.equal(await editor.evaluate((element) => element === document.activeElement), true, "Paste leaves the nested editor focused.");
      await page.keyboard.press("Meta+z");
      assert.equal(await editor.inputValue(), "before selected after");
      await page.keyboard.press("Meta+Shift+z");
      assert.equal(await editor.inputValue(), "before Dictated sentence. after");
      await editor.evaluate((element: HTMLTextAreaElement) => element.setSelectionRange(element.value.length, element.value.length));
      await page.evaluate(() => { (window as unknown as { inputHarness: { clipboard: string } }).inputHarness.clipboard = ""; });
      const readsBeforeEmpty = (await state()).reads;
      await editor.press("Meta+v");
      await page.waitForFunction((reads) => (window as unknown as { inputHarness: { reads: number } }).inputHarness.reads > reads, readsBeforeEmpty);
      const editorHandle = await editor.elementHandle();
      assert.ok(editorHandle);
      const editorFrame = await editorHandle.ownerFrame();
      assert.ok(editorFrame);
      await editorFrame.waitForFunction((element) => element === document.activeElement, editorHandle);
      await editorHandle.dispose();
      await page.keyboard.type("!");
      assert.equal(await editor.inputValue(), "before Dictated sentence. after!");
      await page.evaluate(() => { (window as unknown as { inputHarness: { clipboard: string } }).inputHarness.clipboard = "Dictated sentence."; });
      const beforeCommands = (await state()).keys.length;
      await editor.press("Meta+Alt+9");
      await editor.press("Meta+k");
      await editor.press("s");
      await editor.press("Meta+Shift+p");
      await page.waitForFunction((count) => (window as unknown as { inputHarness: { keys: { code: string; type: string }[] } }).inputHarness.keys.slice(count).some((key) => key.code === "KeyP" && key.type === "keyup"), beforeCommands);
      const keys = (await state()).keys.slice(beforeCommands);
      for (const code of ["Digit9", "KeyK", "KeyS", "KeyP"]) {
        assert.equal(keys.filter((key) => key.code === code && key.type === "keydown").length, 1);
        assert.equal(keys.filter((key) => key.code === code && key.type === "keyup").length, 1);
      }
      const beforeEscape = (await state()).keys.length;
      await editor.press("Escape");
      await editor.press("Meta+Shift+Escape");
      await page.waitForFunction((count) => (window as unknown as { inputHarness: { keys: { key: string; type: string }[] } }).inputHarness.keys.slice(count).filter((key) => key.key === "Escape" && key.type === "keyup").length === 2, beforeEscape);
      const escapes = (await state()).keys.slice(beforeEscape).filter((key) => key.key === "Escape");
      assert.equal(escapes.filter((key) => key.type === "keydown").length, 2);
      assert.ok(escapes.some((key) => key.type === "keydown" && key.meta && key.shift && key.code === "Escape"));
      await editor.fill("Copy and cut");
      await editor.press("Meta+a");
      await editor.press("Meta+c");
      await editor.press("Meta+x");
      assert.equal(await editor.inputValue(), "");
      await editor.press("Meta+z");
      assert.equal(await editor.inputValue(), "Copy and cut");
      const beforeLocal = (await state()).keys.length;
      await editor.evaluate((element) => {
        for (const extra of [{ isComposing: true }, { key: "Dead" }, { key: "Process", keyCode: 229 }]) {
          element.dispatchEvent(new KeyboardEvent("keydown", { key: "p", code: "KeyP", metaKey: true, bubbles: true, cancelable: true, ...extra }));
        }
        const event = new KeyboardEvent("keydown", { key: "p", code: "KeyP", metaKey: true, bubbles: true, cancelable: true });
        event.preventDefault(); element.dispatchEvent(event);
      });
      await page.waitForTimeout(30);
      assert.ok((await state()).keys.slice(beforeLocal).every((key) => key.code !== "KeyP"));
      const editable = level.locator("#editable");
      await editable.focus();
      await editable.press("Meta+a");
      await editable.press("Meta+v");
      await editable.filter({ hasText: "Dictated sentence." }).waitFor();
      const input = level.locator("#input");
      await input.fill("");
      await input.press("Meta+v");
      await input.evaluate((element: HTMLInputElement) => new Promise<void>((resolve) => {
        if (element.value === "Dictated sentence.") resolve();
        else element.addEventListener("input", () => resolve(), { once: true });
      }));
      assert.equal(await input.inputValue(), "Dictated sentence.");
    }
    await page.goto(`${server}/run-panel.html`);
    const native = page.frameLocator("iframe").frameLocator("#nested").locator("#editor");
    await native.fill("Native editing");
    const prevented = await native.evaluate((element) => {
      const event = new KeyboardEvent("keydown", { key: "v", code: "KeyV", metaKey: true, bubbles: true, cancelable: true });
      element.dispatchEvent(event);
      return event.defaultPrevented;
    });
    assert.equal(prevented, false, "Browser mini-apps retain native clipboard handling.");
    assert.deepEqual(errors, []);
  } finally { await browser.close(); }
});
