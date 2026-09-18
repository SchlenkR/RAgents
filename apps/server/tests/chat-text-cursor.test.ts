import { unavailableActorPrograms } from "./actor-programs-fixture.ts";
import assert from "node:assert/strict";
import test from "node:test";
import { Journal, LiveBus, Orchestration } from "@aicontainer/ragents";
import { manualExecution } from "../../../packages/ragents/src/domain/driver.ts";
import { testServices } from "../../../packages/ragents/tests/support.ts";
import { applyEvent, type ChatEvent, type Message } from "../src/chat-events.ts";
import type { Engine } from "../src/ragents/engine.ts";
import { RunChatSession } from "../src/ragents/session.ts";

const fixture = () => {
  const services = testServices();
  const journal = new Journal(":memory:", services);
  const runtime = new Orchestration(journal, services);
  const live = new LiveBus();
  const engine = { journal, runtime, live, scheduler: { isRunning: () => false } } as unknown as Engine;
  const createRun = () => {
    let view = runtime.createRun({ commandId: services.newId("command") }, {
      runId: "cursor-run", title: "Cursor", ownerHandle: "owner", ownerDisplayName: "Owner",
    });
    view = runtime.spawnAgent({ actorId: view.ownerId, commandId: services.newId("command") }, view.id, {
      handle: "coordinator", displayName: "Koordinator", prompt: "", execution: manualExecution(), grants: [], toolNames: [],
    });
    const actor = view.actors.find((entry) => entry.kind === "agent")!;
    runtime.selectPrimaryActor({ actorId: view.ownerId, commandId: services.newId("command") }, view.id, actor.id);
    return { runId: view.id, actorId: actor.id, ownerId: view.ownerId };
  };
  const run = createRun();
  const session = () => new RunChatSession({
    engine, id: run.runId,
    coordinator: { handle: "coordinator", displayName: "Koordinator", profile: "coordinator", runTitle: "Cursor", ownerHandle: "owner", ownerDisplayName: "Owner" },
    prompt: () => "", assertUsable: () => {}, prepare: async () => {}, prepareWorkspace: async () => {},
    scriptEntryFor: () => undefined, actorPrograms: unavailableActorPrograms,
  });
  const startTurn = () => {
    const view = runtime.enqueueInput({ actorId: run.ownerId, commandId: services.newId("command") }, run.runId, { actorId: run.actorId, content: "Weiter" });
    const next = runtime.startTurn({ actorId: run.actorId, commandId: services.newId("command") }, run.runId, run.actorId, view.inputs.at(-1)!.id);
    const actor = next.actors.find((entry) => entry.id === run.actorId)!;
    assert.ok(actor.kind === "agent" && actor.lifecycle.kind === "running");
    live.publish(run.runId, run.actorId, { kind: "turn-started", turnId: actor.lifecycle.turnId });
    return actor.lifecycle.turnId;
  };
  const output = (turnId: string, text: string) => runtime.appendModelOutput({ actorId: run.actorId, commandId: services.newId("command"), turnId }, run.runId, run.actorId, { turnId, text });
  return { ...run, journal, runtime, live, session, startTurn, output, createRun };
};

const textEvents = (events: ChatEvent[]) => events.filter((event) => event.kind === "text");

test("assistant cursors survive chunking, trimmed blocks, tool activity and a fresh journal replay", () => {
  const data = fixture();
  const session = data.session();
  let replaySession: RunChatSession | undefined;
  try {
    session.attach();
    const events: ChatEvent[] = [];
    session.subscribe((event) => events.push(event));
    assert.equal(events.at(-1)?.kind, "replay-end");
    const turnId = data.startTurn();
    data.live.publish(data.runId, data.actorId, { kind: "text", delta: "  Hal" });
    data.live.publish(data.runId, data.actorId, { kind: "text", delta: "lo \n" });
    data.output(turnId, "Hallo");
    data.live.publish(data.runId, data.actorId, { kind: "thinking", delta: "Nachdenken zählt nicht" });
    data.live.publish(data.runId, data.actorId, { kind: "tool", id: "tool-1", name: "read", arguments: "{}" });
    data.live.publish(data.runId, data.actorId, { kind: "tool-result", id: "tool-1", result: "Gelesen" });
    data.live.publish(data.runId, data.actorId, { kind: "text", delta: " Welt! " });
    data.output(turnId, "Welt!");
    const live = textEvents(events);
    assert.deepEqual(live.map((event) => event.cursor?.offset), [3, 5, 10]);

    const reconnect: ChatEvent[] = [];
    session.subscribe((event) => reconnect.push(event))();
    assert.deepEqual(textEvents(reconnect).map((event) => event.cursor), live.map((event) => event.cursor));
    assert.equal(reconnect.at(-1)?.kind, "replay-end");

    replaySession = data.session();
    replaySession.attach();
    const replay: ChatEvent[] = [];
    replaySession.subscribe((event) => replay.push(event))();
    assert.deepEqual(textEvents(replay).map((event) => event.cursor), [live[1].cursor, live[2].cursor]);
    const anchor = data.runtime.events(data.runId).find((event) => event.type === "turn.started")!;
    assert.equal(live[0].cursor?.sequence, anchor.sequence);
    assert.equal(live[0].cursor?.conversationId, data.runtime.events(data.runId)[0].eventId);
    const messages = events.reduce(applyEvent, [] as Message[]);
    assert.equal(messages.filter((message) => message.role === "assistant").at(-1)?.textCursor, live.at(-1)?.cursor);
  } finally { replaySession?.dispose(); session.dispose(); data.journal.close(); }
});

test("journal-only text advances the same cursor before live text and subsequent turns have a new anchor", () => {
  const data = fixture();
  const session = data.session();
  try {
    session.attach();
    const events: ChatEvent[] = [];
    session.subscribe((event) => events.push(event));
    const turnId = data.startTurn();
    data.output(turnId, "Journal");
    data.live.publish(data.runId, data.actorId, { kind: "text", delta: " Live" });
    data.output(turnId, "Live");
    data.output(turnId, "Journal danach");
    data.runtime.finishTurn({ actorId: data.actorId, commandId: "finish-first", turnId }, data.runId, data.actorId, { turnId, outcome: "completed" });
    data.live.publish(data.runId, data.actorId, { kind: "turn-finished", turnId, outcome: "completed" });
    const second = data.startTurn();
    data.output(second, "Neu");
    const texts = textEvents(events);
    assert.deepEqual(texts.map((event) => event.cursor.offset), [7, 11, 24, 3]);
    assert.ok(texts[3].cursor.sequence > texts[2].cursor.sequence);
  } finally { session.dispose(); data.journal.close(); }
});

test("conversation reset has an explicit empty replay boundary and a recreated run changes identity", () => {
  const data = fixture();
  const session = data.session();
  try {
    session.attach();
    const events: ChatEvent[] = [];
    session.subscribe((event) => events.push(event));
    const before = events[0];
    assert.ok(before.kind === "reset" && before.conversationId);
    data.journal.forget(data.runId);
    session.resetHistory();
    assert.deepEqual(events.slice(-3), [
      { kind: "reset", reason: "conversation-reset", conversationId: null },
      { kind: "status", running: false },
      { kind: "replay-end", conversationId: null },
    ]);
    data.createRun();
    session.attach();
    const reconnect: ChatEvent[] = [];
    session.subscribe((event) => reconnect.push(event))();
    const after = reconnect[0];
    assert.ok(after.kind === "reset" && after.conversationId);
    assert.notEqual(after.conversationId, before.conversationId);
    assert.deepEqual(reconnect.at(-1), { kind: "replay-end", conversationId: after.conversationId });
  } finally { session.dispose(); data.journal.close(); }
});
