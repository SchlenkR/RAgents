import assert from "node:assert/strict";
import test from "node:test";
import { activeActivity, activitySourceFrom, elapsedLabel } from "../../../plugins/ragents.activity/web/activity.ts";

const at = (seconds: number) => `2026-01-01T00:00:0${seconds}.000Z`;
const tool = (id: string, name = "bash", seconds = 1, status = "running") => ({ id, name, startedAt: at(seconds), finishedAt: status === "running" ? null : at(9), status });
const turn = (id: string, actorId = "primary", toolCalls: unknown[] = [], status = "running") => ({ id, actorId, status, startedAt: at(0), finishedAt: status === "running" ? null : at(9), toolCalls });
const view = (turns: unknown[]) => ({ primaryActorId: "primary", actors: [{ id: "primary", handle: "moderator" }, { id: "worker", handle: "checker", displayName: "Prüfer" }], turns });
const state = (turns: unknown[]) => activeActivity(activitySourceFrom(view(turns)));
const toolId = (turnId: string, callId: string) => `tool:${JSON.stringify([turnId, callId])}`;

test("running tools are projected for primary and secondary actors with their identity", () => {
  assert.deepEqual(state([turn("a", "primary", [tool("read", "read")]), turn("b", "worker", [tool("check", "actor_program_diagnostics")])]).entries, [
    { id: toolId("a", "read"), kind: "tool", label: "read", startedAt: at(1) },
    { id: toolId("b", "check"), kind: "tool", label: "Prüfer: actor_program_diagnostics", startedAt: at(1) },
  ]);
});

test("completed, failed and interrupted calls are not active", () => {
  const result = state([turn("a", "primary", [tool("done", "read", 1, "completed"), tool("error", "read", 2, "failed"), tool("stop", "read", 3, "interrupted")])]);
  assert.deepEqual(result, { entries: [], hidden: 0 });
});

test("terminal turns cannot retain visible running tools", () => {
  for (const status of ["completed", "failed", "interrupted"]) assert.deepEqual(state([turn("a", "worker", [tool("call")], status)]), { entries: [], hidden: 0 });
});

test("the actor turn is represented by its running tools and returns when they finish", () => {
  const running = state([turn("a", "worker", [tool("call")])]);
  assert.equal(running.entries.length, 1);
  assert.equal(running.entries[0]?.kind, "tool");
  const finished = state([turn("a", "worker", [tool("call", "bash", 1, "completed")])]);
  assert.deepEqual(finished.entries, [{ id: "turn:a", kind: "turn", label: "Prüfer", startedAt: at(0) }]);
});

test("call ids belong to their turn and are never merged between agents or reused turns", () => {
  const result = state([turn("a", "primary", [tool("same")]), turn("b", "worker", [tool("same")]), turn("old", "primary", [tool("same", "bash", 1, "completed")], "completed")]);
  assert.deepEqual(result.entries.map((entry) => entry.id), [toolId("a", "same"), toolId("b", "same")]);
  assert.equal(result.hidden, 0);
});

test("primary turn filtering uses its id before counting entries", () => {
  const source = { primaryActorId: "other", actors: [{ id: "other", handle: "moderator" }, { id: "primary", handle: "coordinator" }], turns: [turn("a", "other"), turn("b", "primary")] };
  assert.deepEqual(activeActivity(activitySourceFrom(source)).entries.map((entry) => entry.label), ["coordinator"]);
});

test("tool entries precede turns, are sorted oldest first and determine the hidden count once", () => {
  const result = state([turn("primary-turn", "primary", [tool("late", "read", 4), tool("early", "bash", 1)]), turn("worker-turn", "worker", [tool("middle", "write", 2), tool("third", "edit", 3)]), turn("thinking", "other")]);
  assert.deepEqual(result.entries.map((entry) => entry.id), [toolId("primary-turn", "early"), toolId("worker-turn", "middle"), toolId("worker-turn", "third")]);
  assert.equal(result.hidden, 2);
});

test("actor handles and ids are used when no display name is available", () => {
  assert.deepEqual(activeActivity(activitySourceFrom({ actors: [{ id: "a", handle: "reviewer" }], turns: [turn("a", "a"), turn("b", "missing")] })).entries.map((entry) => entry.label), ["reviewer", "missing"]);
});

test("missing run data has no activities and invalid calls cannot become chips", () => {
  assert.deepEqual(activeActivity(activitySourceFrom(undefined)), { entries: [], hidden: 0 });
  assert.deepEqual(state([turn("a", "primary", [{ id: "broken" }])]), { entries: [], hidden: 0 });
  assert.equal(activitySourceFrom({ turns: "no" }).turns.length, 0);
});

test("elapsed time handles seconds, minutes, hours and absent timestamps", () => {
  const start = at(0);
  const now = (seconds: number) => Date.parse(start) + seconds * 1000;
  assert.equal(elapsedLabel(start, now(12)), "12s");
  assert.equal(elapsedLabel(start, now(65)), "1:05");
  assert.equal(elapsedLabel(start, now(3720)), "1h 2m");
  assert.equal(elapsedLabel(start, now(-5)), "0s");
  assert.equal(elapsedLabel(undefined, now(5)), undefined);
  assert.equal(elapsedLabel("kein Zeitpunkt", now(5)), undefined);
});
