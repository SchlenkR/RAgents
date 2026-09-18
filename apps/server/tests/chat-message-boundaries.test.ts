import assert from "node:assert/strict";
import test from "node:test";
import { applyEvent, type ChatEvent, type Message } from "../src/chat-events.ts";

test("incoming user messages leave streamed text in its original block", () => {
  const cursor = { conversationId: "conversation", sequence: 7, offset: 5 };
  const first = applyEvent([], { kind: "text", delta: "Hallo", cursor, at: "2026-09-15T10:00:00Z" });
  const incoming = applyEvent(first, { kind: "user", text: "Eine Ergänzung" });
  assert.equal(incoming[0].closed, first[0].closed);
  const continued = applyEvent(incoming, { kind: "text", delta: " Welt", cursor: { ...cursor, offset: 9 } });
  assert.deepEqual(continued.map((message) => [message.role, message.text]), [
    ["assistant", "Hallo Welt"], ["user", "Eine Ergänzung"],
  ]);
  assert.equal(continued[0].key, first[0].key);
  assert.equal(continued[0].at, first[0].at);
  assert.deepEqual(continued[0].textCursor, { ...cursor, offset: 9 });
  assert.equal(first[0].text, "Hallo");
  assert.equal(incoming[0].text, "Hallo");
});

test("turn completion closes a stream before queued users and the next turn gets a new block", () => {
  const events: ChatEvent[] = [
    { kind: "text", delta: "Erste Antwort", cursor: { conversationId: "conversation", sequence: 7, offset: 12 } },
    { kind: "user", text: "Nächster Auftrag" },
    { kind: "user", text: "Noch eine Ergänzung" },
    { kind: "turn-done" },
  ];
  const completed = events.reduce(applyEvent, [] as Message[]);
  assert.equal(completed[0].closed, true);
  const next = applyEvent(completed, {
    kind: "text", delta: "Zweite Antwort", cursor: { conversationId: "conversation", sequence: 11, offset: 13 },
  });
  assert.deepEqual(next.map((message) => message.text), ["Erste Antwort", "Nächster Auftrag", "Noch eine Ergänzung", "Zweite Antwort"]);
  assert.notEqual(next[0].key, next[3].key);
});

for (const cursor of [
  { conversationId: "conversation", sequence: 8, offset: 3 },
  { conversationId: "other-conversation", sequence: 7, offset: 3 },
]) {
  test(`text from ${cursor.conversationId}/${cursor.sequence} never merges with a different cursor anchor`, () => {
    const first = applyEvent([], {
      kind: "text", delta: "Alt", cursor: { conversationId: "conversation", sequence: 7, offset: 3 },
    });
    const next = applyEvent(first, { kind: "text", delta: "Neu", cursor });
    assert.deepEqual(next.map((message) => message.text), ["Alt", "Neu"]);
    assert.equal(next[0].closed, true);
    assert.deepEqual(next[0].textCursor, first[0].textCursor);
    assert.deepEqual(next[1].textCursor, cursor);
  });
}

test("thinking continues across incoming users and closes before the next output phase", () => {
  const events: ChatEvent[] = [
    { kind: "thinking", delta: "Ich prüfe" },
    { kind: "user", text: "Bitte gründlich" },
    { kind: "thinking", delta: " die Details." },
  ];
  const thinking = events.reduce(applyEvent, [] as Message[]);
  assert.deepEqual(thinking.map((message) => [message.role, message.text]), [
    ["thinking", "Ich prüfe die Details."], ["user", "Bitte gründlich"],
  ]);
  assert.equal(applyEvent(thinking, { kind: "turn-done" })[0].closed, true);
  const answer = applyEvent(thinking, {
    kind: "text", delta: "Ergebnis", cursor: { conversationId: "conversation", sequence: 7, offset: 8 },
  });
  assert.equal(answer[0].closed, true);
  assert.deepEqual(answer.map((message) => message.role), ["thinking", "user", "assistant"]);
});
