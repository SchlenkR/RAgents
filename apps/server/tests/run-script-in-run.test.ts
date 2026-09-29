import assert from "node:assert/strict";
import { existsSync, readdirSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test, { type TestContext } from "node:test";
import { Type } from "typebox";
import type { ChatEvent } from "quassel/events";
import {
  AccessProjectionRegistry,
  createAccessContext,
  describeToolAvailability,
  DomainError,
  inheritedGrants,
  LiveBus,
  OperationContributionRegistry,
  ScriptDriver,
  StartOptionContributionRegistry,
  ToolRegistry,
  TurnScheduler,
  type ActorProgramFile,
  type RunFunction,
  type StartOptionContribution,
  type ToolScope,
} from "@ragents/engine";
import { allGrants, catalog, manualExecution, setupRun } from "../../../packages/ragents/tests/support.ts";
import { ORCHESTRATION_PLUGIN_ID } from "../../../plugins/ragents.orchestration/contract.ts";
import { placeOnSurface } from "../../../plugins/ragents.orchestration/server/surface-tool.ts";
import { accessibleChatEvent } from "../src/access-projection.ts";
import type { ChatSessionProvider } from "../src/chat-handler.ts";
import { coreContracts } from "../src/api/contracts.ts";
import { coreMethods } from "../src/api/core-methods.ts";
import { ACTOR_SCRIPT_STATE_ID, type ActorScriptState } from "../src/plugin-support/actor-programs/contract.ts";
import type { Engine } from "../src/ragents/engine.ts";
import type { RunManagement } from "../src/ragents/global-chat.ts";
import { createRunScriptToolContributor } from "../src/ragents/run-script-tools.ts";
import { RunChatSession, type RunScriptStart } from "../src/ragents/session.ts";
import { coreSources, methodContext } from "./rpc-fixture.ts";
import { invocationResult, runtimeFor } from "./actor-runtime-fixture.ts";
import { createActorProgramToolContributors } from "../../../plugins/ragents.actor-programs/server/tool-contributor.ts";

const files = (entries: Record<string, string>): ActorProgramFile[] => Object.entries(entries).map(([file, content]) => ({ path: file, content }));

const packageJson = (name: string, views = false) => JSON.stringify({ name, private: true, type: "module", ragents: {
  title: name, backend: "src/server.ts", ...(views ? { views: [{ id: "main", client: "src/client.tsx" }] } : {}),
} });

const program = (name: string, contract: string, handlers: string, extra: Record<string, string> = {}) => files({
  "package.json": packageJson(name, "src/client.tsx" in extra),
  "src/server.ts": `import { defineActor } from "@ragents/server";
import { Type } from "typebox";
export default defineActor(${contract}, { functions: {}, ${handlers} });`,
  ...extra,
});

const logState = "{ state: Type.Object({ log: Type.Optional(Type.Array(Type.Any())) }), functions: {}, input: { capabilities: [] } }";
const append = (entry: string) => `context.state.replace({ log: [...context.state.read().log ?? [], ${entry}] })`;

/** A setup that logs every delivery in its state; with onStart it logs starts separately. */
const loggingScript = (name: string, withStart: boolean) => program(name, logState,
  `onInput: (input, context) => { ${append('{ kind: "input", content: input.content }')}; },
  ${withStart ? `onStart: (start, context) => { ${append('{ kind: "start", ...start }')}; },` : ""}`);

/** Finishes every start with a summary and logs a line while doing so. */
const finishingScript = (name: string) => program(name, logState,
  `onInput: () => {},
  onStart: (start, context) => { context.log("working on " + start.count); context.finish({ checked: start.input }, { summary: "Reviewed " + start.count }); },`);

/** Starts another run script from its own start and logs the result it gets back. */
const callerScript = (name: string, entry: string) => program(name,
  '{ state: Type.Object({ log: Type.Optional(Type.Array(Type.Any())) }), functions: {}, input: { capabilities: ["run_script_start"] } }',
  `onInput: (input, context) => { ${append('{ kind: "input", content: input.content }')}; },
  onStart: async (_start, context) => { const started = await context.functions.run_script_start({ entry: "${entry}", input: "from-caller" }); ${append('{ kind: "started", ...started }')}; },
  onResult: (result, context) => { ${append('{ kind: "result", ...result }')}; },`);

/** Keeps its start open until an input names it; misuses finish on request. */
const laterScript = (name: string) => program(name,
  "{ state: Type.Object({ pending: Type.Optional(Type.Number()) }), functions: {}, input: { capabilities: [] } }",
  `onStart: (start, context) => { context.state.replace({ pending: start.count }); },
  onInput: (input, context) => {
    if (input.content === "done") context.finish("late", { start: context.state.read().pending, summary: "Late" });
    if (input.content === "twice") { context.finish(1, { start: context.state.read().pending }); context.finish(2, { start: context.state.read().pending }); }
    if (input.content === "unnamed") context.finish("no start");
  },`);

const boardScript = (name: string) => program(name, logState, "onInput: () => {},", {
  "src/client.tsx": 'document.body.dataset.ready = "true"; export {};',
});

const pingScript = (name: string, version: string) => files({
  "package.json": packageJson(name),
  "src/server.ts": `import { defineActor } from "@ragents/server";
import { Type } from "typebox";
export default defineActor({ state: Type.Object({}), input: { capabilities: [] }, functions: { run: { label: "Run", input: Type.Object({}), output: Type.String(), capabilities: ["native_ping"] } } }, {
  functions: { run: async (_input, context) => "${version}:" + await context.functions.native_ping({ value: "ping" }) },
  onInput: () => {},
});`,
});

const listProgram = (label: string) => files({
  "package.json": JSON.stringify({ name: "demo-list", private: true, type: "module", ragents: { title: "demo-list", backend: "src/server.ts" } }),
  "src/server.ts": `import { defineActor } from "@ragents/server";
import { Type } from "typebox";
export default defineActor({ state: Type.Object({}), functions: { label: { label: "Label", input: Type.Object({}), output: Type.String() } } }, { functions: { label: () => "${label}" } });`,
});

const brokenScript = (name: string) => files({
  "package.json": packageJson(name),
  "src/server.ts": 'import { defineActor } from "@ragents/server";\nimport { Type } from "typebox";\nconst wrong: number = "text";\nexport default defineActor({ state: Type.Object({}), functions: {}, input: { capabilities: [] } }, { functions: {}, onInput: () => {} });',
});

const script = (handle: string, source: ActorProgramFile[], options: { embeddable?: boolean; programs?: RunScriptStart["programs"]; shared?: string[]; fixed?: Record<string, string>; coordinator?: boolean } = {}): RunScriptStart => ({
  handle, coordinator: options.coordinator ?? false, embeddable: options.embeddable ?? true, files: source, programs: options.programs ?? [],
  ...(options.shared ? { sharedPrograms: options.shared } : {}),
  entry: { id: `demo.${handle}`, owner: "demo", action: "script", coordinator: options.coordinator ?? false, title: handle, description: `The script ${handle}`,
    ...(options.fixed ? { fixedStartOptions: options.fixed } : {}) },
});

const modeOption: StartOptionContribution = {
  id: "demo.mode",
  schema: Type.Union([Type.Literal("plain"), Type.Literal("strict")]),
  selectable: () => true,
  defaultValue: () => "plain",
  accept: (value) => value,
  describe: () => ({ kind: "choice", label: "Mode", options: [{ value: "plain", label: "Plain" }, { value: "strict", label: "Strict" }] }),
};

const pingOperation = () => {
  const operation = { id: "native_ping", label: "Ping", description: "Test operation", schema: Type.Object({ value: Type.String() }), resultSchema: Type.String(), operator: "direct" as const,
    execute: () => "pong" };
  const operations = new OperationContributionRegistry();
  operations.register("test", [operation]);
  return {
    operations,
    widenInput: () => { operation.schema = Type.Object({ value: Type.String(), verbose: Type.Optional(Type.Boolean()) }) as never; },
    widenMore: () => { operation.schema = Type.Object({ value: Type.String(), verbose: Type.Optional(Type.Boolean()), quiet: Type.Optional(Type.Boolean()) }) as never; },
  };
};

const fixture = async (t: TestContext, scripts: RunScriptStart[], extra: {
  operations?: OperationContributionRegistry;
  sources?: (entryId: string, name: string) => ActorProgramFile[] | undefined;
  shared?: ReadonlyMap<string, ActorProgramFile[]>;
} = {}) => {
  const directory = await mkdtemp(path.join(tmpdir(), "ragents-in-run-"));
  const setup = setupRun({ grants: allGrants() });
  const runId = "demo-run";
  const sources = extra.sources ?? ((entryId: string, name: string) => {
    const found = scripts.find((entry) => entry.entry.id === entryId);
    return !found ? undefined : found.handle === name ? [...found.files] : found.programs.find((bundled) => bundled.name === name)?.files.slice();
  });
  let session: RunChatSession | undefined;
  const management = {
    scripts: () => session!.runScripts(scripts.map((entry) => entry.entry), null),
    startScript: (_runId: string, entryId: string, input: unknown, startedBy: string) => session!.startAndWait(entryId, input, undefined, startedBy),
  } as unknown as RunManagement;
  const contributor = createRunScriptToolContributor(() => management);
  const placement = placeOnSurface(() => setup.runtime);
  const shared = (name: string) => { const files = extra.shared?.get(name); return files ? { pluginId: "demo.shared", files } : undefined; };
  const hostTools = (): readonly RunFunction[] => [...contributor.tools(undefined as never) as readonly RunFunction[], ...managementTools.tools(undefined as never) as readonly RunFunction[]];
  const programs = runtimeFor(setup, directory, extra.operations, undefined, sources,
    (context, id, entity) => { placement.place(context, id, { entity }); }, hostTools, shared);
  const managementTools = createActorProgramToolContributors(programs, { latest: () => "" })[0]!;
  const registry = new ToolRegistry();
  registry.register(contributor);
  registry.register(managementTools);
  const scheduler = new TurnScheduler(setup.runtime, setup.journal, {
    registry, catalog,
    workspaces: { ensure: () => directory, description: () => undefined, storeAttachment: async () => { throw new Error("This test stores no attachments"); } },
    drivers: {
      script: new ScriptDriver({ runtime: setup.runtime }),
      agent: { kind: "agent", runTurn: async () => { throw new Error("This test runs no model"); } },
    },
  });
  const startOptions = new StartOptionContributionRegistry();
  startOptions.register("demo.product", [modeOption]);
  const engine = { journal: setup.journal, runtime: setup.runtime, live: new LiveBus(), scheduler, catalog, startOptions } as unknown as Engine;
  const hooks: string[] = [];
  session = new RunChatSession({
    engine, id: runId,
    coordinator: { handle: "coordinator", displayName: "Coordinator", profile: "agent", runTitle: "Demo", ownerHandle: "owner", ownerDisplayName: "Owner" },
    prompt: () => "Unused coordinator", assertUsable: () => {}, prepare: async () => {}, prepareWorkspace: async () => {},
    started: async (_id, entry) => { hooks.push(entry?.id ?? "free"); },
    scriptEntryFor: (entryId) => scripts.find((entry) => entry.entry.id === entryId), startEntryFor: () => undefined, actorPrograms: programs,
  });
  const chat: ChatEvent[] = [];
  session.subscribe((event) => chat.push(event));
  scheduler.start();
  t.after(async () => {
    session!.dispose();
    await scheduler.stop();
    await programs.shutdown();
    await rm(directory, { recursive: true, force: true });
  });
  const actorsDirectory = path.join(directory, "actor-workspace", "actors");
  const view = () => setup.runtime.view(runId);
  const actorOf = (handle: string) => view().actors.find((actor) => actor.handle === handle);
  const logOf = (handle: string) => programs.data(runId, actorOf(handle)!.id).values.log as Record<string, unknown>[] | undefined ?? [];
  const scriptState = () => view().pluginStates.find((entry) => entry.pluginId === ACTOR_SCRIPT_STATE_ID)?.state as unknown as ActorScriptState;
  const systemTexts = () => chat.flatMap((event) => event.kind === "system" ? [event.text] : []);
  const idle = () => scheduler.waitForIdle();
  const tool = (name: string) => hostTools().find((entry) => entry.name === name)!;
  let calls = 0;
  const callTool = (name: string, actorId: string, input: unknown) => {
    const id = `call-${name}-${++calls}`;
    return tool(name).run({ caller: { runId, actorId, turnId: null }, context: (toolCallId: string) => ({ actorId, commandId: toolCallId }), signal: undefined } as unknown as ToolScope, id, input as never);
  };
  return { setup, programs, session, runId, hooks, chat, actorsDirectory, view, actorOf, logOf, scriptState, systemTexts, idle, tool, callTool };
};

type Fixture = Awaited<ReturnType<typeof fixture>>;

/** What a failed start must not change: actors, package folders, recorded packages, active programs and inputs. */
const snapshot = (f: Fixture) => ({
  actors: f.view().actors.map((actor) => `${actor.handle}:${actor.kind}:${actor.kind === "human" ? "" : actor.lifecycle.kind === "stopped" ? "stopped" : "active"}`),
  folders: readdirSync(f.actorsDirectory).sort(),
  packages: Object.keys(f.scriptState()?.packages ?? {}).sort(),
  programs: f.programs.programs(f.runId).map((entry) => entry.name).sort(),
  inputs: f.view().inputs.length,
});

test("an embeddable script joins a running run, keeps the primary actor and repeated starts reuse its actor", async (t) => {
  const setupScript = script("demo-setup", loggingScript("demo-setup", true), { embeddable: false });
  const review = script("demo-review", loggingScript("demo-review", true));
  const legacy = script("demo-legacy", loggingScript("demo-legacy", false));
  const f = await fixture(t, [setupScript, review, legacy]);
  const created = await f.session.startAndWait("demo.demo-setup", { topic: "Launch" });
  assert.deepEqual(created, { actorId: f.actorOf("demo-setup")!.id, handle: "demo-setup", count: 1 });
  const primary = f.view().primaryActorId;
  assert.equal(primary, created.actorId);
  const owner = f.view().ownerId;

  await assert.rejects(f.session.startAndWait("demo.demo-setup", null), (error: unknown) =>
    error instanceof DomainError && error.code === "run-started" && /embeddable: true/.test(error.message));

  const first = await f.session.startAndWait("demo.demo-review", { topic: "first" });
  const second = await f.session.startAndWait("demo.demo-review", { topic: "second" });
  assert.equal(second.actorId, first.actorId);
  assert.deepEqual([first.count, second.count], [1, 2]);
  await f.session.startAndWait("demo.demo-legacy", { topic: "old" });
  await f.session.startAndWait("demo.demo-legacy", null);
  await f.idle();

  assert.equal(f.view().primaryActorId, primary, "an embedded start never changes the primary actor");
  assert.deepEqual(f.hooks, ["demo.demo-setup"], "only the new run tells the plugins about its start");
  assert.deepEqual(f.logOf("demo-setup"), [{ kind: "start", input: { topic: "Launch" }, options: { "demo.mode": "plain" }, embedded: false, startedBy: owner, count: 1 }]);
  assert.deepEqual(f.logOf("demo-review"), [
    { kind: "start", input: { topic: "first" }, options: { "demo.mode": "plain" }, embedded: true, startedBy: owner, count: 1 },
    { kind: "start", input: { topic: "second" }, options: { "demo.mode": "plain" }, embedded: true, startedBy: owner, count: 2 },
  ]);
  assert.deepEqual(f.logOf("demo-legacy"), [
    { kind: "input", content: JSON.stringify({ input: { topic: "old" }, options: { "demo.mode": "plain" } }) },
    { kind: "input", content: JSON.stringify({ input: null, options: { "demo.mode": "plain" } }) },
  ], "without onStart the start arrives in onInput exactly as before");

  f.setup.runtime.enqueueInput({ actorId: owner, commandId: "plain-input" }, f.runId, { actorId: first.actorId, content: JSON.stringify({ input: "forged", options: {} }) });
  await f.idle();
  assert.deepEqual(f.logOf("demo-review").at(-1), { kind: "input", content: JSON.stringify({ input: "forged", options: {} }) }, "an input with the text of a start is no start");

  f.setup.runtime.stopActor({ actorId: owner, commandId: "stop-review" }, f.runId, first.actorId, "Paused");
  const third = await f.session.startAndWait("demo.demo-review", { topic: "third" });
  await f.idle();
  assert.equal(third.actorId, first.actorId);
  assert.equal(third.count, 3);
  const restarted = f.actorOf("demo-review");
  assert.ok(restarted && restarted.kind !== "human" && restarted.lifecycle.kind !== "stopped", "a stopped script actor is restarted");
  assert.deepEqual(f.logOf("demo-review").at(-1), { kind: "start", input: { topic: "third" }, options: { "demo.mode": "plain" }, embedded: true, startedBy: owner, count: 3 });
  assert.equal(f.view().actors.filter((actor) => actor.handle === "demo-review").length, 1);
  assert.equal(f.view().primaryActorId, primary);

  await f.programs.remove({ actorId: owner, commandId: "remove-review" }, f.runId, "demo-review");
  const fourth = await f.session.startAndWait("demo.demo-review", { topic: "fourth" });
  await f.idle();
  assert.deepEqual([fourth.actorId, fourth.count], [first.actorId, 4], "a removed setup package is activated again from its workspace files");
  assert.deepEqual(f.logOf("demo-review").at(-1), { kind: "start", input: { topic: "fourth" }, options: { "demo.mode": "plain" }, embedded: true, startedBy: owner, count: 4 });
  assert.equal(f.view().primaryActorId, primary);
  assert.deepEqual(f.scriptState().deliveries, [], "consumed starts leave no delivery behind");
});

test("bundled programs are copied only when missing, kept when identical and a different package of the same name is refused", async (t) => {
  const setupScript = script("demo-setup", loggingScript("demo-setup", false), { embeddable: false });
  const review = script("demo-review", loggingScript("demo-review", false), { programs: [{ name: "demo-list", files: listProgram("one") }] });
  const same = script("demo-same", loggingScript("demo-same", false), { programs: [{ name: "demo-list", files: listProgram("one") }] });
  const other = script("demo-other", loggingScript("demo-other", false), { programs: [{ name: "demo-list", files: listProgram("two") }, { name: "demo-extra", files: listProgram("extra") }] });
  const f = await fixture(t, [setupScript, review, same, other]);
  await f.session.startAndWait("demo.demo-setup", null);
  await f.session.startAndWait("demo.demo-review", null);
  const list = path.join(f.actorsDirectory, "demo-list", "src", "server.ts");
  assert.match(await readFile(list, "utf8"), /"one"/);
  await f.programs.activate({ actorId: f.view().ownerId, commandId: "activate-list" }, f.runId, "demo-list");
  await f.session.startAndWait("demo.demo-review", null);
  await f.session.startAndWait("demo.demo-same", null);
  assert.ok(f.actorOf("demo-same"), "an identical bundled program counts as present, also after its activation generated files");

  await f.idle();
  const before = { events: f.setup.runtime.events(f.runId).length, folders: readdirSync(f.actorsDirectory).sort() };
  await assert.rejects(f.session.startAndWait("demo.demo-other", null),
    /run script demo\.demo-other bundles the program demo-list, but this run already has a different package demo-list from the run script demo\.demo-review/);
  assert.equal(f.setup.runtime.events(f.runId).length, before.events, "the conflict is found before anything is recorded");
  assert.deepEqual(readdirSync(f.actorsDirectory).sort(), before.folders, "nothing is copied before the conflict is known");
  assert.equal(f.actorOf("demo-other"), undefined);
  assert.match(await readFile(list, "utf8"), /"one"/);
});

test("a handle held by a foreign actor, a failed package and incompatible start options leave the run unchanged", async (t) => {
  const setupScript = script("demo-setup", loggingScript("demo-setup", false), { embeddable: false });
  const taken = script("demo-taken", loggingScript("demo-taken", false), { programs: [{ name: "demo-list", files: listProgram("one") }] });
  const broken = script("demo-broken", brokenScript("demo-broken"), { programs: [{ name: "demo-extra", files: listProgram("extra") }] });
  const strict = script("demo-strict", loggingScript("demo-strict", false), { fixed: { "demo.mode": "strict" } });
  const plain = script("demo-plain", loggingScript("demo-plain", false), { fixed: { "demo.mode": "plain" } });
  const f = await fixture(t, [setupScript, taken, broken, strict, plain]);
  await f.session.startAndWait("demo.demo-setup", null);
  const owner = f.view().ownerId;
  f.setup.runtime.createScriptActor({ actorId: owner, commandId: "foreign" }, f.runId, { handle: "demo-taken", displayName: "Foreign helper", grants: [], toolNames: null });
  await f.idle();
  const before = snapshot(f);

  await assert.rejects(f.session.startAndWait("demo.demo-taken", null), /Handle @demo-taken already belongs to Foreign helper in this run, not to the run script demo\.demo-taken/);
  assert.deepEqual(snapshot(f), before);
  await assert.rejects(f.session.startAndWait("demo.demo-broken", null), /Typecheck of demo-broken/);
  assert.deepEqual(snapshot(f), before, "the copied bundled program, the package folder and the ownership record are removed again");
  assert.equal(f.actorOf("demo-broken"), undefined);
  await assert.rejects(f.session.startAndWait("demo.demo-strict", null), (error: unknown) =>
    error instanceof DomainError && error.code === "start-option-fixed" && error.message.includes("demo.mode") && error.message.includes('"strict"') && error.message.includes('"plain"'));
  assert.deepEqual(snapshot(f), before);
  const listed = f.session.runScripts([strict.entry, plain.entry, setupScript.entry], null);
  assert.deepEqual(listed.map(({ id, available }) => [id, available]), [["demo.demo-strict", false], ["demo.demo-plain", true], ["demo.demo-setup", false]]);
  assert.match(listed[0]!.reason ?? "", /fixes the start option demo\.mode to "strict", but this run already has a different value there: "plain"/);
  assert.equal(listed[1]!.reason, undefined);
  assert.equal(listed[2]!.reason, "It starts only a new run; its RUN.md does not set embeddable: true.");

  const started = await f.session.startAndWait("demo.demo-plain", null);
  assert.equal(started.handle, "demo-plain");
});

test("a failed start whose ownership record cannot be removed again does not block the next start", async (t) => {
  const setupScript = script("demo-setup", loggingScript("demo-setup", false), { embeddable: false });
  const fixable = script("demo-fixable", brokenScript("demo-fixable"));
  const scripts = [setupScript, fixable];
  const f = await fixture(t, scripts);
  await f.session.startAndWait("demo.demo-setup", null);
  await f.idle();
  const replace = f.setup.runtime.replacePluginState.bind(f.setup.runtime);
  let scriptWrites = 0;
  f.setup.runtime.replacePluginState = ((context, runId, input) => {
    if (input.pluginId === ACTOR_SCRIPT_STATE_ID && ++scriptWrites === 2) throw new Error("journal write refused");
    return replace(context, runId, input);
  }) as typeof f.setup.runtime.replacePluginState;
  await assert.rejects(f.session.startAndWait("demo.demo-fixable", null), /Typecheck of demo-fixable.*ownership record could not be removed again \(journal write refused\)/s);
  f.setup.runtime.replacePluginState = replace;
  assert.ok(f.scriptState().packages["demo-fixable"], "the stale claim stayed");
  assert.equal(f.actorOf("demo-fixable"), undefined);
  assert.equal(existsSync(path.join(f.actorsDirectory, "demo-fixable")), false);
  scripts[1] = script("demo-fixable", loggingScript("demo-fixable", true));
  const started = await f.session.startAndWait("demo.demo-fixable", null);
  await f.idle();
  assert.deepEqual([started.handle, started.count], ["demo-fixable", 1]);
  assert.equal(f.logOf("demo-fixable").length, 1);
});

test("a start input is never queued unrecognizable: a refused record queues nothing, a refused input leaves no record", async (t) => {
  const setupScript = script("demo-setup", loggingScript("demo-setup", false), { embeddable: false });
  const review = script("demo-review", loggingScript("demo-review", true));
  const f = await fixture(t, [setupScript, review]);
  await f.session.startAndWait("demo.demo-setup", null);
  await f.session.startAndWait("demo.demo-review", "first");
  await f.idle();
  const reviewId = f.actorOf("demo-review")!.id;
  const inputsOf = () => f.view().inputs.filter((input) => input.actorId === reviewId).length;

  const replace = f.setup.runtime.replacePluginState.bind(f.setup.runtime);
  f.setup.runtime.replacePluginState = ((context, runId, input) => {
    if (input.pluginId === ACTOR_SCRIPT_STATE_ID) throw new Error("journal write refused");
    return replace(context, runId, input);
  }) as typeof f.setup.runtime.replacePluginState;
  await assert.rejects(f.session.startAndWait("demo.demo-review", "refused record"), /journal write refused/);
  f.setup.runtime.replacePluginState = replace;
  assert.equal(inputsOf(), 1, "without its record the start input is not queued");

  const enqueue = f.setup.runtime.enqueueInput.bind(f.setup.runtime);
  f.setup.runtime.enqueueInput = ((context, runId, input) => {
    if (context.commandId.startsWith("run-script-input:")) throw new Error("input refused");
    return enqueue(context, runId, input);
  }) as typeof f.setup.runtime.enqueueInput;
  await assert.rejects(f.session.startAndWait("demo.demo-review", "refused input"), /input refused/);
  f.setup.runtime.enqueueInput = enqueue;
  assert.deepEqual(f.scriptState().deliveries, []);
  assert.equal(f.scriptState().packages["demo-review"]!.count, 1);

  const state = f.scriptState();
  f.setup.runtime.replacePluginState({ actorId: f.view().ownerId, commandId: "dangling" }, f.runId, { pluginId: ACTOR_SCRIPT_STATE_ID, scope: { kind: "run" },
    state: { ...state, deliveries: [{ commandId: "never-queued", actorId: reviewId, kind: "start", name: "demo-review", count: 9, embedded: true, startedBy: "nobody" }] } as never });
  const next = await f.session.startAndWait("demo.demo-review", "second");
  await f.idle();
  assert.equal(next.count, 2);
  assert.deepEqual(f.scriptState().deliveries, [], "a record whose input never came is dropped");
  assert.deepEqual(f.logOf("demo-review").map((entry) => [entry.input, entry.count]), [["first", 1], ["second", 2]]);
});

test("many repeated starts keep the run script state bounded", async (t) => {
  const setupScript = script("demo-setup", loggingScript("demo-setup", false), { embeddable: false });
  const idleScript = script("demo-idle", program("demo-idle", "{ state: Type.Object({ starts: Type.Optional(Type.Number()) }), functions: {}, input: { capabilities: [] } }",
    "onInput: () => {}, onStart: (_start, context) => { context.state.replace({ starts: (context.state.read().starts ?? 0) + 1 }); },"));
  const review = script("demo-review", finishingScript("demo-review"));
  const f = await fixture(t, [setupScript, idleScript, review]);
  await f.session.startAndWait("demo.demo-setup", null);
  for (let round = 0; round < 55; round += 1) await f.session.startAndWait("demo.demo-idle", null);
  for (let round = 0; round < 5; round += 1) await f.session.startAndWait("demo.demo-review", round);
  await f.idle();
  const state = f.scriptState();
  assert.deepEqual(state.deliveries, []);
  assert.equal(state.packages["demo-idle"]!.count, 55);
  assert.equal(state.packages["demo-idle"]!.open.length, 50, "starts that never finish are kept only up to the limit");
  assert.equal(state.packages["demo-idle"]!.open[0]!.count, 6);
  assert.deepEqual([state.packages["demo-review"]!.count, state.packages["demo-review"]!.open.length], [5, 0]);
  assert.ok(JSON.stringify(state).length < 8_000, `the state stays small: ${JSON.stringify(state).length}`);
  assert.equal(f.programs.data(f.runId, f.actorOf("demo-idle")!.id).values.starts, 55);
});

test("a finished start reaches its starter once: the owner in the chat, a TypeScript actor through onResult, an LLM as a short message", async (t) => {
  const setupScript = script("demo-setup", loggingScript("demo-setup", false), { embeddable: false });
  const review = script("demo-review", finishingScript("demo-review"));
  const caller = script("demo-caller", callerScript("demo-caller", "demo.demo-review"));
  const later = script("demo-later", laterScript("demo-later"));
  const f = await fixture(t, [setupScript, review, caller, later]);
  await f.session.startAndWait("demo.demo-setup", null);
  const owner = f.view().ownerId;

  await f.session.startAndWait("demo.demo-review", "by owner");
  await f.idle();
  assert.ok(f.systemTexts().includes("@demo-review: working on 1"), f.systemTexts().join(" | "));
  assert.ok(f.systemTexts().includes("@demo-review: Reviewed 1"), "the owner reads the summary in the chat");

  await f.session.startAndWait("demo.demo-caller", null);
  await f.idle();
  const callerId = f.actorOf("demo-caller")!.id;
  assert.deepEqual(f.logOf("demo-caller"), [
    { kind: "started", handle: "demo-review", count: 2 },
    { kind: "result", handle: "demo-review", count: 2, result: { checked: "from-caller" }, summary: "Reviewed 2" },
  ]);
  assert.equal(f.systemTexts().includes("@demo-review: Reviewed 2"), false, "a result for another actor is not the owner's chat entry");

  const view = f.setup.runtime.spawnAgent({ actorId: owner, commandId: "planner" }, f.runId, {
    handle: "planner", displayName: "Planner", prompt: "Plan.", execution: manualExecution(), toolNames: null,
    grants: [{ capability: "script.start", scope: { kind: "run" }, delegable: false }],
  });
  const planner = view.actors.find((actor) => actor.handle === "planner")!;
  assert.deepEqual(await f.callTool("run_script_start", planner.id, { entry: "demo.demo-review", input: { topic: "agent" } }), { handle: "demo-review", count: 3 });
  await f.idle();
  const message = f.view().inputs.find((input) => input.actorId === planner.id)!;
  assert.equal(message.presentation, "background");
  assert.equal(message.content, 'Run script @demo-review finished start 3: Reviewed 3\nResult: {"checked":{"topic":"agent"}}');
  assert.deepEqual(f.scriptState().packages["demo-review"]!.open, []);
  assert.equal(f.view().inputs.filter((input) => input.actorId === callerId).length, 2, "every result is delivered once");

  await f.session.startAndWait("demo.demo-later", null);
  await f.idle();
  const laterId = f.actorOf("demo-later")!.id;
  let sent = 0;
  const turnFor = (content: string) => {
    f.setup.runtime.enqueueInput({ actorId: owner, commandId: `later-${++sent}` }, f.runId, { actorId: laterId, content });
    return f.idle().then(() => f.view().turns.filter((turn) => turn.actorId === laterId).at(-1)!);
  };
  const unnamed = await turnFor("unnamed");
  assert.equal(unnamed.status, "failed");
  assert.match(unnamed.reason ?? "", /finish needs options\.start/);
  const twice = await turnFor("twice");
  assert.equal(twice.status, "failed");
  assert.match(twice.reason ?? "", /start 1 of @demo-later is not open/);
  assert.equal(f.scriptState().packages["demo-later"]!.open.length, 1, "a refused finish ends nothing");
  assert.equal((await turnFor("done")).status, "completed");
  assert.ok(f.systemTexts().includes("@demo-later: Late"));
  const again = await turnFor("done");
  assert.equal(again.status, "failed", "a second finish of the same start is an error");
  assert.match(again.reason ?? "", /not open/);
});

test("the coordinator holds script.start without passing it on; the run functions list and start scripts for their caller", async (t) => {
  const setupScript = script("demo-setup", loggingScript("demo-setup", false), { embeddable: false, coordinator: true });
  const review = script("demo-review", loggingScript("demo-review", true));
  const f = await fixture(t, [setupScript, review]);
  await f.session.startAndWait("demo.demo-setup", null);
  await f.idle();
  const view = f.view();
  const coordinator = view.actors.find((actor) => actor.handle === "coordinator")!;
  const setupActor = f.actorOf("demo-setup")!;
  const start = f.tool("run_script_start");
  assert.deepEqual(describeToolAvailability(start.available).requiredCapabilities, ["script.start"]);
  assert.equal(start.available(coordinator, view), true);
  assert.deepEqual(coordinator.grants.filter((grant) => grant.capability === "script.start").map((grant) => grant.delegable), [false]);
  assert.equal(inheritedGrants(coordinator).some((grant) => grant.capability === "script.start"), false, "an agent the coordinator spawns does not get it");
  assert.equal(start.available(setupActor, view), true, "a TypeScript actor the owner installs holds it");
  assert.equal(inheritedGrants(setupActor).some((grant) => grant.capability === "script.start"), false);
  assert.equal(start.available(f.setup.agent, f.setup.view), false);

  assert.deepEqual(await f.callTool("run_script_list", coordinator.id, {}), [
    { entry: "demo.demo-setup", title: "demo-setup", description: "The script demo-setup", available: false, reason: "It starts only a new run; its RUN.md does not set embeddable: true." },
    { entry: "demo.demo-review", title: "demo-review", description: "The script demo-review", available: true },
  ]);
  assert.deepEqual(await f.callTool("run_script_start", coordinator.id, { entry: "demo.demo-review" }), { handle: "demo-review", count: 1 });
  await f.idle();
  assert.equal(f.logOf("demo-review")[0]!.startedBy, coordinator.id);
  assert.equal(f.view().primaryActorId, coordinator.id);
});

test("an embedded start places the script's main view next to the layout once instead of replacing it", async (t) => {
  const setupScript = script("demo-setup", loggingScript("demo-setup", false), { embeddable: false });
  const board = script("demo-board", boardScript("demo-board"));
  const f = await fixture(t, [setupScript, board]);
  await f.session.startAndWait("demo.demo-setup", null);
  f.setup.runtime.replacePluginState({ actorId: f.view().ownerId, commandId: "layout" }, f.runId, { pluginId: ORCHESTRATION_PLUGIN_ID, scope: { kind: "run" }, state: { root: { entity: "@demo-setup" } } });
  const layout = () => f.view().pluginStates.find((entry) => entry.pluginId === ORCHESTRATION_PLUGIN_ID)?.state;
  await f.session.startAndWait("demo.demo-board", null);
  const placed = { root: { direction: "horizontal", weights: [1, 1], children: [{ entity: "@demo-setup" }, { entity: "app:demo-board--main" }] } };
  assert.deepEqual(layout(), placed);
  await f.session.startAndWait("demo.demo-board", null);
  assert.deepEqual(layout(), placed, "a view the layout shows already stays where it is");
});

test("the chat shows runtime output of run script actors, not of other TypeScript actors, and masks it without runs.inspect", async (t) => {
  const setupScript = script("demo-setup", loggingScript("demo-setup", false), { embeddable: false });
  const review = script("demo-review", finishingScript("demo-review"));
  const f = await fixture(t, [setupScript, review]);
  await f.session.startAndWait("demo.demo-setup", null);
  await f.programs.importPackage({ actorId: f.view().ownerId, commandId: "own-program" }, f.runId, "demo-own", finishingScript("demo-own"));
  const own = f.actorOf("demo-own")!;
  f.setup.runtime.enqueueInput({ actorId: f.view().ownerId, commandId: "own-input" }, f.runId, { actorId: own.id, content: "hello" });
  await f.session.startAndWait("demo.demo-review", null);
  await f.idle();
  assert.equal(f.systemTexts().filter((text) => text.startsWith("@demo-review: ")).length, 2);
  assert.equal(f.systemTexts().some((text) => text.includes("demo-own")), false);
  const entry = f.chat.find((event) => event.kind === "system" && event.text.startsWith("@demo-review: "))!;
  const restricted = createAccessContext({ enabled: true, user: { id: "alice", label: "Alice", rights: ["runs.read"] } });
  assert.deepEqual(accessibleChatEvent(entry, restricted, new AccessProjectionRegistry()), { ...entry, text: "Processing notice. If you have questions, contact the responsible agent." });
});

test("every package reactivates from the sources of the script that installed it", async (t) => {
  const ping = pingOperation();
  const current = new Map([["demo-alpha", "alpha-v1"], ["demo-beta", "beta-v1"]]);
  const alpha = script("demo-alpha", pingScript("demo-alpha", "alpha-v1"), { embeddable: false });
  const beta = script("demo-beta", pingScript("demo-beta", "beta-v1"));
  const f = await fixture(t, [alpha, beta], {
    operations: ping.operations,
    sources: (entryId, name) => entryId === `demo.${name}` && current.has(name) ? pingScript(name, current.get(name)!) : undefined,
  });
  await f.session.startAndWait("demo.demo-alpha", null);
  await f.session.startAndWait("demo.demo-beta", null);
  await f.idle();
  const call = async (handle: string, requestId: string) => {
    const found = f.programs.programs(f.runId).find((entry) => entry.name === handle)!;
    const invocation = f.programs.startFunctionInvocation(f.runId, handle, found.revision, "run", requestId, {});
    const settled = await invocationResult(f.programs, f.runId, handle, invocation.id);
    return settled.status === "succeeded" ? settled.result : `${settled.status}: ${settled.error}`;
  };
  assert.equal(await call("demo-alpha", "alpha-before"), "alpha-v1:pong");
  current.set("demo-alpha", "alpha-v2");
  current.set("demo-beta", "beta-v2");
  ping.widenInput();
  assert.equal(await call("demo-alpha", "alpha-after"), "alpha-v2:pong");
  assert.equal(await call("demo-beta", "beta-after"), "beta-v2:pong");
});

test("an older script state counts as no script origin and never blocks the run", async (t) => {
  const f = await fixture(t, [script("demo-setup", loggingScript("demo-setup", true), { embeddable: false })]);
  await f.session.startAndWait("demo.demo-setup", null);
  await f.idle();
  const owner = f.view().ownerId;
  f.setup.runtime.replacePluginState({ actorId: owner, commandId: "old-shape" }, f.runId, { pluginId: ACTOR_SCRIPT_STATE_ID, scope: { kind: "run" }, state: { version: 1, entryId: "demo.demo-setup" } });
  f.setup.runtime.enqueueInput({ actorId: owner, commandId: "after-old-shape" }, f.runId, { actorId: f.actorOf("demo-setup")!.id, content: "still works" });
  await f.idle();
  assert.deepEqual(f.logOf("demo-setup").at(-1), { kind: "input", content: "still works" });
  assert.equal(f.view().turns.every((turn) => turn.status === "completed"), true);
});

test("ragents.runs.scripts and ragents.runs.startScript answer the caller; concurrent starts queue and install once", async (t) => {
  const setupScript = script("demo-setup", loggingScript("demo-setup", false), { embeddable: false });
  const review = script("demo-review", loggingScript("demo-review", true));
  const f = await fixture(t, [setupScript, review]);
  const provider: ChatSessionProvider = { get: async () => f.session, hasRun: () => true, list: async () => [], delete: async () => undefined };
  const plugins = { startEntries: { describe: () => [setupScript.entry, review.entry] } };
  const methods = coreMethods(coreSources(provider, { plugins: plugins as never }));
  const method = (id: string) => methods.find((entry) => entry.contract.id === id)!;
  const created = await method(coreContracts.runs.startScript.id).execute({ runId: f.runId, entry: "demo.demo-setup", input: null } as never, methodContext());
  assert.deepEqual(created, { actorId: f.actorOf("demo-setup")!.id, handle: "demo-setup", count: 1 });
  await assert.rejects(async () => method(coreContracts.runs.startScript.id).execute({ runId: f.runId, entry: "demo.demo-setup" } as never, methodContext()), { code: "run-started", status: 409 });
  assert.deepEqual((await method(coreContracts.runs.scripts.id).execute({ runId: f.runId } as never, methodContext()) as { id: string; available: boolean }[])
    .map(({ id, available }) => [id, available]), [["demo.demo-setup", false], ["demo.demo-review", true]]);
  const reader = createAccessContext({ enabled: true, user: { id: "alice", label: "Alice", rights: ["runs.read", "runs.write"], startEntries: ["demo.demo-review"] } });
  assert.deepEqual((await method(coreContracts.runs.scripts.id).execute({ runId: f.runId } as never, methodContext(reader)) as { id: string }[]).map(({ id }) => id),
    ["demo.demo-review"], "only the scripts the caller may start");

  const racing = await Promise.all([f.session.startAndWait("demo.demo-review", "a"), f.session.startAndWait("demo.demo-review", "b"), f.session.startAndWait("demo.demo-review", "c")]);
  assert.deepEqual(racing.map((started) => started.count), [1, 2, 3], "concurrent starts wait for each other instead of failing");
  assert.equal(f.view().actors.filter((actor) => actor.handle === "demo-review").length, 1);
  const again = await method(coreContracts.runs.startScript.id).execute({ runId: f.runId, entry: "demo.demo-review", input: { topic: "rpc" } } as never, methodContext());
  assert.deepEqual(again, { actorId: f.actorOf("demo-review")!.id, handle: "demo-review", count: 4 });
  assert.equal(existsSync(path.join(f.actorsDirectory, "demo-review")), true);
});

/** Ensures a shared package on every start and logs what ensure reported. */
const ensuringScript = (name: string, target: string) => program(name,
  '{ state: Type.Object({ log: Type.Optional(Type.Array(Type.Any())) }), functions: {}, input: { capabilities: ["actor_program_ensure"] } }',
  `onInput: () => {},
  onStart: async (_start, context) => { const ensured = await context.functions.actor_program_ensure({ name: "${target}" }); ${append("ensured.status")}; },`);

const notesPackage = (version: string) => files({
  "package.json": JSON.stringify({ name: "demo-notes", private: true, type: "module", ragents: { title: "Notes", backend: "src/server.ts" } }),
  "src/server.ts": `import { defineActor } from "@ragents/server";
import { Type } from "typebox";
export default defineActor({ state: Type.Object({}), input: { capabilities: [] }, functions: { version: { label: "Version", input: Type.Object({}), output: Type.String(), capabilities: ["native_ping"] } } }, {
  functions: { version: async (_input, context) => "${version}:" + await context.functions.native_ping({ value: "ping" }) },
  onInput: () => {},
});`,
});

test("a stale ownership record of another template counts as not installed; only a real actor or folder conflicts", async (t) => {
  const setupScript = script("demo-setup", loggingScript("demo-setup", false), { embeddable: false });
  const review = script("demo-review", loggingScript("demo-review", true));
  const f = await fixture(t, [setupScript, review]);
  await f.session.startAndWait("demo.demo-setup", null);
  await f.idle();
  const owner = f.view().ownerId;
  const withRecord = (entryId: string) => {
    const state = f.scriptState();
    f.setup.runtime.replacePluginState({ actorId: owner, commandId: `stale-${entryId}-${Math.random()}` }, f.runId, { pluginId: ACTOR_SCRIPT_STATE_ID, scope: { kind: "run" },
      state: { ...state, packages: { ...state.packages, "demo-review": { origin: { kind: "script", entryId }, identity: "left over", count: 7, open: [] } } } as never });
  };
  withRecord("other.demo-review");
  const started = await f.session.startAndWait("demo.demo-review", "first");
  assert.deepEqual([started.handle, started.count], ["demo-review", 1]);
  assert.deepEqual(f.scriptState().packages["demo-review"]!.origin, { kind: "script", entryId: "demo.demo-review" });
  await f.idle();
  withRecord("other.demo-review");
  await assert.rejects(f.session.startAndWait("demo.demo-review", "second"), /The package demo-review in this run comes from the run script other\.demo-review, not from the run script demo\.demo-review/);
});

test("a shared package used by two scripts is installed once and ensured by both; programOf names every origin", async (t) => {
  const ping = pingOperation();
  const setupScript = script("demo-setup", loggingScript("demo-setup", false), { embeddable: false });
  const alpha = script("demo-alpha", ensuringScript("demo-alpha", "demo-notes"), { shared: ["demo-notes"] });
  const beta = script("demo-beta", ensuringScript("demo-beta", "demo-notes"), { shared: ["demo-notes"] });
  const f = await fixture(t, [setupScript, alpha, beta], { operations: ping.operations, shared: new Map([["demo-notes", notesPackage("v1")]]) });
  await f.session.startAndWait("demo.demo-setup", null);
  await f.session.startAndWait("demo.demo-alpha", null);
  await f.idle();
  assert.equal(existsSync(path.join(f.actorsDirectory, "demo-notes")), true, "the script installs the shared package before its setup");
  await f.session.startAndWait("demo.demo-beta", null);
  await f.session.startAndWait("demo.demo-alpha", null);
  await f.idle();
  assert.deepEqual(f.logOf("demo-alpha"), ["activated", "active"]);
  assert.deepEqual(f.logOf("demo-beta"), ["active"]);
  assert.equal(f.view().actors.filter((actor) => actor.handle === "demo-notes").length, 1);
  assert.deepEqual(f.scriptState().packages["demo-notes"]!.origin, { kind: "shared", pluginId: "demo.shared" });

  const notes = f.actorOf("demo-notes")!;
  assert.deepEqual(f.programs.programOf(f.runId, notes.id)?.origin, { kind: "shared", pluginId: "demo.shared" });
  assert.deepEqual(f.programs.programOf(f.runId, f.actorOf("demo-alpha")!.id)?.origin, { kind: "script", entryId: "demo.demo-alpha" });
  const owner = f.view().ownerId;
  await f.programs.importPackage({ actorId: owner, commandId: "own" }, f.runId, "demo-own", loggingScript("demo-own", false));
  assert.deepEqual(f.programs.programOf(f.runId, f.actorOf("demo-own")!.id)?.origin, { kind: "run", installedBy: owner });
  assert.equal(f.programs.programOf(f.runId, owner), undefined);

  const server = path.join(f.actorsDirectory, "demo-notes", "src", "server.ts");
  await import("node:fs/promises").then(({ writeFile }) => readFile(server, "utf8").then((text) => writeFile(server, text.replace('"v1:"', '"changed:"'))));
  await f.programs.activate({ actorId: owner, commandId: "changed" }, f.runId, "demo-notes");
  assert.deepEqual(f.programs.programOf(f.runId, notes.id)?.origin, { kind: "run", installedBy: f.actorOf("demo-alpha")!.id },
    "a package changed in the run is no longer the shared one; it names who activated it first");
});

test("ensure activates, restarts, installs and returns an active package unchanged; concurrent calls install once", async (t) => {
  const ping = pingOperation();
  const setupScript = script("demo-setup", loggingScript("demo-setup", false), { embeddable: false });
  const f = await fixture(t, [setupScript], { operations: ping.operations, shared: new Map([["demo-notes", notesPackage("v1")]]) });
  await f.session.startAndWait("demo.demo-setup", null);
  await f.idle();
  const owner = f.view().ownerId;
  const ensure = (label: string, name = "demo-notes") => f.callTool("actor_program_ensure", owner, { name }).then((result) => (result as { status: string }).status, (error: Error) => `${label}: ${error.message}`);
  const concurrent = await Promise.all([ensure("first"), ensure("second")]);
  assert.deepEqual(concurrent, ["installed", "active"]);
  const notes = f.actorOf("demo-notes")!;
  const revision = f.programs.programs(f.runId).find((entry) => entry.name === "demo-notes")!.revision;
  assert.equal(await ensure("again"), "active");
  assert.equal(f.programs.programs(f.runId).find((entry) => entry.name === "demo-notes")!.revision, revision, "an active package is not rebuilt");
  f.setup.runtime.stopActor({ actorId: owner, commandId: "stop-notes" }, f.runId, notes.id, "Paused");
  assert.equal(await ensure("stopped"), "restarted");
  assert.equal(f.actorOf("demo-notes")!.id, notes.id);
  await f.programs.remove({ actorId: owner, commandId: "remove-notes" }, f.runId, "demo-notes");
  assert.equal(await ensure("removed"), "activated");
  assert.equal(await ensure("unknown", "demo-missing"), "unknown: The package demo-missing is neither in this run nor a shared actor package of this profile.");
  assert.deepEqual(f.view().actors.filter((actor) => actor.handle === "demo-notes").map((actor) => actor.id), [notes.id]);
});

test("a contract drift reloads a shared package from its plugin, but keeps a package changed in the run", async (t) => {
  const ping = pingOperation();
  const shared = new Map([["demo-notes", notesPackage("v1")]]);
  const setupScript = script("demo-setup", loggingScript("demo-setup", false), { embeddable: false });
  const f = await fixture(t, [setupScript], { operations: ping.operations, shared });
  await f.session.startAndWait("demo.demo-setup", null);
  const owner = f.view().ownerId;
  await f.callTool("actor_program_ensure", owner, { name: "demo-notes" });
  const call = async (requestId: string) => {
    const found = f.programs.programs(f.runId).find((entry) => entry.name === "demo-notes")!;
    const invocation = f.programs.startFunctionInvocation(f.runId, "demo-notes", found.revision, "version", requestId, {});
    const settled = await invocationResult(f.programs, f.runId, "demo-notes", invocation.id);
    return settled.status === "succeeded" ? settled.result : `${settled.status}: ${settled.error}`;
  };
  assert.equal(await call("before"), "v1:pong");
  shared.set("demo-notes", notesPackage("v2"));
  ping.widenInput();
  assert.equal(await call("reloaded"), "v2:pong");
  const notes = f.actorOf("demo-notes")!;
  assert.deepEqual(f.programs.programOf(f.runId, notes.id)?.origin, { kind: "shared", pluginId: "demo.shared" }, "the reloaded package is still the shared one");

  const server = path.join(f.actorsDirectory, "demo-notes", "src", "server.ts");
  const { writeFile } = await import("node:fs/promises");
  await writeFile(server, (await readFile(server, "utf8")).replace('"v2:"', '"local:"'));
  await f.programs.activate({ actorId: owner, commandId: "local" }, f.runId, "demo-notes");
  shared.set("demo-notes", notesPackage("v3"));
  ping.widenMore();
  assert.equal(await call("kept"), "local:pong", "a package changed in the run is rebuilt from its own files");
  assert.equal(f.programs.programOf(f.runId, notes.id)?.origin.kind, "run");
});

test("a package the host did not install never counts as the shared one, for ensure or for a script start", async (t) => {
  const ping = pingOperation();
  const setupScript = script("demo-setup", loggingScript("demo-setup", false), { embeddable: false });
  const user = script("demo-user", loggingScript("demo-user", false), { shared: ["demo-notes"] });
  const f = await fixture(t, [setupScript, user], { operations: ping.operations, shared: new Map([["demo-notes", notesPackage("v1")]]) });
  await f.session.startAndWait("demo.demo-setup", null);
  await f.idle();
  const owner = f.view().ownerId;
  const foreign = /demo-notes is the shared actor package of demo\.shared, but this run has a package demo-notes that the host did not install/;

  await f.programs.importPackage({ actorId: owner, commandId: "impostor" }, f.runId, "demo-notes", loggingScript("demo-notes", false));
  const impostor = f.actorOf("demo-notes")!;
  await assert.rejects(Promise.resolve(f.callTool("actor_program_ensure", owner, { name: "demo-notes" })), foreign, "an impostor under the shared name is never active");
  const before = snapshot(f);
  await assert.rejects(f.session.startAndWait("demo.demo-user", null), foreign);
  assert.deepEqual(snapshot(f), before, "the start fails before anything changes");
  assert.deepEqual(f.programs.programOf(f.runId, impostor.id)?.origin, { kind: "run", installedBy: owner });

  await f.programs.remove({ actorId: owner, commandId: "remove-impostor" }, f.runId, "demo-notes");
  await rm(path.join(f.actorsDirectory, "demo-notes"), { recursive: true, force: true });
  await f.programs.importPackage({ actorId: owner, commandId: "twin" }, f.runId, "demo-notes", notesPackage("v1"));
  const twin = f.actorOf("demo-notes")!;
  await assert.rejects(Promise.resolve(f.callTool("actor_program_ensure", owner, { name: "demo-notes" })), foreign, "the same content without a record is not the shared package either");
  await assert.rejects(f.session.startAndWait("demo.demo-user", null), foreign);
  assert.deepEqual(f.programs.programOf(f.runId, twin.id)?.origin, { kind: "run", installedBy: owner }, "a later start does not give it an origin");
  assert.equal(f.scriptState().packages["demo-notes"], undefined);
});

test("a shared package changed in the run is refused by ensure instead of being answered as active", async (t) => {
  const ping = pingOperation();
  const setupScript = script("demo-setup", loggingScript("demo-setup", false), { embeddable: false });
  const f = await fixture(t, [setupScript], { operations: ping.operations, shared: new Map([["demo-notes", notesPackage("v1")]]) });
  await f.session.startAndWait("demo.demo-setup", null);
  const owner = f.view().ownerId;
  assert.equal((await f.callTool("actor_program_ensure", owner, { name: "demo-notes" }) as { status: string }).status, "installed");
  const server = path.join(f.actorsDirectory, "demo-notes", "src", "server.ts");
  const { writeFile } = await import("node:fs/promises");
  await writeFile(server, (await readFile(server, "utf8")).replace('"v1:"', '"edited:"'));
  await f.programs.activate({ actorId: owner, commandId: "edited" }, f.runId, "demo-notes");
  await assert.rejects(Promise.resolve(f.callTool("actor_program_ensure", owner, { name: "demo-notes" })), /has a package demo-notes that was changed in the run/);
});

test("concurrent script starts and ensure calls for the same shared package wait for each other", async (t) => {
  const ping = pingOperation();
  const names = [1, 2, 3, 4, 5].map((index) => `demo-notes-${index}`);
  const setupScript = script("demo-setup", loggingScript("demo-setup", false), { embeddable: false });
  const users = names.map((name, index) => script(`demo-user-${index + 1}`, loggingScript(`demo-user-${index + 1}`, false), { shared: [name] }));
  const f = await fixture(t, [setupScript, ...users], { operations: ping.operations, shared: new Map(names.map((name) => [name, notesPackage("v1")])) });
  await f.session.startAndWait("demo.demo-setup", null);
  const owner = f.view().ownerId;
  for (const [index, name] of names.entries()) {
    const [started, ensured] = await Promise.allSettled([
      f.session.startAndWait(`demo.demo-user-${index + 1}`, null),
      Promise.resolve(f.callTool("actor_program_ensure", owner, { name })),
    ]);
    assert.equal(started.status, "fulfilled", String((started as PromiseRejectedResult).reason));
    assert.equal(ensured.status, "fulfilled", String((ensured as PromiseRejectedResult).reason));
    assert.ok(["installed", "activated"].includes((ensured as PromiseFulfilledResult<{ status: string }>).value.status));
    assert.equal(f.view().actors.filter((actor) => actor.handle === name).length, 1);
    assert.deepEqual(f.programs.programOf(f.runId, f.actorOf(name)!.id)?.origin, { kind: "shared", pluginId: "demo.shared" });
  }
});

test("a failed start leaves a record that another writer changed after the claim", async (t) => {
  const setupScript = script("demo-setup", loggingScript("demo-setup", false), { embeddable: false });
  const broken = script("demo-broken", brokenScript("demo-broken"));
  const f = await fixture(t, [setupScript, broken]);
  await f.session.startAndWait("demo.demo-setup", null);
  await f.idle();
  const owner = f.view().ownerId;
  const third = { origin: { kind: "script", entryId: "demo.demo-other" }, identity: "third writer", count: 3, open: [] };
  const replace = f.setup.runtime.replacePluginState.bind(f.setup.runtime);
  let interleaved = false;
  f.setup.runtime.replacePluginState = ((context, runId, input) => {
    const view = replace(context, runId, input);
    const claimed = input.pluginId === ACTOR_SCRIPT_STATE_ID && (input.state as { packages?: Record<string, unknown> }).packages?.["demo-broken"];
    if (claimed && !interleaved) {
      interleaved = true;
      setImmediate(() => {
        const state = f.scriptState();
        replace({ actorId: owner, commandId: "third-writer" }, f.runId, { pluginId: ACTOR_SCRIPT_STATE_ID, scope: { kind: "run" },
          state: { ...state, packages: { ...state.packages, "demo-broken": third } } as never });
      });
    }
    return view;
  }) as typeof f.setup.runtime.replacePluginState;
  await assert.rejects(f.session.startAndWait("demo.demo-broken", null), /Typecheck of demo-broken/);
  f.setup.runtime.replacePluginState = replace;
  assert.equal(interleaved, true);
  assert.deepEqual(f.scriptState().packages["demo-broken"], third, "the release does not restore its snapshot over a later change");
  assert.ok(f.scriptState().packages["demo-setup"]);
});

test("a concurrent remove and ensure of the same shared package settle one after the other", async (t) => {
  const ping = pingOperation();
  const setupScript = script("demo-setup", loggingScript("demo-setup", false), { embeddable: false });
  const f = await fixture(t, [setupScript], { operations: ping.operations, shared: new Map([["demo-notes", notesPackage("v1")]]) });
  await f.session.startAndWait("demo.demo-setup", null);
  const owner = f.view().ownerId;
  await f.callTool("actor_program_ensure", owner, { name: "demo-notes" });
  const notes = f.actorOf("demo-notes")!;
  for (let round = 0; round < 3; round += 1) {
    const [removed, ensured] = await Promise.allSettled([
      f.programs.remove({ actorId: owner, commandId: `remove-${round}` }, f.runId, "demo-notes"),
      Promise.resolve(f.callTool("actor_program_ensure", owner, { name: "demo-notes" })),
    ]);
    assert.equal(removed.status, "fulfilled", String((removed as PromiseRejectedResult).reason));
    assert.deepEqual((ensured as PromiseFulfilledResult<unknown>).value, { actorId: notes.id, handle: "demo-notes", status: "activated" }, "ensure waits for the remove and activates again");
    assert.deepEqual(f.programs.programs(f.runId).filter((program) => program.name === "demo-notes").map((program) => program.actorId), [notes.id]);
    assert.deepEqual(f.view().actors.filter((actor) => actor.handle === "demo-notes").map((actor) => [actor.id, actor.kind !== "human" && actor.lifecycle.kind]), [[notes.id, "idle"]]);
    assert.deepEqual(f.programs.programOf(f.runId, notes.id)?.origin, { kind: "shared", pluginId: "demo.shared" });
  }
});
