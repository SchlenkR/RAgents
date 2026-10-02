import assert from "node:assert/strict";
import test from "node:test";
import program from "../src/server.ts";
import { setupContext, startInput } from "./helpers.ts";

test("binds the list to the real list helper and assigns its first call", async () => {
  const { calls, context } = setupContext();
  await program.onInput!(startInput({ title: "Team breakfast", firstEntry: "Coffee" }), context);
  assert.deepEqual(calls.map((call) => call.name), ["model_list", "run_configure", "agent_spawn", "actor_program_activate", "actor_input", "actor_input"]);
  assert.equal((calls.find((call) => call.name === "agent_spawn")?.input as { tools: null }).tools, null);
  assert.deepEqual(calls.find((call) => call.name === "actor_program_activate")?.input, { name: "shared-list", actor: "@list-helper" });
  assert.deepEqual(calls.find((call) => call.name === "run_configure")?.input, { title: "Collection board: Team breakfast" });
  const assignment = calls.filter((call) => call.name === "actor_input")[0].input as { to: string; message: string };
  assert.equal(assignment.to, "@list-helper");
  assert.match(assignment.message, /append_to_list/);
  assert.match(assignment.message, /Coffee/);
  assert.deepEqual(context.state.read(), { built: true });
  const completedCalls = calls.length;
  await program.onInput!(startInput(null), context);
  assert.equal(calls.length, completedCalls);
});

test("the default start stays defined and invalid values start nothing", async () => {
  const initial = setupContext();
  await program.onInput!(startInput(null), initial.context);
  assert.match(JSON.stringify(initial.calls), /Hello from the run script/);
  for (const input of [{ title: "Plan" }, { title: "", firstEntry: "Coffee" }, { title: "Plan", firstEntry: "" }, { title: "x".repeat(161), firstEntry: "Coffee" }, { title: "Plan", firstEntry: "Coffee", extra: true }, 3]) {
    const { calls, context } = setupContext();
    await assert.rejects(async () => program.onInput!(startInput(input), context), /start value needs title/);
    assert.deepEqual(calls, []);
    assert.deepEqual(context.state.read(), {});
  }
});

test("uses the actually created handle for binding and task", async () => {
  const { calls, context } = setupContext(undefined, "-2");
  await program.onInput!(startInput(null), context);
  assert.deepEqual(calls.find((call) => call.name === "actor_program_activate")?.input,
    { name: "shared-list", actor: "@list-helper-2" });
  const assignment = calls.find((call) => call.name === "actor_input")?.input as { to: string };
  assert.equal(assignment.to, "@list-helper-2");
});
