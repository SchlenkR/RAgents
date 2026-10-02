import assert from "node:assert/strict";
import test from "node:test";
import { executionFor, postTo, setupRun } from "../../../packages/ragents/tests/support.ts";
import { runListStateOf } from "../src/run-list-state.ts";

test("the list state follows running work, open actions, and stopped actors of the journal", (t) => {
  const { journal, runtime, view, agent } = setupRun();
  t.after(() => journal.close());
  const of = (running = false) => runListStateOf(runtime.state(view.id), running);
  assert.deepEqual(of(), { state: "idle", pendingActions: 0 });
  assert.deepEqual(of(true), { state: "running", pendingActions: 0 }, "a running session counts as running work");

  const proposed = runtime.proposeAction({ actorId: view.ownerId, commandId: "propose" }, view.id, { owner: "ragents.ask", title: "Continue?" });
  assert.deepEqual(of(), { state: "waiting", pendingActions: 1 });
  assert.deepEqual(of(true), { state: "running", pendingActions: 1 }, "running work comes before an open question");

  runtime.stopActor({ actorId: view.ownerId, commandId: "stop" }, view.id, agent.id, "Done");
  assert.deepEqual(of(), { state: "waiting", pendingActions: 1 }, "an open question keeps a run with stopped actors waiting");
  runtime.resolveAction({ actorId: view.ownerId, commandId: "resolve" }, view.id, proposed.actions[0]!.id, { decision: "dismissed" });
  assert.deepEqual(of(), { state: "ended", pendingActions: 0 }, "every actor stopped and nothing open");
});

test("a pending input keeps the run from ending, a running turn makes it run", (t) => {
  const { journal, runtime, view, agent } = setupRun();
  t.after(() => journal.close());
  const spawned = runtime.spawnAgent({ actorId: view.ownerId, commandId: "spawn-second" }, view.id, {
    handle: "second", displayName: "Second", prompt: "Help.", execution: executionFor("second", { profile: "agent", isolateWorkspace: false }), grants: [], toolNames: null,
  });
  const second = spawned.actors.find((actor) => actor.kind === "agent" && actor.id !== agent.id)!;
  runtime.stopActor({ actorId: view.ownerId, commandId: "stop-first" }, view.id, agent.id, "Done");
  const queued = postTo(runtime, view, second.id, "post-second", "Task");
  assert.deepEqual(runListStateOf(runtime.state(view.id), false), { state: "idle", pendingActions: 0 }, "the waiting second actor is not stopped");
  const input = queued.inputs.find((entry) => entry.actorId === second.id && entry.lifecycle.kind === "pending")!;
  runtime.startTurn({ actorId: second.id, commandId: "turn-second" }, view.id, second.id, input.id);
  assert.deepEqual(runListStateOf(runtime.state(view.id), false), { state: "running", pendingActions: 0 }, "a running turn in the journal counts even without the scheduler flag");
});

test("a paused run shows paused before running work and open actions, but a run whose actors all stopped is not paused", (t) => {
  const { journal, runtime, view, agent } = setupRun();
  t.after(() => journal.close());
  const of = (running = false) => runListStateOf(runtime.state(view.id), running);
  const input = postTo(runtime, view, agent.id, "post", "Task").inputs.at(-1)!;
  runtime.startTurn({ actorId: agent.id, commandId: "turn" }, view.id, agent.id, input.id);
  const proposed = runtime.proposeAction({ actorId: view.ownerId, commandId: "propose" }, view.id, { owner: "ragents.ask", title: "Continue?" });
  runtime.pauseRun({ actorId: view.ownerId, commandId: "pause" }, view.id, { reason: "Paused" });
  assert.deepEqual(of(true), { state: "paused", pendingActions: 1 }, "the pause comes before the turn that is still being interrupted and the open question");

  runtime.resumeRun({ actorId: view.ownerId, commandId: "resume" }, view.id, {});
  assert.deepEqual(of(), { state: "running", pendingActions: 1 });

  runtime.pauseRun({ actorId: view.ownerId, commandId: "pause-again" }, view.id, { reason: "Paused again" });
  runtime.stopActor({ actorId: view.ownerId, commandId: "stop" }, view.id, agent.id, "Done");
  assert.deepEqual(of(), { state: "waiting", pendingActions: 1 }, "with every actor stopped the pause holds nobody; the open question still waits");
  runtime.resolveAction({ actorId: view.ownerId, commandId: "resolve" }, view.id, proposed.actions[0]!.id, { decision: "dismissed" });
  assert.deepEqual(of(), { state: "ended", pendingActions: 0 }, "ended comes before paused");
});
