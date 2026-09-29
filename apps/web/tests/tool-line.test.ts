import assert from "node:assert/strict";
import test from "node:test";

import type { Message, ToolInfo } from "quassel/events";
import { toolLine, toolSummary, withToolSummaries } from "../src/toolLine.ts";

const tool = (args: string, name = "read"): ToolInfo => ({ id: "t1", name, arguments: args });

test("empty arguments give no summary", () => {
  assert.equal(toolSummary(tool("")), "");
  assert.equal(toolSummary(tool("   ")), "");
  assert.equal(toolSummary(tool("{}")), "");
});

test("of several fields the first preferred one wins", () => {
  assert.equal(toolSummary(tool(JSON.stringify({ text: "back", path: "/front" }))), "/front");
  assert.equal(toolSummary(tool(JSON.stringify({ url: "https://example.org", query: "search" }))), "search");
});

test("an empty preferred field is skipped", () => {
  assert.equal(toolSummary(tool(JSON.stringify({ path: "  ", command: "ls -la" }))), "ls -la");
});

test("without a preferred field the scalar fields appear as pairs", () => {
  const summary = toolSummary(tool(JSON.stringify({ limit: 5, deep: true, nested: { weg: 1 } })));

  assert.equal(summary, "limit=5 deep=true");
});

test("without usable fields the raw argument line stays", () => {
  assert.equal(toolSummary(tool(JSON.stringify({ nested: { a: 1 } }))), '{"nested":{"a":1}}');
  assert.equal(toolSummary(tool("no JSON")), "no JSON");
  assert.equal(toolSummary(tool("[1,2]")), "[1,2]");
});

test("a string as argument is summarized directly", () => {
  assert.equal(toolSummary(tool('"just text"')), "just text");
});

test("line breaks are flattened and long lines shortened", () => {
  assert.equal(toolSummary(tool(JSON.stringify({ text: " a\n\n b \t c " }))), "a b c");

  const long = "x".repeat(200);
  const summary = toolSummary(tool(JSON.stringify({ text: long })));

  assert.equal(summary, `${"x".repeat(140)} ...`);
});

test("the tool line uses the label, otherwise the tool name", () => {
  assert.equal(toolLine(tool(JSON.stringify({ path: "/a" }))), "read /a");
  assert.equal(toolLine(tool(JSON.stringify({ path: "/a" })), "Read file"), "Read file /a");
  assert.equal(toolLine(tool(JSON.stringify({ path: "/a" })), "   "), "read /a");
  assert.equal(toolLine(tool("{}")), "read");
});

test("only messages with a tool get a new line", () => {
  const messages: Message[] = [
    { key: "1", role: "user", text: "please read" },
    { key: "2", role: "assistant", text: "Read file", tool: tool(JSON.stringify({ path: "/a" })) },
  ];

  const result = withToolSummaries(messages);

  assert.equal(result[0], messages[0]);
  assert.equal(result[1].text, "Read file /a");
  assert.equal(messages[1].text, "Read file");
});
