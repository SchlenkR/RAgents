import assert from "node:assert/strict";
import test from "node:test";
import program from "../src/server.ts";
import { setupContext, startInput } from "./helpers.ts";

test("stellt Moderator und Gäste auf und übergibt ihm den Chat", async () => {
  const { calls, context } = setupContext();
  await program.onInput!(startInput({ topic: "Gute Zusammenarbeit" }), context);
  assert.deepEqual(calls.filter((call) => call.name === "agent_spawn").map((call) => (call.input as { handle: string }).handle), ["moderator", "kai", "lena"]);
  assert.deepEqual(calls.filter((call) => call.name === "agent_spawn").map((call) => (call.input as { tools: string[] }).tools), [["actor_input", "event_subscribe", "event_unsubscribe", "event_subscription_list"], [], []]);
  assert.deepEqual(calls.find((call) => call.name === "run_configure")?.input, { title: "Moderierte Runde: Gute Zusammenarbeit", primaryActor: "@moderator" });
  assert.match(JSON.stringify(calls.at(-1)), /Gute Zusammenarbeit/);
  assert.deepEqual(context.state.read(), { built: true });
  const completedCalls = calls.length;
  await program.onInput!(startInput(null), context);
  assert.equal(calls.length, completedCalls);
});

test("ohne ein nutzbares Agentenprofil bleibt der Aufbau unverändert", async () => {
  const { calls, context } = setupContext([{ name: "coordinator", driver: "agent" }]);
  await assert.rejects(async () => program.onInput!(startInput(null), context), /Kein Agentenprofil/);
  assert.deepEqual(calls.map((call) => call.name), ["model_list"]);
  assert.deepEqual(context.state.read(), {});
});
