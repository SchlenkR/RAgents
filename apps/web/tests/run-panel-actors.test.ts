import assert from "node:assert/strict";
import test from "node:test";
import { runPanelActors, elementNeedsAttention, partitionRunPanelActors, pendingInputCount } from "../../../plugins/ragents.orchestration/web/run-panel/run-panel-actors.ts";
import { chatLayoutFor, clampChatWidth, DEFAULT_RUN_PANEL_STATE, parseRunPanelState } from "../../../plugins/ragents.orchestration/web/run-panel/run-panel-state.ts";
import { DEFAULT_RUN_PANEL_SETTINGS, parseRunPanelSettings } from "../../../plugins/ragents.orchestration/web/run-panel/run-panel-settings.ts";
import { sheetStatus } from "../../../plugins/ragents.orchestration/web/run-panel/sheet-status.ts";
import type { Message } from "../../../apps/web/src/chat/types.ts";
import type { RunActor, RunView } from "../src/run-view.ts";

const at = "2026-09-17T10:00:00Z";
const actor = (id: string, kind: RunActor["kind"], lifecycle?: RunActor["lifecycle"]): RunActor => ({ id, kind, handle: id, displayName: id, grants: [], createdAt: at, lifecycle });
const view: RunView = {
  id: "run-a", revision: 3, title: "Run", ownerId: "owner", primaryActorId: "coordinator", createdAt: at, forkedFrom: null,
  actors: [actor("owner", "human"), actor("circle", "script", { kind: "idle", since: at }), actor("coordinator", "agent", { kind: "idle", since: at }), actor("mira", "agent", { kind: "running", turnId: "t", inputId: "i", startedAt: at }), actor("old", "agent", { kind: "stopped", stoppedAt: at, reason: "fertig" })],
  inputs: [
    { id: "i1", actorId: "mira", content: "x", artifactIds: [], sourceEventIds: [], subscriptionId: null, enqueuedBy: "owner", enqueuedAt: at, sequence: 1, lifecycle: { kind: "pending" } },
    { id: "i2", actorId: "mira", content: "y", artifactIds: [], sourceEventIds: [], subscriptionId: null, enqueuedBy: "owner", enqueuedAt: at, sequence: 2, lifecycle: { kind: "claimed", turnId: "t", steered: false } },
  ],
  turns: [], subscriptions: [], pluginStates: [],
  actions: [{ id: "q1", askedBy: "circle", owner: "ragents.ask", payload: { question: "?", options: [], multi: false }, title: "?", description: null, parameters: {}, input: null, status: "pending", proposedAt: at, resolvedAt: null, resolvedBy: null, result: null }],
  artifacts: [],
};

test("the chip row puts the coordinator first and hides scripts without the inspect right", () => {
  assert.deepEqual(runPanelActors(view, true).map((entry) => entry.id), ["coordinator", "circle", "mira", "old"]);
  assert.deepEqual(runPanelActors(view, false).map((entry) => entry.id), ["coordinator", "mira", "old"]);
});

test("visibility follows the surface header mode while coordinator and selection stay pinned", () => {
  const actors = runPanelActors(view, true);
  const onStage = (entry: RunActor) => entry.id === "coordinator" || entry.id === "mira";
  const active = partitionRunPanelActors(actors, { mode: "active", onStage, primaryId: "coordinator", selectedId: undefined });
  assert.deepEqual([active.shown.map((entry) => entry.id), active.hidden.map((entry) => entry.id)], [["coordinator", "circle", "mira"], ["old"]]);
  const visible = partitionRunPanelActors(actors, { mode: "visible", onStage, primaryId: "coordinator", selectedId: "old" });
  assert.deepEqual([visible.shown.map((entry) => entry.id), visible.hidden.map((entry) => entry.id)], [["coordinator", "mira", "old"], ["circle"]]);
  const scripts = partitionRunPanelActors(actors, { mode: "script", onStage, primaryId: "coordinator", selectedId: undefined });
  assert.deepEqual(scripts.shown.map((entry) => entry.id), ["coordinator", "circle"]);
});

test("badges count pending inputs and waiting actions of the element owner or a pending host confirmation", () => {
  assert.equal(pendingInputCount(view, "mira"), 1);
  const definition = { id: "board", width: 1, height: 1, anchorActorId: "circle" };
  assert.equal(elementNeedsAttention(view, definition, false), true);
  assert.equal(elementNeedsAttention(view, { ...definition, anchorActorId: "mira" }, false), false);
  assert.equal(elementNeedsAttention(view, { ...definition, anchorActorId: "mira" }, true), true);
  assert.equal(elementNeedsAttention(undefined, definition, false), false);
});

test("the run panel state is parsed strictly, maps earlier layouts and keeps room for the mini-app", () => {
  assert.deepEqual(parseRunPanelState(null), DEFAULT_RUN_PANEL_STATE);
  assert.deepEqual(parseRunPanelState(JSON.stringify({ element: "board", stageHeight: 300, actor: null })), { element: "board", actor: null, chat: "side", chatWidth: 380, sheetExpandedHeight: null });
  assert.deepEqual(parseRunPanelState(JSON.stringify({ element: "board", actor: null, chat: "bottom", chatWidth: 420 })), { element: "board", actor: null, chat: "bottom", chatWidth: 420, sheetExpandedHeight: null });
  assert.equal(parseRunPanelState(JSON.stringify({ element: null, actor: null, chat: "floating" })).chat, "bottom");
  assert.equal(parseRunPanelState(JSON.stringify({ element: null, actor: null, chat: "docked" })).chat, "bottom");
  assert.equal(parseRunPanelState(JSON.stringify({ element: null, actor: null, chat: "auto" })).chat, "side");
  assert.equal(parseRunPanelState(JSON.stringify({ element: "board", actor: null, chat: "chat" })).chat, "chat");
  assert.throws(() => parseRunPanelState(JSON.stringify({ element: "board", actor: null, chat: "sheet" })), /ungültig/);
  assert.throws(() => parseRunPanelState(JSON.stringify({ element: "board", actor: null, chatWidth: 100 })), /ungültig/);
  assert.throws(() => parseRunPanelState(JSON.stringify({ element: "board", actor: null, extra: 1 })), /ungültig/);
  assert.equal(clampChatWidth(100, 900), 280);
  assert.equal(clampChatWidth(800, 900), 600);
  assert.equal(clampChatWidth(300.6, Number.POSITIVE_INFINITY), 301);
});

test("sheet depth preserves the expanded height and ignores the former resting height", () => {
  const state = { element: "board", actor: null, chat: "bottom", chatWidth: 380 };
  assert.equal(parseRunPanelState(JSON.stringify(state)).sheetExpandedHeight, null);
  assert.equal(parseRunPanelState(JSON.stringify({ ...state, sheetPeekExtra: 140.5 })).sheetExpandedHeight, null);
  assert.equal(parseRunPanelState(JSON.stringify({ ...state, sheetExpandedHeight: null })).sheetExpandedHeight, null);
  assert.equal(parseRunPanelState(JSON.stringify({ ...state, sheetExpandedHeight: 340.5 })).sheetExpandedHeight, 340.5);
  for (const sheetExpandedHeight of [-1, 0, "340", true]) {
    assert.throws(() => parseRunPanelState(JSON.stringify({ ...state, sheetExpandedHeight })), /ungültig/);
  }
});

test("the chat fills the run panel without a mini-app and in the pinned chat view, otherwise it takes the side or the sheet", () => {
  assert.equal(chatLayoutFor({ chat: "side", hasElement: false, narrow: false }), "full");
  assert.equal(chatLayoutFor({ chat: "bottom", hasElement: false, narrow: true }), "full");
  assert.equal(chatLayoutFor({ chat: "chat", hasElement: true, narrow: false }), "full");
  assert.equal(chatLayoutFor({ chat: "chat", hasElement: true, narrow: true }), "full");
  assert.equal(chatLayoutFor({ chat: "side", hasElement: true, narrow: false }), "side");
  assert.equal(chatLayoutFor({ chat: "side", hasElement: true, narrow: true }), "floating");
  assert.equal(chatLayoutFor({ chat: "bottom", hasElement: true, narrow: false }), "floating");
});

test("the run panel settings are parsed strictly within their limits", () => {
  assert.deepEqual(parseRunPanelSettings(null), DEFAULT_RUN_PANEL_SETTINGS);
  assert.deepEqual(parseRunPanelSettings(JSON.stringify({ sideWidth: 1200, openDelay: 0, closeDelay: 800 })), { sideWidth: 1200, openDelay: 0, closeDelay: 800 });
  assert.throws(() => parseRunPanelSettings(JSON.stringify({ sideWidth: 300, openDelay: 0, closeDelay: 800 })), /ungültig/);
  assert.throws(() => parseRunPanelSettings(JSON.stringify({ sideWidth: 1200, openDelay: 1.5, closeDelay: 800 })), /ungültig/);
  assert.throws(() => parseRunPanelSettings(JSON.stringify({ sideWidth: 1200, openDelay: 0 })), /ungültig/);
});

test("the sheet status line names a waiting action, the current work or the last spoken line", () => {
  const message = (role: Message["role"], text: string, extra: Partial<Message> = {}): Message => ({ key: `${role}-${text}`, role, text, ...extra });
  assert.deepEqual(sheetStatus([], false, "coordinator"), { kind: "idle", text: "Noch keine Nachrichten." });
  assert.deepEqual(sheetStatus([message("user", "Bitte\nAufgabe 1234 umsetzen")], false, "coordinator"), { kind: "idle", text: "Du: Bitte" });
  assert.deepEqual(sheetStatus([message("user", "Hallo"), message("assistant", "Ich lese das Item.", { closed: true }), message("tool", "", { tool: { id: "t", name: "read", arguments: "", result: "ok" } })], false, "coordinator"), { kind: "idle", text: "@coordinator: Ich lese das Item." });
  assert.deepEqual(sheetStatus([message("user", "Hallo"), message("thinking", "hm")], true, "coordinator"), { kind: "working", text: "@coordinator denkt ..." });
  assert.deepEqual(sheetStatus([message("tool", "", { tool: { id: "t", name: "bash", arguments: "" } })], true, "coordinator"), { kind: "working", text: "@coordinator nutzt bash ..." });
  assert.deepEqual(sheetStatus([message("assistant", "Ich melde mich", { sender: "@mira" })], true, "coordinator"), { kind: "working", text: "@mira antwortet: Ich melde mich" });
  assert.deepEqual(sheetStatus([message("assistant", "Fertig", { closed: true }), message("action", "Welche App?", { action: { actionId: "q1", owner: "ragents.ask", payload: null } })], true, "coordinator"), { kind: "waiting", text: "Wartet auf Eingabe: Welche App?" });
  assert.equal(sheetStatus([message("assistant", "x".repeat(200), { closed: true })], false, "coordinator").text.length, 160 + "@coordinator: ".length);
});
