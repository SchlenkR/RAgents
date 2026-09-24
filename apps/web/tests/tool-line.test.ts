import assert from "node:assert/strict";
import test from "node:test";

import type { Message, ToolInfo } from "../src/chat/types.ts";
import { toolLine, toolSummary, withToolSummaries } from "../src/toolLine.ts";

const tool = (args: string, name = "read"): ToolInfo => ({ id: "t1", name, arguments: args });

test("leere Argumente ergeben keine Zusammenfassung", () => {
  assert.equal(toolSummary(tool("")), "");
  assert.equal(toolSummary(tool("   ")), "");
  assert.equal(toolSummary(tool("{}")), "");
});

test("aus mehreren Feldern gewinnt das erste bevorzugte", () => {
  assert.equal(toolSummary(tool(JSON.stringify({ text: "hinten", path: "/vorn" }))), "/vorn");
  assert.equal(toolSummary(tool(JSON.stringify({ url: "https://example.org", query: "suche" }))), "suche");
});

test("ein leeres bevorzugtes Feld wird übersprungen", () => {
  assert.equal(toolSummary(tool(JSON.stringify({ path: "  ", command: "ls -la" }))), "ls -la");
});

test("ohne bevorzugtes Feld erscheinen die skalaren Felder als Paare", () => {
  const summary = toolSummary(tool(JSON.stringify({ limit: 5, deep: true, nested: { weg: 1 } })));

  assert.equal(summary, "limit=5 deep=true");
});

test("ohne verwertbare Felder bleibt die rohe Argumentzeile", () => {
  assert.equal(toolSummary(tool(JSON.stringify({ nested: { a: 1 } }))), '{"nested":{"a":1}}');
  assert.equal(toolSummary(tool("kein JSON")), "kein JSON");
  assert.equal(toolSummary(tool("[1,2]")), "[1,2]");
});

test("eine Zeichenkette als Argument wird direkt zusammengefasst", () => {
  assert.equal(toolSummary(tool('"nur Text"')), "nur Text");
});

test("Zeilenumbrüche werden geglättet und lange Zeilen gekürzt", () => {
  assert.equal(toolSummary(tool(JSON.stringify({ text: " a\n\n b \t c " }))), "a b c");

  const long = "x".repeat(200);
  const summary = toolSummary(tool(JSON.stringify({ text: long })));

  assert.equal(summary, `${"x".repeat(140)} ...`);
});

test("die Werkzeugzeile nutzt das Etikett, sonst den Werkzeugnamen", () => {
  assert.equal(toolLine(tool(JSON.stringify({ path: "/a" }))), "read /a");
  assert.equal(toolLine(tool(JSON.stringify({ path: "/a" })), "Datei lesen"), "Datei lesen /a");
  assert.equal(toolLine(tool(JSON.stringify({ path: "/a" })), "   "), "read /a");
  assert.equal(toolLine(tool("{}")), "read");
});

test("nur Nachrichten mit Werkzeug bekommen eine neue Zeile", () => {
  const messages: Message[] = [
    { key: "1", role: "user", text: "bitte lesen" },
    { key: "2", role: "assistant", text: "Datei lesen", tool: tool(JSON.stringify({ path: "/a" })) },
  ];

  const result = withToolSummaries(messages);

  assert.equal(result[0], messages[0]);
  assert.equal(result[1].text, "Datei lesen /a");
  assert.equal(messages[1].text, "Datei lesen");
});
