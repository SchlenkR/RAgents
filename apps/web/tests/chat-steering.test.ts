import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ChatMessages } from "../src/chat/ChatMessages";
import { applyEvent, type ChatEvent, type Message } from "../src/chat/types";
import { defaultTexts } from "../src/chat/texts";

test("a message steered into the running turn keeps its place and carries a visible mark", () => {
  const events: ChatEvent[] = [
    { kind: "user", text: "Baue die Seite.", inputId: "input-1" },
    { kind: "text", delta: "Ich beginne", cursor: { conversationId: "run", sequence: 3, offset: 10 } },
    { kind: "user", text: "Nimm Blau statt Rot.", inputId: "input-2" },
    { kind: "steered", inputId: "input-2" },
    { kind: "steered", inputId: "unbekannt" },
  ];
  const messages = events.reduce(applyEvent, [] as Message[]);
  assert.deepEqual(messages.map((message) => [message.role, message.text, message.steered === true]), [
    ["user", "Baue die Seite.", false],
    ["assistant", "Ich beginne", false],
    ["user", "Nimm Blau statt Rot.", true],
  ]);

  const markup = renderToStaticMarkup(createElement(ChatMessages, { messages }));
  assert.equal(markup.split('data-chat="steered"').length - 1, 1);
  assert.ok(markup.indexOf("Nimm Blau statt Rot.") < markup.indexOf(defaultTexts.steered));
});
