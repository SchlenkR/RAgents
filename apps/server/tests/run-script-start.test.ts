import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import type { ChatSessionProvider } from "../src/chat-handler.ts";
import { coreContracts } from "../src/api/contracts.ts";
import { coreMethods } from "../src/api/core-methods.ts";
import { coreSources, methodContext } from "./rpc-fixture.ts";
import {
  claimTurn,
  createAccessContext,
  DomainError,
  Journal,
  LiveBus,
  Orchestration,
  StartOptionContributionRegistry,
  StaticModelCatalog,
  type AccessContext,
  type AgentProfile,
  type CatalogModel,
  type RunScriptPackage,
  type SessionStartedContext,
} from "@ragents/engine";
import type { ChatEvent } from "@schlenkr/quassel/events";
import { testServices } from "../../../packages/ragents/tests/support.ts";
import type { ModelChoice } from "../src/plugin-support/model-choice.ts";
import { productStartOptions } from "../src/plugin-support/product-start-options.ts";
import type { SystemPromptCatalog } from "../src/plugin-support/system-prompts.ts";
import type { Engine } from "../src/ragents/engine.ts";
import { RunChatSession, type RunChatSessionOptions, type RunScriptStart } from "../src/ragents/session.ts";
import { awaitWithSignal } from "../src/plugin-support/await-with-signal.ts";
import { runScriptFromDirectory } from "../src/plugin-support/run-scripts.ts";
import type { ScriptParameters } from "../src/plugin-support/actor-programs/script-parameters.ts";
import { noScriptParameters } from "./actor-programs-fixture.ts";
import { capabilityNames } from "@ragents/engine";

const packageOf = (overrides: Partial<RunScriptPackage> = {}, entry: Partial<RunScriptStart["entry"]> = {}): RunScriptStart => ({
  handle: "example",
  coordinator: true,
  files: [{path: "package.json", content: '{"private":true}'}, {path: "src/server.ts", content: "export const program = {};"}],
  programs: [],
  ...overrides,
  entry: {id: "test.example", owner: "test", action: "script", coordinator: overrides.coordinator ?? true,
    title: "Example run", description: "A run from the test", ...entry},
});

const parametersOf = (properties: ScriptParameters["properties"], required: readonly string[] = []): ScriptParameters =>
  ({type: "object", properties, required, additionalProperties: false});

const topicParameters = parametersOf({topic: {type: "string"}});

const createFixture = (runId: string, packages: readonly RunScriptStart[], controls: {
  prepare?: (signal?: AbortSignal) => Promise<void>;
  prepareWorkspace?: (signal?: AbortSignal) => Promise<void>;
  importPackage?: (signal?: AbortSignal) => Promise<void>;
  started?: (signal?: AbortSignal) => Promise<void>;
  stopping?: () => void;
  parameters?: ScriptParameters;
} = {}) => {
  const services = testServices();
  const journal = new Journal(":memory:", services);
  const runtime = new Orchestration(journal, services);
  const live = new LiveBus();
  const catalogModels: CatalogModel[] = [
    { driver: "agent", provider: "test", model: "coordinator-default", label: "test/coordinator-default", thinking: ["low", "high"] },
  ];
  const profiles: AgentProfile[] = [{
    name: "coordinator",
    description: "Test coordinator",
    driver: "agent",
    provider: "test",
    model: "coordinator-default",
    thinking: "low",
    turnTimeoutMs: null,
    isolateWorkspace: false,
  }];
  const systemPrompts: SystemPromptCatalog = {
    mode: "selectable",
    options: [{ id: "general", label: "General", file: "general.md", text: "General prompt" }],
    defaultIds: ["general"],
    shareDefault: false,
  };
  const modelChoice: ModelChoice = {
    options: ["coordinator-default"],
    defaultModel: "coordinator-default",
    provider: "test",
    selectable: true,
    thinkingOptionsFor: () => ["low", "high"],
  };
  const startOptions = new StartOptionContributionRegistry();
  startOptions.register("test.product", productStartOptions({ modelChoice, coordinatorThinking: "low", systemPrompts: () => systemPrompts }));
  const files = mkdtempSync("/private/tmp/ragents-run-script-files-");
  const imports: Array<{name: string; files: RunScriptPackage["files"]; programs: string[]}> = [];
  const starts: Array<{entry: SessionStartedContext["startEntry"]; actors: number; inputs: number}> = [];
  const engine = {
    journal,
    runtime,
    live,
    scheduler: { isRunning: () => false },
    catalog: new StaticModelCatalog(catalogModels, profiles),
    startOptions,
    stopRun: async (_runId: string, input: { commandId: string; reason: string }) => {
      controls.stopping?.();
      runtime.stopRun({ actorId: runtime.view(runId).ownerId, commandId: input.commandId }, runId, { reason: input.reason });
      session.abortStart();
      return runtime.view(runId);
    },
  } as unknown as Engine;
  const options: RunChatSessionOptions = {
    engine,
    id: runId,
    coordinator: {
      handle: "coordinator",
      displayName: "Coordinator",
      profile: "coordinator",
      runTitle: "New run",
      ownerHandle: "owner",
      ownerDisplayName: "Owner",
    },
    prompt: () => "Coordinator prompt",
    assertUsable: () => undefined,
    prepare: async (_id, _emitSystem, signal) => controls.prepare?.(signal),
    prepareWorkspace: async (_id, _emitSystem, signal) => controls.prepareWorkspace?.(signal),
    started: async (_id, entry, signal) => {
      const state = journal.stateOf(runId);
      starts.push({entry, actors: [...state?.actors.values() ?? []].filter((actor) => actor.kind !== "human").length, inputs: state?.inputs.size ?? 0});
      await controls.started?.(signal);
    },
    scriptEntryFor: (entryId) => packages.find((candidate) => candidate.entry.id === entryId),
    startEntryFor: () => undefined,
    actorPrograms: {
      async scriptParameters() { return controls.parameters ?? noScriptParameters; },
      async installScript(context, id, script, _origin, signal) {
        await controls.importPackage?.(signal);
        signal?.throwIfAborted();
        imports.push({name: script.handle, files: script.files, programs: script.programs.map((program) => program.name)});
        if (script.files.some((file) => file.content === "reject")) throw new Error("Package tests failed");
        const view = runtime.createScriptActor(context, id, {
          handle: script.handle, displayName: "Example run", toolNames: null,
          grants: capabilityNames.map((capability) => ({capability, scope: {kind: "run"}, delegable: true})),
        });
        const actor = view.actors.find((entry) => entry.kind === "script" && entry.handle === script.handle)!;
        return {name: script.handle, actorId: actor.id, actorHandle: actor.handle, views: 0};
      },
      enqueueStart(context, id, handle, start) {
        const actor = runtime.view(id).actors.find((entry) => entry.kind === "script" && entry.handle === handle)!;
        const view = runtime.enqueueInput(context, id, {actorId: actor.id, content: start.content});
        return {count: view.inputs.filter((input) => input.actorId === actor.id).length};
      },
      isScriptActor: () => false,
    },
  };
  const session = new RunChatSession(options);
  const events: ChatEvent[] = [];
  session.subscribe((event) => events.push(event));
  const systemTexts = () => events.flatMap((event) => (event.kind === "system" ? [event.text] : []));
  return { journal, runtime, session, live, files, events, systemTexts, imports, starts, createSession: () => new RunChatSession(options) };
};

const startThroughChatHttp = async (session: RunChatSession, runId: string, body: unknown, access?: AccessContext, action: "start" | "send" = "start"): Promise<number> => {
  const provider: ChatSessionProvider = { get: async () => session, hasRun: () => session.started, list: async () => [], delete: async () => undefined };
  const methods = coreMethods(coreSources(provider));
  const method = methods.find((entry) => entry.contract.id === (action === "start" ? coreContracts.chat.start.id : coreContracts.chat.send.id))!;
  const input = { runId, ...(body as Record<string, unknown>) };
  try {
    await method.execute(input as never, methodContext(access));
    await session.settle();
    return 202;
  } catch (error) {
    await session.settle();
    return error instanceof DomainError ? error.status : 500;
  }
};

const phase = () => {
  const entered = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  return {
    entered: entered.promise,
    release: () => release.resolve(),
    wait: (signal?: AbortSignal) => { entered.resolve(); return awaitWithSignal(release.promise, signal); },
  };
};

const statusesOf = (events: readonly ChatEvent[]) => events.filter((event) => event.kind === "status");
const replayStatus = (session: RunChatSession) => {
  const events: ChatEvent[] = [];
  session.subscribe((event) => events.push(event))();
  return statusesOf(events).at(-1)!;
};

test("all script start entry points synchronously publish preparation, replay each phase and clear it after enqueue", async (t) => {
  for (const method of ["start", "startAndWait", "startPackageAndWait"] as const) await t.test(method, async (t) => {
    const preparation = phase();
    const workspace = phase();
    const importing = phase();
    const script = packageOf({ coordinator: false });
    const f = createFixture(`startup-${method.toLowerCase()}`, [script], {
      prepare: preparation.wait,
      prepareWorkspace: workspace.wait,
      importPackage: importing.wait,
    });
    t.after(async () => { preparation.release(); workspace.release(); importing.release(); await f.session.drain(); f.journal.close(); rmSync(f.files, { recursive: true, force: true }); });
    const pending = method === "startPackageAndWait" ? f.session.startPackageAndWait(script, {}) : f.session[method]("test.example", {});
    void pending?.catch(() => {});
    if (method === "start") await pending;
    assert.equal(f.session.started, true);
    assert.deepEqual(replayStatus(f.session), { kind: "status", running: false, startup: { status: "preparing", message: "Preparing run." } });
    assert.equal(f.journal.stateOf(f.session.id), null);
    await preparation.entered;
    const beforeDuplicate = statusesOf(f.events).length;
    await assert.rejects(f.session.startAndWait("test.unknown", {}), /is being started/);
    await assert.rejects(f.session.startPackageAndWait(script, {}), /is being started/);
    assert.equal(statusesOf(f.events).length, beforeDuplicate);
    preparation.release();
    await workspace.entered;
    assert.equal(f.runtime.view(f.session.id).actors.filter((actor) => actor.kind !== "human").length, 0);
    assert.deepEqual(replayStatus(f.session).startup, { status: "preparing", message: "Preparing working directory." });
    const reloaded = f.createSession();
    assert.equal(reloaded.attach(), false);
    assert.deepEqual(replayStatus(reloaded), { kind: "status", running: false });
    reloaded.dispose();
    workspace.release();
    await importing.entered;
    assert.deepEqual(replayStatus(f.session).startup, { status: "preparing", message: "Preparing UI." });
    const unsubscribe = f.journal.subscribe((events) => {
      const input = events.find((event) => event.type === "actor.input.enqueued");
      if (input?.type === "actor.input.enqueued") f.live.publish(f.session.id, input.payload.actorId, { kind: "turn-started", turnId: "setup-turn" });
    });
    t.after(unsubscribe);
    importing.release();
    await pending;
    await f.session.settle();
    assert.equal(f.runtime.view(f.session.id).inputs.length, 1);
    assert.ok(statusesOf(f.events).some((event) => event.running && event.startup?.status === "preparing"), "Live status during enqueue must preserve startup");
    assert.deepEqual(replayStatus(f.session), { kind: "status", running: true });
    const boundStatus = f.events.findIndex((event, index) => event.kind === "reset" && index > 0);
    assert.ok(statusesOf(f.events.slice(boundStatus)).some((event) => event.startup?.message === "Preparing UI."), "Binding a new primary actor must replay startup");
    f.live.publish(f.session.id, f.runtime.view(f.session.id).primaryActorId!, { kind: "turn-finished", turnId: "setup-turn" });
    assert.deepEqual(replayStatus(f.session), { kind: "status", running: false });
    const finalCount = statusesOf(f.events).length;
    await assert.rejects(f.session.startAndWait("test.example", {}), /already running/);
    assert.equal(statusesOf(f.events).length, finalCount);
  });
});

test("startup failures retain the actual cause for replay and retries replace the failed state", async (t) => {
  for (const operationName of ["prepare", "prepareWorkspace", "importPackage"] as const) await t.test(operationName, async (t) => {
    let failed = false;
    const cause = `${operationName}: unavailable fixture resource`;
    const f = createFixture(`startup-failed-${operationName.toLowerCase()}`, [packageOf()], { [operationName]: async () => {
      if (!failed) { failed = true; throw new Error(cause); }
    } });
    t.after(async () => { await f.session.drain(); f.journal.close(); rmSync(f.files, { recursive: true, force: true }); });
    await assert.rejects(f.session.startAndWait("test.example", {}), { message: cause });
    assert.deepEqual(replayStatus(f.session), { kind: "status", running: false, startup: { status: "failed", message: cause } });
    assert.equal(f.session.started, false);
    const replacement = f.createSession();
    replacement.attach();
    assert.deepEqual(replayStatus(replacement), { kind: "status", running: false });
    replacement.dispose();
    const retry = f.session.startPackageAndWait(packageOf(), {});
    assert.equal(replayStatus(f.session).startup?.status, "preparing");
    await retry;
    assert.deepEqual(replayStatus(f.session), { kind: "status", running: false });
  });
});

test("stop clears the loader while tracking unfinished preparation and never enqueues late inputs", async (t) => {
  for (const operationName of ["prepare", "prepareWorkspace", "importPackage"] as const) await t.test(operationName, async (t) => {
    const blocked = phase();
    const f = createFixture(`startup-stop-${operationName.toLowerCase()}`, [packageOf()], { [operationName]: operationName === "importPackage" ? blocked.wait : () => blocked.wait() });
    t.after(async () => { blocked.release(); await f.session.drain(); f.journal.close(); rmSync(f.files, { recursive: true, force: true }); });
    const pending = f.session.startAndWait("test.example", {});
    const rejected = assert.rejects(pending, /start was cancelled/);
    await blocked.entered;
    await f.session.stop();
    assert.equal(replayStatus(f.session).startup?.status, "failed");
    if (operationName !== "importPackage") {
      let settled = false;
      void f.session.settle().then(() => { settled = true; });
      await new Promise((resolve) => setImmediate(resolve));
      assert.equal(settled, false);
      assert.equal(f.session.started, true);
      assert.equal(replayStatus(f.session).startup?.status, "failed");
    } else {
      await rejected;
      await f.session.settle();
    }
    blocked.release();
    await rejected;
    await f.session.settle();
    assert.equal(f.imports.length, 0);
    assert.equal(f.journal.stateOf(f.session.id)?.inputs.size ?? 0, 0);
    assert.equal(f.session.started, false);
  });
});

test("stop marks an installed run before cancelling its unfinished start and leaves its actors usable", async (t) => {
  const blocked = phase();
  let startSignal: AbortSignal | undefined;
  const f = createFixture("installed-start-stop", [packageOf()], {
    started: (signal) => {
      startSignal = signal;
      return blocked.wait(signal);
    },
    stopping: () => { assert.equal(startSignal?.aborted, false); },
  });
  t.after(async () => { blocked.release(); await f.session.drain(); f.journal.close(); rmSync(f.files, { recursive: true, force: true }); });
  const pending = assert.rejects(f.session.startAndWait("test.example", {}), /start was cancelled/);
  await blocked.entered;
  const primaryId = f.runtime.view(f.session.id).primaryActorId;
  assert.ok(primaryId);
  assert.ok(startSignal);
  await f.session.stop();
  await pending;
  const stopped = f.runtime.view(f.session.id);
  assert.equal(startSignal.aborted, true);
  assert.ok(stopped.stopped);
  assert.equal(stopped.inputs.length, 0);
  assert.equal(stopped.primaryActorId, primaryId);
  assert.ok(stopped.actors.filter((actor) => actor.kind !== "human").every((actor) => actor.lifecycle.kind === "idle"));
  assert.equal(f.runtime.events(f.session.id).some((event) => event.type === "actor.stopped"), false);
});

for (const entry of ["send", "ensureStarted"] as const) test(`stop cancels an initial ${entry} during workspace preparation without accepting its old input`, async (t) => {
  const blocked = phase();
  let waiting = true;
  let startSignal: AbortSignal | undefined;
  const f = createFixture(`initial-${entry.toLowerCase()}-stop`, [], {
    prepareWorkspace: (signal) => {
      startSignal = signal;
      return waiting ? blocked.wait(signal) : Promise.resolve();
    },
    stopping: () => { assert.equal(startSignal?.aborted, false); },
  });
  t.after(async () => { blocked.release(); await f.session.drain(); f.journal.close(); rmSync(f.files, { recursive: true, force: true }); });
  const operation = entry === "send" ? f.session.send("Old message.") : f.session.ensureStarted();
  const outcome = operation.then(() => undefined, (error: unknown) => error);
  await blocked.entered;
  assert.equal(f.journal.hasRun(f.session.id), true);
  await f.session.stop();
  blocked.release();
  const cancelled = await outcome;
  assert.ok(cancelled instanceof Error);
  assert.match(cancelled.message, entry === "send" ? /message was cancelled/ : /start was cancelled/);
  assert.equal(startSignal?.aborted, true);
  const stopped = f.runtime.view(f.session.id);
  assert.ok(stopped.stopped);
  assert.equal(stopped.inputs.length, 0);
  assert.equal(stopped.turns.length, 0);
  assert.equal(f.runtime.events(f.session.id).some((event) => event.type === "run.continued"), false);

  waiting = false;
  await f.session.send("New message.");
  const continued = f.runtime.view(f.session.id);
  assert.equal(continued.stopped, null);
  assert.ok(continued.primaryActorId);
  assert.deepEqual(continued.inputs.map((input) => input.content), ["New message."]);
  assert.equal(f.runtime.events(f.session.id).filter((event) => event.type === "run.continued").length, 1);
});

for (const directed of [false, true]) test(`stop cancels a pending ${directed ? "directed " : ""}message before run readiness without letting it continue the run`, async (t) => {
  const blocked = phase();
  let waiting = false;
  let messageSignal: AbortSignal | undefined;
  const f = createFixture(`pending-${directed ? "directed" : "primary"}-stop`, [], {
    prepare: (signal) => {
      messageSignal = signal;
      return waiting ? blocked.wait() : Promise.resolve();
    },
    stopping: () => { assert.equal(messageSignal?.aborted, false); },
  });
  t.after(async () => { blocked.release(); await f.session.drain(); f.journal.close(); rmSync(f.files, { recursive: true, force: true }); });
  const primaryId = await f.session.ensureStarted();
  waiting = true;
  const operation = directed ? f.session.sendToActor(primaryId, "Old message.") : f.session.send("Old message.");
  const outcome = operation.then(() => undefined, (error: unknown) => error);
  await blocked.entered;
  await f.session.stop();
  assert.equal(messageSignal?.aborted, true);
  assert.ok(f.runtime.view(f.session.id).stopped);
  assert.equal(f.runtime.view(f.session.id).inputs.length, 0);
  blocked.release();
  const cancelled = await outcome;
  assert.ok(cancelled instanceof Error);
  assert.match(cancelled.message, /message was cancelled/);
  assert.ok(f.runtime.view(f.session.id).stopped);
  assert.equal(f.runtime.events(f.session.id).some((event) => event.type === "run.continued"), false);

  waiting = false;
  await f.session.send("New message.");
  const continued = f.runtime.view(f.session.id);
  assert.equal(continued.stopped, null);
  assert.equal(continued.primaryActorId, primaryId);
  assert.deepEqual(continued.inputs.map((input) => input.content), ["New message."]);
  assert.equal(continued.turns.length, 0);
});

test("dispose cancels preparation without replaying a stale startup", async (t) => {
  const blocked = phase();
  const f = createFixture("startup-clear", [packageOf()], { prepare: () => blocked.wait() });
  t.after(async () => { blocked.release(); await f.session.drain(); f.journal.close(); rmSync(f.files, { recursive: true, force: true }); });
  const rejected = assert.rejects(f.session.startAndWait("test.example", {}), /deleted/);
  await blocked.entered;
  f.session.dispose();
  assert.equal(replayStatus(f.session).startup, undefined);
  let settled = false;
  const draining = f.session.settle().then(() => { settled = true; });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(settled, false);
  blocked.release();
  await rejected;
  await draining;
  assert.equal(f.journal.stateOf(f.session.id), null);
  assert.equal(replayStatus(f.session).startup, undefined);
});

test("a local package transports all sources and node tests through the common import path", async () => {
  const fixture = createFixture("local-package", [], {parameters: topicParameters});
  const directory = path.join(fixture.files, "own-setup");
  mkdirSync(path.join(directory, "src", "lib"), {recursive: true});
  mkdirSync(path.join(directory, "tests"));
  writeFileSync(path.join(directory, "RUN.md"), "---\ntitle: Own setup\ndescription: From a local file\n---\n");
  writeFileSync(path.join(directory, "package.json"), '{"private":true,"ragents":{"backend":"src/server.ts"}}');
  writeFileSync(path.join(directory, "src/server.ts"), 'export {value} from "./lib/value.js";');
  writeFileSync(path.join(directory, "src/lib/value.ts"), "export const value = 1;");
  writeFileSync(path.join(directory, "tests/app.test.ts"), 'import test from "node:test"; test("package", () => {});');
  try {
    assert.throws(() => runScriptFromDirectory("own-setup"), /absolute server file path/);
    const {script, ...entry} = runScriptFromDirectory(directory);
    assert.deepEqual(script.files.map((file) => file.path), ["package.json", "src/lib/value.ts", "src/server.ts", "tests/app.test.ts"]);
    await fixture.session.startPackageAndWait({...script, entry: {...entry, owner: "test", coordinator: script.coordinator}}, {parameters: {topic: "Local topic"}});
    assert.deepEqual(fixture.imports, [{name: "own-setup", files: script.files, programs: []}]);
    const view = fixture.runtime.view("local-package");
    assert.equal(view.title, "Own setup");
    assert.ok(view.actors.some((actor) => actor.kind === "script" && actor.handle === "own-setup"));
    assert.deepEqual(JSON.parse(view.inputs[0]!.content).parameters, {topic: "Local topic"});
    assert.equal(view.inputs[0]!.origin, undefined);
    await assert.rejects(fixture.session.startPackageAndWait(packageOf(), {}), /already running/);
  } finally {fixture.journal.close(); rmSync(fixture.files, {recursive: true, force: true});}
});

test("a script start tells the plugins its template after installing the script and before its first input", async () => {
  const fixture = createFixture("script-start-hook", [packageOf({ coordinator: false })]);
  try {
    await fixture.session.startAndWait("test.example", {});
    assert.deepEqual(fixture.starts, [{entry: {id: "test.example", action: "script"}, actors: 1, inputs: 0}]);
    assert.equal(fixture.runtime.view("script-start-hook").inputs.length, 1);
  } finally {fixture.journal.close(); rmSync(fixture.files, {recursive: true, force: true});}
});

test("a rejected package exposes its failure before creating the coordinator", async () => {
  const fixture = createFixture("bad-local-package", []);
  try {
    const script = packageOf({files: [{path: "tests/app.test.ts", content: "reject"}]});
    await assert.rejects(fixture.session.startPackageAndWait(script, {}), /Package tests failed/);
    assert.equal(fixture.runtime.view("bad-local-package").actors.filter((actor) => actor.kind !== "human").length, 0);
  } finally {fixture.journal.close(); rmSync(fixture.files, {recursive: true, force: true});}
});

test("a run script starts over HTTP with coordinator primary and the selected start values", async () => {
  const runId = "run-script-start-coordinator";
  const fixture = createFixture(runId, [packageOf()], {parameters: topicParameters});
  try {
    assert.equal(await startThroughChatHttp(fixture.session, runId, {entry: "test.example", parameters: {topic: "Test topic"}}), 202);
    const view = fixture.runtime.view(runId);
    assert.equal(view.title, "Example run");
    const primary = view.actors.find((actor) => actor.id === view.primaryActorId);
    assert.ok(primary && primary.kind === "agent" && primary.handle === "coordinator");
    const script = view.actors.find((actor) => actor.kind === "script");
    assert.ok(script && script.kind === "script");
    assert.equal(script.handle, "example");
    assert.equal(script.createdBy, view.ownerId);
    assert.equal(script.toolNames, null);
    assert.equal("source" in script, false);
    assert.equal(view.inputs.length, 1);
    assert.equal(view.inputs[0]?.actorId, script.id);
    const content = JSON.parse(view.inputs[0]!.content);
    assert.deepEqual(content.parameters, {topic: "Test topic"});
    assert.deepEqual(Object.keys(content.options).sort(), ["ragents.model", "ragents.resume-after-restart", "ragents.system-prompt"]);
    assert.equal(content.options["ragents.resume-after-restart"], "on");
    assert.ok(fixture.systemTexts().some((text) => text.includes('The run script "Example run" runs as @example')));
  } finally {fixture.journal.close(); rmSync(fixture.files, {recursive: true, force: true});}
});

const roundParameters = parametersOf({ topic: { type: "string" }, rounds: { type: "integer", maximum: 5 } }, ["topic"]);

test("a start whose parameters miss a required one, add an unknown one or mistype one is refused before any run exists", async (t) => {
  const fixture = createFixture("parameters-refused", [packageOf()], { parameters: roundParameters });
  t.after(async () => { await fixture.session.drain(); fixture.session.dispose(); fixture.journal.close(); rmSync(fixture.files, { recursive: true, force: true }); });
  const refusals: Array<[unknown, RegExp]> = [
    [undefined, /parameters is missing required field topic/],
    [null, /parameters is missing required field topic/],
    [{ rounds: 2 }, /parameters is missing required field topic/],
    [{ topic: "Launch", extra: 1 }, /parameters has unknown field extra/],
    [{ topic: 3 }, /topic must be string, got 3/],
    [{ topic: "Launch", rounds: 9 }, /rounds must be <= 5, got 9/],
    [["Launch"], /parameters must be object/],
  ];
  for (const [parameters, complaint] of refusals) {
    await assert.rejects(fixture.session.startAndWait("test.example", { parameters }), (error: unknown) =>
      error instanceof DomainError && error.code === "parameters-invalid" && error.status === 400 && complaint.test(error.message)
      && error.message.startsWith("The parameters of the run script test.example are invalid: ")
      && error.message.endsWith(" Its parameters: topic (string, required); rounds (integer, optional)."), JSON.stringify(parameters));
    assert.equal(fixture.journal.stateOf(fixture.session.id), null, "no run is created");
    assert.equal(fixture.session.started, false);
    assert.deepEqual(fixture.imports, []);
    assert.deepEqual(fixture.starts, []);
  }
  await fixture.session.startAndWait("test.example", { parameters: { topic: "Launch" } });
  assert.deepEqual(JSON.parse(fixture.runtime.view(fixture.session.id).inputs[0]!.content).parameters, { topic: "Launch" }, "the host adds no defaults");
});

test("ragents.runs.startScript and ragents.chat.start refuse invalid parameters with parameters-invalid; neither creates a run", async (t) => {
  const fixture = createFixture("parameters-rpc", [packageOf()], { parameters: roundParameters });
  t.after(async () => { await fixture.session.drain(); fixture.session.dispose(); fixture.journal.close(); rmSync(fixture.files, { recursive: true, force: true }); });
  const startScript = coreMethods(coreSources({ get: async () => fixture.session })).find((entry) => entry.contract.id === coreContracts.runs.startScript.id)!;
  await assert.rejects(async () => startScript.execute({ runId: fixture.session.id, entry: "test.example", parameters: { topic: 3 } } as never, methodContext()),
    { code: "parameters-invalid", status: 400, message: /topic must be string, got 3\. Its parameters: topic \(string, required\); rounds \(integer, optional\)\.$/ });
  assert.equal(fixture.journal.stateOf(fixture.session.id), null);
  const errors = fixture.systemTexts().filter((text) => text.startsWith("Error")).length;
  assert.equal(await startThroughChatHttp(fixture.session, fixture.session.id, { entry: "test.example", parameters: { topic: "Launch", rounds: 9 } }), 400, "the start is refused");
  assert.equal(fixture.systemTexts().filter((text) => text.startsWith("Error")).length, errors, "a refused chat start leaves nothing in the chat");
  assert.equal(fixture.journal.stateOf(fixture.session.id), null);
  assert.deepEqual(fixture.imports, []);
  assert.equal(await startThroughChatHttp(fixture.session, fixture.session.id, { entry: "test.example", parameters: { topic: "Launch", rounds: 2 } }), 202);
  assert.deepEqual(JSON.parse(fixture.runtime.view(fixture.session.id).inputs[0]!.content).parameters, { topic: "Launch", rounds: 2 });
});

test("start options in a start request are chosen like ragents.startOptions.select and only for a start that passed the parameter check", async (t) => {
  const restart = (session: RunChatSession) => session.startOptions(null).find((option) => option.id === "ragents.resume-after-restart")!;
  const refused = createFixture("request-options-refused", [packageOf()], { parameters: roundParameters });
  t.after(async () => { await refused.session.drain(); refused.session.dispose(); refused.journal.close(); rmSync(refused.files, { recursive: true, force: true }); });
  await assert.rejects(refused.session.startAndWait("test.example", { parameters: { topic: 3 }, options: { "ragents.resume-after-restart": "off" } }), { code: "parameters-invalid" });
  assert.equal(restart(refused.session).chosen, false);
  await assert.rejects(refused.session.startAndWait("test.example", { parameters: { topic: "Launch" }, options: { "ragents.resume-after-restart": "maybe" } }),
    /Invalid value for start option ragents\.resume-after-restart/);
  await assert.rejects(refused.session.startAndWait("test.example", { parameters: { topic: "Launch" }, options: { "test.unknown": 1 } }), { code: "option-unknown", status: 404 });
  assert.equal(refused.journal.stateOf(refused.session.id), null, "no run is created");

  const accepted = createFixture("request-options-accepted", [packageOf()]);
  t.after(async () => { await accepted.session.drain(); accepted.session.dispose(); accepted.journal.close(); rmSync(accepted.files, { recursive: true, force: true }); });
  assert.equal(restart(accepted.session).value, "on");
  await accepted.session.startAndWait("test.example", { options: { "ragents.resume-after-restart": "off" } });
  const content = JSON.parse(accepted.runtime.view(accepted.session.id).inputs[0]!.content);
  assert.equal(content.options["ragents.resume-after-restart"], "off");
  assert.deepEqual(content.parameters, {});
});

test("ragents.runs.scripts lists the declared parameters, ragents.runs.scriptParameters returns them for one template", async (t) => {
  const plain = packageOf({}, { id: "test.plain" });
  const fixture = createFixture("parameters-listing", [packageOf(), plain], { parameters: roundParameters });
  t.after(async () => { await fixture.session.drain(); fixture.session.dispose(); fixture.journal.close(); rmSync(fixture.files, { recursive: true, force: true }); });
  const provider: ChatSessionProvider = { get: async () => fixture.session, hasRun: () => false, list: async () => [], delete: async () => undefined };
  const plugins = { startEntries: { describe: () => [packageOf().entry, plain.entry] }, startOptions: new StartOptionContributionRegistry() };
  const methods = coreMethods(coreSources(provider, { plugins: plugins as never }));
  const method = (id: string) => methods.find((entry) => entry.contract.id === id)!;
  const listed = await method(coreContracts.runs.scripts.id).execute({ runId: fixture.session.id } as never, methodContext());
  assert.deepEqual(listed, [
    { id: "test.example", title: "Example run", description: "A run from the test", parameters: roundParameters, available: true },
    { id: "test.plain", title: "Example run", description: "A run from the test", parameters: roundParameters, available: true },
  ]);
  assert.deepEqual(await method(coreContracts.runs.scriptParameters.id).execute({ runId: fixture.session.id, entry: "test.plain" } as never, methodContext()), roundParameters);
  await assert.rejects(async () => method(coreContracts.runs.scriptParameters.id).execute({ runId: fixture.session.id, entry: "test.unknown" } as never, methodContext()),
    { code: "entry-unknown", status: 404 });
  const reader = createAccessContext({ enabled: true, user: { id: "alice", label: "Alice", rights: ["runs.read", "runs.write"], startEntries: ["test.plain"] } });
  await assert.rejects(async () => method(coreContracts.runs.scriptParameters.id).execute({ runId: fixture.session.id, entry: "test.example" } as never, methodContext(reader)),
    { code: "access-denied", status: 403 });
  assert.equal(fixture.journal.stateOf(fixture.session.id), null, "reading parameters creates no run");
});

test("unlisted scripts stay absent from run-script listings and start by ID only with permission", async (t) => {
  const runId = "unlisted-script";
  const script = packageOf({ coordinator: false }, { listed: false });
  const fixture = createFixture(runId, [script], { parameters: parametersOf({ row: { type: "integer" } }) });
  t.after(async () => { await fixture.session.drain(); fixture.session.dispose(); fixture.journal.close(); rmSync(fixture.files, { recursive: true, force: true }); });
  assert.deepEqual(await fixture.session.runScripts([script.entry], null), []);
  const user = { id: "alice", label: "Alice", rights: ["runs.read", "runs.write"] };
  const denied = createAccessContext({ enabled: true, user });
  assert.equal(await startThroughChatHttp(fixture.session, runId, { entry: script.entry.id, parameters: { row: 3 } }, denied), 403);
  assert.equal(fixture.session.started, false);
  assert.deepEqual(fixture.imports, []);
  const permitted = createAccessContext({ enabled: true, user: { ...user, startEntries: [script.entry.id] } });
  assert.equal(await startThroughChatHttp(fixture.session, runId, { entry: script.entry.id, parameters: { row: 3 } }, permitted), 202);
  assert.equal(fixture.session.started, true);
  assert.equal(fixture.runtime.view(runId).actors.some((actor) => actor.kind === "script" && actor.handle === script.handle), true);
  assert.deepEqual(await fixture.session.runScripts([script.entry], user.id), []);
});

test("authenticated HTTP script starts use the trusted user's label despite Owner defaults and a forged request user", async (t) => {
  const access = createAccessContext({ enabled: true, user: {
    id: "operator-account", label: "Operator", rights: ["runs.read", "runs.write"], startEntries: ["test.example"],
  } });
  for (const coordinator of [true, false]) await t.test(coordinator ? "with coordinator" : "headless", async (t) => {
    const runId = `script-user-${coordinator}`;
    const fixture = createFixture(runId, [packageOf({ coordinator })]);
    const started = t.mock.method(fixture.session, "start");
    t.after(async () => { await fixture.session.drain(); fixture.session.dispose(); fixture.journal.close(); rmSync(fixture.files, { recursive: true, force: true }); });
    assert.equal(await startThroughChatHttp(fixture.session, runId, {
      entry: "test.example", user: { id: "owner", label: "Owner" }, ownerDisplayName: "Owner",
    }, access), 202);
    const view = fixture.runtime.view(runId);
    const humans = view.actors.filter((actor) => actor.kind === "human");
    assert.equal(humans.length, 1);
    assert.equal(humans[0].id, view.ownerId);
    assert.equal(humans[0].displayName, "Operator");
    assert.equal(humans[0].handle, "operator-account");
    assert.equal(view.actors.some((actor) => actor.displayName === "Owner" || actor.handle === "owner"), false);
    assert.deepEqual(started.mock.calls[0].arguments[2], { id: "operator-account", label: "Operator" });
  });
});

test("free chat creation receives the authenticated user and ignores identity fields in the message body", async (t) => {
  const runId = "free-chat-user";
  const fixture = createFixture(runId, []);
  const sent = t.mock.method(fixture.session, "send");
  t.after(async () => { await fixture.session.drain(); fixture.session.dispose(); fixture.journal.close(); rmSync(fixture.files, { recursive: true, force: true }); });
  const access = createAccessContext({ enabled: true, user: { id: "operator-account", label: "Operator", rights: ["runs.read", "runs.write", "runs.create"] } });
  assert.equal(await startThroughChatHttp(fixture.session, runId, { text: "Hello", user: { id: "owner", label: "Owner" } }, access, "send"), 202);
  const view = fixture.runtime.view(runId);
  const owner = view.actors.find((actor) => actor.id === view.ownerId)!;
  assert.equal(owner.kind, "human");
  assert.equal(owner.displayName, "Operator");
  assert.equal(owner.handle, "operator-account");
  assert.equal(view.inputs.at(-1)?.content, "Hello");
  assert.deepEqual(sent.mock.calls[0].arguments[3], { id: "operator-account", label: "Operator" });
});

test("another logged-in user can continue a restored run without rewriting its existing owner", async (t) => {
  const runId = "restored-chat-owner";
  const fixture = createFixture(runId, []);
  t.after(async () => { await fixture.session.drain(); fixture.session.dispose(); fixture.journal.close(); rmSync(fixture.files, { recursive: true, force: true }); });
  await fixture.session.send("Original conversation");
  const original = fixture.runtime.view(runId);
  const owner = original.actors.find((actor) => actor.id === original.ownerId)!;
  assert.equal(owner.displayName, "Owner");
  assert.equal(owner.handle, "owner");
  fixture.session.dispose();
  const restored = fixture.createSession();
  t.after(() => restored.dispose());
  assert.equal(restored.attach(), true);
  const access = createAccessContext({ enabled: true, user: { id: "operator-account", label: "Operator", rights: ["runs.read", "runs.write"] } });
  assert.equal(await startThroughChatHttp(restored, runId, { text: "Continue" }, access, "send"), 202);
  const current = fixture.runtime.view(runId);
  assert.equal(current.ownerId, original.ownerId);
  assert.deepEqual(current.actors.filter((actor) => actor.kind === "human"), [owner]);
  assert.equal(current.inputs.at(-1)?.content, "Continue");
});

test("without a coordinator the setup actor is immediately primary and can select a successor", async () => {
  const runId = "run-script-start-headless";
  const fixture = createFixture(runId, [packageOf({coordinator: false})]);
  try {
    await fixture.session.startAndWait("test.example", {});
    let view = fixture.runtime.view(runId);
    const script = view.actors.find((actor) => actor.kind === "script");
    assert.ok(script);
    assert.equal(view.primaryActorId, script.id);
    assert.equal(fixture.session.started, true);
    assert.equal(view.actors.filter((actor) => actor.kind === "agent").length, 0);
    assert.equal(view.inputs.length, 1);
    assert.equal(view.inputs[0].actorId, script.id);
    assert.deepEqual(JSON.parse(view.inputs[0].content).parameters, {});
    const before = structuredClone(fixture.runtime.events(runId));
    await assert.rejects(fixture.session.send("Start again"), { code: "actor-chat-unsupported", status: 400 });
    assert.deepEqual(fixture.runtime.events(runId), before);
    view = fixture.runtime.spawnAgent({actorId: view.ownerId, commandId: "moderator"}, runId, {
      handle: "moderator", displayName: "Moderator", prompt: "Moderate.",
      execution: {driver: {kind: "manual", config: {}}, workspacePath: null, turnTimeoutMs: null}, grants: [], toolNames: null,
    });
    const moderator = view.actors.find((actor) => actor.kind === "agent")!;
    const input = view.inputs.find((entry) => entry.actorId === script.id)!;
    const turn = claimTurn(fixture.runtime, runId, script.id, input.id, "setup-turn");
    fixture.runtime.selectPrimaryActor({actorId: script.id, commandId: "successor", turnId: turn.turnId}, runId, moderator.id);
    assert.equal(fixture.runtime.view(runId).primaryActorId, moderator.id);
    assert.ok(fixture.events.some((event) => event.kind === "reset"));
    await fixture.session.send("Moderate the next round");
    assert.equal(fixture.runtime.view(runId).inputs.at(-1)?.actorId, moderator.id);
  } finally {fixture.journal.close(); rmSync(fixture.files, {recursive: true, force: true});}
});

test("unknown templates, rejected packages and existing runs produce named errors while failed imports can retry", async () => {
  const runId = "run-script-start-errors";
  const broken = packageOf({files: [{path: "src/server.ts", content: "reject"}]}, {id: "test.broken"});
  const fixture = createFixture(runId, [packageOf(), broken]);
  try {
    await assert.rejects(fixture.session.start("test.nowhere", {}), { code: "entry-unknown", message: /is not a script template of this profile/ });
    await fixture.session.start("test.broken", {});
    await fixture.session.settle();
    assert.ok(fixture.systemTexts().some((text) => text.includes("Package tests failed")));
    assert.equal(fixture.runtime.view(runId).actors.filter((actor) => actor.kind !== "human").length, 0);
    await fixture.session.startAndWait("test.example", {});
    assert.ok(fixture.runtime.view(runId).actors.some((actor) => actor.kind === "script"));
    await assert.rejects(fixture.session.startAndWait("test.example", {}), /only starts a new run/);
  } finally {fixture.journal.close(); rmSync(fixture.files, {recursive: true, force: true});}
});

test("bundled actor packages go to the installation together with the setup before the setup is invoked", async () => {
  const runId = "run-script-start-programs";
  const fixture = createFixture(runId, [packageOf({programs: [{name: "shared-list", files: packageOf().files}]})]);
  try {
    await fixture.session.startAndWait("test.example", {});
    assert.equal(fixture.systemTexts().filter((text) => text.startsWith("Error")).length, 0);
    assert.equal(fixture.runtime.view(runId).inputs.length, 1);
    assert.deepEqual(fixture.imports.map((entry) => [entry.name, entry.programs]), [["example", ["shared-list"]]]);
  } finally {fixture.journal.close(); rmSync(fixture.files, {recursive: true, force: true});}
});

for (const phaseName of ["prepare", "prepareWorkspace", "importPackage", "started"] as const) {
  test(`RPC script starts cancel during ${phaseName} and can be retried without accepting input`, async (t) => {
    const preparation = phase();
    let pause = true;
    let preparationSignal: AbortSignal | undefined;
    const f = createFixture(`rpc-cancel-${phaseName.toLowerCase()}`, [packageOf({coordinator: false})], {
      [phaseName]: (signal?: AbortSignal) => {
        preparationSignal = signal;
        return pause ? preparation.wait(signal) : Promise.resolve();
      },
    });
    t.after(async () => { preparation.release(); await f.session.drain(); f.journal.close(); rmSync(f.files, {recursive: true, force: true}); });
    const method = coreMethods(coreSources({get: async () => f.session})).find((entry) => entry.contract.id === coreContracts.runs.startScript.id)!;
    const caller = new AbortController();
    const pending = method.execute({runId: f.session.id, entry: "test.example"}, {...methodContext(), signal: caller.signal});
    const cancelled = assert.rejects(pending, /cancelled|disconnected/);
    await preparation.entered;
    assert.ok(preparationSignal);
    caller.abort(new Error("Request disconnected"));
    await cancelled;
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(preparationSignal.aborted, true);
    assert.equal(f.journal.stateOf(f.session.id)?.inputs.size ?? 0, 0);
    assert.equal(f.imports.length, phaseName === "started" ? 1 : 0);
    if (phaseName === "started") {
      assert.ok(f.runtime.view(f.session.id).primaryActorId, "the lifecycle hook sees the installed primary actor");
      assert.equal(f.starts.length, 1);
    }
    pause = false;
    await method.execute({runId: f.session.id, entry: "test.example"}, methodContext());
    assert.equal(f.journal.stateOf(f.session.id)?.inputs.size, 1);
    assert.equal(f.imports.length, 1);
    if (phaseName === "started") {
      assert.equal(f.starts.length, 2, "the cancelled lifecycle must run again before accepting the retry");
      assert.ok(f.starts.every((start) => start.inputs === 0));
    }
  });
}

for (const directed of [false, true]) test(`a ${directed ? "directed " : ""}chat retry completes cancelled initial lifecycle readiness before accepting input`, async (t) => {
  const lifecycle = phase();
  let pause = true;
  const f = createFixture("cancelled-chat-lifecycle", [], {started: (signal) => pause ? lifecycle.wait(signal) : Promise.resolve()});
  t.after(async () => { lifecycle.release(); await f.session.drain(); f.journal.close(); rmSync(f.files, {recursive: true, force: true}); });
  const method = coreMethods(coreSources({get: async () => f.session})).find((entry) => entry.contract.id === coreContracts.chat.send.id)!;
  const caller = new AbortController();
  const pending = method.execute({runId: f.session.id, text: "Cancelled first message"}, {...methodContext(), signal: caller.signal});
  const cancelled = assert.rejects(pending, /disconnected/);
  await lifecycle.entered;
  const primary = f.runtime.view(f.session.id).primaryActorId;
  assert.ok(primary);
  caller.abort(new Error("Request disconnected"));
  await cancelled;
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(f.runtime.view(f.session.id).inputs.length, 0);
  pause = false;
  if (directed) {
    const directedMethod = coreMethods(coreSources({get: async () => f.session})).find((entry) => entry.contract.id === coreContracts.chat.sendToActor.id)!;
    await directedMethod.execute({runId: f.session.id, actorId: primary, text: "Accepted retry"}, methodContext());
  } else await method.execute({runId: f.session.id, text: "Accepted retry"}, methodContext());
  assert.equal(f.starts.length, 2, "materializing a primary actor must not skip cancelled lifecycle work");
  assert.ok(f.starts.every((start) => start.inputs === 0));
  assert.equal(f.runtime.view(f.session.id).primaryActorId, primary);
  assert.deepEqual(f.runtime.view(f.session.id).inputs.map((input) => input.content), ["Accepted retry"]);
});

test("a cancelled initial script never accepts setup input when a chat sender keeps lifecycle readiness alive", async (t) => {
  const lifecycle = phase();
  let lifecycleSignal: AbortSignal | undefined;
  const f = createFixture("shared-script-lifecycle", [packageOf()], {started: (signal) => {
    lifecycleSignal = signal;
    return lifecycle.wait(signal);
  }});
  t.after(async () => { lifecycle.release(); await f.session.drain(); f.journal.close(); rmSync(f.files, {recursive: true, force: true}); });
  const caller = new AbortController();
  const first = f.session.startAndWait("test.example", {}, undefined, undefined, caller.signal);
  const cancelled = assert.rejects(first, /disconnected/);
  await lifecycle.entered;
  const second = f.session.send("Accepted chat message");
  await new Promise((resolve) => setTimeout(resolve, 0));
  caller.abort(new Error("Request disconnected"));
  await cancelled;
  assert.equal(lifecycleSignal?.aborted, false);
  lifecycle.release();
  await second;
  assert.deepEqual(f.runtime.view(f.session.id).inputs.map((input) => input.content), ["Accepted chat message"]);
  assert.equal(f.starts.length, 1);
});

test("a cancelled chat sender leaves shared run readiness available to another sender", async (t) => {
  const workspace = phase();
  let workspaceSignal: AbortSignal | undefined;
  const f = createFixture("shared-readiness", [], {prepareWorkspace: (signal) => { workspaceSignal = signal; return workspace.wait(signal); }});
  t.after(async () => { workspace.release(); await f.session.drain(); f.journal.close(); rmSync(f.files, {recursive: true, force: true}); });
  const method = coreMethods(coreSources({get: async () => f.session})).find((entry) => entry.contract.id === coreContracts.chat.send.id)!;
  const caller = new AbortController();
  const first = method.execute({runId: f.session.id, text: "Cancelled message"}, {...methodContext(), signal: caller.signal});
  const cancelled = assert.rejects(first, /disconnected/);
  await workspace.entered;
  const second = method.execute({runId: f.session.id, text: "Accepted message"}, methodContext());
  await new Promise((resolve) => setTimeout(resolve, 0));
  caller.abort(new Error("Request disconnected"));
  await cancelled;
  assert.equal(workspaceSignal?.aborted, false, "the other sender still owns a readiness lease");
  workspace.release();
  await second;
  assert.deepEqual([...f.journal.stateOf(f.session.id)!.inputs.values()].map((input) => input.content), ["Accepted message"]);
  assert.equal(workspaceSignal?.aborted, false, "completed readiness belongs to the accepted run");
});

test("cancelled directed messages never enqueue after their workspace check completes", async (t) => {
  const workspace = phase();
  let pause = false;
  let workspaceSignal: AbortSignal | undefined;
  const f = createFixture("directed-readiness", [], {prepareWorkspace: (signal) => {
    workspaceSignal = signal;
    return pause ? workspace.wait(signal) : Promise.resolve();
  }});
  t.after(async () => { workspace.release(); await f.session.drain(); f.journal.close(); rmSync(f.files, {recursive: true, force: true}); });
  await f.session.send("Accepted first message");
  const actorId = f.runtime.view(f.session.id).primaryActorId!;
  const method = coreMethods(coreSources({get: async () => f.session})).find((entry) => entry.contract.id === coreContracts.chat.sendToActor.id)!;
  pause = true;
  const caller = new AbortController();
  const pending = method.execute({runId: f.session.id, actorId, text: "Cancelled directed message"}, {...methodContext(), signal: caller.signal});
  const cancelled = assert.rejects(pending, /disconnected/);
  await workspace.entered;
  assert.ok(workspaceSignal);
  assert.equal(workspaceSignal.aborted, false);
  const disconnected = new Error("Request disconnected");
  caller.abort(disconnected);
  await cancelled;
  assert.equal(workspaceSignal.aborted, true);
  assert.equal(workspaceSignal.reason, disconnected);
  workspace.release();
  assert.deepEqual(f.runtime.view(f.session.id).inputs.map((input) => input.content), ["Accepted first message"]);
  pause = false;
  await method.execute({runId: f.session.id, actorId, text: "Accepted directed message"}, methodContext());
  assert.equal(f.runtime.view(f.session.id).inputs.length, 2);
});
