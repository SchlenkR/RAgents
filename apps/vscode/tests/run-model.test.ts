import assert from "node:assert/strict";
import test from "node:test";
import { runSummaryFrom, sortRuns, textArtifact } from "../src/run-model";
import { runView, session } from "./fixtures";

test("a run summary derives state, actors, apps, artifacts and questions from the run view", () => {
  const summary = runSummaryFrom(session(), runView());
  assert.equal(summary.loaded, true);
  assert.equal(summary.state, "running");
  assert.equal(summary.activeActors, 1);
  assert.equal(summary.questions, 1);
  assert.equal(summary.events, 12);
  assert.deepEqual(summary.actors.map((actor) => [actor.handle, actor.role, actor.status, actor.pendingInputs, actor.questions]), [
    ["coordinator", "coordinator", "idle", 0, 0],
    ["mira", "agent", "running", 0, 0],
    ["jon", "agent", "waiting", 2, 1],
    ["conversation-circle", "script", "stopped", 0, 0],
  ]);
  assert.deepEqual(summary.apps.map((app) => [app.id, app.title, app.actorHandle, app.questions]), [
    ["decision--main", "Entscheidung", "jon", 1],
  ]);
  assert.deepEqual(summary.artifacts.map((artifact) => artifact.title), ["protokoll.md"]);
});

test("stopped owners drop their apps, ended runs need every actor stopped, questions make an idle run wait", () => {
  const stopped = runView({ actors: runView().actors.map((actor) => actor.kind === "human" ? actor : { ...actor, lifecycle: { kind: "stopped", stoppedAt: "now", reason: "fertig" } }), actions: [] });
  assert.equal(runSummaryFrom(session({ running: false }), stopped).state, "ended");
  assert.equal(runSummaryFrom(session({ running: false }), stopped).apps.length, 0);
  const idle = runView({ actors: runView().actors.map((actor) => actor.id === "mira" ? { ...actor, lifecycle: { kind: "idle", since: "now" } } : actor) });
  assert.equal(runSummaryFrom(session({ running: false }), idle).state, "waiting");
  assert.equal(runSummaryFrom(session({ running: false }), { ...idle, actions: [] }).state, "idle");
});

test("without a run view the summary keeps the list row and reports it as not loaded", () => {
  const summary = runSummaryFrom(session({ running: false, revision: 4 }), undefined);
  assert.equal(summary.loaded, false);
  assert.equal(summary.state, "idle");
  assert.equal(summary.events, 4);
  assert.deepEqual(summary.actors, []);
});

test("runs sort by activity like the web overview and text artifacts open as documents", () => {
  const runs = [runSummaryFrom(session({ id: "old", updatedAt: 1 }), undefined), runSummaryFrom(session({ id: "new", updatedAt: 9 }), undefined)];
  assert.deepEqual(sortRuns(runs).map((run) => run.id), ["new", "old"]);
  assert.equal(textArtifact({ id: "a", title: "a.md", mediaType: "text/markdown", size: 1 }), true);
  assert.equal(textArtifact({ id: "a", title: "a.json", mediaType: "application/json", size: 1 }), true);
  assert.equal(textArtifact({ id: "a", title: "a.png", mediaType: "image/png", size: 1 }), false);
});
