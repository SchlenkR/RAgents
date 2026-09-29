import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Markdown, ChatMessages, applyEvent } from "quassel";
import { QuasselHost } from "../src/chat/QuasselHost";

const renderMarkdown = (text: string, streaming = false) =>
  renderToStaticMarkup(createElement(QuasselHost, null, createElement(Markdown, { text, streaming })));

test("Markdown renders horizontal rules, nested lists and GFM tables", () => {
  const html = renderMarkdown("Before\n\n---\n\n1. Outer\n   - Inner\n\n| Name | Value |\n| --- | --- |\n| Test | 42 |");
  assert.match(html, /<hr\b/);
  assert.match(html, /<ol\b[^>]*>[\s\S]*<li\b[^>]*>Outer[\s\S]*<ul\b[^>]*>[\s\S]*Inner[\s\S]*<\/ul>[\s\S]*<\/ol>/);
  assert.match(html, /<table\b/);
  assert.match(html, /<td\b[^>]*>42<\/td>/);
});

test("open formatting is completed while streaming", () => {
  const bold = renderMarkdown("**Hello", true);
  assert.ok(!bold.includes("**Hello"));
  assert.match(bold, /(?:<strong\b[^>]*>|data-streamdown="strong">)Hello</);
  assert.match(renderMarkdown("`const value", true), /<code\b[^>]*>const value<\/code>/);
  assert.match(renderMarkdown("```ts\nconst value = 1", true), /<pre\b[^>]*><code\b[^>]*>const value = 1/);
  assert.ok(renderMarkdown("**Hello").includes("**Hello"));
});

test("incomplete links stay without a clickable target, complete links are kept", () => {
  const incomplete = renderMarkdown("[Target](https://exam", true);
  assert.ok(incomplete.includes("Target"));
  assert.ok(!incomplete.includes("href="));
  const complete = renderMarkdown("[Target](https://example.org)");
  assert.match(complete, /href="https:\/\/example.org"/);
  assert.match(complete, /rel="noreferrer"/);
  assert.match(renderMarkdown("[Agent](flow:actor/test)"), /href="flow:actor\/test"/);
  assert.match(renderMarkdown("[File](./report.md)"), /href="\.\/report.md"/);
});

test("HTML and executable link targets are not rendered", () => {
  const html = renderMarkdown('<script>alert(1)</script>\n\n<img src="x" onerror="alert(1)">\n\n[Bad](javascript:alert(1))');
  assert.ok(!html.includes("<script"));
  assert.ok(!html.includes("<img"));
  assert.ok(!html.includes('href="javascript:'));
});

test("chat deltas use streaming until turn-done, after that the unchanged Markdown applies", () => {
  const messages = applyEvent([], {
    kind: "text",
    delta: "**Hello",
    cursor: { conversationId: "test", sequence: 1, offset: 7 },
  });
  const streaming = renderToStaticMarkup(createElement(ChatMessages, { messages }));
  assert.ok(!streaming.includes("**Hello"));
  const closed = applyEvent(messages, { kind: "turn-done" });
  const completed = renderToStaticMarkup(createElement(ChatMessages, { messages: closed }));
  assert.ok(completed.includes("**Hello"));
  const finished = applyEvent(messages, {
    kind: "text",
    delta: "**",
    cursor: { conversationId: "test", sequence: 1, offset: 9 },
  });
  const finishedHtml = renderToStaticMarkup(createElement(ChatMessages, { messages: applyEvent(finished, { kind: "turn-done" }) }));
  assert.ok(!finishedHtml.includes("**Hello"));
  assert.ok(finishedHtml.includes("Hello"));
});
