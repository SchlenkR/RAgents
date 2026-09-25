import { unavailableActorPrograms } from "./actor-programs-fixture.ts";
import assert from "node:assert/strict";
import test from "node:test";

import { Journal, LiveBus, Orchestration, TurnScheduler, runtimeMethods } from "@ragents/engine";
import { runContracts } from "@ragents/engine/src/http/contracts";
import { catalog, deferred, executionFor, FakeDriver, noUsage, registryOf, testServices } from "../../../packages/ragents/tests/support.ts";
import { applyEvent, type ChatEvent, type Message } from "../src/chat-events.ts";
import type { Engine } from "../src/ragents/engine.ts";
import { RunChatSession } from "../src/ragents/session.ts";
import { methodContext } from "./rpc-fixture.ts";

const primaryRun = () => {
  const services = testServices();
  const journal = new Journal(":memory:", services);
  const runtime = new Orchestration(journal, services);
  const view = runtime.createRun({ commandId: "create" }, { runId: "interrupt-run", title: "Interrupt", ownerHandle: "owner", ownerDisplayName: "Owner" });
  const primary = runtime.spawnAgent({ actorId: view.ownerId, commandId: "spawn" }, view.id, {
    handle: "coordinator", displayName: "Coordinator", prompt: "", execution: executionFor("coordinator", { profile: "agent" }),
    grants: [], toolNames: [],
  }).actors.find((actor) => actor.kind === "agent")!;
  runtime.selectPrimaryActor({ actorId: view.ownerId, commandId: "select" }, view.id, primary.id);
  return { journal, runtime, view, primary };
};

const chatSession = (engine: Engine, runId: string) => {
  const session = new RunChatSession({
    engine, id: runId,
    coordinator: { handle: "coordinator", displayName: "Coordinator", profile: "coordinator", runTitle: "Chat", ownerHandle: "owner", ownerDisplayName: "Owner" },
    prompt: () => "", assertUsable: () => undefined, prepare: async () => undefined, prepareWorkspace: async () => undefined, started: async () => undefined,
    scriptEntryFor: () => undefined, startEntryFor: () => undefined, actorPrograms: unavailableActorPrograms,
  });
  const events: ChatEvent[] = [];
  session.subscribe((event) => events.push(event));
  const answers = () => events.reduce(applyEvent, [] as Message[]).filter((message) => message.role === "assistant");
  return { session, answers };
};

test("the chat's stop interrupts only the primary's turn: its text stays, the chat stays bound and the next message runs", async () => {
  const { journal, runtime, view, primary } = primaryRun();
  const started = deferred();
  const partial = "Angefangene Antwort";
  const driver = new FakeDriver(async (request, signal) => {
    if (driver.requests.length > 1) {
      request.emit({ kind: "assistant", text: "Weiter geht es." });
      return { failure: null, usage: noUsage() };
    }
    request.publish({ kind: "text", delta: partial });
    started.resolve();
    await new Promise<void>((resolve) => signal.addEventListener("abort", () => resolve(), { once: true }));
    request.emit({ kind: "assistant-interrupted", text: partial });
    return { failure: null, usage: noUsage() };
  });
  const live = new LiveBus();
  const scheduler = new TurnScheduler(runtime, journal, { drivers: registryOf(driver), catalog, live });
  const interrupt = runtimeMethods({
    runtime,
    assertRunRights: () => undefined,
    projectView: (runView) => runView,
    hasRun: () => true,
    interruptTurn: (runId, actorId, interruption) => scheduler.interruptTurn(runId, actorId, interruption),
  }).find((entry) => entry.contract.id === runContracts.interruptTurn.id)!;
  const { session, answers } = chatSession({ journal, runtime, live, scheduler } as unknown as Engine, view.id);
  try {
    assert.equal(session.attach(), true);
    runtime.enqueueInput({ actorId: view.ownerId, commandId: "input" }, view.id, { actorId: primary.id, content: "Start" });
    scheduler.start();
    await started.promise;
    assert.equal(session.running, true);

    await interrupt.execute({ runId: view.id, commandId: "interrupt", actorId: primary.id } as never, methodContext());
    assert.equal(session.running, false);
    assert.equal(session.started, true, "der Chat bleibt an seinen Actor gebunden");
    assert.deepEqual(answers().map((message) => message.text), [partial]);
    assert.equal(answers()[0]?.closed, true);
    const current = runtime.view(view.id);
    assert.equal(current.primaryActorId, primary.id);
    assert.deepEqual(current.turns.map((turn) => turn.status), ["interrupted"]);
    assert.equal(runtime.events(view.id).some((event) => event.type === "actor.stopped"), false);

    const answered = deferred();
    const unsubscribe = journal.subscribe((events) => {
      if (events.some((event) => event.type === "turn.finished")) answered.resolve();
    });
    session.send("Weiter.");
    await answered.promise;
    unsubscribe();
    await scheduler.waitForIdle();
    assert.deepEqual(answers().map((message) => message.text), [partial, "Weiter geht es."]);
  } finally {
    await scheduler.stop();
    session.dispose();
    journal.close();
  }
});

test("restarting a stopped primary actor makes it primary again and binds the chat to it", () => {
  const { journal, runtime, view, primary } = primaryRun();
  const live = new LiveBus();
  const { session } = chatSession({ journal, runtime, live, scheduler: { isRunning: () => false } } as unknown as Engine, view.id);
  try {
    assert.equal(session.attach(), true);
    runtime.stopActor({ actorId: view.ownerId, commandId: "stop" }, view.id, primary.id, "Versehentlich gestoppt");
    assert.equal(session.started, false);
    assert.equal(runtime.view(view.id).stoppedPrimaryActorId, primary.id);

    runtime.restartActor({ actorId: view.ownerId, commandId: "restart" }, view.id, primary.id, "Vom Bediener neu gestartet");
    assert.equal(runtime.view(view.id).primaryActorId, primary.id);
    assert.equal(session.started, true);
  } finally {
    session.dispose();
    journal.close();
  }
});
