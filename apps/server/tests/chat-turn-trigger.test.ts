import { unavailableActorPrograms } from "./actor-programs-fixture.ts";
import assert from "node:assert/strict";
import test from "node:test";

import { Journal, LiveBus, Orchestration } from "@ragents/engine";
import { allGrants, manualExecution, postTo, testServices, textStep } from "../../../packages/ragents/tests/support.ts";
import { applyEvent, type ChatEvent, type Message } from "quassel/events";
import type { Engine } from "../src/ragents/engine.ts";
import { RunChatSession } from "../src/ragents/session.ts";

const chatSession = (engine: Engine, runId: string) => {
  const session = new RunChatSession({
    engine, id: runId,
    coordinator: { handle: "coordinator", displayName: "Coordinator", profile: "coordinator", runTitle: "Trigger", ownerHandle: "alice", ownerDisplayName: "Alice" },
    prompt: () => "", assertUsable: () => undefined, prepare: async () => undefined, prepareWorkspace: async () => undefined, started: async () => undefined,
    scriptEntryFor: () => undefined, startEntryFor: () => undefined, actorPrograms: unavailableActorPrograms,
  });
  const events: ChatEvent[] = [];
  session.subscribe((event) => events.push(event));
  const systemLines = () => events.flatMap((event) => event.kind === "system" ? [{ text: event.text, at: event.at }] : []);
  const messages = () => events.reduce(applyEvent, [] as Message[]);
  return { session, systemLines, messages };
};

test("the chat says what started a turn of the primary actor that no person asked for, live and in the replayed history", () => {
  const services = testServices();
  const journal = new Journal(":memory:", services);
  const runtime = new Orchestration(journal, services);
  const view = runtime.createRun({ commandId: "create" }, { runId: "trigger-run", title: "Trigger", ownerHandle: "alice", ownerDisplayName: "Alice", ownerUserId: "alice" });
  const id = view.id;
  const context = (actorId: string, turnId?: string) => ({ actorId, commandId: services.newId("command"), ...(turnId ? { turnId } : {}) });
  const primary = runtime.spawnAgent(context(view.ownerId), id, {
    handle: "coordinator", displayName: "Coordinator", prompt: "", execution: manualExecution(), grants: allGrants(), toolNames: [],
  }).actors.find((actor) => actor.handle === "coordinator")!;
  runtime.selectPrimaryActor(context(view.ownerId), id, primary.id);
  const pending = (actorId: string) => runtime.view(id).inputs.filter((input) => input.actorId === actorId && input.lifecycle.kind === "pending");
  const startNext = (actorId: string) => runtime.startTurn(context(actorId), id, actorId, pending(actorId)[0]!.id).turns.at(-1)!.id;
  const finish = (actorId: string, turnId: string) => runtime.finishTurn(context(actorId, turnId), id, actorId, { turnId, outcome: "completed" });
  const engine = { journal, runtime, live: new LiveBus(), scheduler: { isRunning: () => false } } as unknown as Engine;
  const live = chatSession(engine, id);
  try {
    assert.equal(live.session.attach(), true);
    runtime.enqueueInput(context(view.ownerId), id, { actorId: primary.id, content: "Delegate the work.", origin: "human" });
    const first = startNext(primary.id);
    const helper = runtime.spawnAgent(context(primary.id, first), id, {
      handle: "implementer", displayName: "Implementer", prompt: "", execution: manualExecution(), grants: allGrants(), toolNames: [],
    }).actors.find((actor) => actor.handle === "implementer")!;
    runtime.createSubscription(context(primary.id, first), id, { subscriberId: primary.id, sourceActorIds: [helper.id], eventTypes: ["turn.finished"] });
    runtime.enqueueInput(context(primary.id, first), id, { actorId: helper.id, content: "Change the files." });
    finish(primary.id, first);

    finish(helper.id, startNext(helper.id));
    const second = startNext(primary.id);
    runtime.completeModelStep(context(primary.id, second), id, primary.id, { turnId: second, step: textStep("The implementer is done.") });
    finish(primary.id, second);

    postTo(runtime, view, helper.id, "helper-automatic", "Check again.");
    const helperTurn = startNext(helper.id);
    runtime.enqueueInput(context(helper.id, helperTurn), id, { actorId: primary.id, content: "Found a problem." });
    runtime.interruptTurn(context(view.ownerId), id, helper.id, { turnId: helperTurn, reason: "Interrupted by the operator" });
    finish(primary.id, startNext(primary.id));
    finish(primary.id, startNext(primary.id));
    postTo(runtime, view, primary.id, "primary-automatic", "A plugin notice.");
    finish(primary.id, startNext(primary.id));

    assert.deepEqual(live.systemLines().map((line) => line.text), [
      "New turn, triggered by turn.finished of @implementer",
      "New turn, triggered by a message from @implementer",
      "New turn, triggered by turn.interrupted of @implementer",
      "New turn, triggered by an automatic input",
    ], "a person's own message starts a turn without a line, turns of other actors have none either");
    const texts = live.messages().filter((message) => message.role !== "user").map((message) => message.text);
    assert.equal(texts.indexOf("The implementer is done."), texts.indexOf("New turn, triggered by turn.finished of @implementer") + 1, "the line stands before the output of its turn");

    const replayed = chatSession(engine, id);
    try {
      assert.equal(replayed.session.attach(), true);
      assert.deepEqual(replayed.systemLines(), live.systemLines());
    } finally {
      replayed.session.dispose();
    }
  } finally {
    live.session.dispose();
    journal.close();
  }
});
