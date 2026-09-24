import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ChatMessages } from "../src/chat/ChatMessages.tsx";
import type { Message } from "../src/chat/types.ts";

const render = (messages: Message[], running = false) => renderToStaticMarkup(createElement(ChatMessages, { messages, running, detailMode: "grouped" }));

const steps: Message[] = [
  { key: "thinking", role: "thinking", text: "Interner Denktext", closed: true },
  { key: "read", role: "tool", text: "read", tool: { id: "read", name: "read", arguments: "{}", result: "Dateiinhalt" } },
  { key: "bash", role: "tool", text: "bash", tool: { id: "bash", name: "bash", arguments: "{}", result: "Ausgabe" } },
];

test("gruppiert fasst aufeinanderfolgende Schritte zwischen Antworten zu einer zugeklappten Zeile zusammen", () => {
  const html = render([
    { key: "frage", role: "user", text: "Meine Frage" },
    ...steps,
    { key: "antwort", role: "assistant", text: "Erste Antwort", closed: true },
    { key: "solo", role: "tool", text: "grep", tool: { id: "grep", name: "grep", arguments: "{}", result: "Treffer" } },
    { key: "antwort2", role: "assistant", text: "Zweite Antwort", closed: true },
  ]);
  assert.deepEqual([...html.matchAll(/<button aria-expanded="false"[^>]*>.*?<span[^>]*>([^<]*)</g)].map((match) => match[1]), ["3 Schritte", "1 Schritt"]);
  assert.doesNotMatch(html, /data-step="line"|Interner Denktext|Dateiinhalt|>read<|>bash<|>grep</);
  assert.doesNotMatch(html, /animate-fade-pulse/);
  assert.ok(html.includes("Erste Antwort") && html.includes("Zweite Antwort"));
});

test("die laufende Gruppe nennt den aktuellen Schritt und pulsiert", () => {
  const laufend = render([...steps, { key: "open", role: "tool", text: "write", tool: { id: "write", name: "write", arguments: "{}" } }], true);
  assert.match(laufend, /animate-fade-pulse[^>]*>.*?4 Schritte<span[^>]*>write läuft \.\.\.<\/span>/);
  const denkend = render([...steps, { key: "thought", role: "thinking", text: "Neuer Gedanke", closed: false }], true);
  assert.match(denkend, /4 Schritte<span[^>]*>Denken läuft \.\.\.<\/span>/);
  assert.doesNotMatch(render(steps, true), /animate-fade-pulse|läuft \.\.\./);
});
