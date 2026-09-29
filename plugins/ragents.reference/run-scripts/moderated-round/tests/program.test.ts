import assert from "node:assert/strict";
import test from "node:test";
import program from "../src/server.ts";
import { setupContext, startInput } from "./helpers.ts";

test("sets up the moderator and guests and hands the chat to the moderator", async () => {
  const { calls, context } = setupContext();
  await program.onInput!(startInput({ topic: "Good collaboration" }), context);
  assert.deepEqual(calls.filter((call) => call.name === "agent_spawn").map((call) => (call.input as { handle: string }).handle), ["moderator", "kai", "lena"]);
  assert.deepEqual(calls.filter((call) => call.name === "agent_spawn").map((call) => (call.input as { tools: string[] }).tools), [["actor_input", "event_subscribe", "event_unsubscribe", "event_subscription_list"], [], []]);
  assert.deepEqual(calls.find((call) => call.name === "run_configure")?.input, { title: "Moderated round: Good collaboration", primaryActor: "@moderator" });
  assert.match(JSON.stringify(calls.at(-1)), /Good collaboration/);
  assert.deepEqual(context.state.read(), { built: true });
  const completedCalls = calls.length;
  await program.onInput!(startInput(null), context);
  assert.equal(calls.length, completedCalls);
});

test("without a usable role the setup stays unchanged", async () => {
  const { calls, context } = setupContext([{ name: "coordinator", driver: "agent" }]);
  await assert.rejects(async () => program.onInput!(startInput(null), context), /No role/);
  assert.deepEqual(calls.map((call) => call.name), ["model_list"]);
  assert.deepEqual(context.state.read(), {});
});
