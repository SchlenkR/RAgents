import { unavailableActorPrograms } from "./actor-programs-fixture.ts";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import type { ChatSessionProvider } from "../src/chat-handler.ts";
import { coreContracts } from "../src/api/contracts.ts";
import { coreMethods } from "../src/api/core-methods.ts";
import { coreSources, methodContext } from "./rpc-fixture.ts";
import { Journal, LiveBus, Orchestration, RunStopper, TurnScheduler, type RunStopCommand } from "@ragents/engine";
import { manualExecution, catalog, deferred, executionFor, FakeDriver, noUsage, registryOf, testServices } from "../../../packages/ragents/tests/support.ts";
import { applyEvent, type ChatEvent, type Message } from "../src/chat-events.ts";
import type { Engine } from "../src/ragents/engine.ts";
import { RunChatSession } from "../src/ragents/session.ts";

test("the visible chat stop awaits the shared run stop and publishes running false", async () => {
  const services = testServices();
  const journal = new Journal(":memory:", services);
  const runtime = new Orchestration(journal, services);
  let view = runtime.createRun(
    { commandId: "create-run" },
    {
      runId: "chat-stop-run",
      title: "Stop",
      ownerHandle: "owner",
      ownerDisplayName: "Owner",
    },
  );
  view = runtime.spawnAgent({ actorId: view.ownerId, commandId: "spawn-coordinator" }, view.id, {
    handle: "coordinator",
    displayName: "Koordinator",
    prompt: "",
    execution: manualExecution(),
    grants: [],
    toolNames: [],
  });
  const coordinator = view.actors.find((actor) => actor.kind === "agent" && actor.handle === "coordinator");
  assert.ok(coordinator);
  view = runtime.selectPrimaryActor(
    { actorId: view.ownerId, commandId: "select-primary" },
    view.id,
    coordinator.id,
  );

  const stopStarted = deferred();
  const releaseStop = deferred();
  let stopCall: { runId: string; input: RunStopCommand } | undefined;
  const live = new LiveBus();
  const engine = {
    journal,
    runtime,
    live,
    scheduler: { isRunning: () => false },
    stopRun: async (runId: string, input: RunStopCommand) => {
      stopCall = { runId, input };
      stopStarted.resolve();
      await releaseStop.promise;
      return runtime.view(runId);
    },
  } as unknown as Engine;
  const session = new RunChatSession({
    engine,
    id: view.id,
    coordinator: {
      handle: "coordinator",
      displayName: "Koordinator",
      profile: "coordinator",
      runTitle: "Neue Unterhaltung",
      ownerHandle: "owner",
      ownerDisplayName: "Owner",
    },
    prompt: () => "",
    assertUsable: () => undefined,
    prepare: async () => undefined,
    prepareWorkspace: async () => undefined,
    scriptEntryFor: () => undefined,
    startEntryFor: () => undefined,
    actorPrograms: unavailableActorPrograms,
  });
  assert.equal(session.attach(), true);
  const statuses: boolean[] = [];
  session.subscribe((event) => {
    if (event.kind === "status") statuses.push(event.running);
  });
  live.publish(view.id, coordinator.id, { kind: "turn-started", turnId: "turn-visible" });
  assert.equal(session.running, true);

  const provider: ChatSessionProvider = {
    get: async () => session,
    list: async () => [],
    delete: async () => undefined,
  };
  const stop = coreMethods(coreSources(provider))
    .find((entry) => entry.contract.id === coreContracts.chat.stop.id)!;

  try {
    let responseSettled = false;
    const responsePromise = stop.execute({ runId: view.id } as never, methodContext()).then((result) => {
      responseSettled = true;
      return result;
    });
    await stopStarted.promise;
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.equal(responseSettled, false);
    assert.equal(session.running, true);

    releaseStop.resolve();
    assert.equal(await responsePromise, null);
    assert.equal(stopCall?.runId, view.id);
    assert.match(stopCall?.input.commandId ?? "", /^chat-stop:/);
    assert.equal(stopCall?.input.reason, "Not-Aus durch den Bediener");
    assert.equal(session.running, false);
    assert.equal(statuses.at(-1), false);
  } finally {
    releaseStop.resolve();
    session.dispose();
    journal.close();
  }
});

test("chat stop preserves partial text once in live, mid-turn and disk-replayed conversations", async () => {
  const directory = mkdtempSync(join(tmpdir(), "ragents-chat-stop-"));
  const services = testServices();
  const journal = new Journal(directory, services);
  const runtime = new Orchestration(journal, services);
  const view = runtime.createRun({ commandId: "create" }, {
    runId: "partial-answer", title: "Partial answer", ownerHandle: "owner", ownerDisplayName: "Owner",
  });
  const primary = runtime.spawnAgent({ actorId: view.ownerId, commandId: "spawn" }, view.id, {
    handle: "coordinator", displayName: "Coordinator", prompt: "", execution: executionFor("coordinator", { profile: "agent" }),
    grants: [], toolNames: [],
  }).actors.find((actor) => actor.kind === "agent")!;
  runtime.selectPrimaryActor({ actorId: view.ownerId, commandId: "select" }, view.id, primary.id);
  const started = deferred();
  const partial = "Angefangene Antwort";
  const driver = new FakeDriver(async (request, signal) => {
    request.publish({ kind: "text", delta: "Angefangene " });
    request.publish({ kind: "text", delta: "Antwort" });
    started.resolve();
    await new Promise<void>((resolve) => signal.addEventListener("abort", () => resolve(), { once: true }));
    request.emit({ kind: "assistant-interrupted", text: partial });
    return { failure: null, usage: noUsage() };
  });
  const live = new LiveBus();
  const scheduler = new TurnScheduler(runtime, journal, { drivers: registryOf(driver), catalog, live });
  const stopper = new RunStopper({ runtime, stopExternal: (runId, stopJournal) =>
    scheduler.haltRun(runId, (settled) => stopJournal(settled)) });
  const engine = { journal, runtime, live, scheduler, stopRun: stopper.stop } as unknown as Engine;
  const sessions: RunChatSession[] = [];
  const openSession = (engine: Engine) => {
    const session = new RunChatSession({
      engine, id: view.id,
      coordinator: { handle: "coordinator", displayName: "Coordinator", profile: "coordinator", runTitle: "Chat", ownerHandle: "owner", ownerDisplayName: "Owner" },
      prompt: () => "", assertUsable: () => undefined, prepare: async () => undefined, prepareWorkspace: async () => undefined,
      scriptEntryFor: () => undefined, startEntryFor: () => undefined, actorPrograms: unavailableActorPrograms,
    });
    sessions.push(session);
    assert.equal(session.attach(), true);
    const events: ChatEvent[] = [];
    session.subscribe((event) => events.push(event));
    const answers = () => events.reduce(applyEvent, [] as Message[]).filter((message) => message.role === "assistant");
    return { session, events, answers };
  };
  try {
    const attached = openSession(engine);
    runtime.enqueueInput({ actorId: view.ownerId, commandId: "input" }, view.id, { actorId: primary.id, content: "Start" });
    scheduler.start();
    await started.promise;
    const beforeStop = attached.answers()[0];
    assert.equal(beforeStop?.text, partial);
    assert.notEqual(beforeStop?.closed, true);
    const midTurn = openSession(engine);
    assert.deepEqual(midTurn.answers(), []);
    await attached.session.stop();
    assert.equal(attached.session.running, false);
    assert.equal(midTurn.session.running, false);
    for (const observed of [attached, midTurn]) {
      assert.deepEqual(observed.answers().map((message) => message.text), [partial]);
      assert.equal(observed.answers()[0].closed, true);
      assert.deepEqual(observed.answers()[0].textCursor, beforeStop.textCursor);
    }
    assert.equal(attached.events.filter((event) => event.kind === "text").length, 2);
    assert.equal(midTurn.events.filter((event) => event.kind === "text").length, 1);
    const events = runtime.events(view.id);
    assert.deepEqual(events.slice(-2).map((event) => event.type), ["model.output.interrupted", "turn.interrupted"]);
    assert.equal(events.some((event) => event.type === "model.output.completed"), false);
    assert.deepEqual(runtime.view(view.id).turns[0].outputs, []);
    await scheduler.stop();
    sessions.forEach((session) => session.dispose());
    journal.close();
    const restoredJournal = new Journal(directory, testServices());
    try {
      const restoredRuntime = new Orchestration(restoredJournal, testServices());
      const restored = openSession({ journal: restoredJournal, runtime: restoredRuntime, live: new LiveBus(),
        scheduler: { isRunning: () => false } } as unknown as Engine);
      assert.deepEqual(restored.answers().map((message) => message.text), [partial]);
      assert.equal(restored.answers()[0].closed, true);
      assert.deepEqual(restored.answers()[0].textCursor, beforeStop.textCursor);
      const actorAnswers = restored.session.actorConversations().actors[primary.id].filter((message) => message.role === "assistant");
      assert.deepEqual(actorAnswers.map((message) => message.text), [partial]);
      assert.equal(actorAnswers[0].closed, true);
      assert.deepEqual(actorAnswers[0].textCursor, beforeStop.textCursor);
      restored.session.dispose();
    } finally {
      restoredJournal.close();
    }
  } finally {
    await scheduler.stop();
    sessions.forEach((session) => session.dispose());
    journal.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("the chat session follows primary actor changes and releases a stopped primary actor", async () => {
  const services = testServices();
  const journal = new Journal(":memory:", services);
  const runtime = new Orchestration(journal, services);
  let view = runtime.createRun(
    { commandId: "create-primary-lifecycle-run" },
    {
      runId: "primary-lifecycle-run",
      title: "Primary lifecycle",
      ownerHandle: "owner",
      ownerDisplayName: "Owner",
    },
  );
  view = runtime.spawnAgent({ actorId: view.ownerId, commandId: "spawn-first-primary" }, view.id, {
    handle: "coordinator",
    displayName: "First",
    prompt: "",
    execution: manualExecution(),
    grants: [],
    toolNames: [],
  });
  view = runtime.spawnAgent({ actorId: view.ownerId, commandId: "spawn-second-primary" }, view.id, {
    handle: "second",
    displayName: "Second",
    prompt: "",
    execution: manualExecution(),
    grants: [],
    toolNames: [],
  });
  const first = view.actors.find((actor) => actor.kind === "agent" && actor.handle === "coordinator");
  const second = view.actors.find((actor) => actor.kind === "agent" && actor.handle === "second");
  assert.ok(first);
  assert.ok(second);
  view = runtime.selectPrimaryActor(
    { actorId: view.ownerId, commandId: "select-first-primary" },
    view.id,
    first.id,
  );

  const live = new LiveBus();
  const engine = {
    journal,
    runtime,
    live,
    scheduler: { isRunning: () => false },
  } as unknown as Engine;
  const session = new RunChatSession({
    engine,
    id: view.id,
    coordinator: {
      handle: "coordinator",
      displayName: "Koordinator",
      profile: "coordinator",
      runTitle: "Neue Unterhaltung",
      ownerHandle: "owner",
      ownerDisplayName: "Owner",
    },
    prompt: () => "",
    assertUsable: () => undefined,
    prepare: async () => undefined,
    prepareWorkspace: async () => undefined,
    scriptEntryFor: () => undefined,
    startEntryFor: () => undefined,
    actorPrograms: unavailableActorPrograms,
  });

  try {
    assert.equal(session.attach(), true);
    const systems: string[] = [];
    session.subscribe((event) => {
      if (event.kind === "system") systems.push(event.text);
    });
    live.publish(view.id, first.id, { kind: "turn-started", turnId: "first-turn" });
    assert.equal(session.running, true);

    view = runtime.selectPrimaryActor(
      { actorId: view.ownerId, commandId: "select-second-primary" },
      view.id,
      second.id,
    );
    assert.equal(session.started, true);
    assert.equal(session.running, false);
    live.publish(view.id, first.id, { kind: "turn-started", turnId: "obsolete-first-turn" });
    assert.equal(session.running, false);
    live.publish(view.id, second.id, { kind: "turn-started", turnId: "second-turn" });
    assert.equal(session.running, true);

    const inputEnqueued = deferred();
    const unsubscribe = journal.subscribe((events) => {
      if (events.some((event) =>
        event.runId === view.id
        && event.type === "actor.input.enqueued"
        && event.payload.content === "Hallo Second")) inputEnqueued.resolve();
    });
    session.send("Hallo Second");
    await inputEnqueued.promise;
    unsubscribe();
    const input = [...runtime.state(view.id).inputs.values()].at(-1);
    assert.equal(input?.actorId, second.id);

    view = runtime.stopActor(
      { actorId: view.ownerId, commandId: "stop-second-primary" },
      view.id,
      second.id,
      "Primary stopped",
    );
    assert.equal(view.primaryActorId, null);
    assert.equal(session.started, false);
    assert.equal(session.running, false);
    assert.equal(session.attach(), false);
    live.publish(view.id, second.id, { kind: "turn-started", turnId: "obsolete-second-turn" });
    assert.equal(session.running, false);
    assert.ok(systems.includes("Primary stopped"));

    const rebound = deferred();
    const unsubscribeRebound = journal.subscribe((events) => {
      if (events.some((event) => event.type === "actor.input.enqueued"
        && event.payload.content === "Hallo First")) rebound.resolve();
    });
    session.send("Hallo First");
    await rebound.promise;
    unsubscribeRebound();
    assert.equal(session.started, true);
    assert.equal(runtime.view(view.id).inputs.at(-1)?.actorId, first.id);
    live.publish(view.id, first.id, { kind: "turn-started", turnId: "reselected-first-turn" });
    assert.equal(session.running, true);
  } finally {
    session.dispose();
    journal.close();
  }
});

test("the chat projects journal-only output and suppresses only matching live progress", () => {
  const services = testServices();
  const journal = new Journal(":memory:", services);
  const runtime = new Orchestration(journal, services);
  let view = runtime.createRun(
    { commandId: "create-live-projection-run" },
    {
      runId: "live-projection-run",
      title: "Live projection",
      ownerHandle: "owner",
      ownerDisplayName: "Owner",
    },
  );
  view = runtime.spawnAgent({ actorId: view.ownerId, commandId: "spawn-primary" }, view.id, {
    handle: "coordinator",
    displayName: "Koordinator",
    prompt: "",
    execution: manualExecution(),
    grants: [],
    toolNames: [],
  });
  const primary = view.actors.find((actor) => actor.kind === "agent");
  assert.ok(primary);
  view = runtime.selectPrimaryActor({ actorId: view.ownerId, commandId: "select-primary" }, view.id, primary.id);
  view = runtime.enqueueInput({ actorId: view.ownerId, commandId: "input" }, view.id, {
    actorId: primary.id,
    content: "Start",
  });
  const input = view.inputs.find((entry) => entry.actorId === primary.id);
  assert.ok(input);
  view = runtime.startTurn({ actorId: primary.id, commandId: "turn" }, view.id, primary.id, input.id);
  const running = view.actors.find((actor) => actor.id === primary.id);
  assert.ok(running && running.kind === "agent" && running.lifecycle.kind === "running");
  const turnId = running.lifecycle.turnId;
  const live = new LiveBus();
  const engine = {
    journal,
    runtime,
    live,
    scheduler: { isRunning: () => true },
  } as unknown as Engine;
  const session = new RunChatSession({
    engine,
    id: view.id,
    coordinator: {
      handle: "coordinator",
      displayName: "Koordinator",
      profile: "coordinator",
      runTitle: "Neue Unterhaltung",
      ownerHandle: "owner",
      ownerDisplayName: "Owner",
    },
    prompt: () => "",
    assertUsable: () => undefined,
    prepare: async () => undefined,
    prepareWorkspace: async () => undefined,
    scriptEntryFor: () => undefined,
    startEntryFor: () => undefined,
    actorPrograms: unavailableActorPrograms,
  });
  const projected: Array<{ kind: string; text?: string }> = [];

  try {
    assert.equal(session.attach(), true);
    session.subscribe((event) => {
      if (event.kind === "text") projected.push({ kind: event.kind, text: event.delta });
      if (event.kind === "turn-done") projected.push({ kind: event.kind });
      if (event.kind === "system") projected.push({ kind: event.kind, text: event.text });
    });

    live.publish(view.id, primary.id, { kind: "turn-started", turnId });
    runtime.appendModelOutput(
      { actorId: primary.id, commandId: "journal-only", turnId },
      view.id,
      primary.id,
      { turnId, text: "Journal only" },
    );
    live.publish(view.id, primary.id, { kind: "text", delta: "Streamed" });
    runtime.appendModelOutput(
      { actorId: primary.id, commandId: "streamed", turnId },
      view.id,
      primary.id,
      { turnId, text: "Streamed" },
    );
    runtime.finishTurn(
      { actorId: primary.id, commandId: "finish", turnId },
      view.id,
      primary.id,
      { turnId, outcome: "completed" },
    );
    live.publish(view.id, primary.id, { kind: "turn-finished", turnId, outcome: "completed" });
    runtime.stopActor({ actorId: view.ownerId, commandId: "stop-primary" }, view.id, primary.id, "Primary stopped");

    assert.equal(projected.filter((event) => event.text === "Journal only").length, 1);
    assert.equal(projected.filter((event) => event.text === "Streamed").length, 1);
    assert.equal(projected.filter((event) => event.kind === "turn-done").length, 1);
    assert.ok(projected.some((event) => event.kind === "system" && event.text === "Primary stopped"));
  } finally {
    session.dispose();
    journal.close();
  }
});

test("a mid-turn attach ignores partial live deltas and projects the complete journal output once", () => {
  const services = testServices();
  const journal = new Journal(":memory:", services);
  const runtime = new Orchestration(journal, services);
  let view = runtime.createRun(
    { commandId: "create-mid-turn-run" },
    { runId: "mid-turn-run", title: "Mid turn", ownerHandle: "owner", ownerDisplayName: "Owner" },
  );
  view = runtime.spawnAgent({ actorId: view.ownerId, commandId: "spawn-primary" }, view.id, {
    handle: "coordinator",
    displayName: "Koordinator",
    prompt: "",
    execution: manualExecution(),
    grants: [],
    toolNames: [],
  });
  const primary = view.actors.find((actor) => actor.kind === "agent");
  assert.ok(primary);
  view = runtime.selectPrimaryActor({ actorId: view.ownerId, commandId: "select-primary" }, view.id, primary.id);
  view = runtime.enqueueInput({ actorId: view.ownerId, commandId: "input" }, view.id, {
    actorId: primary.id,
    content: "Start",
  });
  const input = view.inputs.find((entry) => entry.actorId === primary.id);
  assert.ok(input);
  view = runtime.startTurn({ actorId: primary.id, commandId: "turn" }, view.id, primary.id, input.id);
  const running = view.actors.find((actor) => actor.id === primary.id);
  assert.ok(running && running.kind === "agent" && running.lifecycle.kind === "running");
  const turnId = running.lifecycle.turnId;
  const live = new LiveBus();
  const engine = {
    journal,
    runtime,
    live,
    scheduler: { isRunning: () => true },
  } as unknown as Engine;
  const session = new RunChatSession({
    engine,
    id: view.id,
    coordinator: {
      handle: "coordinator",
      displayName: "Koordinator",
      profile: "coordinator",
      runTitle: "Neue Unterhaltung",
      ownerHandle: "owner",
      ownerDisplayName: "Owner",
    },
    prompt: () => "",
    assertUsable: () => undefined,
    prepare: async () => undefined,
    prepareWorkspace: async () => undefined,
    scriptEntryFor: () => undefined,
    startEntryFor: () => undefined,
    actorPrograms: unavailableActorPrograms,
  });
  const texts: string[] = [];

  try {
    assert.equal(session.attach(), true);
    session.subscribe((event) => {
      if (event.kind === "text") texts.push(event.delta);
    });
    live.publish(view.id, primary.id, { kind: "text", delta: "Late suffix" });
    runtime.appendModelOutput(
      { actorId: primary.id, commandId: "complete-output", turnId },
      view.id,
      primary.id,
      { turnId, text: "Complete answer" },
    );

    assert.deepEqual(texts, ["Complete answer"]);
  } finally {
    session.dispose();
    journal.close();
  }
});

test("the chat session retains a script primary for observation but rejects free chat", async () => {
  const services = testServices();
  const journal = new Journal(":memory:", services);
  const runtime = new Orchestration(journal, services);
  let view = runtime.createRun(
    { commandId: "create-script-primary-run" },
    { runId: "script-primary-run", title: "Script primary", ownerHandle: "owner", ownerDisplayName: "Owner" },
  );
  view = runtime.createScriptActor({ actorId: view.ownerId, commandId: "install-script" }, view.id, {
    handle: "script-primary",
    displayName: "Script Primary",
    grants: [],
    toolNames: [],
  });
  const script = view.actors.find((actor) => actor.kind === "script");
  assert.ok(script);
  view = runtime.selectPrimaryActor({ actorId: view.ownerId, commandId: "select-script" }, view.id, script.id);
  const live = new LiveBus();
  const engine = {
    journal,
    runtime,
    live,
    scheduler: { isRunning: () => false },
  } as unknown as Engine;
  const session = new RunChatSession({
    engine,
    id: view.id,
    coordinator: {
      handle: "coordinator",
      displayName: "Koordinator",
      profile: "coordinator",
      runTitle: "Neue Unterhaltung",
      ownerHandle: "owner",
      ownerDisplayName: "Owner",
    },
    prompt: () => "",
    assertUsable: () => undefined,
    prepare: async () => undefined,
    prepareWorkspace: async () => undefined,
    scriptEntryFor: () => undefined,
    startEntryFor: () => undefined,
    actorPrograms: unavailableActorPrograms,
  });
  try {
    assert.equal(session.attach(), true);
    await assert.rejects(session.send("Hallo Script"), /TypeScript-Actor und kein Chatpartner/);
    assert.equal(runtime.view(view.id).primaryActorId, script.id);
    assert.equal(runtime.view(view.id).inputs.length, 0);
  } finally {
    session.dispose();
    journal.close();
  }
});
