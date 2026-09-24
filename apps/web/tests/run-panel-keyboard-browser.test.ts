import assert from "node:assert/strict";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { chromium } from "playwright-core";
import { frameHtml } from "../../vscode/src/webview-html";

interface KeyRecord {
  type: string;
  key: string;
  code: string;
  keyCode: number;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
}

interface KeyboardHarness {
  keys: KeyRecord[];
  messages: unknown[];
  extensionMessages: unknown[];
  pasteCalls: number;
}

declare global {
  interface Window {
    keyboardHarness: KeyboardHarness;
    keyboardInput: { value: string; inputType: string | undefined }[];
    disposeKeyboardBridge: () => void;
  }
}

test("nested run-panel keyboard shortcuts reach the hull while Hex-style paste still inserts input", {
  skip: process.env.RAGENTS_BROWSER_TESTS !== "1", timeout: 60_000,
}, async () => {
  const root = fileURLToPath(new URL("../../../", import.meta.url));
  const bundle = await build({
    stdin: {
      contents: `import { installKeyboardBridge } from './src/run-panel/keyboard';
import { installClipboardBridge } from './src/run-panel/clipboard';
installClipboardBridge(window);
window.disposeKeyboardBridge = installKeyboardBridge(window);
window.keyboardInput = [];
document.querySelector('textarea').addEventListener('input', event => {
  window.keyboardInput.push({value: event.target.value, inputType: event.inputType});
});`,
      resolveDir: `${root}apps/web`, loader: "ts",
    },
    bundle: true, platform: "browser", format: "iife", write: false, logLevel: "silent",
  });
  const hullOrigin = "http://127.0.0.1:47910";
  const childOrigin = "http://127.0.0.1:47911";
  const html = frameHtml({ serverUrl: childOrigin, query: { host: "vscode" }, nonce: "test-nonce", title: "Keyboard test" });
  const browser = await chromium.launch({ headless: true, executablePath: process.env.BROWSER_EXECUTABLE_PATH ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" });
  const errors: string[] = [];
  try {
    const context = await browser.newContext();
    await context.route("http://127.0.0.1:*/**", async (route) => {
      const url = new URL(route.request().url());
      const body = url.origin === hullOrigin ? html : url.pathname === "/child.js" ? bundle.outputFiles[0].text
        : '<!doctype html><html><body><textarea aria-label="Chat"></textarea><input type="password" aria-label="Passwort"><script src="/child.js"></script></body></html>';
      await route.fulfill({ contentType: url.pathname === "/child.js" ? "text/javascript" : "text/html", body });
    });
    await context.addInitScript({ content: `(() => {
      if (location.origin !== ${JSON.stringify(hullOrigin)}) return;
      const state = { keys: [], messages: [], extensionMessages: [], pasteCalls: 0 };
      window.keyboardHarness = state;
      window.acquireVsCodeApi = () => ({ postMessage: message => state.extensionMessages.push(message) });
      for (const type of ["keydown", "keyup"]) window.addEventListener(type, event => {
        state.keys.push({ type: event.type, key: event.key, code: event.code, keyCode: event.keyCode,
          ctrlKey: event.ctrlKey, metaKey: event.metaKey, shiftKey: event.shiftKey, altKey: event.altKey });
      });
      window.addEventListener("message", event => {
        if (event.origin !== location.origin && event.data) state.messages.push(event.data);
      });
      const execCommand = document.execCommand.bind(document);
      document.execCommand = (command, showUI, value) => {
        if (command !== "paste") return execCommand(command, showUI, value);
        state.pasteCalls += 1;
        document.activeElement.value = "Diktierter Satz.";
        return true;
      };
    })();` });
    const page = await context.newPage();
    page.setDefaultTimeout(10_000);
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(`${hullOrigin}/`);
    const child = page.frameLocator("#frame");
    const input = child.getByRole("textbox", { name: "Chat", exact: true });
    await input.fill("");
    await input.pressSequentially("Normaler Text");
    assert.equal(await input.inputValue(), "Normaler Text");
    await page.waitForFunction(() => window.keyboardHarness.keys.some((event) => event.type === "keydown" && event.key === "t"));

    await input.focus();
    await input.press("Meta+Shift+P");
    await input.press("Meta+P");
    await input.press("F1");
    await input.press("Meta+K");
    await input.press("s");
    await page.waitForFunction(() => window.keyboardHarness.keys.some((event) => event.type === "keyup" && event.code === "KeyS"));
    const relayed = await page.evaluate(() => window.keyboardHarness.keys);
    assert.ok(relayed.some((event) => event.type === "keydown" && event.code === "KeyP" && event.metaKey && event.shiftKey && event.keyCode === 80));
    assert.ok(relayed.some((event) => event.type === "keyup" && event.code === "KeyP"));
    assert.ok(relayed.some((event) => event.type === "keydown" && event.key === "F1" && event.keyCode === 112));
    assert.ok(relayed.some((event) => event.type === "keydown" && event.code === "KeyK"));
    assert.ok(relayed.some((event) => event.type === "keydown" && event.code === "KeyS" && !event.metaKey && !event.ctrlKey));
    assert.deepEqual(await page.evaluate(() => window.keyboardHarness.extensionMessages), []);

    const beforeLocal = relayed.length;
    await input.fill("Bearbeiten");
    await input.press("Meta+A");
    await input.evaluate((element) => {
      element.dispatchEvent(new KeyboardEvent("keydown", { key: "Process", code: "KeyP", metaKey: true, isComposing: true, bubbles: true }));
      element.dispatchEvent(new KeyboardEvent("keyup", { key: "Process", code: "KeyP", metaKey: true, isComposing: true, bubbles: true }));
    });
    const localEvents = (await page.evaluate(() => window.keyboardHarness.keys)).slice(beforeLocal);
    assert.ok(localEvents.every((event) => event.key === "Meta"));
    const beforePaste = await page.evaluate(() => window.keyboardHarness.keys.length);

    await input.fill("");
    await input.evaluate((element) => {
      element.dispatchEvent(new KeyboardEvent("keydown", { key: "v", code: "KeyV", keyCode: 86, metaKey: true, bubbles: true, cancelable: true }));
      element.dispatchEvent(new KeyboardEvent("keyup", { key: "v", code: "KeyV", keyCode: 86, metaKey: true, bubbles: true, cancelable: true }));
    });
    const frame = page.frames().find((candidate) => candidate.url().startsWith(childOrigin))!;
    await frame.waitForFunction(() => document.querySelector("textarea")?.value === "Diktierter Satz.");
    assert.equal(await input.inputValue(), "Diktierter Satz.");
    assert.deepEqual(await frame.evaluate(() => window.keyboardInput.at(-1)), { value: "Diktierter Satz.", inputType: "insertText" });
    assert.equal(await page.evaluate(() => window.keyboardHarness.pasteCalls), 1);
    assert.equal(await page.evaluate(() => window.keyboardHarness.keys.length), beforePaste);
    assert.deepEqual(await page.evaluate(() => window.keyboardHarness.extensionMessages), []);
    assert.deepEqual(errors, []);
  } catch (error) {
    throw new Error(`${error instanceof Error ? error.message : String(error)}\nBrowser errors: ${errors.join("; ")}`, { cause: error });
  } finally {
    await browser.close();
  }
});
