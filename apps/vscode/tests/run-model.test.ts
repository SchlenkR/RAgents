import assert from "node:assert/strict";
import test from "node:test";
import { runSummaryFrom, sortRuns } from "../src/run-model";
import { runView, session } from "./fixtures";

test("a run summary derives state and pending actions from the run view", () => {
  const summary = runSummaryFrom(session(), runView());
  assert.equal(summary.state, "running");
  assert.equal(summary.pendingActions, 1);
  assert.equal(summary.problem, undefined);
});

test("ended runs need every actor stopped, pending actions make an idle run wait", () => {
  const stopped = runView({ actors: runView().actors.map((actor) => actor.kind === "human" ? actor : { ...actor, lifecycle: { kind: "stopped", stoppedAt: "now", reason: "fertig" } }), actions: [] });
  assert.equal(runSummaryFrom(session({ running: false }), stopped).state, "ended");
  const idle = runView({ actors: runView().actors.map((actor) => actor.id === "mira" ? { ...actor, lifecycle: { kind: "idle", since: "now" } } : actor) });
  assert.equal(runSummaryFrom(session({ running: false }), idle).state, "waiting");
  assert.equal(runSummaryFrom(session({ running: false }), { ...idle, actions: [] }).state, "idle");
});

test("an unreadable run view keeps the run as a list row and names the problem instead of throwing", () => {
  const summary = runSummaryFrom(session({ running: false }), runView({ inputs: [{ actorId: "coordinator" }] as never }));
  assert.equal(summary.state, "idle");
  assert.equal(summary.pendingActions, 0);
  assert.match(summary.problem ?? "", /Die Run-Ansicht ist nicht lesbar: /);
});

test("without a run view the summary keeps the list row", () => {
  assert.deepEqual(runSummaryFrom(session({ running: false, revision: 4 }), undefined), {
    id: "run-a", title: session().title, updatedAt: session().updatedAt, state: "idle", pendingActions: 0,
  });
});

test("runs sort by activity like the web overview", () => {
  const runs = [runSummaryFrom(session({ id: "old", updatedAt: 1 }), undefined), runSummaryFrom(session({ id: "new", updatedAt: 9 }), undefined)];
  assert.deepEqual(sortRuns(runs).map((run) => run.id), ["new", "old"]);
});
