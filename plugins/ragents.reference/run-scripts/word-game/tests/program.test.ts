import assert from "node:assert/strict";
import test from "node:test";
import { createTestContext } from "@ragents/server/testing";
import type { ActorInput, CapabilityContracts } from "@ragents/server";
import program from "../src/server.ts";
import { participants, type WordGameState } from "../src/state.ts";

const message = (content: string): ActorInput => ({ id: "input", content, artifactIds: [], sourceEventIds: [], subscriptionId: null, event: null });
const firstInput = message(JSON.stringify({ input: null, options: {} }));
const words = ["Beach", "Sand", "Desert", "Camel", "Oasis", "Water", "River", "Bridge", "City", "House", "Garden", "Flower"];
type History = CapabilityContracts["event_query"]["output"];

function fixture(initialState: WordGameState = {}) {
  const calls: { name: string; input: unknown }[] = [];
  const history: History = [];
  const settings = { missingProfile: false, failDispatch: false };
  const context = createTestContext<WordGameState>({
    state: initialState,
    functions: {
      model_list: async (input) => {
        calls.push({ name: "model_list", input });
        return { profiles: settings.missingProfile ? [] : [{ name: "standard", driver: "agent", description: "Test", turnTimeoutMs: null, isolateWorkspace: false, provider: "test", model: "test" }], models: [] };
      },
      agent_spawn: async (input) => {
        calls.push({ name: "agent_spawn", input });
        return { id: `actor-${input.handle}`, handle: input.handle };
      },
      run_configure: async (input) => { calls.push({ name: "run_configure", input }); return null; },
      canvas_layout_replace: async (input) => { calls.push({ name: "canvas_layout_replace", input }); return null; },
      event_subscribe: async (input) => {
        calls.push({ name: "event_subscribe", input });
        return { subscriptionId: "subscription", sources: input.sourceActorIds ?? null };
      },
      actor_input: async (input) => {
        calls.push({ name: "actor_input", input });
        if (settings.failDispatch) throw new Error("Handover failed");
        return [{ type: "actor.input.enqueued", payload: { actorId: input.actor, inputId: `request-${calls.length}` } }];
      },
      event_query: async (input) => { calls.push({ name: "event_query", input }); return history.filter((event) => input.actorIds?.includes(event.actorId)); },
    },
  });

  const response = (word: string, options: { actorId?: string; inputId?: string; outcome?: string; type?: string; subscriptionId?: string } = {}): ActorInput => {
    const state = context.state.read();
    const index = state.entries?.length ?? 0;
    const actorId = options.actorId ?? state.participants![index % 4]!.id;
    const turnId = `turn-${history.length}`;
    const envelope = { actorId, causationId: null, commandId: "test", correlationId: null, occurredAt: "2026-09-13T12:00:00Z", runId: "test", schemaVersion: 3 as const };
    history.push({ ...envelope, eventId: `${turnId}-start`, sequence: history.length + 1, type: "turn.started", payload: { turnId, inputId: options.inputId ?? state.pendingInputId } });
    history.push({ ...envelope, eventId: `${turnId}-output`, sequence: history.length + 1, type: "model.output.completed", payload: { turnId, text: word } });
    return { ...message("Event"), subscriptionId: options.subscriptionId ?? "subscription", sourceEventIds: [`${turnId}-finished`],
      event: { type: options.type ?? "turn.finished", eventId: `${turnId}-finished`, sequence: history.length + 1, occurredAt: envelope.occurredAt,
        sourceActorId: actorId, sourceActorHandle: null, payload: { turnId, outcome: options.outcome ?? "completed", reason: "Test interruption" } } };
  };
  const start = async () => {
    await program.onInput(firstInput, context);
    await program.functions.start({}, context);
    await program.onInput(message("START_WORD_GAME"), context);
  };
  return { context, calls, history, settings, response, start };
}

test("sets up four plain LLMs and its own view without a model task", async () => {
  const { context, calls } = fixture();
  await program.onInput(firstInput, context);
  assert.equal(context.state.read().status, "ready");
  assert.deepEqual(calls.filter((call) => call.name === "agent_spawn").map((call) => {
    const input = call.input as { handle: string; displayName: string; tools: unknown; profile: string };
    return { handle: input.handle, name: input.displayName, tools: input.tools, profile: input.profile };
  }), participants.map((participant) => ({ ...participant, tools: [], profile: "standard" })));
  assert.equal(calls.some((call) => call.name === "actor_input"), false);
  assert.deepEqual(calls.find((call) => call.name === "run_configure")!.input, { title: "Word game", primaryActor: "test-actor" });
  const before = structuredClone(context.state.read());
  const callCount = calls.length;
  await assert.rejects(async () => program.onInput(firstInput, context), /does not understand free chat messages/);
  assert.deepEqual(context.state.read(), before);
  assert.equal(calls.length, callCount);
});

test("the app call sends only one task to its own control actor", async () => {
  const { context, calls } = fixture();
  await program.onInput(firstInput, context);
  assert.deepEqual(await program.functions.start({}, context), { accepted: true });
  assert.deepEqual(calls.at(-1), { name: "actor_input", input: { actor: "test-actor", content: "START_WORD_GAME" } });
  assert.equal(calls.some((call) => call.name === "event_subscribe"), false);
  assert.equal(context.state.read().status, "ready");
});

test("waits for later events, counts twelve contributions, and ends the handover", async () => {
  const { context, calls, response, start } = fixture();
  await start();
  assert.deepEqual(calls.slice(-2).map((call) => call.name), ["event_subscribe", "actor_input"]);
  for (const word of words) await program.onInput(response(word), context);
  const inputs = calls.filter((call) => call.name === "actor_input" && (call.input as { actor: string }).actor !== "test-actor");
  assert.equal(inputs.length, 12);
  assert.deepEqual(inputs.map((call) => (call.input as { actor: string }).actor), words.map((_word, index) => `actor-${participants[index % 4]!.handle}`));
  assert.equal(context.state.read().status, "completed");
  assert.equal(context.state.read().entries?.length, 12);
  assert.match(context.state.read().document!, /12\. Green: Flower/);
  assert.equal(context.state.read().pendingInputId, undefined);
  assert.deepEqual(await program.functions.start({}, context), { accepted: false });
});

test("ignores wrong sources, foreign tasks, wrong subscriptions, and duplicate events", async () => {
  const { context, calls, response, start } = fixture();
  await start();
  await program.onInput(response("Foreign", { actorId: "actor-blue" }), context);
  await program.onInput(response("Foreign", { inputId: "foreign-input" }), context);
  await program.onInput(response("Foreign", { subscriptionId: "foreign-subscription" }), context);
  assert.equal(context.state.read().entries?.length, 0);
  const first = response(words[0]!);
  await program.onInput(first, context);
  await program.onInput(first, context);
  for (const word of words.slice(1, 4)) await program.onInput(response(word), context);
  const before = calls.filter((call) => call.name === "actor_input").length;
  await program.onInput(first, context);
  assert.equal(context.state.read().entries?.length, 4);
  assert.equal(calls.filter((call) => call.name === "actor_input").length, before);
});

for (const scenario of [
  { name: "model error", word: "Beach", options: { outcome: "failed" } },
  { name: "interruption", word: "Beach", options: { type: "turn.interrupted" } },
  { name: "multi-word answer", word: "Beautiful beach", options: {} },
  { name: "repeated starting word", word: "sun", options: {} },
]) {
  test(`${scenario.name} stays visible as an error and does not start again`, async () => {
    const { context, calls, response, start } = fixture();
    await start();
    await program.onInput(response(scenario.word, scenario.options), context);
    assert.equal(context.state.read().status, "error");
    assert.ok(context.state.read().error);
    const before = calls.length;
    await program.onInput(message("START_WORD_GAME"), context);
    assert.deepEqual(await program.functions.start({}, context), { accepted: false });
    assert.equal(calls.length, before);
    assert.equal(context.state.read().entries?.length, 0);
  });
}

test("another start during the game changes no task or progress", async () => {
  const { context, calls, start } = fixture();
  await start();
  const before = calls.length;
  await program.onInput(message("START_WORD_GAME"), context);
  assert.deepEqual(await program.functions.start({}, context), { accepted: false });
  assert.equal(calls.length, before);
});

for (const status of ["ready", "running", "completed"]) {
  test(`free chat messages are rejected when ${status} and keep the game state`, async () => {
    const { context, calls, response } = fixture();
    await program.onInput(firstInput, context);
    if (status !== "ready") {
      await program.onInput(message("START_WORD_GAME"), context);
      const contributions = status === "completed" ? words : words.slice(0, 1);
      for (const word of contributions) await program.onInput(response(word), context);
    }
    assert.equal(context.state.read().status, status);
    const before = structuredClone(context.state.read());
    const callCount = calls.length;
    const content = "Please start the word game again from the beginning.";
    await assert.rejects(async () => program.onInput(message(content), context), /does not understand free chat messages.*start button.*new run/);
    assert.deepEqual(context.state.read(), before);
    assert.equal(calls.length, callCount);
    if (status === "ready") {
      await program.onInput(message("START_WORD_GAME"), context);
      assert.equal(context.state.read().status, "running");
    } else if (status === "running") {
      for (const word of words.slice(1)) await program.onInput(response(word), context);
      assert.equal(context.state.read().status, "completed");
      assert.equal(context.state.read().entries?.length, 12);
    }
  });
}

test("a failed handover keeps the word already accepted", async () => {
  const { context, settings, response, start } = fixture();
  await start();
  settings.failDispatch = true;
  await program.onInput(response("Beach"), context);
  assert.equal(context.state.read().status, "error");
  assert.deepEqual(context.state.read().entries, [{ participant: 0, word: "Beach" }]);
  assert.match(context.state.read().error!, /Handover/);
});

test("a missing standard profile shows an error without creating participants", async () => {
  const { context, settings, calls } = fixture();
  settings.missingProfile = true;
  await program.onInput(firstInput, context);
  assert.equal(context.state.read().status, "error");
  assert.match(context.state.read().error!, /role standard is missing/);
  assert.deepEqual(calls.map((call) => call.name), ["run_configure", "canvas_layout_replace", "model_list"]);
});

test("a restored state keeps counting the pending task and rebuilds nothing", async () => {
  const previous = fixture();
  await previous.start();
  await program.onInput(previous.response(words[0]!), previous.context);
  const restored = fixture(previous.context.state.read());
  const before = structuredClone(restored.context.state.read());
  await assert.rejects(async () => program.onInput(firstInput, restored.context), /does not understand free chat messages/);
  assert.deepEqual(restored.context.state.read(), before);
  assert.equal(restored.calls.length, 0);
  await program.onInput(restored.response(words[1]!), restored.context);
  assert.equal(restored.context.state.read().entries?.length, 2);
  assert.equal(restored.context.state.read().status, "running");
  assert.equal(restored.calls.some((call) => call.name === "agent_spawn"), false);
});

test("missing or multiple model outputs are not taken as a word", async () => {
  for (const count of [0, 2]) {
    const { context, history, response, start } = fixture();
    await start();
    const input = response("Beach");
    const output = history.pop()!;
    for (let index = 0; index < count; index++) history.push({ ...output, eventId: `output-${index}` });
    await program.onInput(input, context);
    assert.equal(context.state.read().status, "error");
    assert.equal(context.state.read().entries?.length, 0);
  }
});

test("invalid start data stays visible as an error and starts no model", async () => {
  for (const content of ["no JSON", JSON.stringify({ input: "Beach", options: {} }), JSON.stringify({ input: null, options: [] })]) {
    const { context, calls } = fixture();
    await program.onInput(message(content), context);
    assert.equal(context.state.read().status, "error");
    assert.equal(calls.some((call) => call.name === "agent_spawn"), false);
  }
});

test("accepts the profile start options without deriving its own model settings from them", async () => {
  const { context, calls } = fixture();
  await program.onInput(message(JSON.stringify({ input: null, options: {
    "ragents.model": { model: "test-model", thinking: "off" },
    "ragents.system-prompt": { promptIds: [], shareWithAgents: false },
  } })), context);
  assert.equal(context.state.read().status, "ready");
  assert.equal(calls.filter((call) => call.name === "agent_spawn").length, 4);
  assert.ok(calls.filter((call) => call.name === "agent_spawn").every((call) => (call.input as { profile: string }).profile === "standard"));
  assert.equal(calls.some((call) => call.name === "actor_input"), false);
});

test("a stopped current participant halts the game", async () => {
  const { context, response, start } = fixture();
  await start();
  await program.onInput(response("Beach", { type: "actor.stopped" }), context);
  assert.equal(context.state.read().status, "error");
  assert.match(context.state.read().error!, /Red was stopped/);
  assert.equal(context.state.read().entries?.length, 0);
});
