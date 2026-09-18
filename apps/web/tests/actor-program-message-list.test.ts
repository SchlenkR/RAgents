import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MessageList } from "../../../plugins/ragents.actor-programs/client-ui/MessageList";
import type { MessageListItem } from "../../../plugins/ragents.actor-programs/client-ui/message-list-contracts";

test("MessageList zeigt benannte Absender, Markdown und Anhänge ohne Eingabe", () => {
  const html = renderToStaticMarkup(createElement(MessageList, { showTimestamps: true, messages: [
    { key: "first", sender: "Analyse", text: "**Befund**", at: "2026-09-07T12:00:00Z" },
    { key: "second", sender: "Prüfung <extern>", text: "", attachments: [{ name: "Notizen.txt", mediaType: "text/plain", size: 12, url: "/notes.txt" }] },
  ] }));
  assert.match(html, /Analyse/);
  assert.match(html, /Prüfung &lt;extern&gt;/);
  assert.match(html, /<strong[^>]*>Befund<\/strong>/);
  assert.match(html, /Notizen.txt/);
  assert.match(html, /<time/);
  assert.doesNotMatch(html, /<textarea|<input|<form/);
  assert.ok(html.indexOf("Analyse") < html.indexOf("Prüfung"));
});

test("Absenderfarben bleiben bei neuer Reihenfolge stabil und können überschrieben werden", () => {
  const first: MessageListItem = { key: "one", sender: "Redaktion", text: "Ein Beitrag" };
  const second: MessageListItem = { key: "two", sender: "Lektorat", text: "Noch ein Beitrag" };
  const colors = (messages: MessageListItem[]) => [...renderToStaticMarkup(createElement(MessageList, { messages }))
    .matchAll(/style="background:([^"]+)"/g)].map((match) => match[1]);
  assert.deepEqual(colors([first, second]), colors([second, first]).reverse());
  assert.notEqual(colors([first, second])[0], colors([first, second])[1]);
  const html = renderToStaticMarkup(createElement(MessageList, { messages: [{ ...first, color: "#123456", side: "end" }] }));
  assert.match(html, /background:#123456/);
  assert.match(html, /data-side="end"/);
  const empty = renderToStaticMarkup(createElement(MessageList, { messages: [], emptyState: createElement("p", null, "Noch keine Meldungen") }));
  assert.match(empty, /Noch keine Meldungen/);
});

test("MessageList can switch the owner without replacing messages or losing attachment-only contributions", () => {
  const messages: MessageListItem[] = [
    { key: "one", sender: "Redaktion", text: "**Entwurf**", color: "#123456", side: "end" },
    { key: "two", sender: "Lektorat", text: "", color: "#abcdef", attachments: [{ name: "Notizen.txt", mediaType: "text/plain", size: 12, url: "/notes.txt" }] },
  ];
  const original = structuredClone(messages);
  const render = (owner?: string | null) => renderToStaticMarkup(createElement(MessageList, { messages, owner }));
  const all = render();
  assert.match(all, /background:#123456/);
  assert.match(all, /background:#abcdef/);
  assert.equal(render(null), all);
  const editor = render("Redaktion");
  assert.doesNotMatch(editor, /background:#123456|data-side="end"/);
  assert.match(editor, /<strong[^>]*>Entwurf<\/strong>/);
  assert.match(editor, /background:#abcdef/);
  const reviewer = render("Lektorat");
  assert.match(reviewer, /background:#123456/);
  assert.doesNotMatch(reviewer, /background:#abcdef/);
  assert.match(reviewer, /data-message="answer"/);
  assert.match(reviewer, /download="Notizen.txt"/);
  assert.equal(render(), all);
  assert.deepEqual(messages, original);
});
