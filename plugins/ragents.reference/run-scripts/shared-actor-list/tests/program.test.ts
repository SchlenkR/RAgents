import assert from "node:assert/strict";
import test from "node:test";
import program from "../src/server.ts";
import { setupContext, startInput } from "./helpers.ts";

test("bindet die Liste an den echten Listenhelfer und beauftragt seinen ersten Aufruf", async () => {
  const { calls, context } = setupContext();
  await program.onInput!(startInput({ title: "Teamfrühstück", firstEntry: "Kaffee" }), context);
  assert.deepEqual(calls.map((call) => call.name), ["model_list", "run_configure", "agent_spawn", "actor_program_activate", "actor_input", "actor_input"]);
  assert.equal((calls.find((call) => call.name === "agent_spawn")?.input as { tools: null }).tools, null);
  assert.deepEqual(calls.find((call) => call.name === "actor_program_activate")?.input, { name: "shared-list", actor: "@listenhelfer" });
  assert.deepEqual(calls.find((call) => call.name === "run_configure")?.input, { title: "Sammelboard: Teamfrühstück" });
  const assignment = calls.filter((call) => call.name === "actor_input")[0].input as { actor: string; content: string };
  assert.equal(assignment.actor, "@listenhelfer");
  assert.match(assignment.content, /append_to_list/);
  assert.match(assignment.content, /Kaffee/);
  assert.deepEqual(context.state.read(), { built: true });
  const completedCalls = calls.length;
  await program.onInput!(startInput(null), context);
  assert.equal(calls.length, completedCalls);
});

test("Standardstart bleibt definiert und ungültige Werte starten nichts", async () => {
  const initial = setupContext();
  await program.onInput!(startInput(null), initial.context);
  assert.match(JSON.stringify(initial.calls), /Hallo aus dem Run-Script/);
  for (const input of [{ title: "Plan" }, { title: "", firstEntry: "Kaffee" }, { title: "Plan", firstEntry: "" }, { title: "x".repeat(161), firstEntry: "Kaffee" }, { title: "Plan", firstEntry: "Kaffee", extra: true }, 3]) {
    const { calls, context } = setupContext();
    await assert.rejects(async () => program.onInput!(startInput(input), context), /Startwert braucht title/);
    assert.deepEqual(calls, []);
    assert.deepEqual(context.state.read(), {});
  }
});

test("verwendet den tatsächlich erzeugten Handle für Bindung und Auftrag", async () => {
  const { calls, context } = setupContext(undefined, "-2");
  await program.onInput!(startInput(null), context);
  assert.deepEqual(calls.find((call) => call.name === "actor_program_activate")?.input,
    { name: "shared-list", actor: "@listenhelfer-2" });
  const assignment = calls.find((call) => call.name === "actor_input")?.input as { actor: string };
  assert.equal(assignment.actor, "@listenhelfer-2");
});
