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
  reply({ type: "clipboardContent", id: requests[1].id, text: "Second", files: [] });
  dispose();
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(answers, [{ type: "clipboardContent", id: "b", text: "Second", files: [] }, { type: "clipboardContent", id: "a", text: "", files: [] }]);
  const nested = fakeBrowser();
  const port = new EventTarget() as EventTarget & { postMessage: () => void };
  port.postMessage = () => {};
  const close = installFrameInputBridge(nested.browser, port as unknown as MessagePort);
  const pending: unknown[] = [];
  relayFrameInput(nested.browser, { type: "ragents.app.input", version: 1, message: { type: "clipboardRead", id: "pending" } }, (message) => pending.push(message));
  close();
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(pending, [{ type: "clipboardContent", id: "pending", text: "", files: [] }]);
});

test("clipboard replies restore the child frame before delivery, including empty text", async () => {
  for (const text of ["Pasted text", ""]) {
    for (const state of ["connected", "removed", "disposed"]) {
      const { browser, messages, reply } = fakeBrowser();
      const events: string[] = [];
      const frame = { tagName: "IFRAME", isConnected: true, focus: () => events.push("focus") };
      Object.defineProperty(browser.document, "activeElement", { configurable: true, value: frame });
      const dispose = installRunPanelInputBridge(browser);
      relayFrameInput(browser, { type: "ragents.app.input", version: 1, message: { type: "clipboardRead", id: "child" } }, (message) => {
        events.push("reply");
        assert.deepEqual(message, { type: "clipboardContent", id: "child", text, files: [] });
      });
      Object.defineProperty(browser.document, "activeElement", { value: null });
      if (state === "removed") frame.isConnected = false;
      reply({ type: "clipboardContent", id: (messages[0] as { id: string }).id, text, files: [] });
      if (state === "disposed") dispose();
      await new Promise((resolve) => setImmediate(resolve));
      assert.deepEqual(events, state === "connected" ? ["focus", "reply"] : ["reply"]);
      if (state !== "disposed") dispose();
    }
  }
});

test("a nested frame accepts its clipboard reply through its window from the parent, not through its port", async () => {
  const { browser, reply } = fakeBrowser();
  const sent: { message: { id: string } }[] = [];
  const port = Object.assign(new EventTarget(), {
    onmessage: null as ((event: MessageEvent) => void) | null,
    postMessage: (message: { message: { id: string } }) => { sent.push(message); },
  });
  const close = installFrameInputBridge(browser, port as unknown as MessagePort);
  const answers: unknown[] = [];
  relayFrameInput(browser, { type: "ragents.app.input", version: 1, message: { type: "clipboardRead", id: "child" } }, (message) => answers.push(message));
  const id = sent[0].message.id;
  assert.deepEqual(sent, [{ type: "ragents.app.input", version: 1, message: { type: "clipboardRead", id } }]);
  const overPort = new Event("message");
  Object.assign(overPort, { data: { type: "clipboardContent", id, text: "Port", files: [] } });
  port.dispatchEvent(overPort);
  port.onmessage?.(overPort as MessageEvent);
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(answers, []);
  reply({ type: "clipboardContent", id, text: "Window", files: [] });
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(answers, [{ type: "clipboardContent", id: "child", text: "Window", files: [] }]);
  close();
});
