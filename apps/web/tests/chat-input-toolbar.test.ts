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

test("the run chat offers its stop only for its own actor's turn and shows a stopped primary with its reason", async () => {
  const { primaryChatState } = await import("../src/chat/chat-target");
  const running = { kind: "running", turnId: "t", inputId: "i", startedAt: "now" };
  const idle = { kind: "idle", since: "now" };
  const view = (coordinator: unknown, worker: unknown, primary: { primaryActorId: string | null; stoppedPrimaryActorId?: string | null } = { primaryActorId: "coordinator" }) => ({
    id: "run", ownerId: "owner", ...primary, inputs: [], turns: [], subscriptions: [], pluginStates: [], actions: [], artifacts: [],
    actors: [
      { id: "owner", kind: "human", handle: "owner" },
      { id: "coordinator", kind: "agent", handle: "coordinator", lifecycle: coordinator },
      { id: "worker", kind: "agent", handle: "worker", lifecycle: worker },
    ],
  });
  assert.deepEqual(primaryChatState(view(running, idle), "run", false), { kind: "active", actorId: "coordinator", turnRunning: true });
  assert.deepEqual(primaryChatState(view(idle, running), "run", false), { kind: "active", actorId: "coordinator", turnRunning: false });
  assert.deepEqual(primaryChatState(view(idle, running), "run", true), { kind: "active", actorId: "coordinator", turnRunning: true });
  const stopped = { kind: "stopped", stoppedAt: "now", reason: "Versehentlich gestoppt" };
  const state = primaryChatState(view(stopped, running, { primaryActorId: null, stoppedPrimaryActorId: "coordinator" }), "run", false);
  assert.equal(state.kind === "stopped" ? state.actor.lifecycle : undefined, stopped);
  assert.deepEqual(primaryChatState(view(idle, idle, { primaryActorId: null }), "run", false), { kind: "none" });
  assert.deepEqual(primaryChatState(view(running, idle), "other", false), { kind: "none" });
  assert.deepEqual(primaryChatState(undefined, "run", true), { kind: "none" });
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
