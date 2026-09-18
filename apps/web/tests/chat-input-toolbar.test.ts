import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ChatInputToolbar } from "../src/chat/ChatInputToolbar";

test("the default composer keeps its attachment actions and three-line input", () => {
  const html = renderToStaticMarkup(createElement(ChatInputToolbar, {
    onSend: () => {}, toolbarLeft: "Modellauswahl", toolbarRight: "Zusatzaktion",
  }));
  assert.match(html, /<textarea[^>]*rows="3"/);
  assert.match(html, /<button[^>]*aria-label="Dateien anhängen"/);
  assert.match(html, /Modellauswahl/);
  assert.match(html, /Zusatzaktion/);
  assert.match(html, /data-input="controls"/);
  assert.match(html, /data-layout="card"/);
});

test("the toolbar composer keeps its single-line input separate from dropdown details", () => {
  const html = renderToStaticMarkup(createElement(ChatInputToolbar, {
    layout: "toolbar", onSend: () => {}, rows: 5, maxRows: 8,
    inputAriaControls: "global-conversation",
    toolbarLeft: "Modellauswahl", toolbarRight: "Zusatzaktion",
  }));
  assert.match(html, /data-layout="toolbar"/);
  assert.match(html, /<textarea[^>]*aria-controls="global-conversation"[^>]*rows="1"/);
  assert.match(html, /aria-label="Senden"/);
  assert.doesNotMatch(html, /<button[^>]*aria-label="Dateien anhängen"/);
  assert.doesNotMatch(html, /Modellauswahl|Zusatzaktion|data-input="controls"/);
  assert.equal((html.match(/<textarea/g) ?? []).length, 1);
});

test("disconnected toolbar chats permit drafting while preserving the stop action", () => {
  const html = renderToStaticMarkup(createElement(ChatInputToolbar, {
    layout: "toolbar", onSend: () => {}, onStop: () => {}, running: true, sendDisabled: true,
  }));
  assert.doesNotMatch(html.match(/<textarea[^>]*>/)?.[0] ?? "", /disabled/);
  assert.match(html, /aria-label="Arbeit stoppen"/);
  const readOnly = renderToStaticMarkup(createElement(ChatInputToolbar, {
    layout: "toolbar", onSend: () => {}, disabled: true,
  }));
  assert.match(readOnly, /<textarea[^>]*readOnly=""/);
  assert.doesNotMatch(readOnly.match(/<textarea[^>]*>/)?.[0] ?? "", /disabled/);
});

test("an unfinished start keeps its existing cancellation callback", async () => {
  const { stopChatWork } = await import("../src/chat/chat-target");
  let cancelled = 0;
  await stopChatWork("draft", undefined, async () => { cancelled += 1; });
  assert.equal(cancelled, 1);
});

test("the run counts as working while any agent or program turn runs", async () => {
  const { runIsWorking } = await import("../src/chat/chat-target");
  const view = (lifecycle: string, kind = "agent") => ({ id: "run", actors: [
    { id: "owner", kind: "human" },
    { id: "coordinator", kind: "agent", lifecycle: { kind: "idle" } },
    { id: "worker", kind, lifecycle: { kind: lifecycle } },
  ] });
  assert.equal(runIsWorking(view("running"), "run"), true);
  assert.equal(runIsWorking(view("running", "script"), "run"), true);
  assert.equal(runIsWorking(view("idle"), "run"), false);
  assert.equal(runIsWorking(view("stopped"), "run"), false);
  assert.equal(runIsWorking(view("running"), "other"), false);
  assert.equal(runIsWorking(undefined, "run"), false);
  assert.equal(runIsWorking({ id: "run", actors: [{ id: "owner", kind: "human", lifecycle: { kind: "running" } }] }, "run"), false);
});
