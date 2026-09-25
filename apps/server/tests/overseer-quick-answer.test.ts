import { unavailableActorPrograms } from "./actor-programs-fixture.ts";
import assert from "node:assert/strict";
import test from "node:test";
import { Value } from "typebox/value";
import { Journal, LiveBus, Orchestration, type ToolScope } from "@ragents/engine";
import { manualExecution, testServices } from "../../../packages/ragents/tests/support.ts";
import { OVERSEER_PLUGIN_ID, QUICK_ANSWER_MAX_LENGTH } from "../../../plugins/ragents.overseer/contract.ts";
import { coordinatorRunId } from "../../../plugins/ragents.overseer/server/coordinator.ts";
import { createQuickAnswerTool } from "../../../plugins/ragents.overseer/server/quick-answer.ts";
import type { ChatEvent } from "../src/chat-events.ts";
import type { Engine } from "../src/ragents/engine.ts";
import { RunChatSession } from "../src/ragents/session.ts";

const fixture = (runId = coordinatorRunId("alice")) => {
  const services = testServices();
  const journal = new Journal(":memory:", services);
  const runtime = new Orchestration(journal, services);
  let view = runtime.createRun({ commandId: "create" }, { runId, title: "Coordinator", ownerHandle: "owner", ownerDisplayName: "Owner" });
  view = runtime.spawnAgent({ actorId: view.ownerId, commandId: "spawn" }, runId, {
    handle: "coordinator", displayName: "Koordinator", prompt: "", execution: manualExecution(),
    grants: [{ capability: "plugin.state.write", scope: { kind: "run" }, delegable: false }], toolNames: ["quick_answer"],
  });
  let actor = view.actors.find((entry) => entry.kind === "agent")!;
  view = runtime.selectPrimaryActor({ actorId: view.ownerId, commandId: "select" }, runId, actor.id);
  view = runtime.enqueueInput({ actorId: view.ownerId, commandId: "input" }, runId, { actorId: actor.id, content: "Prüfen" });
  view = runtime.startTurn({ actorId: actor.id, commandId: "turn" }, runId, actor.id, view.inputs.at(-1)!.id);
  actor = view.actors.find((entry) => entry.id === actor.id)!;
  assert.ok(actor.kind === "agent" && actor.lifecycle.kind === "running");
  const turnId = actor.lifecycle.turnId;
  const scope = {
    runtime, caller: { runId, actorId: actor.id, turnId },
    context: (toolCallId: string) => ({ actorId: actor.id, commandId: toolCallId, turnId }),
  } as unknown as ToolScope;
  const sessions: RunChatSession[] = [];
  const createSession = () => {
    const session = new RunChatSession({
    engine: { runtime, journal, live: new LiveBus(), scheduler: { isRunning: () => false } } as unknown as Engine,
    id: runId, coordinator: { handle: "coordinator", displayName: "Koordinator", profile: "coordinator", runTitle: "Coordinator", ownerHandle: "owner", ownerDisplayName: "Owner" },
    prompt: () => "", assertUsable: () => {}, prepare: async () => {}, prepareWorkspace: async () => {}, started: async () => {},
    scriptEntryFor: () => undefined, startEntryFor: () => undefined, actorPrograms: unavailableActorPrograms,
    });
    sessions.push(session);
    return session;
  };
  return { runtime, journal, view, actor, scope, session: createSession(), createSession, close: () => { for (const session of sessions) session.dispose(); journal.close(); } };
};

test("quick_answer is restricted to the global primary agent, including direct execution", () => {
  const global = fixture();
  const ordinary = fixture("ordinary-run");
  const tool = createQuickAnswerTool();
  try {
    assert.equal(tool.available(global.actor, global.view), true);
    const single = fixture(coordinatorRunId(null));
    try { assert.equal(tool.available(single.actor, single.view), true, "also the one coordinator without login"); } finally { single.close(); }
    assert.equal(tool.available(ordinary.actor, ordinary.view), false);
    assert.equal(tool.available({ ...global.actor, id: "secondary" }, global.view), false);
    assert.equal(tool.available({ ...global.actor, grants: [] }, global.view), false);
    assert.throws(() => tool.run(ordinary.scope, "forbidden", { question: "Ist die Prüfung abgeschlossen?", text: "Erledigt." } as never), /nur dem globalen Koordinator/);
    assert.equal(ordinary.runtime.events(ordinary.view.id).some((event) => event.type === "plugin.state-replaced"), false);
  } finally { global.close(); ordinary.close(); }
});

test("quick_answer requires and trims both bounded single-line question and answer before writing the journal", () => {
  const data = fixture();
  const tool = createQuickAnswerTool();
  const valid = { question: "Ist die Prüfung abgeschlossen?", text: "Die Prüfung ist abgeschlossen." };
  try {
    assert.equal(Value.Check(tool.schema, valid), true);
    for (const input of [{}, { text: valid.text }, { question: valid.question }]) {
      assert.equal(Value.Check(tool.schema, input), false);
      assert.throws(() => tool.run(data.scope, "missing", input as never), /1 bis 240 Zeichen/);
    }
    for (const field of ["question", "text"] as const) {
      assert.equal(Value.Check(tool.schema, { ...valid, [field]: "x".repeat(QUICK_ANSWER_MAX_LENGTH + 1) }), false);
      for (const value of [null, 42, "", " \t ", "x".repeat(QUICK_ANSWER_MAX_LENGTH + 1), "Erste Zeile\nZweite Zeile", "Erste Zeile\rZweite Zeile"]) {
        assert.throws(() => tool.run(data.scope, "invalid", { ...valid, [field]: value } as never), new RegExp(`${field} muss.*1 bis 240 Zeichen`));
      }
    }
    assert.equal(data.runtime.events(data.view.id).some((event) => event.type === "plugin.state-replaced"), false);
    assert.deepEqual(tool.run(data.scope, "answer", { question: `  ${valid.question}  `, text: `  ${valid.text}  ` } as never), { ok: true });
    const recorded = data.runtime.events(data.view.id).at(-1)!;
    assert.equal(recorded.type, "plugin.state-replaced");
    assert.deepEqual(recorded.payload, { pluginId: OVERSEER_PLUGIN_ID, scope: { kind: "run" }, state: { kind: "quick-answer", ...valid } });
    const boundary = { question: "q".repeat(QUICK_ANSWER_MAX_LENGTH), text: "a".repeat(QUICK_ANSWER_MAX_LENGTH) };
    assert.equal(Value.Check(tool.schema, boundary), true);
    assert.deepEqual(tool.run(data.scope, "limit", boundary as never), { ok: true });
  } finally { data.close(); }
});

test("quick answers stream as persisted plugin events with stable event identities through reconnect and fresh replay", () => {
  const data = fixture();
  const tool = createQuickAnswerTool();
  try {
    data.session.attach();
    const live: ChatEvent[] = [];
    data.session.subscribe((event) => live.push(event));
    assert.equal(live.at(-1)?.kind, "replay-end");
    tool.run(data.scope, "first-answer", { question: "Ist die Prüfung abgeschlossen?", text: "Die Prüfung ist abgeschlossen." } as never);
    tool.run(data.scope, "first-answer", { question: "Ist die Prüfung abgeschlossen?", text: "Die Prüfung ist abgeschlossen." } as never);
    tool.run(data.scope, "second-answer", { question: "Ist die Prüfung abgeschlossen?", text: "Auch der Build ist erfolgreich." } as never);
    const answers = live.filter((event) => event.kind === "plugin");
    assert.equal(answers.length, 2);
    assert.deepEqual(answers[0].payload, { scope: { kind: "run" }, state: { kind: "quick-answer", question: "Ist die Prüfung abgeschlossen?", text: "Die Prüfung ist abgeschlossen." } });
    assert.equal(answers[0].pluginId, OVERSEER_PLUGIN_ID);
    assert.equal(answers[0].type, "state-replaced");
    const journal = data.runtime.events(data.view.id);
    const recorded = journal.filter((event) => event.type === "plugin.state-replaced" || event.type === "plugin.state-patched");
    assert.equal(recorded[1].type, "plugin.state-patched");
    assert.deepEqual(answers.map((event) => event.journal), recorded.map((event) => ({ conversationId: journal[0].eventId, eventId: event.eventId, sequence: event.sequence })));
    assert.notEqual(answers[0].journal?.eventId, answers[1].journal?.eventId);
    const replay: ChatEvent[] = [];
    data.session.subscribe((event) => replay.push(event))();
    assert.deepEqual(replay.filter((event) => event.kind === "plugin"), answers);
    assert.equal(replay.at(-1)?.kind, "replay-end");
    data.session.dispose();
    const fresh = data.createSession();
    fresh.attach();
    const restored: ChatEvent[] = [];
    fresh.subscribe((event) => restored.push(event))();
    assert.deepEqual(restored.filter((event) => event.kind === "plugin"), answers);
  } finally { data.close(); }
});
