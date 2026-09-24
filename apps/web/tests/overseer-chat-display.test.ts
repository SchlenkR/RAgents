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
import { ChatMessages } from "../src/chat/ChatMessages.tsx";
import type { Message } from "../src/chat/types.ts";

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

test("globaler Chat beginnt unabhängig vom Run mit aktuellem, manuell wählbarem Schritt", (context) => {
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
  assert.equal(global().mode("coordinator"), "chips", "globale Auswahl bleibt nach erneutem Öffnen erhalten");
  assert.equal(readControl(runPolicy).mode("coordinator"), "full");
  readControl(runPolicy).setMode("coordinator", "compact");
  assert.equal(global().mode("coordinator"), "chips");

  global().setMode("coordinator", "off");
  assert.equal(global().mode("coordinator"), "off");
  values.set(`${overseerChatStorageKeyPrefix}.coordinator`, "invalid");
  assert.equal(global().mode("coordinator"), "grouped", "ungültiger gespeicherter Detailgrad fällt auf den globalen Default zurück");
  values.clear();
  assert.equal(readControl(runPolicy).mode("coordinator"), "grouped", "Run-Default verwendet die gruppierte Ansicht");
  assert.equal(global().mode("coordinator"), "grouped");
});

test("Fläche, Inspector und Popout desselben Chats merken sich ihren Detailgrad getrennt", (context) => {
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
  control("surface").setMode("agents", "full");
  assert.equal(control("surface").mode("agents"), "full");
  assert.equal(control("inspector").mode("agents"), "grouped");
  assert.equal(control("popout").mode("agents"), "grouped");
  assert.equal(control().mode("agents"), "grouped", "ohne Fläche bleibt der bisherige Schlüssel unberührt");
  control("popout").setMode("agents", "compact");
  assert.equal(control("surface").mode("agents"), "full");
  assert.equal(control("inspector").mode("agents"), "grouped");
  assert.equal(control("popout").mode("agents"), "compact");
});

test("globaler Standard fasst Denktext und Werkzeugaufrufe zu einer Gruppe ohne Ergebnis zusammen, volle Details zeigen alles", () => {
  const messages: Message[] = [
    { key: "thinking", role: "thinking", text: "Interner Denktext", closed: true },
    { key: "tool", role: "tool", text: "bash", tool: { id: "call", name: "bash", arguments: "{}", result: "Ergebnisdaten" } },
    { key: "answer", role: "assistant", text: "Sichtbare Antwort" },
  ];
  assert.equal(overseerChatDisplayPolicy.modes.coordinator, "grouped");
  const grouped = renderToStaticMarkup(createElement(ChatMessages, {
    messages, detailMode: overseerChatDisplayPolicy.modes.coordinator,
  }));
  assert.ok(grouped.includes("Sichtbare Antwort"));
  assert.ok(grouped.includes("2 Schritte"));
  assert.ok(!grouped.includes("Ergebnisdaten"));
  const shown = renderToStaticMarkup(createElement(ChatMessages, { messages, detailMode: "full" }));
  assert.ok(shown.includes("Interner Denktext"));
  assert.ok(shown.includes("bash"));
  assert.ok(shown.includes("Ergebnisdaten"));
});
