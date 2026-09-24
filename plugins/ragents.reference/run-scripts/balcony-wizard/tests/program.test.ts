import assert from "node:assert/strict";
import test from "node:test";
import { createTestContext } from "@ragents/server/testing";
import program from "../src/server.js";

const input = { id: "start", content: JSON.stringify({ input: null, options: {} }), artifactIds: [], sourceEventIds: [], subscriptionId: null, event: null };

function setup(options: { missingProfile?: boolean; failActivation?: boolean } = {}) {
  const calls: { name: string; input: unknown }[] = [];
  const functions = Object.fromEntries([
    "model_list", "agent_spawn", "actor_program_activate", "canvas_layout_replace", "run_configure",
  ].map((name) => [name, (value: unknown) => {
    calls.push({ name, input: value });
    if (name === "model_list") return { profiles: options.missingProfile ? [] : [{ name: "standard", driver: "agent", description: "Testprofil", turnTimeoutMs: null, isolateWorkspace: false, provider: "test", model: "test" }], models: [] };
    if (name === "agent_spawn") {
      const handle = (value as { handle: string }).handle;
      return { id: `actor-${handle}`, handle };
    }
    if (name === "actor_program_activate" && options.failActivation) throw new Error("View kann nicht aktiviert werden.");
    if (name === "actor_program_activate") {
      const activation = value as { name: string; actor: string };
      return { name: activation.name, actor: activation.actor, views: 1, active: true };
    }
    return [];
  }]));
  const context = createTestContext<{ built?: boolean }>({ state: {}, functions });
  return { calls, context };
}

test("richtet einen Berater ohne Werkzeuge und seine eigene Mini-App als einzige Kachel ein", async () => {
  const { calls, context } = setup();
  await program.onInput!(input, context);
  assert.deepEqual(calls.map((call) => call.name), ["model_list", "agent_spawn", "actor_program_activate", "canvas_layout_replace", "run_configure"]);
  assert.deepEqual(calls.find((call) => call.name === "agent_spawn")?.input, {
    handle: "balcony-advisor", displayName: "Balkon-Berater", profile: "standard", tools: [],
    prompt: (calls[1]!.input as { prompt: string }).prompt,
  });
  assert.deepEqual(calls[2]!.input, { name: "balcony-app", actor: "@balcony-advisor" });
  assert.deepEqual(calls[3]!.input, { root: { entity: "app:@balcony-advisor/main" } });
  assert.deepEqual(calls[4]!.input, { title: "Dein Balkon", primaryActor: "@balcony-advisor" });
  assert.deepEqual(context.state.read(), { built: true });
  await program.onInput!(input, context);
  assert.equal(calls.length, 5);
});

test("fehlende Rolle baut keinen unbrauchbaren Berater", async () => {
  const { calls, context } = setup({ missingProfile: true });
  await assert.rejects(async () => program.onInput!(input, context), /Rolle standard fehlt/);
  assert.deepEqual(calls.map((call) => call.name), ["model_list"]);
  assert.deepEqual(context.state.read(), {});
});

test("eine fehlgeschlagene View-Aktivierung setzt weder Fläche noch Erfolgszustand", async () => {
  const options = { failActivation: true };
  const { calls, context } = setup(options);
  await assert.rejects(async () => program.onInput!(input, context), /View kann nicht aktiviert/);
  assert.deepEqual(calls.map((call) => call.name), ["model_list", "agent_spawn", "actor_program_activate"]);
  assert.deepEqual(context.state.read(), {});
});
