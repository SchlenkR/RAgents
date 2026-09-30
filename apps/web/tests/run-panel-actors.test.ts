import assert from "node:assert/strict";
import test from "node:test";
import { runPanelActors, pendingInputCount } from "../../../plugins/ragents.orchestration/web/run-panel/run-panel-actors.ts";
import { DEFAULT_RUN_PANEL_STATE, parseRunPanelState } from "../../../plugins/ragents.orchestration/web/run-panel/run-panel-state.ts";
import type { RunActor, RunView } from "../src/run-view.ts";

const at = "2026-09-17T10:00:00Z";
const actor = (id: string, kind: RunActor["kind"], lifecycle?: RunActor["lifecycle"]): RunActor => ({ id, kind, handle: id, displayName: id, grants: [], createdAt: at, lifecycle });
const view: RunView = {
  id: "run-a", revision: 3, title: "Run", ownerId: "owner", primaryActorId: "coordinator", createdAt: at, forkedFrom: null,
  actors: [actor("owner", "human"), actor("circle", "script", { kind: "idle", since: at }), actor("coordinator", "agent", { kind: "idle", since: at }), actor("mira", "agent", { kind: "running", turnId: "t", inputId: "i", startedAt: at }), actor("old", "agent", { kind: "stopped", stoppedAt: at, reason: "done" })],
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

test("pending inputs stay available to the addressee control", () => {
  assert.equal(pendingInputCount(view, "mira"), 1);
});

test("the run panel stores only app navigation and addressee", () => {
  assert.deepEqual(parseRunPanelState(null), DEFAULT_RUN_PANEL_STATE);
  const state = { element: "board", actor: "worker" };
  assert.deepEqual(parseRunPanelState(JSON.stringify(state)), state);
  for (const invalid of [{}, { ...state, extra: 1 }, { ...state, actor: 12 }, { ...state, element: false }]) {
    assert.throws(() => parseRunPanelState(JSON.stringify(invalid)), /invalid/);
  }
});
