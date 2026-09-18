import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ChatMessages } from "../src/chat/ChatMessages.tsx";
import { applyEvent, type Message } from "../src/chat/types.ts";
import { DETAIL_MODES, detailModeLabel } from "../src/chat/DetailModeSwitch.tsx";
import { CHAT_DETAIL_MODES } from "../../server/src/plugin-support/chat-display-contract.ts";

const render = (messages: Message[], running = true) => renderToStaticMarkup(createElement(ChatMessages, { messages, running }));

function assertCurrentChip(html: string, label: string, expandable = true) {
  assert.match(html, /data-step="row"/);
  assert.deepEqual([...html.matchAll(/data-step="chip"[^>]*title="([^"]*)"/g)].map((match) => match[1]), [label]);
  assert.match(html, /animate-fade-pulse/);
  assert.doesNotMatch(html, /data-step="line"|data-step="detail"/);
  if (expandable) assert.match(html, /<button[^>]*aria-haspopup="dialog"[^>]*data-step="chip"/);
  else {
    assert.match(html, /<span[^>]*data-step="chip"/);
    assert.doesNotMatch(html, /<button|aria-haspopup|role="dialog"/);
  }
}

test("aktueller Standard wechselt zwischen Schrittchips und Antwort ohne Schrittverlauf", () => {
  const thinking = applyEvent(applyEvent([], { kind: "user", text: "Meine Frage" }), { kind: "thinking", delta: "Verborgener Denktext" });
  const thoughtHtml = render(thinking);
  assertCurrentChip(thoughtHtml, "Denken");
  assert.ok(!thoughtHtml.includes("Verborgener Denktext"));
  assert.match(thoughtHtml, /data-chat="working"/);

  const tool = applyEvent(thinking, { kind: "tool", id: "first", name: "lookup", arguments: "{}" });
  const toolHtml = render(tool);
  assertCurrentChip(toolHtml, "lookup");
  assert.doesNotMatch(toolHtml, /Denken|Verborgener Denktext/);
  assert.match(toolHtml, /data-chat="working"/);

  const nextTool = applyEvent(tool, { kind: "tool", id: "second", name: "calculate", arguments: "{}" });
  assertCurrentChip(render(nextTool), "calculate");
  assert.ok(!render(nextTool).includes("lookup"));
  const completed = applyEvent(nextTool, { kind: "tool-result", id: "second", result: "42" });
  assert.ok(!render(completed).includes("calculate"));
  assert.ok(!render(completed).includes("lookup"));
  assert.doesNotMatch(render(completed), /data-step="chip"/);
  assert.match(render(completed), /data-chat="working"/);

  const answer = applyEvent(completed, { kind: "text", delta: "Meine Antwort", cursor: { conversationId: "chat", sequence: 5, offset: 12 } });
  const answerHtml = render(answer);
  assert.ok(answerHtml.includes("Meine Frage"));
  assert.ok(answerHtml.includes("Meine Antwort"));
  assert.ok(!answerHtml.includes("lookup"));
  assert.ok(!answerHtml.includes("calculate"));
  assert.ok(!answerHtml.includes("Verborgener Denktext"));
  assert.doesNotMatch(answerHtml, /data-step="chip"/);
});

test("Laufende, abgeschlossene Gedanken und Rückfragen hinterlassen keinen aktuellen Schritt", () => {
  const thinking = applyEvent([], { kind: "thinking", delta: "Privater Gedanke" });
  assert.doesNotMatch(render(thinking, false), /Denken|data-step="chip"|data-chat="working"/);
  assert.doesNotMatch(render(applyEvent(thinking, { kind: "turn-done" })), /Denken|data-step="chip"/);
  const tool = applyEvent(thinking, { kind: "tool", id: "ask", name: "ask_user", arguments: "{}" });
  assert.ok(!render(tool, false).includes("ask_user"));
  const question = applyEvent(tool, { kind: "question", callId: "ask", text: "Welche Farbe?", options: ["Rot", "Blau"] });
  assert.ok(render(question).includes("Welche Farbe?"));
  assert.ok(!render(question).includes("ask_user"));
  assert.doesNotMatch(render(question), /data-step="chip"/);
  const answer = applyEvent(tool, { kind: "text", delta: "Ich brauche deine Auswahl." });
  assert.match(render(answer), /Ich brauche deine Auswahl/);
  assert.doesNotMatch(render(answer), /ask_user|data-step="chip"/);
});

test("eine nachgeschobene Eingabe beendet den laufenden Schritt nicht, jede andere Nachricht schon", () => {
  const tool = applyEvent([], { kind: "tool", id: "call", name: "lookup", arguments: "{}" });
  const queued = applyEvent(tool, { kind: "user", text: "Bitte auch die Tests prüfen" });
  const queuedHtml = render(queued);
  assertCurrentChip(queuedHtml, "lookup");
  assert.match(queuedHtml, /Bitte auch die Tests prüfen/);
  assert.doesNotMatch(render(applyEvent(queued, { kind: "tool-result", id: "call", result: "42" })), /data-step="chip"/);
  const thinking = applyEvent(queued, { kind: "thinking", delta: "Weiter" });
  assertCurrentChip(render(thinking), "Denken");
  const twice = applyEvent(thinking, { kind: "user", text: "Und noch etwas" });
  assertCurrentChip(render(twice), "Denken");
  assert.doesNotMatch(render(applyEvent(twice, { kind: "system", text: "Hinweis" })), /data-step="chip"/);
  assert.doesNotMatch(render(applyEvent(queued, { kind: "system", text: "Hinweis" })), /data-step="chip"/);
});

test("aktuell gehört zu den gemeinsamen wählbaren Detailgraden", () => {
  assert.deepEqual(DETAIL_MODES, CHAT_DETAIL_MODES);
  assert.equal(detailModeLabel("current"), "aktuell");
});

test("nicht aufklappbarer current-Modus zeigt einen generischen Schrittchip ohne technische Inhalte", () => {
  const show = (messages: Message[], running = true) => renderToStaticMarkup(createElement(ChatMessages, { messages, running, detailMode: "current", stepsExpandable: false }));
  const thinking = applyEvent([], { kind: "thinking", delta: "Verborgener Gedanke" });
  assertCurrentChip(show(thinking), "Denken", false);
  assert.doesNotMatch(show(thinking), /Verborgener Gedanke|<button/);
  const tool = applyEvent(thinking, { kind: "tool", id: "browser", name: "browser_check", label: "Privater Quellpfad", arguments: "Verborgene Argumente" });
  const html = show(tool);
  assertCurrentChip(html, "Werkzeug läuft", false);
  assert.match(html, /title="Werkzeug läuft"/);
  assert.match(html, /data-chat="working"/);
  assert.doesNotMatch(html, /browser_check|Privater Quellpfad|Verborgene Argumente|Verborgener Gedanke|Denken/);
  assert.doesNotMatch(show(tool, false), /Werkzeug läuft|data-step="chip"|data-chat="working"/);
  const completed = applyEvent(tool, { kind: "tool-result", id: "browser", result: "Verborgener Screenshot" });
  assert.doesNotMatch(show(completed), /Werkzeug läuft|Verborgener Screenshot/);
  const failed = applyEvent(tool, { kind: "tool-result", id: "browser", result: "Verborgener Fehler", isError: true });
  assert.doesNotMatch(show(failed), /Werkzeug läuft|Verborgener Fehler/);
});

test("redigierte leere Phasenmarker bleiben sichtbar und geschlossene Gedanken enden", () => {
  const show = (messages: Message[]) => renderToStaticMarkup(createElement(ChatMessages, { messages, running: true, stepsExpandable: false }));
  const thinking = applyEvent([], { kind: "thinking", delta: "" });
  assertCurrentChip(show(thinking), "Denken", false);
  assert.match(show(thinking), /data-chat="working"/);
  assert.doesNotMatch(show(applyEvent(thinking, { kind: "turn-done" })), /Denken|data-step="chip"/);
  const tool = applyEvent(thinking, { kind: "tool", id: "redacted", name: "", arguments: "", label: "" });
  assertCurrentChip(show(tool), "Werkzeug läuft", false);
  assert.match(show(tool), /data-chat="working"/);
  assert.doesNotMatch(show(applyEvent(tool, { kind: "tool-result", id: "redacted", result: "" })), /Werkzeug läuft/);
});

test("aktuelle Werkzeugchips umgehen benutzerdefinierte Werkzeugdarstellungen und geschlossene Argumente", () => {
  const messages = applyEvent([], { kind: "tool", id: "call", name: "private_tool", arguments: "private_source" });
  const html = renderToStaticMarkup(createElement(ChatMessages, {
    messages,
    running: true,
    stepsExpandable: false,
    renderTool: () => assert.fail("Generischer Status darf keinen Werkzeugrenderer aufrufen"),
    toolArgumentsText: () => assert.fail("Generischer Status darf keine Argumente darstellen"),
  }));
  assertCurrentChip(html, "Werkzeug läuft", false);
  assert.doesNotMatch(html, /private_tool|private_source/);
  const expanded = renderToStaticMarkup(createElement(ChatMessages, {
    messages,
    running: true,
    stepsExpandable: true,
    renderTool: () => assert.fail("Aktueller Schritt muss als Chip erscheinen"),
    toolArgumentsText: () => assert.fail("Geschlossener Chip darf keine Argumente darstellen"),
  }));
  assertCurrentChip(expanded, "private_tool");
  assert.doesNotMatch(expanded, /private_source|role="dialog"/);
});

test("aktuelle Chips verwenden die gemeinsamen Denk- und generischen Werkzeugtexte", () => {
  const show = (messages: Message[]) => renderToStaticMarkup(createElement(ChatMessages, {
    messages, running: true, stepsExpandable: false,
    texts: { thinkingChip: "Überlegen", currentTool: "Aktion läuft" },
  }));
  assertCurrentChip(show(applyEvent([], { kind: "thinking", delta: "Privat" })), "Überlegen", false);
  assertCurrentChip(show(applyEvent([], { kind: "tool", id: "tool", name: "private_tool", arguments: "Privat" })), "Aktion läuft", false);
});

test("Arbeitsanzeige bleibt in jedem Detailmodus zusätzlich sichtbar solange der Lauf läuft", () => {
  const thinking = applyEvent([], { kind: "thinking", delta: "Gedanke" });
  const tool = applyEvent(thinking, { kind: "tool", id: "tool", name: "lookup", arguments: "{}" });
  const completed = applyEvent(tool, { kind: "tool-result", id: "tool", result: "Erledigt" });
  const answer = applyEvent(completed, { kind: "text", delta: "Antwort" });
  for (const detailMode of DETAIL_MODES) {
    for (const messages of [[], thinking, tool, completed, answer]) {
      const show = (running: boolean) => renderToStaticMarkup(createElement(ChatMessages, { messages, detailMode, running }));
      assert.match(show(true), /aria-label="Arbeitet \.\.\."[^>]*data-chat="working" role="status"/, detailMode);
      assert.doesNotMatch(show(false), /data-chat="working"/, detailMode);
    }
  }
});

test("eigene Arbeitsanzeige bleibt neben dem aktuellen Chip bis zum Laufende sichtbar", () => {
  const messages = applyEvent([], { kind: "tool", id: "tool", name: "lookup", arguments: "{}" });
  const show = (running: boolean) => renderToStaticMarkup(createElement(ChatMessages, {
    messages, running, working: createElement("span", { role: "status" }, "Eigene Arbeitsanzeige"),
  }));
  const html = show(true);
  assertCurrentChip(html, "lookup");
  assert.match(html, /role="status">Eigene Arbeitsanzeige/);
  assert.doesNotMatch(html, /data-chat="working"/);
  assert.doesNotMatch(show(false), /Eigene Arbeitsanzeige|data-step="chip"/);
});
