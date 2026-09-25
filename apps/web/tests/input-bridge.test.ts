import assert from "node:assert/strict";
import test from "node:test";
import { hostInputEnabled, installFrameInputBridge, installRunPanelInputBridge, relayFrameInput } from "../src/run-panel/input-bridge";

const fakeBrowser = () => {
  const events = new EventTarget();
  const messages: unknown[] = [];
  const parent = { postMessage: (message: unknown) => messages.push(message) };
  const browser = { parent, document: { activeElement: null }, addEventListener: events.addEventListener.bind(events), removeEventListener: events.removeEventListener.bind(events) } as unknown as Window;
  return { browser, messages, reply: (data: unknown) => {
    const event = new Event("message");
    Object.assign(event, { source: parent, data });
    events.dispatchEvent(event);
  } };
};

test("frame input is gated by the document transport and validates keyboard payloads", () => {
  const { browser, messages } = fakeBrowser();
  const keyboard = { type: "ragents.app.input", version: 1, message: { type: "keyboardEvent", event: {
    type: "keydown", key: "p", code: "KeyP", keyCode: 80, metaKey: true, ctrlKey: false, altKey: false, shiftKey: false, repeat: false,
  } } };
  assert.equal(relayFrameInput(browser, keyboard, () => {}), true);
  assert.deepEqual(messages, []);
  const dispose = installRunPanelInputBridge(browser);
  assert.equal(hostInputEnabled(browser), true);
  assert.equal(relayFrameInput(browser, keyboard, () => {}), true);
  assert.deepEqual(messages, [keyboard.message]);
  relayFrameInput(browser, { ...keyboard, message: { type: "keyboardEvent", event: { key: "p" } } }, () => {});
  relayFrameInput(browser, { ...keyboard, version: 2 }, () => {});
  assert.equal(messages.length, 1);
  dispose();
  assert.equal(hostInputEnabled(browser), false);
});

test("each nested clipboard request returns through its own transport and disposal settles pending reads", async () => {
  const { browser, messages, reply } = fakeBrowser();
  const dispose = installRunPanelInputBridge(browser);
  const answers: unknown[] = [];
  for (const id of ["a", "b"]) relayFrameInput(browser, { type: "ragents.app.input", version: 1, message: { type: "clipboardRead", id } }, (message) => answers.push(message));
  const requests = messages as { id: string }[];
  reply({ type: "clipboardText", id: requests[1].id, text: "Second" });
  dispose();
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(answers, [{ type: "clipboardText", id: "b", text: "Second" }, { type: "clipboardText", id: "a", text: "" }]);
  const nested = fakeBrowser();
  const port = new EventTarget() as EventTarget & { postMessage: () => void };
  port.postMessage = () => {};
  const close = installFrameInputBridge(nested.browser, port as unknown as MessagePort);
  const pending: unknown[] = [];
  relayFrameInput(nested.browser, { type: "ragents.app.input", version: 1, message: { type: "clipboardRead", id: "pending" } }, (message) => pending.push(message));
  close();
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(pending, [{ type: "clipboardText", id: "pending", text: "" }]);
});
