import assert from "node:assert/strict";
import test from "node:test";
import { installClipboardBridge } from "../src/run-panel/clipboard.ts";

const field = (tagName: string) => ({ tagName, isContentEditable: false, focused: 0, focus() { this.focused += 1; } });

const fakeWindow = (active: ReturnType<typeof field> | null) => {
  const keyListeners: Array<(event: unknown) => void> = [];
  const messageListeners: Array<(event: unknown) => void> = [];
  const posted: unknown[] = [];
  const commands: Array<{ name: string; text: string | undefined }> = [];
  const parent = { postMessage: (message: unknown) => posted.push(message) };
  const browser = {
    parent,
    document: {
      activeElement: active,
      execCommand: (name: string, _show?: boolean, text?: string) => { commands.push({ name, text }); return true; },
    },
    addEventListener: (type: string, listener: (event: unknown) => void) => {
      if (type === "keydown") keyListeners.push(listener);
      if (type === "message") messageListeners.push(listener);
    },
    removeEventListener: () => undefined,
  };
  return {
    browser: browser as unknown as Window,
    posted,
    commands,
    press: (key: string, extra: Record<string, unknown> = {}) => {
      let prevented = false;
      const event = { key, metaKey: true, ctrlKey: false, altKey: false, defaultPrevented: false, preventDefault: () => { prevented = true; }, ...extra };
      for (const listener of keyListeners) listener(event);
      return prevented;
    },
    reply: (data: unknown) => { for (const listener of messageListeners) listener({ source: parent, data }); },
  };
};

test("pasting in the run panel asks the hull for the text and inserts it into the focused field", async () => {
  const input = field("TEXTAREA");
  const { browser, posted, commands, press, reply } = fakeWindow(input);
  installClipboardBridge(browser);
  assert.equal(press("v"), true);
  const request = posted[0] as { type: string; id: string };
  assert.equal(request.type, "clipboardRead");
  reply({ type: "clipboardText", id: "fremd", text: "verworfen" });
  reply({ type: "clipboardText", id: request.id, text: "Diktierter Satz." });
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(commands, [{ name: "insertText", text: "Diktierter Satz." }]);
  assert.equal(input.focused, 1);
});

test("copying works without an editable field, cutting and pasting need one", () => {
  const outside = fakeWindow(field("DIV"));
  installClipboardBridge(outside.browser);
  assert.equal(outside.press("c"), true);
  assert.equal(outside.press("x"), false);
  assert.equal(outside.press("v"), false);
  assert.deepEqual(outside.commands, [{ name: "copy", text: undefined }]);
  assert.deepEqual(outside.posted, []);

  const inside = fakeWindow(field("INPUT"));
  installClipboardBridge(inside.browser);
  assert.equal(inside.press("x"), true);
  assert.deepEqual(inside.commands, [{ name: "cut", text: undefined }]);
});

test("other shortcuts and keys handled elsewhere stay untouched", () => {
  const { browser, commands, posted, press } = fakeWindow(field("TEXTAREA"));
  installClipboardBridge(browser);
  assert.equal(press("v", { metaKey: false }), false);
  assert.equal(press("v", { altKey: true }), false);
  assert.equal(press("a"), false);
  assert.equal(press("v", { defaultPrevented: true }), false);
  assert.deepEqual(commands, []);
  assert.deepEqual(posted, []);
});
