import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ChatInputToolbar } from "quassel";

test("the default composer keeps its attachment actions and three-line input", () => {
  const html = renderToStaticMarkup(createElement(ChatInputToolbar, {
    onSend: () => {}, toolbarLeft: "Model choice", toolbarRight: "Extra action",
  }));
  assert.match(html, /<textarea[^>]*rows="3"/);
  assert.match(html, /<button[^>]*aria-label="Attach files"/);
  assert.match(html, /Model choice/);
  assert.match(html, /Extra action/);
  assert.match(html, /data-input="controls"/);
  assert.match(html, /data-layout="card"/);
});

test("the toolbar composer keeps its single-line input separate from dropdown details", () => {
  const html = renderToStaticMarkup(createElement(ChatInputToolbar, {
    layout: "toolbar", onSend: () => {}, rows: 5, maxRows: 8,
    inputAriaControls: "global-conversation",
    toolbarLeft: "Model choice", toolbarRight: "Extra action",
  }));
  assert.match(html, /data-layout="toolbar"/);
  assert.match(html, /<textarea[^>]*aria-controls="global-conversation"[^>]*rows="1"/);
  assert.match(html, /aria-label="Send"/);
  assert.doesNotMatch(html, /<button[^>]*aria-label="Attach files"/);
  assert.doesNotMatch(html, /Model choice|Extra action|data-input="controls"/);
  assert.equal((html.match(/<textarea/g) ?? []).length, 1);
});

test("disconnected toolbar chats permit drafting while preserving the stop action", () => {
  const html = renderToStaticMarkup(createElement(ChatInputToolbar, {
    layout: "toolbar", onSend: () => {}, onStop: () => {}, running: true, sendDisabled: true,
  }));
  assert.doesNotMatch(html.match(/<textarea[^>]*>/)?.[0] ?? "", /disabled/);
  assert.match(html, /aria-label="Stop work"/);
  const readOnly = renderToStaticMarkup(createElement(ChatInputToolbar, {
    layout: "toolbar", onSend: () => {}, disabled: true,
  }));
  assert.match(readOnly, /<textarea[^>]*readOnly=""/);
  assert.doesNotMatch(readOnly.match(/<textarea[^>]*>/)?.[0] ?? "", /disabled/);
});

test("the run chat talks to its active primary and shows a stopped primary with its reason", async () => {
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
  assert.deepEqual(primaryChatState(view(running, idle), "run"), { kind: "active" });
  assert.deepEqual(primaryChatState(view(idle, running), "run"), { kind: "active" });
  const stopped = { kind: "stopped", stoppedAt: "now", reason: "Stopped by mistake" };
  const state = primaryChatState(view(stopped, running, { primaryActorId: null, stoppedPrimaryActorId: "coordinator" }), "run");
  assert.equal(state.kind === "stopped" ? state.actor.lifecycle : undefined, stopped);
  assert.deepEqual(primaryChatState(view(idle, idle, { primaryActorId: null }), "run"), { kind: "none" });
  assert.deepEqual(primaryChatState(view(running, idle), "other"), { kind: "none" });
  assert.deepEqual(primaryChatState(undefined, "run"), { kind: "none" });
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
