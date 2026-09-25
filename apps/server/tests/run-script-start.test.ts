import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
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
import type { ChatEvent } from "../src/chat-events.ts";
import { testServices } from "../../../packages/ragents/tests/support.ts";
import type { ModelChoice } from "../src/plugin-support/model-choice.ts";
import { productStartOptions } from "../src/plugin-support/product-start-options.ts";
import type { SystemPromptCatalog } from "../src/plugin-support/system-prompts.ts";
import type { Engine } from "../src/ragents/engine.ts";
import { RunChatSession, type RunChatSessionOptions, type RunScriptStart } from "../src/ragents/session.ts";
import { awaitWithSignal } from "../src/plugin-support/await-with-signal.ts";
import { runScriptFromDirectory } from "../src/plugin-support/run-scripts.ts";
import { capabilityNames } from "@ragents/engine";

const packageOf = (overrides: Partial<RunScriptPackage> = {}, entry: Partial<RunScriptStart["entry"]> = {}): RunScriptStart => ({
  handle: "example",
  coordinator: true,
  files: [{path: "package.json", content: '{"private":true}'}, {path: "src/server.ts", content: "export const program = {};"}],
  programs: [],
  ...overrides,
  entry: {id: "test.example", owner: "test", action: "script", coordinator: overrides.coordinator ?? true,
    title: "Beispiel-Run", description: "Ein Run aus dem Test", ...entry},
});

const createFixture = (runId: string, packages: readonly RunScriptStart[], controls: {
  prepare?: () => Promise<void>;
  prepareWorkspace?: () => Promise<void>;
  importPackage?: (signal?: AbortSignal) => Promise<void>;
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
  const imports: Array<{name: string; files: RunScriptPackage["files"]}> = [];
  const starts: Array<{entry: SessionStartedContext["startEntry"]; actors: number; inputs: number}> = [];
  const engine = {
    journal,
    runtime,
    live,
    scheduler: { isRunning: () => false },
    catalog: new StaticModelCatalog(catalogModels, profiles),
    startOptions,
    stopRun: async () => runtime.view(runId),
  } as unknown as Engine;
  const options: RunChatSessionOptions = {
    engine,
    id: runId,
    coordinator: {
      handle: "coordinator",
      displayName: "Koordinator",
      profile: "coordinator",
      runTitle: "Neuer Run",
      ownerHandle: "owner",
      ownerDisplayName: "Owner",
    },
    prompt: () => "Coordinator prompt",
    assertUsable: () => undefined,
    prepare: async () => controls.prepare?.(),
    prepareWorkspace: async () => controls.prepareWorkspace?.(),
    started: async (_id, entry) => {
      const state = journal.stateOf(runId);
      starts.push({entry, actors: [...state?.actors.values() ?? []].filter((actor) => actor.kind !== "human").length, inputs: state?.inputs.size ?? 0});
    },
    scriptEntryFor: (entryId) => packages.find((candidate) => candidate.entry.id === entryId),
    startEntryFor: () => undefined,
    actorPrograms: {
      async runInput() { throw new Error("This fixture verifies setup before the first turn."); },
      async workspaceDirectory() { const root = path.join(files, "actors"); mkdirSync(root, {recursive: true}); return root; },
      async importPackage(context, id, name, sourceFiles, signal) {
        await controls.importPackage?.(signal);
        signal?.throwIfAborted();
        imports.push({name, files: sourceFiles});
        if (sourceFiles.some((file) => file.content === "reject")) throw new Error("Package tests failed");
        const view = runtime.createScriptActor(context, id, {
          handle: name, displayName: "Beispiel-Run", toolNames: null,
          grants: capabilityNames.map((capability) => ({capability, scope: {kind: "run"}, delegable: true})),
        });
        const actor = view.actors.find((entry) => entry.kind === "script" && entry.handle === name)!;
        return {name, actorId: actor.id, actorHandle: actor.handle, views: 0};
      },
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
    const pending = method === "startPackageAndWait" ? f.session.startPackageAndWait(script, null) : f.session[method]("test.example", null);
    void pending?.catch(() => {});
    assert.equal(f.session.started, true);
    assert.deepEqual(replayStatus(f.session), { kind: "status", running: false, startup: { status: "preparing", message: "Run wird vorbereitet." } });
    assert.equal(f.journal.stateOf(f.session.id), null);
    await preparation.entered;
    const beforeDuplicate = statusesOf(f.events).length;
    await assert.rejects(f.session.startAndWait("test.unknown", null), /gerade gestartet/);
    await assert.rejects(f.session.startPackageAndWait(script, null), /gerade gestartet/);
    assert.equal(statusesOf(f.events).length, beforeDuplicate);
    preparation.release();
    await workspace.entered;
    assert.equal(f.runtime.view(f.session.id).actors.filter((actor) => actor.kind !== "human").length, 0);
    assert.deepEqual(replayStatus(f.session).startup, { status: "preparing", message: "Arbeitsverzeichnis wird vorbereitet." });
    const reloaded = f.createSession();
    assert.equal(reloaded.attach(), false);
    assert.deepEqual(replayStatus(reloaded), { kind: "status", running: false });
    reloaded.dispose();
    workspace.release();
    await importing.entered;
    assert.deepEqual(replayStatus(f.session).startup, { status: "preparing", message: "Oberfläche wird vorbereitet." });
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
    assert.ok(statusesOf(f.events.slice(boundStatus)).some((event) => event.startup?.message === "Oberfläche wird vorbereitet."), "Binding a new primary actor must replay startup");
    f.live.publish(f.session.id, f.runtime.view(f.session.id).primaryActorId!, { kind: "turn-finished", turnId: "setup-turn" });
    assert.deepEqual(replayStatus(f.session), { kind: "status", running: false });
    const finalCount = statusesOf(f.events).length;
    await assert.rejects(f.session.startAndWait("test.example", null), /läuft schon/);
    assert.equal(statusesOf(f.events).length, finalCount);
  });
});

test("startup failures retain the actual cause for replay and retries replace the failed state", async (t) => {
  for (const stage of ["prepare", "prepareWorkspace", "importPackage"] as const) await t.test(stage, async (t) => {
    let failed = false;
    const cause = `${stage}: unavailable fixture resource`;
    const f = createFixture(`startup-failed-${stage.toLowerCase()}`, [packageOf()], { [stage]: async () => {
      if (!failed) { failed = true; throw new Error(cause); }
    } });
    t.after(async () => { await f.session.drain(); f.journal.close(); rmSync(f.files, { recursive: true, force: true }); });
    await assert.rejects(f.session.startAndWait("test.example", null), { message: cause });
    assert.deepEqual(replayStatus(f.session), { kind: "status", running: false, startup: { status: "failed", message: cause } });
    assert.equal(f.session.started, false);
    const replacement = f.createSession();
    replacement.attach();
    assert.deepEqual(replayStatus(replacement), { kind: "status", running: false });
    replacement.dispose();
    const retry = f.session.startPackageAndWait(packageOf(), null);
    assert.equal(replayStatus(f.session).startup?.status, "preparing");
    await retry;
    assert.deepEqual(replayStatus(f.session), { kind: "status", running: false });
  });
});

test("stop clears the loader while tracking unfinished preparation and never enqueues late inputs", async (t) => {
  for (const stage of ["prepare", "prepareWorkspace", "importPackage"] as const) await t.test(stage, async (t) => {
    const blocked = phase();
    const f = createFixture(`startup-stop-${stage.toLowerCase()}`, [packageOf()], { [stage]: blocked.wait });
    t.after(async () => { blocked.release(); await f.session.drain(); f.journal.close(); rmSync(f.files, { recursive: true, force: true }); });
    const pending = f.session.startAndWait("test.example", null);
    const rejected = assert.rejects(pending, /Start.*abgebrochen/);
    await blocked.entered;
    await f.session.stop();
    assert.equal(replayStatus(f.session).startup?.status, "failed");
    if (stage !== "importPackage") {
      let settled = false;
      void f.session.settle().then(() => { settled = true; });
      await new Promise((resolve) => setImmediate(resolve));
      assert.equal(settled, false);
      assert.equal(f.session.started, true);
      await assert.rejects(f.session.startAndWait("test.example", null), /gerade gestartet/);
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

test("dispose and history reset cancel preparation without replaying a stale startup", async (t) => {
  for (const reset of [false, true]) await t.test(reset ? "reset" : "dispose", async (t) => {
    const blocked = phase();
    const f = createFixture(`startup-clear-${reset}`, [packageOf()], { prepare: blocked.wait });
    t.after(async () => { blocked.release(); await f.session.drain(); f.journal.close(); rmSync(f.files, { recursive: true, force: true }); });
    const rejected = assert.rejects(f.session.startAndWait("test.example", null), /gelöscht|zurückgesetzt/);
    await blocked.entered;
    if (reset) f.session.resetHistory();
    else f.session.dispose();
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
});

test("a local package transports all sources and node tests through the common import path", async () => {
  const fixture = createFixture("local-package", []);
  const directory = path.join(fixture.files, "own-setup");
  mkdirSync(path.join(directory, "src", "lib"), {recursive: true});
  mkdirSync(path.join(directory, "tests"));
  writeFileSync(path.join(directory, "RUN.md"), "---\ntitle: Eigenes Setup\ndescription: Aus einer lokalen Datei\n---\n");
  writeFileSync(path.join(directory, "package.json"), '{"private":true,"ragents":{"backend":"src/server.ts"}}');
  writeFileSync(path.join(directory, "src/server.ts"), 'export {value} from "./lib/value.js";');
  writeFileSync(path.join(directory, "src/lib/value.ts"), "export const value = 1;");
  writeFileSync(path.join(directory, "tests/app.test.ts"), 'import test from "node:test"; test("package", () => {});');
  try {
    assert.throws(() => runScriptFromDirectory("own-setup"), /absoluten Serverdateipfad/);
    const {script, ...entry} = runScriptFromDirectory(directory);
    assert.deepEqual(script.files.map((file) => file.path), ["package.json", "src/lib/value.ts", "src/server.ts", "tests/app.test.ts"]);
    await fixture.session.startPackageAndWait({...script, entry: {...entry, owner: "test", coordinator: script.coordinator}}, {topic: "Lokales Thema"});
    assert.deepEqual(fixture.imports, [{name: "own-setup", files: script.files}]);
    const view = fixture.runtime.view("local-package");
    assert.equal(view.title, "Eigenes Setup");
    assert.ok(view.actors.some((actor) => actor.kind === "script" && actor.handle === "own-setup"));
    assert.deepEqual(JSON.parse(view.inputs[0]!.content).input, {topic: "Lokales Thema"});
    await assert.rejects(fixture.session.startPackageAndWait(packageOf(), null), /läuft schon/);
  } finally {fixture.journal.close(); rmSync(fixture.files, {recursive: true, force: true});}
});

test("a script start tells the plugins its template after installing the script and before its first input", async () => {
  const fixture = createFixture("script-start-hook", [packageOf({ coordinator: false })]);
  try {
    await fixture.session.startAndWait("test.example", null);
    assert.deepEqual(fixture.starts, [{entry: {id: "test.example", action: "script"}, actors: 1, inputs: 0}]);
    assert.equal(fixture.runtime.view("script-start-hook").inputs.length, 1);
  } finally {fixture.journal.close(); rmSync(fixture.files, {recursive: true, force: true});}
});

test("a rejected package exposes its failure before creating the coordinator", async () => {
  const fixture = createFixture("bad-local-package", []);
  try {
    const script = packageOf({files: [{path: "tests/app.test.ts", content: "reject"}]});
    await assert.rejects(fixture.session.startPackageAndWait(script, null), /Package tests failed/);
    assert.equal(fixture.runtime.view("bad-local-package").actors.filter((actor) => actor.kind !== "human").length, 0);
  } finally {fixture.journal.close(); rmSync(fixture.files, {recursive: true, force: true});}
});

test("a run script starts over HTTP with coordinator primary and the selected start values", async () => {
  const runId = "run-script-start-coordinator";
  const fixture = createFixture(runId, [packageOf()]);
  try {
    assert.equal(await startThroughChatHttp(fixture.session, runId, {entry: "test.example", input: {topic: "Testthema"}}), 202);
    const view = fixture.runtime.view(runId);
    assert.equal(view.title, "Beispiel-Run");
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
    assert.deepEqual(content.input, {topic: "Testthema"});
    assert.deepEqual(Object.keys(content.options).sort(), ["ragents.model", "ragents.system-prompt"]);
    assert.ok(fixture.systemTexts().some((text) => text.includes('"Beispiel-Run" läuft als @example')));
  } finally {fixture.journal.close(); rmSync(fixture.files, {recursive: true, force: true});}
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
      entry: "test.example", input: null, user: { id: "owner", label: "Owner" }, ownerDisplayName: "Owner",
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
  assert.equal(await startThroughChatHttp(fixture.session, runId, { text: "Hallo", user: { id: "owner", label: "Owner" } }, access, "send"), 202);
  const view = fixture.runtime.view(runId);
  const owner = view.actors.find((actor) => actor.id === view.ownerId)!;
  assert.equal(owner.kind, "human");
  assert.equal(owner.displayName, "Operator");
  assert.equal(owner.handle, "operator-account");
  assert.equal(view.inputs.at(-1)?.content, "Hallo");
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
  assert.equal(await startThroughChatHttp(restored, runId, { text: "Weiter" }, access, "send"), 202);
  const current = fixture.runtime.view(runId);
  assert.equal(current.ownerId, original.ownerId);
  assert.deepEqual(current.actors.filter((actor) => actor.kind === "human"), [owner]);
  assert.equal(current.inputs.at(-1)?.content, "Weiter");
});

test("without a coordinator the setup actor is immediately primary and can select a successor", async () => {
  const runId = "run-script-start-headless";
  const fixture = createFixture(runId, [packageOf({coordinator: false})]);
  try {
    await fixture.session.startAndWait("test.example", null);
    let view = fixture.runtime.view(runId);
    const script = view.actors.find((actor) => actor.kind === "script");
    assert.ok(script);
    assert.equal(view.primaryActorId, script.id);
    assert.equal(fixture.session.started, true);
    assert.equal(view.actors.filter((actor) => actor.kind === "agent").length, 0);
    assert.equal(view.inputs.length, 1);
    assert.equal(view.inputs[0].actorId, script.id);
    assert.equal(JSON.parse(view.inputs[0].content).input, null);
    const before = structuredClone(fixture.runtime.events(runId));
    await assert.rejects(fixture.session.send("Starte erneut"), { code: "actor-chat-unsupported", status: 400 });
    assert.deepEqual(fixture.runtime.events(runId), before);
    view = fixture.runtime.spawnAgent({actorId: view.ownerId, commandId: "moderator"}, runId, {
      handle: "moderator", displayName: "Moderator", prompt: "Moderiere.",
      execution: {driver: {kind: "manual", config: {}}, workspacePath: null, turnTimeoutMs: null}, grants: [], toolNames: null,
    });
    const moderator = view.actors.find((actor) => actor.kind === "agent")!;
    const input = view.inputs.find((entry) => entry.actorId === script.id)!;
    const turn = claimTurn(fixture.runtime, runId, script.id, input.id, "setup-turn");
    fixture.runtime.selectPrimaryActor({actorId: script.id, commandId: "successor", turnId: turn.turnId}, runId, moderator.id);
    assert.equal(fixture.runtime.view(runId).primaryActorId, moderator.id);
    assert.ok(fixture.events.some((event) => event.kind === "reset"));
    await fixture.session.send("Moderiere die nächste Runde");
    assert.equal(fixture.runtime.view(runId).inputs.at(-1)?.actorId, moderator.id);
  } finally {fixture.journal.close(); rmSync(fixture.files, {recursive: true, force: true});}
});

test("unknown templates, rejected packages and existing runs produce named errors while failed imports can retry", async () => {
  const runId = "run-script-start-errors";
  const broken = packageOf({files: [{path: "src/server.ts", content: "reject"}]}, {id: "test.broken"});
  const fixture = createFixture(runId, [packageOf(), broken]);
  try {
    fixture.session.start("test.nowhere", null);
    await fixture.session.settle();
    assert.ok(fixture.systemTexts().some((text) => text.includes("keine Script-Vorlage dieses Profils")));
    fixture.session.start("test.broken", null);
    await fixture.session.settle();
    assert.ok(fixture.systemTexts().some((text) => text.includes("Package tests failed")));
    assert.equal(fixture.runtime.view(runId).actors.filter((actor) => actor.kind !== "human").length, 0);
    await fixture.session.startAndWait("test.example", null);
    assert.ok(fixture.runtime.view(runId).actors.some((actor) => actor.kind === "script"));
    await assert.rejects(fixture.session.startAndWait("test.example", null), /startet nur einen neuen Run/);
  } finally {fixture.journal.close(); rmSync(fixture.files, {recursive: true, force: true});}
});

test("bundled actor packages land in the private workspace before the setup is invoked", async () => {
  const runId = "run-script-start-programs";
  const fixture = createFixture(runId, [packageOf({programs: [{name: "shared-list", files: packageOf().files}]})]);
  try {
    await fixture.session.startAndWait("test.example", null);
    assert.equal(fixture.systemTexts().filter((text) => text.startsWith("Fehler")).length, 0);
    assert.ok(existsSync(path.join(fixture.files, "actors", "shared-list", "package.json")));
    assert.equal(fixture.runtime.view(runId).inputs.length, 1);
    assert.deepEqual(fixture.imports.map((entry) => entry.name), ["example"]);
  } finally {fixture.journal.close(); rmSync(fixture.files, {recursive: true, force: true});}
});
