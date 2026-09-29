import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ChatMessages, applyEvent, type ChatEvent, type Message, defaultTexts } from "quassel";

test("a message steered into the running turn keeps its place and carries a visible mark", () => {
  const events: ChatEvent[] = [
    { kind: "user", text: "Build the page.", inputId: "input-1" },
    { kind: "text", delta: "I am starting", cursor: { conversationId: "run", sequence: 3, offset: 10 } },
    { kind: "user", text: "Use blue instead of red.", inputId: "input-2" },
    { kind: "steered", inputId: "input-2" },
    { kind: "steered", inputId: "unknown" },
  ];
  const messages = events.reduce(applyEvent, [] as Message[]);
  assert.deepEqual(messages.map((message) => [message.role, message.text, message.steered === true]), [
    ["user", "Build the page.", false],
    ["assistant", "I am starting", false],
    ["user", "Use blue instead of red.", true],
  ]);

  const markup = renderToStaticMarkup(createElement(ChatMessages, { messages }));
  assert.equal(markup.split('data-chat="steered"').length - 1, 1);
  assert.ok(markup.indexOf("Use blue instead of red.") < markup.indexOf(defaultTexts.steered));
});
