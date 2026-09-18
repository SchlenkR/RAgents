import assert from "node:assert/strict";
import test from "node:test";
import { columnActors, elementNeedsAttention, partitionColumnActors, pendingInputCount } from "../../../plugins/ragents.orchestration/web/column/column-actors.ts";
import { clampChatWidth, DEFAULT_COLUMN_STATE, parseColumnState } from "../../../plugins/ragents.orchestration/web/column/column-state.ts";
import { DEFAULT_COLUMN_SETTINGS, parseColumnSettings } from "../../../plugins/ragents.orchestration/web/column/column-settings.ts";
import { sheetStatus } from "../../../plugins/ragents.orchestration/web/column/sheet-status.ts";
import type { Message } from "../../../apps/web/src/chat/types.ts";
import type { RunActor, RunView } from "../../../plugins/ragents.orchestration/web/run-view.ts";

const at = "2026-09-17T10:00:00Z";
const actor = (id: string, kind: RunActor["kind"], lifecycle?: RunActor["lifecycle"]): RunActor => ({ id, kind, handle: id, displayName: id, grants: [], createdAt: at, lifecycle });
const view: RunView = {
  id: "run-a", revision: 3, title: "Run", ownerId: "owner", primaryActorId: "coordinator", createdAt: at, forkedFrom: null,
  actors: [actor("owner", "human"), actor("circle", "script", { kind: "idle", since: at }), actor("coordinator", "agent", { kind: "idle", since: at }), actor("mira", "agent", { kind: "running", turnId: "t", inputId: "i", startedAt: at }), actor("old", "agent", { kind: "stopped", stoppedAt: at, reason: "fertig" })],
  inputs: [
    { id: "i1", actorId: "mira", content: "x", artifactIds: [], sourceEventIds: [], subscriptionId: null, enqueuedBy: "owner", enqueuedAt: at, sequence: 1, lifecycle: { kind: "pending" } },
    { id: "i2", actorId: "mira", content: "y", artifactIds: [], sourceEventIds: [], subscriptionId: null, enqueuedBy: "owner", enqueuedAt: at, sequence: 2, lifecycle: { kind: "claimed", turnId: "t" } },
  ],
  turns: [], subscriptions: [], pluginStates: [],
  actions: [{ id: "q1", askedBy: "circle", kind: "question", question: { options: [], multi: false }, title: "?", description: null, parameters: {}, input: null, status: "pending", proposedAt: at, resolvedAt: null, resolvedBy: null, response: null }],
  artifacts: [],
};

test("the chip row puts the coordinator first and hides scripts without the inspect right", () => {
  assert.deepEqual(columnActors(view, true).map((entry) => entry.id), ["coordinator", "circle", "mira", "old"]);
  assert.deepEqual(columnActors(view, false).map((entry) => entry.id), ["coordinator", "mira", "old"]);
});

test("visibility follows the canvas header mode while coordinator and selection stay pinned", () => {
  const actors = columnActors(view, true);
  const onStage = (entry: RunActor) => entry.id === "coordinator" || entry.id === "mira";
  const active = partitionColumnActors(actors, { mode: "active", onStage, primaryId: "coordinator", selectedId: undefined });
  assert.deepEqual([active.shown.map((entry) => entry.id), active.hidden.map((entry) => entry.id)], [["coordinator", "circle", "mira"], ["old"]]);
  const visible = partitionColumnActors(actors, { mode: "visible", onStage, primaryId: "coordinator", selectedId: "old" });
  assert.deepEqual([visible.shown.map((entry) => entry.id), visible.hidden.map((entry) => entry.id)], [["coordinator", "mira", "old"], ["circle"]]);
  const scripts = partitionColumnActors(actors, { mode: "script", onStage, primaryId: "coordinator", selectedId: undefined });
  assert.deepEqual(scripts.shown.map((entry) => entry.id), ["coordinator", "circle"]);
});

test("badges count pending inputs and questions of the element owner or a pending host confirmation", () => {
  assert.equal(pendingInputCount(view, "mira"), 1);
  const definition = { id: "board", width: 1, height: 1, anchorActorId: "circle" };
  assert.equal(elementNeedsAttention(view, definition, false), true);
  assert.equal(elementNeedsAttention(view, { ...definition, anchorActorId: "mira" }, false), false);
  assert.equal(elementNeedsAttention(view, { ...definition, anchorActorId: "mira" }, true), true);
  assert.equal(elementNeedsAttention(undefined, definition, false), false);
});

test("the column state is parsed strictly, maps earlier layouts and keeps room for the mini-app", () => {
  assert.deepEqual(parseColumnState(null), DEFAULT_COLUMN_STATE);
  assert.deepEqual(parseColumnState(JSON.stringify({ element: "board", stageHeight: 300, actor: null })), { element: "board", actor: null, chat: "side", chatWidth: 380 });
  assert.deepEqual(parseColumnState(JSON.stringify({ element: "board", actor: null, chat: "bottom", chatWidth: 420 })), { element: "board", actor: null, chat: "bottom", chatWidth: 420 });
  assert.equal(parseColumnState(JSON.stringify({ element: null, actor: null, chat: "floating" })).chat, "bottom");
  assert.equal(parseColumnState(JSON.stringify({ element: null, actor: null, chat: "docked" })).chat, "bottom");
  assert.equal(parseColumnState(JSON.stringify({ element: null, actor: null, chat: "auto" })).chat, "side");
  assert.throws(() => parseColumnState(JSON.stringify({ element: "board", actor: null, chat: "sheet" })), /ungültig/);
  assert.throws(() => parseColumnState(JSON.stringify({ element: "board", actor: null, chatWidth: 100 })), /ungültig/);
  assert.throws(() => parseColumnState(JSON.stringify({ element: "board", actor: null, extra: 1 })), /ungültig/);
  assert.equal(clampChatWidth(100, 900), 280);
  assert.equal(clampChatWidth(800, 900), 600);
  assert.equal(clampChatWidth(300.6, Number.POSITIVE_INFINITY), 301);
});

test("the column settings are parsed strictly within their limits", () => {
  assert.deepEqual(parseColumnSettings(null), DEFAULT_COLUMN_SETTINGS);
  assert.deepEqual(parseColumnSettings(JSON.stringify({ sideWidth: 1200, openDelay: 0, closeDelay: 800 })), { sideWidth: 1200, openDelay: 0, closeDelay: 800 });
  assert.throws(() => parseColumnSettings(JSON.stringify({ sideWidth: 300, openDelay: 0, closeDelay: 800 })), /ungültig/);
  assert.throws(() => parseColumnSettings(JSON.stringify({ sideWidth: 1200, openDelay: 1.5, closeDelay: 800 })), /ungültig/);
  assert.throws(() => parseColumnSettings(JSON.stringify({ sideWidth: 1200, openDelay: 0 })), /ungültig/);
});

test("the sheet status line names a question, the current work or the last spoken line", () => {
  const message = (role: Message["role"], text: string, extra: Partial<Message> = {}): Message => ({ key: `${role}-${text}`, role, text, ...extra });
  assert.deepEqual(sheetStatus([], false, "coordinator"), { kind: "idle", text: "Noch keine Nachrichten." });
  assert.deepEqual(sheetStatus([message("user", "Bitte\nItem 14760 umsetzen")], false, "coordinator"), { kind: "idle", text: "Du: Bitte" });
  assert.deepEqual(sheetStatus([message("user", "Hallo"), message("assistant", "Ich lese das Item.", { closed: true }), message("tool", "", { tool: { id: "t", name: "read", arguments: "", result: "ok" } })], false, "coordinator"), { kind: "idle", text: "@coordinator: Ich lese das Item." });
  assert.deepEqual(sheetStatus([message("user", "Hallo"), message("thinking", "hm")], true, "coordinator"), { kind: "working", text: "@coordinator denkt ..." });
  assert.deepEqual(sheetStatus([message("tool", "", { tool: { id: "t", name: "bash", arguments: "" } })], true, "coordinator"), { kind: "working", text: "@coordinator nutzt bash ..." });
  assert.deepEqual(sheetStatus([message("assistant", "Ich melde mich", { sender: "@mira" })], true, "coordinator"), { kind: "working", text: "@mira antwortet: Ich melde mich" });
  assert.deepEqual(sheetStatus([message("assistant", "Fertig", { closed: true }), message("question", "Welche App?")], true, "coordinator"), { kind: "question", text: "Rückfrage: Welche App?" });
  assert.equal(sheetStatus([message("assistant", "x".repeat(200), { closed: true })], false, "coordinator").text.length, 160 + "@coordinator: ".length);
});
