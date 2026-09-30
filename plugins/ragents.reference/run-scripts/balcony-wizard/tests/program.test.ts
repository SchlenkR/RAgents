import assert from "node:assert/strict";
import test from "node:test";
import { createTestContext } from "@ragents/server/testing";
import program from "../src/server.js";

const input = { id: "start", content: JSON.stringify({ input: null, options: {} }), artifactIds: [], sourceEventIds: [], subscriptionId: null, event: null };

function setup(options: { missingProfile?: boolean; failActivation?: boolean } = {}) {
  const calls: { name: string; input: unknown }[] = [];
  const functions = Object.fromEntries([
    "model_list", "agent_spawn", "actor_program_activate", "run_configure",
  ].map((name) => [name, (value: unknown) => {
    calls.push({ name, input: value });
    if (name === "model_list") return { profiles: options.missingProfile ? [] : [{ name: "standard", driver: "agent", description: "Test profile", turnTimeoutMs: null, isolateWorkspace: false, provider: "test", model: "test" }], models: [] };
    if (name === "agent_spawn") {
      const handle = (value as { handle: string }).handle;
      return { id: `actor-${handle}`, handle };
    }
    if (name === "actor_program_activate" && options.failActivation) throw new Error("View cannot be activated.");
    if (name === "actor_program_activate") {
      const activation = value as { name: string; actor: string };
      return { name: activation.name, actor: activation.actor, views: 1, active: true };
    }
    return null;
  }]));
  const context = createTestContext<{ built?: boolean }>({ state: {}, functions });
  return { calls, context };
}

test("sets up an advisor without tools and its own mini-app in the app catalog", async () => {
  const { calls, context } = setup();
  await program.onInput!(input, context);
  assert.deepEqual(calls.map((call) => call.name), ["model_list", "agent_spawn", "actor_program_activate", "run_configure"]);
  assert.deepEqual(calls.find((call) => call.name === "agent_spawn")?.input, {
    handle: "balcony-advisor", displayName: "Balcony advisor", profile: "standard", tools: [],
    prompt: (calls[1]!.input as { prompt: string }).prompt,
  });
  assert.deepEqual(calls[2]!.input, { name: "balcony-app", actor: "@balcony-advisor" });
  assert.deepEqual(calls[3]!.input, { title: "Your balcony", primaryActor: "@balcony-advisor" });
  assert.deepEqual(context.state.read(), { built: true });
  await program.onInput!(input, context);
  assert.equal(calls.length, 4);
});

test("a missing role builds no unusable advisor", async () => {
  const { calls, context } = setup({ missingProfile: true });
  await assert.rejects(async () => program.onInput!(input, context), /role standard is missing/);
  assert.deepEqual(calls.map((call) => call.name), ["model_list"]);
  assert.deepEqual(context.state.read(), {});
});

test("a failed view activation neither configures the run nor marks setup complete", async () => {
  const options = { failActivation: true };
  const { calls, context } = setup(options);
  await assert.rejects(async () => program.onInput!(input, context), /View cannot be activated/);
  assert.deepEqual(calls.map((call) => call.name), ["model_list", "agent_spawn", "actor_program_activate"]);
  assert.deepEqual(context.state.read(), {});
});
