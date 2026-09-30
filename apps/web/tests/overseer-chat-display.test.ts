import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  ChatStepsProvider,
  defaultChatDisplayPolicy,
  useChatSteps,
  type ChatDisplayPolicy,
  type ChatStepsControl,
} from "../src/PluginRegistry.tsx";
import { overseerChatDisplayPolicy, overseerChatStorageKeyPrefix } from "../../../plugins/ragents.overseer/web/chat-display.ts";
import { ChatMessages, type Message } from "quassel";

const readControl = (policy: ChatDisplayPolicy, storageKeyPrefix?: string): ChatStepsControl => {
  let result: ChatStepsControl | undefined;
  const Probe = () => {
    result = useChatSteps();
    return null;
  };
  renderToStaticMarkup(createElement(ChatStepsProvider, { policy, storageKeyPrefix }, createElement(Probe)));
  assert.ok(result);
  return result;
};

test("the global chat starts independently of the run with the current, manually selectable step", (context) => {
  const values = new Map([
    ["ragents.chat-steps.coordinator", "full"],
    ["ragents.chat-steps.agents", "compact"],
  ]);
  const previous = Object.getOwnPropertyDescriptor(globalThis, "window");
  Object.defineProperty(globalThis, "window", { configurable: true, value: { localStorage: {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
  } } });
  context.after(() => {
    if (previous) Object.defineProperty(globalThis, "window", previous);
    else Reflect.deleteProperty(globalThis, "window");
  });

  const runPolicy = { ...defaultChatDisplayPolicy, selectable: true };
  const global = () => readControl(overseerChatDisplayPolicy, overseerChatStorageKeyPrefix);
  assert.equal(global().mode("coordinator"), "grouped");
  assert.equal(global().selectable, true);
  assert.equal(global().stepsExpandable, true);
  assert.equal(readControl(runPolicy).mode("coordinator"), "full");
  assert.equal(readControl(runPolicy).mode("agents"), "compact");

  global().setMode("coordinator", "chips");
  assert.equal(values.get(`${overseerChatStorageKeyPrefix}.coordinator`), "chips");
  assert.equal(global().mode("coordinator"), "chips", "the global choice is kept after reopening");
  assert.equal(readControl(runPolicy).mode("coordinator"), "full");
  readControl(runPolicy).setMode("coordinator", "compact");
  assert.equal(global().mode("coordinator"), "chips");

  global().setMode("coordinator", "off");
  assert.equal(global().mode("coordinator"), "off");
  values.set(`${overseerChatStorageKeyPrefix}.coordinator`, "invalid");
  assert.equal(global().mode("coordinator"), "grouped", "an invalid saved detail level falls back to the global default");
  values.clear();
  assert.equal(readControl(runPolicy).mode("coordinator"), "grouped", "the run default uses the grouped view");
  assert.equal(global().mode("coordinator"), "grouped");
});

test("run panel and inspector of the same chat remember their detail level separately", (context) => {
  const values = new Map<string, string>();
  const previous = Object.getOwnPropertyDescriptor(globalThis, "window");
  Object.defineProperty(globalThis, "window", { configurable: true, value: { localStorage: {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
  } } });
  context.after(() => {
    if (previous) Object.defineProperty(globalThis, "window", previous);
    else Reflect.deleteProperty(globalThis, "window");
  });
  const control = (display?: string): ChatStepsControl => {
    let result: ChatStepsControl | undefined;
    const Probe = () => {
      result = useChatSteps("run-a", "coordinator", display);
      return null;
    };
    renderToStaticMarkup(createElement(ChatStepsProvider, { policy: { ...defaultChatDisplayPolicy, selectable: true } }, createElement(Probe)));
    assert.ok(result);
    return result;
  };
  control("run-panel").setMode("agents", "full");
  assert.equal(control("run-panel").mode("agents"), "full");
  assert.equal(control("inspector").mode("agents"), "grouped");
  assert.equal(control().mode("agents"), "grouped", "without a surface the previous key stays untouched");
  assert.equal(control("run-panel").mode("agents"), "full");
  assert.equal(control("inspector").mode("agents"), "grouped");
});

test("the global default merges thinking text and tool calls into one group without result, full details show everything", () => {
  const messages: Message[] = [
    { key: "thinking", role: "thinking", text: "Internal thinking text", closed: true },
    { key: "tool", role: "tool", text: "bash", tool: { id: "call", name: "bash", arguments: "{}", result: "Result data" } },
    { key: "answer", role: "assistant", text: "Visible answer" },
  ];
  assert.equal(overseerChatDisplayPolicy.modes.coordinator, "grouped");
  const grouped = renderToStaticMarkup(createElement(ChatMessages, {
    messages, detailMode: overseerChatDisplayPolicy.modes.coordinator,
  }));
  assert.ok(grouped.includes("Visible answer"));
  assert.ok(grouped.includes("2 steps"));
  assert.ok(!grouped.includes("Result data"));
  const shown = renderToStaticMarkup(createElement(ChatMessages, { messages, detailMode: "full" }));
  assert.ok(shown.includes("Internal thinking text"));
  assert.ok(shown.includes("bash"));
  assert.ok(shown.includes("Result data"));
});
