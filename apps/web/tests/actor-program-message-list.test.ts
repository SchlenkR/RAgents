import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MessageList } from "../../../apps/web/src/actor-programs/client-ui/MessageList";
import type { MessageListItem } from "../../../apps/web/src/actor-programs/client-ui/message-list-contracts";

test("MessageList shows named senders, Markdown and attachments without input", () => {
  const html = renderToStaticMarkup(createElement(MessageList, { showTimestamps: true, messages: [
    { key: "first", sender: "Analysis", text: "**Finding**", at: "2026-09-07T12:00:00Z" },
    { key: "second", sender: "Review <external>", text: "", attachments: [{ name: "Notes.txt", mediaType: "text/plain", size: 12, url: "/notes.txt" }] },
  ] }));
  assert.match(html, /Analysis/);
  assert.match(html, /Review &lt;external&gt;/);
  assert.match(html, /<strong[^>]*>Finding<\/strong>/);
  assert.match(html, /Notes.txt/);
  assert.match(html, /<time/);
  assert.doesNotMatch(html, /<textarea|<input|<form/);
  assert.ok(html.indexOf("Analysis") < html.indexOf("Review"));
});

test("sender colors stay stable in a new order and can be overridden", () => {
  const first: MessageListItem = { key: "one", sender: "Editorial", text: "A contribution" };
  const second: MessageListItem = { key: "two", sender: "Proofreading", text: "Another contribution" };
  const colors = (messages: MessageListItem[]) => [...renderToStaticMarkup(createElement(MessageList, { messages }))
    .matchAll(/style="background:([^"]+)"/g)].map((match) => match[1]);
  assert.deepEqual(colors([first, second]), colors([second, first]).reverse());
  assert.notEqual(colors([first, second])[0], colors([first, second])[1]);
  const html = renderToStaticMarkup(createElement(MessageList, { messages: [{ ...first, color: "#123456", side: "end" }] }));
  assert.match(html, /background:#123456/);
  assert.match(html, /data-side="end"/);
  const empty = renderToStaticMarkup(createElement(MessageList, { messages: [], emptyState: createElement("p", null, "No messages yet") }));
  assert.match(empty, /No messages yet/);
});

test("MessageList can switch the owner without replacing messages or losing attachment-only contributions", () => {
  const messages: MessageListItem[] = [
    { key: "one", sender: "Editorial", text: "**Draft**", color: "#123456", side: "end" },
    { key: "two", sender: "Proofreading", text: "", color: "#abcdef", attachments: [{ name: "Notes.txt", mediaType: "text/plain", size: 12, url: "/notes.txt" }] },
  ];
  const original = structuredClone(messages);
  const render = (owner?: string | null) => renderToStaticMarkup(createElement(MessageList, { messages, owner }));
  const all = render();
  assert.match(all, /background:#123456/);
  assert.match(all, /background:#abcdef/);
  assert.equal(render(null), all);
  const editor = render("Editorial");
  assert.doesNotMatch(editor, /background:#123456|data-side="end"/);
  assert.match(editor, /<strong[^>]*>Draft<\/strong>/);
  assert.match(editor, /background:#abcdef/);
  const reviewer = render("Proofreading");
  assert.match(reviewer, /background:#123456/);
  assert.doesNotMatch(reviewer, /background:#abcdef/);
  assert.match(reviewer, /data-message="answer"/);
  assert.match(reviewer, /download="Notes.txt"/);
  assert.equal(render(), all);
  assert.deepEqual(messages, original);
});
