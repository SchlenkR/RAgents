import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test, { type TestContext } from "node:test";
import {
  DomainError, FixedWorkspaces, Journal, LiveBus, Orchestration, StartOptionContributionRegistry,
  StaticModelCatalog, TurnScheduler, type CatalogModel,
} from "@ragents/engine";
import { manualExecution, FakeDriver, noUsage, testServices } from "../../../packages/ragents/tests/support.ts";
import { OVERSEER_PLUGIN_ID } from "../../../plugins/ragents.overseer/contract.ts";
import { coordinatorRunId, SHARED_OVERSEER_RUN_ID } from "../../../plugins/ragents.overseer/server/coordinator.ts";
import { RunDirectory } from "../../../plugins/ragents.overseer/server/run-directory.ts";
import { createUserLocationContext, parseUserLocation } from "../../../plugins/ragents.overseer/server/user-location.ts";
import type { ChatUserLocation } from "../src/chat-context.ts";
import type { ChatEvent } from "quassel/events";
import { coreContracts } from "../src/api/contracts.ts";
import { coreMethods } from "../src/api/core-methods.ts";
import { coreSources, methodContext } from "./rpc-fixture.ts";
import type { Engine } from "../src/ragents/engine.ts";
import type { RunManagement } from "../src/ragents/global-chat.ts";
import { RunChatSession } from "../src/ragents/session.ts";

const OVERSEER_RUN_ID = coordinatorRunId(null);
const home: ChatUserLocation = { page: "home", runId: null, tab: null, selection: null };
const offered: CatalogModel[] = [{ driver: "agent", provider: "local", model: "test", label: "Local fixture", thinking: ["off"] }];
const catalog = new StaticModelCatalog(offered, [{
  name: "coordinator", description: "Test", driver: "agent", provider: "local", model: "test", thinking: "off",
  turnTimeoutMs: null, isolateWorkspace: false,
}]);

const fixture = async (t: TestContext, existingDirectory?: string) => {
  const directory = existingDirectory ?? await mkdtemp(path.join(tmpdir(), "ragents-overseer-location-"));
  const services = { ...testServices(), newId: (kind: string) => `${kind}-${randomUUID()}` };
  const journal = new Journal(path.join(directory, "journal"), services);
  const runtime = new Orchestration(journal, services);
  for (const [runId, title, handle] of [["first-run", "Shopping list", "listhelper"], ["second-run", "Check CSV import", "reviewer"]]) {
    if (journal.stateOf(runId!)) continue;
    const created = runtime.createRun({ commandId: `create:${runId}` }, { runId, title: title!, ownerHandle: "owner", ownerDisplayName: "Owner" });
    runtime.spawnAgent({ actorId: created.ownerId, commandId: `actor:${runId}` }, created.id, {
      handle: handle!, displayName: handle!, prompt: "Test", execution: manualExecution(), grants: [], toolNames: [],
    });
  }
  const available = new Set(["first-run", "second-run"]);
  const management: RunManagement = {
    list: async () => [...available].map((id) => ({ id, title: runtime.view(id).title, updatedAt: 1 })),
    view: (id) => {
      assert.ok(available.has(id), "The location resolver must not inspect an unavailable run");
      return runtime.view(id);
    },
    events: (id) => runtime.events(id),
    create: async () => { throw new Error("No creation through location context"); },
    send: async () => { throw new Error("No sending through location context"); },
    stop: async () => { throw new Error("No stopping through location context"); },
    resetGlobal: async () => { throw new Error("No reset through location context"); },
  };
  const runDirectory = new RunDirectory(path.join(directory, "references.json"));
  await runDirectory.describe(await management.list());
  const policy = createUserLocationContext(() => management, runDirectory);
  const errors: unknown[] = [];
  const driver = new FakeDriver(async () => ({ failure: null, usage: noUsage() }));
  const live = new LiveBus();
  const scheduler = new TurnScheduler(runtime, journal, {
    drivers: { agent: driver }, catalog, live, workspaces: new FixedWorkspaces(directory),
    basePrompt: (runId, actor) => runId === OVERSEER_RUN_ID
      ? `Global coordinator\n\n${policy.contextPrompt!(runtime, runId, actor)}` : "Ordinary run without location context",
    onError: (error) => errors.push(error),
  });
  const engine = { runtime, journal, scheduler, catalog, live, catalogModels: offered, startOptions: new StartOptionContributionRegistry() } as unknown as Engine;
  const sessions: RunChatSession[] = [];
  const sessionFor = (id: string) => {
    const session = new RunChatSession({
      id, engine,
      coordinator: { handle: "coordinator", displayName: "Coordinator", profile: "coordinator", runTitle: "Global", ownerHandle: "owner", ownerDisplayName: "Owner" },
      ...(id === OVERSEER_RUN_ID ? { inputContext: policy.inputContext } : {}),
      prompt: () => "Local test", assertUsable: () => {}, prepare: async () => {}, prepareWorkspace: async () => {}, started: async () => {},
      scriptEntryFor: () => undefined,
      startEntryFor: () => undefined,
      actorPrograms: {
        installScript: async () => { throw new Error("No Actor program package"); },
        enqueueStart: () => { throw new Error("No Actor program package"); },
        isScriptActor: () => false,
      },
    });
    session.attach();
    sessions.push(session);
    return session;
  };
  const session = sessionFor(OVERSEER_RUN_ID);
  const actorIn = (id: string) => runtime.view(id).actors.find((actor) => actor.kind === "agent")!;
  const location = (id: string): ChatUserLocation => ({ page: "run", runId: id, tab: "ragents.orchestration", selection: { type: "actor", id: actorIn(id).id } });
  let closed = false;
  const close = async () => {
    if (closed) return;
    closed = true;
    for (const session of sessions) session.dispose();
    await scheduler.stop();
    journal.close();
  };
  t.after(close);
  if (!existingDirectory) t.after(() => rm(directory, { recursive: true, force: true }));
  return { directory, journal, runtime, session, sessionFor, location, actorIn, scheduler, driver, errors, management, available, close };
};

const locationEvents = (runtime: Orchestration) => runtime.events(OVERSEER_RUN_ID)
  .filter((event) => (event.type === "plugin.state-replaced" || event.type === "plugin.state-patched") && event.payload.pluginId === OVERSEER_PLUGIN_ID);

test("queued global messages keep their own location snapshots and leave visible user text unchanged", async (t) => {
  const data = await fixture(t);
  const chat: ChatEvent[] = [];
  data.session.subscribe((event) => chat.push(event));
  const firstLocation = data.location("first-run");
  const firstText = "What is this actor doing right now?";
  const secondText = "And what is happening here?";
  const thirdText = "A question without a location";
  await data.session.send(firstText, [], firstLocation);
  await data.session.send(secondText, [], data.location("second-run"));
  await data.session.send(thirdText);
  firstLocation.selection!.id = data.actorIn("second-run").id;
  const firstRun = data.runtime.view("first-run");
  data.runtime.retitleRun({ actorId: firstRun.ownerId, commandId: "later-title" }, firstRun.id, "Title changed later");
  const queued = data.runtime.view(OVERSEER_RUN_ID).inputs;
  assert.deepEqual(queued.map((input) => input.content), [firstText, secondText, thirdText]);
  assert.ok(queued.every((input) => input.lifecycle.kind === "pending"));
  assert.equal(new Set(queued.flatMap((input) => input.sourceEventIds)).size, 3);
  assert.deepEqual(chat.flatMap((event) => event.kind === "user" ? [event.text] : []), [firstText, secondText, thirdText]);
  data.scheduler.start();
  await data.scheduler.waitForIdle();
  assert.deepEqual(data.errors, []);
  assert.equal(data.driver.requests.length, 3);
  const [first, second, third] = data.driver.requests;
  assert.match(first!.systemPrompt, /Run: Run 1, title "Shopping list"/);
  assert.match(first!.systemPrompt, /Actor @listhelper/);
  assert.match(first!.systemPrompt, /Open area: "ragents.orchestration"/);
  assert.doesNotMatch(first!.systemPrompt, /Title changed later|@reviewer|CSV import/);
  assert.match(second!.systemPrompt, /Run: Run 2, title "Check CSV import"/);
  assert.match(second!.systemPrompt, /Actor @reviewer/);
  assert.doesNotMatch(second!.systemPrompt, /@listhelper|Shopping list/);
  assert.match(third!.systemPrompt, /No interface context.*Earlier location details do not count as current/s);
  assert.doesNotMatch(third!.systemPrompt, /Run: Run \d|@listhelper|@reviewer|CSV import/);
  assert.deepEqual(data.driver.requests.map((request) => request.input.content), [firstText, secondText, thirdText]);
  assert.equal(data.runtime.view(OVERSEER_RUN_ID).turns.length, 3);
});

test("journal reload preserves each pending input's location binding instead of reading the latest plugin state", async (t) => {
  const first = await fixture(t);
  await first.session.send("Check here", [], first.location("first-run"));
  await first.session.send("Another question here", [], first.location("first-run"));
  await first.session.send("Now the overview", [], { page: "overview", runId: null, tab: null, selection: null });
  const before = first.runtime.view(OVERSEER_RUN_ID).inputs.map((input) => ({ id: input.id, sourceEventIds: input.sourceEventIds }));
  assert.equal(locationEvents(first.runtime).length, 3);
  assert.equal(locationEvents(first.runtime)[1].type, "plugin.state-patched");
  await first.close();
  const restored = await fixture(t, first.directory);
  assert.deepEqual(restored.runtime.view(OVERSEER_RUN_ID).inputs.map((input) => ({ id: input.id, sourceEventIds: input.sourceEventIds })), before);
  restored.management.list = async () => { throw new Error("Prompt rendering must use the journal snapshot"); };
  restored.scheduler.start();
  await restored.scheduler.waitForIdle();
  assert.deepEqual(restored.errors, []);
  assert.equal(restored.driver.requests.length, 3);
  assert.match(restored.driver.requests[0]!.systemPrompt, /Run: Run 1, title "Shopping list"/);
  assert.match(restored.driver.requests[0]!.systemPrompt, /@listhelper/);
  assert.match(restored.driver.requests[1]!.systemPrompt, /Run: Run 1, title "Shopping list"/);
  assert.match(restored.driver.requests[2]!.systemPrompt, /Interface: run overview/);
  assert.doesNotMatch(restored.driver.requests[2]!.systemPrompt, /Shopping list|@listhelper/);
  await restored.close();
});

test("ordinary run messages receive no global location context and reject a supplied location", async (t) => {
  const data = await fixture(t);
  const ordinary = data.sessionFor("ordinary-run");
  await assert.rejects(ordinary.send("Do not send", [], home), (error) => error instanceof DomainError && error.code === "chat-context-unavailable");
  assert.equal(data.journal.stateOf("ordinary-run"), null);
  await ordinary.send("Ordinary message");
  assert.deepEqual(data.runtime.view("ordinary-run").inputs[0]!.sourceEventIds, []);
  assert.equal(data.runtime.events("ordinary-run").some((event) => event.type === "plugin.state-replaced" && event.payload.pluginId === OVERSEER_PLUGIN_ID), false);
  data.scheduler.start();
  await data.scheduler.waitForIdle();
  assert.deepEqual(data.errors, []);
  assert.equal(data.driver.requests.length, 1);
  assert.match(data.driver.requests[0]!.systemPrompt, /Ordinary run/);
  assert.doesNotMatch(data.driver.requests[0]!.systemPrompt, /[Ii]nterface context|Run 1|listhelper/);
});

test("invalid and oversized user locations are rejected before any message or location event is queued", async (t) => {
  const data = await fixture(t);
  await data.session.send("Valid start", [], home);
  const valid = data.location("first-run");
  const invalid = [
    null, {}, [], "run", { ...home, extra: true }, { ...home, page: "unknown" },
    { ...home, page: ["home"] }, { ...valid, page: ["run"] },
    { ...valid, runId: null }, { ...valid, runId: OVERSEER_RUN_ID }, { ...valid, runId: coordinatorRunId("alice") }, { ...valid, runId: SHARED_OVERSEER_RUN_ID }, { ...valid, runId: "../foreign" },
    { ...valid, runId: "a".repeat(65) }, { ...valid, tab: "a".repeat(121) }, { ...valid, tab: "bad\nsection" },
    { ...valid, selection: { type: "a".repeat(41), id: "x" } },
    { ...valid, selection: { type: "actor", id: "a".repeat(121) } },
    { ...valid, selection: { type: "actor", id: "x", extra: true } },
    { ...valid, selection: { type: "actor", id: "x\0y" } },
    { ...home, tab: "actors" }, { ...home, runId: "first-run" },
    { ...valid, page: "overview" },
  ];
  for (const location of invalid) {
    assert.throws(() => parseUserLocation(location), (error) => error instanceof DomainError && error.code === "invalid-user-location");
    await assert.rejects(data.session.send("Invalid message", [], location), (error) => error instanceof DomainError && error.code === "invalid-user-location");
  }
  assert.equal(data.runtime.view(OVERSEER_RUN_ID).inputs.length, 1);
  assert.equal(locationEvents(data.runtime).length, 1);
  assert.equal(parseUserLocation(undefined), undefined);
  assert.deepEqual(parseUserLocation(home), home);
});

test("foreign or stale selections and unavailable runs never invent an actor or disclose another run", async (t) => {
  const data = await fixture(t);
  const first = data.location("first-run");
  await data.session.send("Foreign actor selection", [], { ...first, selection: { type: "actor", id: data.actorIn("second-run").id } });
  await data.session.send("Stale selection", [], { ...first, selection: { type: "actor", id: "removed-actor" } });
  await data.session.send("Unknown selection type", [], { ...first, selection: { type: "unrecognized", id: data.actorIn("first-run").id } });
  data.available.delete("second-run");
  await data.session.send("Unavailable run", [], data.location("second-run"));
  data.scheduler.start();
  await data.scheduler.waitForIdle();
  assert.deepEqual(data.errors, []);
  assert.equal(data.driver.requests.length, 4);
  for (const request of data.driver.requests.slice(0, 3)) {
    assert.match(request.systemPrompt, /Run: Run 1, title "Shopping list"/);
    assert.match(request.systemPrompt, /Element no longer exists or cannot be resolved here/);
    assert.doesNotMatch(request.systemPrompt, /@reviewer|@listhelper|CSV import/);
  }
  assert.match(data.driver.requests[3]!.systemPrompt, /run that was open when sending is no longer available/);
  assert.doesNotMatch(data.driver.requests[3]!.systemPrompt, /Run 2|@reviewer|CSV import/);
});

test("the chat method forwards user location separately and reports a client error for malformed context", async (t) => {
  const data = await fixture(t);
  const send = coreMethods(coreSources({
    get: async (id) => { assert.equal(id, OVERSEER_RUN_ID); return data.session; },
    hasRun: () => true,
  })).find((entry) => entry.contract.id === coreContracts.chat.send.id)!;
  const message = (body: Record<string, unknown>) => send.execute({ runId: OVERSEER_RUN_ID, ...body } as never, methodContext());
  await message({ text: "Look here", userLocation: data.location("first-run") });
  await assert.rejects(message({ text: "Wrong context", userLocation: { ...home, page: ["home"] } }),
    (error: unknown) => error instanceof DomainError && error.status === 400);
  assert.deepEqual(data.runtime.view(OVERSEER_RUN_ID).inputs.map((input) => input.content), ["Look here"]);
  data.scheduler.start();
  await data.scheduler.waitForIdle();
  assert.deepEqual(data.errors, []);
  assert.equal(data.driver.requests.length, 1);
  assert.match(data.driver.requests[0]!.systemPrompt, /Run: Run 1, title "Shopping list"/);
  assert.match(data.driver.requests[0]!.systemPrompt, /@listhelper/);
});
