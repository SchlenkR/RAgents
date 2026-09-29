import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ChatMessages, type Message } from "quassel";

const render = (messages: Message[], running = false) => renderToStaticMarkup(createElement(ChatMessages, { messages, running, detailMode: "grouped" }));

const steps: Message[] = [
  { key: "thinking", role: "thinking", text: "Internal thinking text", closed: true },
  { key: "read", role: "tool", text: "read", tool: { id: "read", name: "read", arguments: "{}", result: "File content" } },
  { key: "bash", role: "tool", text: "bash", tool: { id: "bash", name: "bash", arguments: "{}", result: "Output" } },
];

test("grouped mode merges consecutive steps between answers into one collapsed line", () => {
  const html = render([
    { key: "question", role: "user", text: "My question" },
    ...steps,
    { key: "answer", role: "assistant", text: "First answer", closed: true },
    { key: "solo", role: "tool", text: "grep", tool: { id: "grep", name: "grep", arguments: "{}", result: "Match" } },
    { key: "answer2", role: "assistant", text: "Second answer", closed: true },
  ]);
  assert.deepEqual([...html.matchAll(/<button aria-expanded="false"[^>]*>.*?<span[^>]*>([^<]*)</g)].map((match) => match[1]), ["3 steps", "1 step"]);
  assert.doesNotMatch(html, /data-step="line"|Internal thinking text|File content|>read<|>bash<|>grep</);
  assert.doesNotMatch(html, /animate-fade-pulse/);
  assert.ok(html.includes("First answer") && html.includes("Second answer"));
});

test("the running group names the current step and pulses", () => {
  const running = render([...steps, { key: "open", role: "tool", text: "write", tool: { id: "write", name: "write", arguments: "{}" } }], true);
  assert.match(running, /animate-fade-pulse[^>]*>.*?4 steps<span[^>]*>write running \.\.\.<\/span>/);
  const thinking = render([...steps, { key: "thought", role: "thinking", text: "New thought", closed: false }], true);
  assert.match(thinking, /4 steps<span[^>]*>Thinking running \.\.\.<\/span>/);
  assert.doesNotMatch(render(steps, true), /animate-fade-pulse|running \.\.\./);
});
