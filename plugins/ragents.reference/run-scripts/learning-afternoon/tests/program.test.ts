import assert from "node:assert/strict";
import test from "node:test";
import type { ActorInput, CapabilityContracts } from "@ragents/server";
import { createTestContext } from "@ragents/server/testing";
import program from "../src/server.ts";
import type { LearningState } from "../src/state.ts";

const inputOf = (content: string): ActorInput => ({ id: "input", content, artifactIds: [], sourceEventIds: [], subscriptionId: null, event: null });
const setupInput = inputOf(JSON.stringify({ input: null, options: {} }));
const startInput = inputOf("START_LEARNING_AFTERNOON");
const eventOf = (helper: string, type: string, payload: Record<string, unknown>, eventId = `${helper}-${type}`): ActorInput => ({
  ...inputOf(""),
  subscriptionId: "ideas",
  sourceEventIds: [eventId],
  event: { type, eventId, sequence: 1, occurredAt: "2026-09-13T12:00:00.000Z", sourceActorId: `actor-learning-${helper}`, sourceActorHandle: `learning-${helper}`, payload: { turnId: `turn-${helper}`, ...payload } },
});

function setup(options: { missingProfile?: boolean; failDispatch?: string; beforeDispatch?: (actor: string) => Promise<void> } = {}) {
  const calls: { name: string; input: unknown }[] = [];
  const history: CapabilityContracts["event_query"]["output"] = [];
  const functions = Object.fromEntries([
    "model_list", "agent_spawn", "canvas_layout_replace", "run_configure", "actor_input", "event_subscribe", "event_unsubscribe", "event_query",
  ].map((name) => [name, async (input: unknown) => {
    calls.push({ name, input });
    if (name === "model_list") return { profiles: options.missingProfile ? [] : [{ name: "standard", driver: "agent", description: "Testprofil", turnTimeoutMs: null, isolateWorkspace: false, provider: "test", model: "test" }], models: [] };
    if (name === "agent_spawn") {
      const handle = (input as { handle: string }).handle;
      return { id: `actor-${handle}`, handle };
    }
    if (name === "event_subscribe") return { subscriptionId: "ideas", sources: ["@learning-experiment", "@learning-quiz"] };
    if (name === "event_query") return history.filter((event) => (input as { actorIds: string[] }).actorIds.includes(event.actorId));
    if (name === "actor_input") {
      const actor = (input as { actor: string }).actor;
      await options.beforeDispatch?.(actor);
      if (actor === options.failDispatch) throw new Error("Auftrag konnte nicht gesendet werden.");
      return [{ type: "actor.input.enqueued", payload: { actorId: `actor-${actor.slice(1)}`, inputId: `input-${actor.slice(1)}` } }];
    }
    return null;
  }]));
  return { calls, context: Object.assign(createTestContext<{ board?: LearningState; subscriptionId?: string }>({ state: {}, functions }), { history }) };
}

function record(context: ReturnType<typeof setup>["context"], helper: string, type: string, payload: Record<string, unknown>) {
  context.history.push({ eventId: `event-${context.history.length}`, actorId: `actor-learning-${helper}`, causationId: null, commandId: "test", correlationId: null,
    occurredAt: "2026-09-13T12:00:00Z", runId: "test", schemaVersion: 3, sequence: context.history.length + 1, type, payload: { turnId: `turn-${helper}`, ...payload } });
}

async function begin(context: ReturnType<typeof setup>["context"]) {
  await program.onInput(setupInput, context);
  await program.onInput(startInput, context);
  for (const helper of ["experiment", "quiz"]) record(context, helper, "turn.started", { inputId: `input-learning-${helper}` });
}

async function complete(context: ReturnType<typeof setup>["context"], helper: string, text: string) {
  record(context, helper, "model.output.completed", { text });
  await program.onInput(eventOf(helper, "turn.finished", { outcome: "completed" }), context);
}

test("Start richtet nur zwei reine Helfer und die eigene App ein; erst der Button stellt einen Auftrag an den Besitzer", async () => {
  const { context, calls } = setup();
  await program.onInput(setupInput, context);
  assert.equal(context.state.read().board?.phase, "ready");
  assert.equal(calls.filter((call) => call.name === "agent_spawn").length, 2);
  for (const call of calls.filter((call) => call.name === "agent_spawn")) {
    assert.deepEqual((call.input as { tools: string[] }).tools, []);
    assert.equal((call.input as { profile: string }).profile, "standard");
  }
  assert.equal(calls.some((call) => call.name === "actor_input" || call.name === "event_subscribe"), false);
  const before = structuredClone(context.state.read());
  const callCount = calls.length;
  await assert.rejects(async () => program.onInput(setupInput, context), /keine freien Chatnachrichten/);
  assert.deepEqual(context.state.read(), before);
  assert.equal(calls.length, callCount);
  await program.functions.start({}, context);
  assert.deepEqual(calls.at(-1), { name: "actor_input", input: { actor: "@test", content: "START_LEARNING_AFTERNOON" } });
  assert.equal(context.state.read().board?.phase, "ready");
});

test("der Input-Handler abonniert zuerst und sendet beide unabhängigen Aufträge parallel genau einmal", async () => {
  const pending: (() => void)[] = [];
  const { context, calls } = setup({ beforeDispatch: () => new Promise<void>((resolve) => pending.push(resolve)) });
  await program.onInput(setupInput, context);
  const starting = program.onInput(startInput, context);
  for (let attempt = 0; attempt < 20 && pending.length < 2; attempt++) await Promise.resolve();
  assert.equal(pending.length, 2, "Beide Inputs beginnen, bevor einer fertig ist.");
  assert.equal(calls.filter((call) => call.name === "event_subscribe").length, 1);
  for (const resolve of pending) resolve();
  await starting;
  await program.onInput(startInput, context);
  await program.functions.start({}, context);
  assert.equal(calls.filter((call) => call.name === "actor_input").length, 2);
  assert.equal(context.state.read().board?.phase, "working");
});

for (const phase of ["ready", "working", "complete"]) {
  test(`freie Chatnachrichten werden bei ${phase} abgelehnt und erhalten die Ideen`, async () => {
    const { context, calls } = setup();
    if (phase === "ready") {
      await program.onInput(setupInput, context);
    } else {
      await begin(context);
      await complete(context, "experiment", "Die Experimentidee ist fertig.");
      if (phase === "complete") await complete(context, "quiz", "Die Quizidee ist fertig.");
    }
    assert.equal(context.state.read().board?.phase, phase);
    const before = structuredClone(context.state.read());
    const callCount = calls.length;
    const content = "Sammle bitte noch einmal neue Ideen für den Lernnachmittag.";
    await assert.rejects(async () => program.onInput(inputOf(content), context), /keine freien Chatnachrichten.*Startknopf.*neuer Run/);
    assert.deepEqual(context.state.read(), before);
    assert.equal(calls.length, callCount);
    if (phase === "ready") {
      await program.onInput(startInput, context);
      assert.equal(context.state.read().board?.phase, "working");
    } else if (phase === "working") {
      await complete(context, "quiz", "Die Quizidee ist fertig.");
      assert.equal(context.state.read().board?.phase, "complete");
      assert.equal(context.state.read().board?.helpers[0]?.text, "Die Experimentidee ist fertig.");
    }
  });
}

for (const order of [["experiment", "quiz"], ["quiz", "experiment"]]) {
  test(`sammelt Antworten in beliebiger Reihenfolge: ${order.join(", ")}`, async () => {
    const { context, calls } = setup();
    await begin(context);
    await complete(context, order[0]!, "Erste echte Antwort");
    assert.equal(context.state.read().board?.phase, "working");
    await complete(context, order[1]!, "Zweite echte Antwort");
    const board = context.state.read().board!;
    assert.equal(board.phase, "complete");
    assert.equal(board.helpers.find((helper) => helper.id === order[0])?.text, "Erste echte Antwort");
    assert.equal(board.helpers.find((helper) => helper.id === order[1])?.text, "Zweite echte Antwort");
    assert.equal(calls.filter((call) => call.name === "event_unsubscribe").length, 1);
    for (let count = 0; count < 10; count++) await complete(context, order[0]!, "Späte Antwort");
    assert.deepEqual(context.state.read().board, board);
    assert.equal(calls.filter((call) => call.name === "actor_input").length, 2);
  });
}

test("ignoriert falsche Actors, Inputs, Turns, Abos und doppelte Antworten", async () => {
  const { context } = setup();
  await program.onInput(setupInput, context);
  await program.onInput(startInput, context);
  record(context, "experiment", "turn.started", { inputId: "fremd", turnId: "fremd" });
  record(context, "experiment", "model.output.completed", { text: "Fremd", turnId: "fremd" });
  record(context, "experiment", "turn.started", { inputId: "input-learning-experiment" });
  record(context, "experiment", "model.output.completed", { text: "Meine Idee" });
  const before = context.state.read();
  await program.onInput(eventOf("foreign", "turn.finished", { outcome: "completed" }), context);
  await program.onInput(eventOf("experiment", "turn.finished", { outcome: "completed", turnId: "fremd" }), context);
  await program.onInput({ ...eventOf("experiment", "turn.finished", { outcome: "completed" }), subscriptionId: "fremd" }, context);
  assert.deepEqual(context.state.read(), before);
  const answer = eventOf("experiment", "turn.finished", { outcome: "completed" });
  await program.onInput(answer, context);
  await program.onInput(answer, context);
  assert.equal(context.state.read().board?.helpers[0]?.text, "Meine Idee");
  assert.equal(context.state.read().board?.helpers[0]?.status, "complete");
});

for (const ending of ["failed", "interrupted", "empty", "stopped"]) {
  test(`ein ${ending}-Ergebnis erhält die erfolgreiche Idee des anderen Helfers`, async () => {
    const { context, calls } = setup();
    await begin(context);
    await complete(context, "quiz", "Das Quiz ist fertig.");
    await program.onInput(eventOf("experiment", ending === "stopped" ? "actor.stopped" : ending === "interrupted" ? "turn.interrupted" : "turn.finished", { outcome: ending === "empty" ? "completed" : "failed", ...(ending === "empty" ? {} : { reason: "Modellfehler" }) }), context);
    assert.equal(context.state.read().board?.phase, "error");
    assert.equal(context.state.read().board?.helpers[0]?.status, "error");
    assert.ok(context.state.read().board?.helpers[0]?.error);
    assert.equal(context.state.read().board?.helpers[1]?.text, "Das Quiz ist fertig.");
    assert.equal(calls.filter((call) => call.name === "actor_input").length, 2);
    assert.equal(calls.filter((call) => call.name === "event_unsubscribe").length, 1);
  });
}

test("ein gescheiterter Input verhindert den Auftrag des anderen Helfers nicht", async () => {
  const { context } = setup({ failDispatch: "@learning-experiment" });
  await begin(context);
  assert.equal(context.state.read().board?.helpers[0]?.status, "error");
  assert.equal(context.state.read().board?.phase, "working");
  await complete(context, "quiz", "Eine Quizidee.");
  assert.equal(context.state.read().board?.phase, "error");
  assert.equal(context.state.read().board?.helpers[1]?.status, "complete");
});

test("ohne Standardprofil wird kein Helfer angelegt", async () => {
  const { context, calls } = setup({ missingProfile: true });
  await assert.rejects(async () => program.onInput(setupInput, context), /Rolle standard fehlt/);
  assert.deepEqual(calls.map((call) => call.name), ["model_list"]);
  assert.deepEqual(context.state.read(), {});
});

test("der gemeinsame Ablauf liefert Helferaufträge, Prompt und parallele Graphzweige", async () => {
  const { learningWorkflow, helperSteps } = await import("../src/workflow.ts");
  const { learningWorkflowState, initialState } = await import("../src/state.ts");
  const { workflowGraph } = await import("@ragents/workflow");
  const { context, calls } = setup();
  await begin(context);
  const spawns = calls.filter((call) => call.name === "agent_spawn");
  assert.equal(spawns.length, helperSteps.length);
  for (const spawn of spawns) {
    const prompt = (spawn.input as { prompt: string }).prompt;
    assert.match(prompt, /Bearbeite ausschließlich diese Aufgabe/);
    assert.match(prompt, /Beispielfrage/);
    assert.match(prompt, /gefährliche Stoffe/);
  }
  assert.deepEqual(calls.filter((call) => call.name === "actor_input").map((call) => (call.input as { content: string }).content), helperSteps.map((step) => step.goal));
  const initial = workflowGraph(learningWorkflow, learningWorkflowState(initialState));
  assert.ok(initial.nodes.every((node) => node.status === "pending"));
  assert.deepEqual(initial.edges.map((edge) => [edge.source, edge.target]), [["experiment", "collect"], ["quiz", "collect"]]);
  await complete(context, "quiz", "Eine Quizidee.");
  const partial = workflowGraph(learningWorkflow, learningWorkflowState(context.state.read().board!));
  assert.deepEqual(partial.nodes.map((node) => [node.id, node.status]), [["experiment", "active"], ["quiz", "done"], ["collect", "active"]]);
  await program.onInput(eventOf("experiment", "actor.stopped", {}), context);
  const failed = workflowGraph(learningWorkflow, learningWorkflowState(context.state.read().board!));
  assert.deepEqual(failed.nodes.map((node) => [node.id, node.status]), [["experiment", "blocked"], ["quiz", "done"], ["collect", "blocked"]]);
  assert.match(failed.nodes.find((node) => node.id === "collect")!.detail!, /1 von 2/);
});
