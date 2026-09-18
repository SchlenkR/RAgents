import assert from "node:assert/strict";
import test from "node:test";
import { claimTurn } from "../src/agents/turn.ts";
import { manualExecution } from "../src/domain/driver.ts";
import { project, viewOf } from "../src/domain/projection.ts";
import { postTo, setupRun } from "./support.ts";

test("tool call projections separate actors and reused ids and replay completion, failure and interruption", () => {
  const setup = setupRun();
  const { runtime, view, agent } = setup;
  try {
    const spawned = runtime.spawnAgent({ actorId: view.ownerId, commandId: "spawn-reviewer" }, view.id, {
      handle: "reviewer", displayName: "Reviewer", prompt: "Review.", execution: manualExecution(), grants: [], toolNames: [],
    });
    const reviewer = spawned.actors.find((actor) => actor.handle === "reviewer")!;
    const start = (actorId: string, name: string) => {
      const queued = postTo(runtime, view, actorId, `input-${name}`, name);
      const input = queued.inputs.find((entry) => entry.actorId === actorId && entry.lifecycle.kind === "pending")!;
      return claimTurn(runtime, view.id, actorId, input.id, `turn-${name}`);
    };
    const first = start(agent.id, "first");
    const other = start(reviewer.id, "other");
    const context = (turn: typeof first, step: string) => ({ actorId: turn.actorId, turnId: turn.turnId, commandId: `${turn.turnId}-${step}` });
    const beginCall = (turn: typeof first) => runtime.startToolCall(context(turn, "start"), view.id, turn.actorId, { turnId: turn.turnId, toolCallId: "same", name: "read", input: { privateBody: "not in projection" } });
    beginCall(first);
    beginCall(other);
    const projected = () => runtime.view(view.id).turns;
    assert.deepEqual(projected().map((turn) => turn.toolCalls.map((call) => call.status)), [["running"], ["running"]]);
    assert.equal(JSON.stringify(projected()).includes("privateBody"), false);
    runtime.completeToolCall(context(first, "complete"), view.id, first.actorId, { turnId: first.turnId, toolCallId: "same", name: "read", output: "private result" });
    runtime.failToolCall(context(other, "fail"), view.id, other.actorId, { turnId: other.turnId, toolCallId: "same", name: "read", error: "failure details" });
    assert.deepEqual(projected().map((turn) => turn.toolCalls[0]?.status), ["completed", "failed"]);
    assert.ok(projected().every((turn) => turn.toolCalls[0]?.finishedAt));
    runtime.finishTurn(context(first, "finish"), view.id, first.actorId, { turnId: first.turnId, outcome: "completed" });
    const next = start(agent.id, "next");
    beginCall(next);
    runtime.interruptTurn(context(next, "stop"), view.id, next.actorId, { turnId: next.turnId, reason: "Stopped" });
    assert.equal(projected().find((turn) => turn.id === first.turnId)?.toolCalls[0]?.status, "completed");
    const interrupted = projected().find((turn) => turn.id === next.turnId)!;
    assert.equal(interrupted.toolCalls[0]?.status, "interrupted");
    assert.equal(interrupted.toolCalls[0]?.finishedAt, interrupted.finishedAt);
    const replayed = project(runtime.events(view.id));
    assert.ok(replayed);
    assert.deepEqual(viewOf(replayed).turns, projected());
  } finally {
    setup.journal.close();
  }
});
