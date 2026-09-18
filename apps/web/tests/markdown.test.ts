import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Markdown } from "../src/chat/Markdown.tsx";
import { ChatMessages } from "../src/chat/ChatMessages.tsx";
import { applyEvent } from "../src/chat/types.ts";

const renderMarkdown = (text: string, streaming = false) => renderToStaticMarkup(createElement(Markdown, { text, streaming }));

test("Markdown rendert Trennlinien, verschachtelte Listen und GFM-Tabellen", () => {
  const html = renderMarkdown("Vorher\n\n---\n\n1. Außen\n   - Innen\n\n| Name | Wert |\n| --- | --- |\n| Test | 42 |");
  assert.match(html, /<hr\b/);
  assert.match(html, /<ol\b[^>]*>[\s\S]*<li\b[^>]*>Außen[\s\S]*<ul\b[^>]*>[\s\S]*Innen[\s\S]*<\/ul>[\s\S]*<\/ol>/);
  assert.match(html, /<table\b/);
  assert.match(html, /<td\b[^>]*>42<\/td>/);
});

test("offene Formatierungen werden während des Streams vervollständigt", () => {
  const bold = renderMarkdown("**Hallo", true);
  assert.ok(!bold.includes("**Hallo"));
  assert.match(bold, /(?:<strong\b[^>]*>|data-streamdown="strong">)Hallo</);
  assert.match(renderMarkdown("`const value", true), /<code\b[^>]*>const value<\/code>/);
  assert.match(renderMarkdown("```ts\nconst value = 1", true), /<pre\b[^>]*><code\b[^>]*>const value = 1/);
  assert.ok(renderMarkdown("**Hallo").includes("**Hallo"));
});

test("unvollständige Links bleiben ohne klickbares Ziel, vollständige Links bleiben erhalten", () => {
  const incomplete = renderMarkdown("[Ziel](https://exam", true);
  assert.ok(incomplete.includes("Ziel"));
  assert.ok(!incomplete.includes("href="));
  const complete = renderMarkdown("[Ziel](https://example.org)");
  assert.match(complete, /href="https:\/\/example.org"/);
  assert.match(complete, /rel="noreferrer"/);
  assert.match(renderMarkdown("[Agent](ablauf:actor/test)"), /href="ablauf:actor\/test"/);
  assert.match(renderMarkdown("[Datei](./report.md)"), /href="\.\/report.md"/);
});

test("HTML und ausführbare Linkziele werden nicht ausgegeben", () => {
  const html = renderMarkdown('<script>alert(1)</script>\n\n<img src="x" onerror="alert(1)">\n\n[Bad](javascript:alert(1))');
  assert.ok(!html.includes("<script"));
  assert.ok(!html.includes("<img"));
  assert.ok(!html.includes('href="javascript:'));
});

test("Chat-Deltas verwenden Streaming bis turn-done, danach gilt unverändertes Markdown", () => {
  const messages = applyEvent([], {
    kind: "text",
    delta: "**Hallo",
    cursor: { conversationId: "test", sequence: 1, offset: 7 },
  });
  const streaming = renderToStaticMarkup(createElement(ChatMessages, { messages }));
  assert.ok(!streaming.includes("**Hallo"));
  const closed = applyEvent(messages, { kind: "turn-done" });
  const completed = renderToStaticMarkup(createElement(ChatMessages, { messages: closed }));
  assert.ok(completed.includes("**Hallo"));
  const finished = applyEvent(messages, {
    kind: "text",
    delta: "**",
    cursor: { conversationId: "test", sequence: 1, offset: 9 },
  });
  const finishedHtml = renderToStaticMarkup(createElement(ChatMessages, { messages: applyEvent(finished, { kind: "turn-done" }) }));
  assert.ok(!finishedHtml.includes("**Hallo"));
  assert.ok(finishedHtml.includes("Hallo"));
});
