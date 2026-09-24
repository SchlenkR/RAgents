import assert from "node:assert/strict";
import test from "node:test";
import { createTestContext } from "@ragents/server/testing";
import type { ActorInput, CapabilityContracts } from "@ragents/server";
import program from "../src/server.ts";
import { participants, type WordGameState } from "../src/state.ts";

const message = (content: string): ActorInput => ({ id: "input", content, artifactIds: [], sourceEventIds: [], subscriptionId: null, event: null });
const firstInput = message(JSON.stringify({ input: null, options: {} }));
const words = ["Strand", "Sand", "Wüste", "Kamel", "Oase", "Wasser", "Fluss", "Brücke", "Stadt", "Haus", "Garten", "Blume"];
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
      run_configure: async (input) => { calls.push({ name: "run_configure", input }); return []; },
      canvas_layout_replace: async (input) => { calls.push({ name: "canvas_layout_replace", input }); return []; },
      event_subscribe: async (input) => {
        calls.push({ name: "event_subscribe", input });
        return { ...input, includeSelf: false, sourceActorIds: input.sourceActorIds ?? null, sourceActorKinds: null, sources: null,
          status: "active", subscriptionId: "subscription", subscriberId: "test-actor", createdAt: "2026-09-13T12:00:00Z", createdBy: "test-actor", createdSequence: 1 };
      },
      actor_input: async (input) => {
        calls.push({ name: "actor_input", input });
        if (settings.failDispatch) throw new Error("Übergabe fehlgeschlagen");
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
    return { ...message("Ereignis"), subscriptionId: options.subscriptionId ?? "subscription", sourceEventIds: [`${turnId}-finished`],
      event: { type: options.type ?? "turn.finished", eventId: `${turnId}-finished`, sequence: history.length + 1, occurredAt: envelope.occurredAt,
        sourceActorId: actorId, sourceActorHandle: null, payload: { turnId, outcome: options.outcome ?? "completed", reason: "Testunterbrechung" } } };
  };
  const start = async () => {
    await program.onInput(firstInput, context);
    await program.functions.start({}, context);
    await program.onInput(message("START_WORD_GAME"), context);
  };
  return { context, calls, history, settings, response, start };
}

test("richtet vier reine LLMs und die eigene View ohne Modellauftrag ein", async () => {
  const { context, calls } = fixture();
  await program.onInput(firstInput, context);
  assert.equal(context.state.read().status, "ready");
  assert.deepEqual(calls.filter((call) => call.name === "agent_spawn").map((call) => {
    const input = call.input as { handle: string; displayName: string; tools: unknown; profile: string };
    return { handle: input.handle, name: input.displayName, tools: input.tools, profile: input.profile };
  }), participants.map((participant) => ({ ...participant, tools: [], profile: "standard" })));
  assert.equal(calls.some((call) => call.name === "actor_input"), false);
  assert.deepEqual(calls.find((call) => call.name === "run_configure")!.input, { title: "Wortspiel", primaryActor: "test-actor" });
  const before = structuredClone(context.state.read());
  const callCount = calls.length;
  await assert.rejects(async () => program.onInput(firstInput, context), /keine freien Chatnachrichten/);
  assert.deepEqual(context.state.read(), before);
  assert.equal(calls.length, callCount);
});

test("der App-Aufruf schickt nur einen Auftrag an den eigenen Steueractor", async () => {
  const { context, calls } = fixture();
  await program.onInput(firstInput, context);
  assert.deepEqual(await program.functions.start({}, context), { accepted: true });
  assert.deepEqual(calls.at(-1), { name: "actor_input", input: { actor: "test-actor", content: "START_WORD_GAME" } });
  assert.equal(calls.some((call) => call.name === "event_subscribe"), false);
  assert.equal(context.state.read().status, "ready");
});

test("wartet auf spätere Ereignisse, zählt zwölf Beiträge und beendet die Weitergabe", async () => {
  const { context, calls, response, start } = fixture();
  await start();
  assert.deepEqual(calls.slice(-2).map((call) => call.name), ["event_subscribe", "actor_input"]);
  for (const word of words) await program.onInput(response(word), context);
  const inputs = calls.filter((call) => call.name === "actor_input" && (call.input as { actor: string }).actor !== "test-actor");
  assert.equal(inputs.length, 12);
  assert.deepEqual(inputs.map((call) => (call.input as { actor: string }).actor), words.map((_word, index) => `actor-${participants[index % 4]!.handle}`));
  assert.equal(context.state.read().status, "completed");
  assert.equal(context.state.read().entries?.length, 12);
  assert.match(context.state.read().document!, /12\. Grün: Blume/);
  assert.equal(context.state.read().pendingInputId, undefined);
  assert.deepEqual(await program.functions.start({}, context), { accepted: false });
});

test("ignoriert falsche Quellen, fremde Aufträge, falsche Abos und doppelte Ereignisse", async () => {
  const { context, calls, response, start } = fixture();
  await start();
  await program.onInput(response("Fremd", { actorId: "actor-blue" }), context);
  await program.onInput(response("Fremd", { inputId: "foreign-input" }), context);
  await program.onInput(response("Fremd", { subscriptionId: "foreign-subscription" }), context);
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
  { name: "Modellfehler", word: "Strand", options: { outcome: "failed" } },
  { name: "Unterbrechung", word: "Strand", options: { type: "turn.interrupted" } },
  { name: "Mehrwortantwort", word: "Schöner Strand", options: {} },
  { name: "wiederholtes Ausgangswort", word: "sonne", options: {} },
]) {
  test(`${scenario.name} bleibt als Fehler sichtbar und startet nicht erneut`, async () => {
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

test("ein weiterer Start während des Spiels verändert keinen Auftrag oder Fortschritt", async () => {
  const { context, calls, start } = fixture();
  await start();
  const before = calls.length;
  await program.onInput(message("START_WORD_GAME"), context);
  assert.deepEqual(await program.functions.start({}, context), { accepted: false });
  assert.equal(calls.length, before);
});

for (const status of ["ready", "running", "completed"]) {
  test(`freie Chatnachrichten werden bei ${status} abgelehnt und erhalten den Spielstand`, async () => {
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
    const content = "Starte das Wortspiel bitte noch einmal von vorn.";
    await assert.rejects(async () => program.onInput(message(content), context), /keine freien Chatnachrichten.*Startknopf.*neuer Run/);
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

test("eine fehlgeschlagene Übergabe erhält das bereits angenommene Wort", async () => {
  const { context, settings, response, start } = fixture();
  await start();
  settings.failDispatch = true;
  await program.onInput(response("Strand"), context);
  assert.equal(context.state.read().status, "error");
  assert.deepEqual(context.state.read().entries, [{ participant: 0, word: "Strand" }]);
  assert.match(context.state.read().error!, /Übergabe/);
});

test("fehlendes Standardprofil zeigt einen Fehler ohne Teilnehmer anzulegen", async () => {
  const { context, settings, calls } = fixture();
  settings.missingProfile = true;
  await program.onInput(firstInput, context);
  assert.equal(context.state.read().status, "error");
  assert.match(context.state.read().error!, /Rolle standard fehlt/);
  assert.deepEqual(calls.map((call) => call.name), ["run_configure", "canvas_layout_replace", "model_list"]);
});

test("ein wiederhergestellter Zustand zählt den wartenden Auftrag weiter und baut nichts neu", async () => {
  const previous = fixture();
  await previous.start();
  await program.onInput(previous.response(words[0]!), previous.context);
  const restored = fixture(previous.context.state.read());
  const before = structuredClone(restored.context.state.read());
  await assert.rejects(async () => program.onInput(firstInput, restored.context), /keine freien Chatnachrichten/);
  assert.deepEqual(restored.context.state.read(), before);
  assert.equal(restored.calls.length, 0);
  await program.onInput(restored.response(words[1]!), restored.context);
  assert.equal(restored.context.state.read().entries?.length, 2);
  assert.equal(restored.context.state.read().status, "running");
  assert.equal(restored.calls.some((call) => call.name === "agent_spawn"), false);
});

test("fehlende oder mehrfache Modellausgaben werden nicht als Wort übernommen", async () => {
  for (const count of [0, 2]) {
    const { context, history, response, start } = fixture();
    await start();
    const input = response("Strand");
    const output = history.pop()!;
    for (let index = 0; index < count; index++) history.push({ ...output, eventId: `output-${index}` });
    await program.onInput(input, context);
    assert.equal(context.state.read().status, "error");
    assert.equal(context.state.read().entries?.length, 0);
  }
});

test("ungültige Startdaten bleiben als Fehler sichtbar und starten kein Modell", async () => {
  for (const content of ["kein JSON", JSON.stringify({ input: "Strand", options: {} }), JSON.stringify({ input: null, options: [] })]) {
    const { context, calls } = fixture();
    await program.onInput(message(content), context);
    assert.equal(context.state.read().status, "error");
    assert.equal(calls.some((call) => call.name === "agent_spawn"), false);
  }
});

test("akzeptiert die Startoptionen des Profils ohne eigene Modellvorgaben daraus abzuleiten", async () => {
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

test("ein gestoppter aktueller Teilnehmer hält das Spiel an", async () => {
  const { context, response, start } = fixture();
  await start();
  await program.onInput(response("Strand", { type: "actor.stopped" }), context);
  assert.equal(context.state.read().status, "error");
  assert.match(context.state.read().error!, /Rot wurde gestoppt/);
  assert.equal(context.state.read().entries?.length, 0);
});
