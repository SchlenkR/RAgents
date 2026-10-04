import assert from "node:assert/strict";
import test from "node:test";
import program from "../src/server.ts";
import { message, setupContext, start } from "./helpers.ts";

test("topic and number of rounds control participants and task", async () => {
  const { calls, context } = setupContext();
  await program.onStart!(start({ topic: "Team breakfast", rounds: 3 }), context);
  assert.deepEqual(calls.filter((call) => call.name === "agent_spawn").map((call) => (call.input as { name: string }).name), ["mira", "jon", "ada"]);
  assert.deepEqual(calls.filter((call) => call.name === "agent_spawn").map((call) => (call.input as { description: string }).description), ["asks curious questions", "voices polite disagreement", "looks for common ground"]);
  assert.deepEqual(calls.find((call) => call.name === "run_configure")?.input, { title: "Conversation circle: Team breakfast" });
  assert.match(JSON.stringify(calls.at(-1)), /exactly 3 conversation rounds/);
  assert.deepEqual(context.state.read(), { built: true });
  const completedCalls = calls.length;
  await program.onStart!(start(null), context);
  await program.onInput!(message("Hello"), context);
  assert.equal(calls.length, completedCalls);
});

test("the coordinator gets the participants' addresses from the main room, in the room this start actually opened", async () => {
  const task = async (room: string | null) => {
    const { calls, context } = setupContext();
    await program.onStart!(start(null, room), context);
    return calls.at(-1)?.input as { to: string; message: string };
  };
  const repeated = await task("conversation-circle-2");
  assert.equal(repeated.to, "@coordinator");
  assert.match(repeated.message, /^The circle is ready: @conversation-circle-2\.mira, @conversation-circle-2\.jon, @conversation-circle-2\.ada are set up\./);
  assert.match((await task(null)).message, /^The circle is ready: @mira, @jon, @ada are set up\./);
});

test("null has an explicit default, invalid values have no effect", async () => {
  const initial = setupContext();
  await program.onStart!(start(null), initial.context);
  assert.match(JSON.stringify(initial.calls), /Should city centers become car-free/);
  assert.match(JSON.stringify(initial.calls.at(-1)), /exactly 2 conversation rounds/);
  for (const input of [{ topic: "Plan" }, { topic: "", rounds: 2 }, { topic: "Plan", rounds: 6 }, { topic: "Plan", rounds: 1.5 }, { topic: "Plan", rounds: 2, extra: true }, "Plan"]) {
    const { calls, context } = setupContext();
    await assert.rejects(async () => program.onStart!(start(input), context), /start value needs topic/);
    assert.deepEqual(calls, []);
    assert.deepEqual(context.state.read(), {});
  }
});
