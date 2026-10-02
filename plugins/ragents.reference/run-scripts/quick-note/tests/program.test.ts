import assert from "node:assert/strict";
import test from "node:test";
import { createTestContext } from "@ragents/server/testing";
import program from "../src/server.ts";

const start = (input: unknown) => ({ input, options: {}, embedded: true, startedBy: "owner-id", count: 1 });

const note = (status: "active" | "installed" = "installed") => {
  const calls: { name: string; input: unknown }[] = [];
  const record = <T>(name: string, answer: T) => (input: unknown): T => { calls.push({ name, input }); return answer; };
  const context = createTestContext<Record<string, never>>({ state: {}, functions: {
    actor_program_ensure: record("actor_program_ensure", { actorId: "id-notebook", handle: "notebook", status }),
    actor_input: record("actor_input", []),
  } });
  return { calls, context };
};

test("sends the note to the shared notebook and reports it", async () => {
  const { calls, context } = note();
  await program.onStart!(start({ text: "  Ask about the budget  " }), context);
  assert.deepEqual(calls.map((call) => [call.name, call.input]), [
    ["actor_program_ensure", { name: "notebook" }],
    ["actor_input", { to: "@notebook", message: "Ask about the budget" }],
  ]);
  assert.deepEqual(context.finished, [{ result: { note: "Ask about the budget", notebook: "installed" }, summary: "Noted: Ask about the budget" }]);
});

test("without a start value it notes when it started; an invalid value changes nothing", async () => {
  const { calls, context } = note("active");
  await program.onStart!(start(null), context);
  assert.match(String((calls[1]!.input as { message: string }).message), /^Started at /);
  const invalid = note();
  await assert.rejects(async () => program.onStart!(start({ text: "" }), invalid.context), /start value/);
  assert.deepEqual(invalid.calls, []);
  assert.deepEqual(invalid.context.finished, []);
});

test("an ordinary message is refused", async () => {
  const { context } = note();
  await assert.rejects(async () => program.onInput!({ id: "input-1", content: "hello", artifactIds: [], sourceEventIds: [], subscriptionId: null, event: null }, context), /answers only starts/);
});
