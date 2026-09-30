import assert from "node:assert/strict";
import test from "node:test";
import program from "../src/server.ts";
import { setupContext, startInput } from "./helpers.ts";

test("topic and number of rounds control participants and task", async () => {
  const { calls, context } = setupContext();
  await program.onInput!(startInput({ topic: "Team breakfast", rounds: 3 }), context);
  assert.deepEqual(calls.filter((call) => call.name === "agent_spawn").map((call) => (call.input as { handle: string }).handle), ["mira", "jon", "ada"]);
  assert.deepEqual(calls.find((call) => call.name === "run_configure")?.input, { title: "Conversation circle: Team breakfast" });
  assert.match(JSON.stringify(calls.at(-1)), /exactly 3 conversation rounds/);
  assert.deepEqual(context.state.read(), { built: true });
  const completedCalls = calls.length;
  await program.onInput!(startInput(null), context);
  assert.equal(calls.length, completedCalls);
});

test("null has an explicit default, invalid values have no effect", async () => {
  const initial = setupContext();
  await program.onInput!(startInput(null), initial.context);
  assert.match(JSON.stringify(initial.calls), /Should city centers become car-free/);
  assert.match(JSON.stringify(initial.calls.at(-1)), /exactly 2 conversation rounds/);
  for (const input of [{ topic: "Plan" }, { topic: "", rounds: 2 }, { topic: "Plan", rounds: 6 }, { topic: "Plan", rounds: 1.5 }, { topic: "Plan", rounds: 2, extra: true }, "Plan"]) {
    const { calls, context } = setupContext();
    await assert.rejects(async () => program.onInput!(startInput(input), context), /start value needs topic/);
    assert.deepEqual(calls, []);
    assert.deepEqual(context.state.read(), {});
  }
});
