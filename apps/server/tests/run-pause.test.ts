import { unavailableActorPrograms } from "./actor-programs-fixture.ts";
import assert from "node:assert/strict";
import test from "node:test";

import { Journal, LiveBus, Orchestration, TurnScheduler } from "@ragents/engine";
import { allGrants, catalog, executionFor, FakeDriver, noUsage, postTo, registryOf, testServices } from "../../../packages/ragents/tests/support.ts";
import type { ChatEvent } from "quassel/events";
import type { Engine } from "../src/ragents/engine.ts";
import { RunChatSession } from "../src/ragents/session.ts";

const pausedRun = () => {
  const services = testServices();
  const journal = new Journal(":memory:", services);
  const runtime = new Orchestration(journal, services);
  const view = runtime.createRun({ commandId: "create" }, { runId: "pause-run", title: "Pause", ownerHandle: "alice", ownerDisplayName: "Alice", ownerUserId: "alice" });
  const spawn = (handle: string) => runtime.spawnAgent({ actorId: view.ownerId, commandId: `spawn-${handle}` }, view.id, {
    handle, displayName: handle, prompt: "", execution: executionFor(handle, { profile: "agent" }), grants: allGrants(), toolNames: [],
  }).actors.find((actor) => actor.handle === handle)!;
  const primary = spawn("coordinator");
  const helper = spawn("helper");
  runtime.selectPrimaryActor({ actorId: view.ownerId, commandId: "select" }, view.id, primary.id);
  const seen: { actorId: string; contents: string[] }[] = [];
  const driver = new FakeDriver(async (request) => {
    seen.push({ actorId: request.agentId, contents: [request.input.content, ...request.claimSteering().map((steered) => steered.input.content)] });
    return { failure: null, usage: noUsage() };
  });
  const live = new LiveBus();
  const scheduler = new TurnScheduler(runtime, journal, { drivers: registryOf(driver), catalog, live });
  return { journal, runtime, view, primary, helper, seen, live, scheduler };
};

const chatSession = (engine: Engine, runId: string) => {
  const session = new RunChatSession({
    engine, id: runId,
    coordinator: { handle: "coordinator", displayName: "Coordinator", profile: "coordinator", runTitle: "Pause", ownerHandle: "alice", ownerDisplayName: "Alice" },
    prompt: () => "", assertUsable: () => undefined, prepare: async () => undefined, prepareWorkspace: async () => undefined, started: async () => undefined,
    scriptEntryFor: () => undefined, startEntryFor: () => undefined, actorPrograms: unavailableActorPrograms,
  });
  const events: ChatEvent[] = [];
  session.subscribe((event) => events.push(event));
  const systemLines = () => events.flatMap((event) => event.kind === "system" ? [{ text: event.text, at: event.at }] : []);
  return { session, systemLines };
};

const settle = async (scheduler: TurnScheduler) => {
  await scheduler.waitForIdle();
  await new Promise((resolve) => setTimeout(resolve, 20));
  await scheduler.waitForIdle();
};

test("a chat message resumes a paused run in its own command, names the signed-in user, and the primary gets what waited together with the message in one turn", async () => {
  const run = pausedRun();
  const { runtime, view, primary, scheduler } = run;
  const { session } = chatSession({ journal: run.journal, runtime, live: run.live, scheduler } as unknown as Engine, view.id);
  try {
    assert.equal(session.attach(), true);
    runtime.pauseRun({ actorId: view.ownerId, commandId: "pause" }, view.id, { reason: "Paused in the chat", userId: "alice" });
    postTo(runtime, view, primary.id, "automatic", "An automatic notice.");
    scheduler.start();
    await settle(scheduler);
    assert.deepEqual(run.seen, [], "nothing runs while the run is paused");

    await session.send("Continue now.", undefined, undefined, { id: "alice", label: "Alice" });
    const events = runtime.events(view.id);
    const message = events.find((event) => event.type === "actor.input.enqueued" && event.payload.subscriptionId === null && event.payload.content === "Continue now.")!;
    const command = events.filter((event) => event.commandId === message.commandId);
    assert.deepEqual(command.map((event) => event.type), ["run.resumed", "actor.input.enqueued"]);
    assert.deepEqual(command[0]!.payload, { trigger: "input", userId: "alice" });
    await settle(scheduler);

    assert.deepEqual(run.seen, [{ actorId: primary.id, contents: ["An automatic notice.", "Continue now."] }]);
    assert.equal(runtime.view(view.id).pause, null);
  } finally {
    await scheduler.stop();
    session.dispose();
    run.journal.close();
  }
});

test("a message to another actor resumes the run and lets that actor go on; without sign-in the resume names no user", async () => {
  const run = pausedRun();
  const { runtime, view, helper, scheduler } = run;
  const { session } = chatSession({ journal: run.journal, runtime, live: run.live, scheduler } as unknown as Engine, view.id);
  try {
    assert.equal(session.attach(), true);
    runtime.pauseRun({ actorId: view.ownerId, commandId: "pause" }, view.id, { reason: "Paused in the chat" });
    scheduler.start();

    await session.sendToActor(helper.id, "Go on.");
    const resumed = runtime.events(view.id).filter((event) => event.type === "run.resumed");
    assert.deepEqual(resumed.map((event) => event.payload), [{ trigger: "input" }]);
    await settle(scheduler);

    assert.deepEqual(run.seen, [{ actorId: helper.id, contents: ["Go on."] }]);
    const current = runtime.view(view.id).actors.find((actor) => actor.id === helper.id);
    assert.ok(current && current.kind !== "human");
    assert.equal(current.held, undefined);
  } finally {
    await scheduler.stop();
    session.dispose();
    run.journal.close();
  }
});

test("the chat names who paused and resumed the run, live and in the replayed history", () => {
  const run = pausedRun();
  const { runtime, view, primary } = run;
  const engine = { journal: run.journal, runtime, live: run.live, scheduler: { isRunning: () => false } } as unknown as Engine;
  const live = chatSession(engine, view.id);
  try {
    assert.equal(live.session.attach(), true);
    const input = runtime.enqueueInput({ actorId: view.ownerId, commandId: "message" }, view.id, { actorId: primary.id, content: "Work.", origin: "human" }).inputs.at(-1)!;
    const turnId = runtime.startTurn({ actorId: primary.id, commandId: "turn" }, view.id, primary.id, input.id).turns.at(-1)!.id;
    runtime.pauseRun({ actorId: view.ownerId, commandId: "pause" }, view.id, { reason: "Paused in the chat", userId: "alice" });
    runtime.interruptTurn({ actorId: view.ownerId, commandId: "pause:interrupt" }, view.id, primary.id, { turnId, reason: "Paused in the chat" });
    runtime.resumeRun({ actorId: view.ownerId, commandId: "resume" }, view.id, { userId: "alice" });
    runtime.pauseRun({ actorId: view.ownerId, commandId: "pause-anonymous" }, view.id, { reason: "Paused" });
    runtime.resumeRun({ actorId: view.ownerId, commandId: "resume-anonymous" }, view.id, {});

    assert.deepEqual(live.systemLines().map((line) => line.text), ["Run paused by alice", "Paused in the chat", "Run resumed by alice", "Run paused", "Run resumed"]);
    const replayed = chatSession(engine, view.id);
    try {
      assert.equal(replayed.session.attach(), true);
      assert.deepEqual(replayed.systemLines(), live.systemLines());
    } finally {
      replayed.session.dispose();
    }
  } finally {
    live.session.dispose();
    run.journal.close();
  }
});
