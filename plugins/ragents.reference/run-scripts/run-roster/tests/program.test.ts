import assert from "node:assert/strict";
import test from "node:test";
import { createTestContext } from "@ragents/server/testing";
import program from "../src/server.ts";

const start = { input: null, options: {}, embedded: true, startedBy: "owner-id", count: 1 };
const actor = (handle: string, kind: "human" | "agent" | "script", lifecycle = "idle") =>
  ({ id: `id-${handle}`, handle, displayName: handle, kind, lifecycle, createdBy: null, description: null, toolCount: null });

const roster = (actors: ReturnType<typeof actor>[], state: { reports?: number } = {}) => {
  const calls: { name: string; input: unknown }[] = [];
  const record = <T>(name: string, answer: T) => (input: unknown): T => { calls.push({ name, input }); return answer; };
  const context = createTestContext<{ reports?: number }>({ state, functions: {
    actor_list: record("actor_list", actors),
    actor_program_ensure: record("actor_program_ensure", { actorId: "id-notebook", handle: "notebook", status: "active" as const }),
    actor_input: record("actor_input", []),
  } });
  return { calls, context };
};

test("reports the other participants as result and summary and notes them in the shared notebook", async () => {
  const { calls, context } = roster([actor("owner", "human"), actor("coordinator", "agent", "running"), actor("helper", "agent"), actor("test", "script")]);
  await program.onStart!(start, context);
  assert.deepEqual(context.finished, [{
    result: { actors: [{ handle: "coordinator", kind: "agent", lifecycle: "running" }, { handle: "helper", kind: "agent", lifecycle: "idle" }] },
    summary: "2 participants: @coordinator, @helper.",
  }]);
  assert.deepEqual(calls.slice(1).map((call) => [call.name, call.input]), [
    ["actor_program_ensure", { name: "notebook" }],
    ["actor_input", { actor: "@notebook", content: "Roster: 2 participants: @coordinator, @helper." }],
  ]);
  assert.deepEqual(context.state.read(), { reports: 1 });
});

test("a run without other participants still gets a result, and every start counts", async () => {
  const { context } = roster([actor("owner", "human"), actor("test", "script")], { reports: 2 });
  await program.onStart!({ ...start, embedded: false, count: 3 }, context);
  assert.deepEqual(context.finished, [{ result: { actors: [] }, summary: "No other participants yet." }]);
  assert.deepEqual(context.state.read(), { reports: 3 });
});

test("an ordinary message is refused", async () => {
  const { context } = roster([]);
  await assert.rejects(async () => program.onInput!({ id: "input-1", content: "hello", artifactIds: [], sourceEventIds: [], subscriptionId: null, event: null }, context), /answers only starts/);
});
