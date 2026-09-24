import assert from "node:assert/strict";
import test from "node:test";
import { installKeyboardBridge } from "../src/run-panel/keyboard";
import { isRunPanelKeyboardMessage, type RunPanelKeyboardMessage } from "../src/run-panel/host-contract";

const createBrowser = () => {
  const listeners = new Map<string, Set<(event: KeyboardEvent) => void>>();
  const messages: RunPanelKeyboardMessage[] = [];
  const browser = {
    parent: { postMessage: (message: RunPanelKeyboardMessage) => messages.push(message) },
    document: { activeElement: { tagName: "TEXTAREA", isContentEditable: false } },
    addEventListener: (type: string, listener: (event: KeyboardEvent) => void) => {
      const entries = listeners.get(type) ?? new Set();
      entries.add(listener);
      listeners.set(type, entries);
    },
    removeEventListener: (type: string, listener: (event: KeyboardEvent) => void) => { listeners.get(type)?.delete(listener); },
  };
  const dispatch = (type: string, overrides: Partial<KeyboardEvent> = {}) => {
    let prevented = false;
    const event = {
      key: "p", code: "KeyP", keyCode: 80, ctrlKey: false, metaKey: false, shiftKey: false, altKey: false,
      repeat: false, defaultPrevented: false, isComposing: false, getModifierState: () => false,
      preventDefault: () => { prevented = true; }, ...overrides,
    } as KeyboardEvent;
    for (const listener of listeners.get(type) ?? []) listener(event);
    return prevented;
  };
  return { browser: browser as unknown as Window, messages, dispatch };
};

test("VS Code commands and unmodified chord suffixes retain key metadata", () => {
  const { browser, messages, dispatch } = createBrowser();
  installKeyboardBridge(browser);
  assert.equal(dispatch("keydown", { metaKey: true, shiftKey: true, key: "P" }), true);
  dispatch("keyup", { metaKey: false, shiftKey: false, key: "p" });
  assert.equal(dispatch("keydown", { key: "F1", code: "F1", keyCode: 112 }), false);
  dispatch("keyup", { key: "F1", code: "F1", keyCode: 112 });
  assert.equal(dispatch("keydown", { metaKey: true, key: "k", code: "KeyK", keyCode: 75 }), false);
  dispatch("keyup", { key: "k", code: "KeyK", keyCode: 75 });
  assert.equal(dispatch("keydown", { key: "s", code: "KeyS", keyCode: 83 }), false);
  assert.deepEqual(messages[0], { type: "keyboardEvent", event: {
    type: "keydown", key: "P", code: "KeyP", keyCode: 80, ctrlKey: false, metaKey: true, shiftKey: true, altKey: false, repeat: false,
  } });
  assert.equal(messages[1].event.type, "keyup");
  assert.equal(messages[1].event.metaKey, false);
  assert.equal(messages.at(-1)?.event.metaKey, false);
  assert.equal(messages.at(-1)?.event.code, "KeyS");
});

test("plain typing is relayed without cancelling text insertion", () => {
  const { browser, messages, dispatch } = createBrowser();
  installKeyboardBridge(browser);
  assert.equal(dispatch("keydown", { key: "a", code: "KeyA", keyCode: 65 }), false);
  assert.equal(dispatch("keyup", { key: "a", code: "KeyA", keyCode: 65 }), false);
  assert.equal(messages.length, 2);
});

test("Windows and Linux command shortcuts prevent browser print, find and save", () => {
  const { browser, messages, dispatch } = createBrowser();
  installKeyboardBridge(browser);
  for (const key of ["p", "f", "s"]) assert.equal(dispatch("keydown", { key, ctrlKey: true }), true);
  assert.ok(messages.every((message) => message.event.ctrlKey && !message.event.metaKey));
  dispatch("keydown", { ctrlKey: true, repeat: true });
  assert.equal(messages.at(-1)?.event.repeat, true);
});

test("editable native shortcuts and handled or composing keys stay local", () => {
  const { browser, messages, dispatch } = createBrowser();
  installKeyboardBridge(browser);
  for (const key of ["a", "z", "y", "c", "v", "x", "ArrowLeft", "ArrowRight", "Backspace", "Delete"]) {
    assert.equal(dispatch("keydown", { key, code: key, metaKey: true }), false);
    dispatch("keyup", { key, code: key });
  }
  dispatch("keydown", { key: "z", code: "KeyZ", metaKey: true, shiftKey: true });
  dispatch("keydown", { defaultPrevented: true, metaKey: true });
  dispatch("keydown", { isComposing: true, metaKey: true });
  dispatch("keydown", { keyCode: 229, metaKey: true });
  dispatch("keydown", { key: "Dead" });
  dispatch("keydown", { key: "Process" });
  dispatch("keydown", { getModifierState: (key) => key === "AltGraph" });
  assert.deepEqual(messages, []);
});

test("only an outstanding forwarded key receives a keyup, and teardown removes all handlers", () => {
  const { browser, messages, dispatch } = createBrowser();
  const dispose = installKeyboardBridge(browser);
  dispatch("keyup");
  assert.equal(messages.length, 0);
  dispatch("keydown");
  dispatch("blur");
  dispatch("keyup");
  assert.equal(messages.length, 1);
  dispose();
  dispatch("keydown", { metaKey: true });
  assert.equal(messages.length, 1);
});

test("keyboard bridge validates complete serialized event data", () => {
  const { browser, messages, dispatch } = createBrowser();
  installKeyboardBridge(browser);
  dispatch("keydown", { metaKey: true });
  const message = messages[0];
  assert.equal(isRunPanelKeyboardMessage(message), true);
  assert.equal(isRunPanelKeyboardMessage({ ...message, event: { ...message.event, type: "keypress" } }), false);
  assert.equal(isRunPanelKeyboardMessage({ ...message, event: { ...message.event, keyCode: -1 } }), false);
  assert.equal(isRunPanelKeyboardMessage({ ...message, event: { ...message.event, keyCode: Infinity } }), false);
  assert.equal(isRunPanelKeyboardMessage({ ...message, event: { ...message.event, metaKey: "true" } }), false);
  assert.equal(isRunPanelKeyboardMessage({ type: "keyboardEvent" }), false);
});
