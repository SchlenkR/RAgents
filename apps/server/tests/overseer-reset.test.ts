import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fauxAssistantMessage, fauxToolCall, registerFauxProvider } from "@ragents/ai";
import { PluginHost, ScriptDriver, unrestrictedAccess } from "@ragents/engine";
import { deferred } from "../../../packages/ragents/tests/support.ts";
import { plugin } from "../../../plugins/ragents.overseer/server/index.ts";
import { overseerContracts } from "../../../plugins/ragents.overseer/contract.ts";
import { coordinatorRunId } from "../../../plugins/ragents.overseer/server/coordinator.ts";
import { coreContracts } from "../src/api/contracts.ts";
import { coreChannels, coreMethods } from "../src/api/core-methods.ts";
import { coreSources, dispatchMethod, methodContext } from "./rpc-fixture.ts";
import { WorkspaceSandboxHost, sandboxServicesToken } from "../src/plugin-support/workspace-sandbox-host.ts";
import { plugin as actorProgramsPlugin } from "../../../plugins/ragents.actor-programs/server/index.ts";
import { plugin as globalAppsPlugin } from "../../../plugins/ragents.global-apps/server/index.ts";
import { globalAppsContracts } from "../../../plugins/ragents.global-apps/contract.ts";
import { actorProgramsToken } from "../src/plugin-support/actor-programs/service.ts";
import { runOwnerAccessToken, runtimeProviderToken, runGuardToken, runWorkspaceProviderToken, workspaceGuardToken, userAccessToken } from "../src/ragents/host-services.ts";
import { writeAppFiles } from "./actor-runtime-fixture.ts";
import { globalChatToken, runManagementToken, type RunManagement } from "../src/ragents/global-chat.ts";
import { productRuntimeToken } from "../src/ragents/product-runtime.ts";
import { workspaceRuntimeToken } from "../src/ragents/workspace-runtime.ts";
import type { ChatEvent } from "quassel/events";
import type { Engine } from "../src/ragents/engine.ts";
import type { SessionInfo } from "../src/chat-handler.ts";

const directory = await mkdtemp(path.join(tmpdir(), "ragents-overseer-reset-"));
process.env.DATA_DIR = directory;
process.env.PRODUCT_PROFILE = "core";
process.env.PRODUCT_ID = "test";
process.env.PRODUCT_TITLE = "Test";
process.env.COMPACTION_MODEL = "";
process.env.ACCESS_TOKEN = "reset-test-only-token";
const { RunSessionProvider } = await import("../src/provider.ts");
const { registerTypeScriptFunctions } = await import("../src/ragents/typescript-tools.ts");

const G = coordinatorRunId(null);

const until = async (condition: () => boolean) => {
  const timeout = Date.now() + 10000;
  while (!condition()) {
    assert.ok(Date.now() < timeout, "The expected state change did not happen");
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
};

test("confirmed reset preserves global apps and recovers durably across server restarts", { timeout: 60000 }, async () => {
  const faux = registerFauxProvider({ models: [{ id: "reset-model", reasoning: true }] });
  const model = faux.getModel();
  let management: RunManagement;
  const resolvedWorkspaces: string[] = [];
  const createProvider = () => new RunSessionProvider((bridges) => {
    management = bridges.sessions!();
    const host = new PluginHost({ product: { id: "test", title: "Test" }, dataDirectory: directory });
    host.provideHost(runManagementToken, () => management);
    host.provideHost(runtimeProviderToken, bridges.runtime!);
    host.provideHost(runOwnerAccessToken, () => unrestrictedAccess);
    host.provideHost(userAccessToken, () => unrestrictedAccess);
    host.provideHost(runGuardToken, bridges.ensureSession!);
    host.provideHost(runWorkspaceProviderToken, (runId) => bridges.sessionWorkspaceFor!(runId));
    host.provideHost(workspaceGuardToken, bridges.ensureWorkspaceAccess!);
    const sandbox = new WorkspaceSandboxHost({ contributorName: "test.workspace", contributions: [], workspaceFor: bridges.sessionWorkspaceFor,
      identFor: async () => undefined, homeFor: async () => ({ home: directory }), skillPaths: async () => [] });
    host.register({ manifest: { id: "test.product" }, register: (registration) => {
      registration.script({ id: "typescript", create: (context) => ({ driver: new ScriptDriver({ runtime: context.runtime }) }) });
      registration.provide(sandboxServicesToken, sandbox);
      registration.functions(sandbox.workspaceTools());
      registration.lifecycle({ id: "test.sandbox", shutdown: () => sandbox.shutdownAll() });
      registration.provide(productRuntimeToken, {
        coordinator: { handle: "coordinator", displayName: "Coordinator", profile: "coordinator", runTitle: "New", ownerHandle: "owner", ownerDisplayName: "Owner" },
        roleFor: (view, actor) => view.primaryActorId === actor.id ? "primary" : "worker",
        contract: () => "", promptComposition: "test", systemPrompts: () => ({ mode: "fixed", options: [], defaultIds: [], shareDefault: false }),
      });
      registration.provide(workspaceRuntimeToken, {
        describe: () => ({ mode: "test", directoryPattern: directory }),
        resolve: async (runId) => {
          resolvedWorkspaces.push(runId);
          return { cwd: directory, currentRoot: async () => directory, runOperation: (operation) => operation() };
        },
      });
      registration.profiles({ id: "models", models: () => [{ driver: "agent", provider: model.provider, model: model.id, label: "Reset Model", thinking: ["off", "high"] }],
        providers: () => [{ id: model.provider, config: { api: faux.api, baseUrl: model.baseUrl, apiKey: "faux-test-key", models: faux.models } }],
        profiles: () => [{ name: "coordinator", description: "Coordinator", driver: "agent", provider: model.provider, model: model.id, thinking: "off", turnTimeoutMs: null, isolateWorkspace: false }] });
    } });
    host.register(actorProgramsPlugin.create(host));
    host.register(plugin.create(host));
    host.register(globalAppsPlugin.create(host));
    registerTypeScriptFunctions(host);
    host.seal();
    return host;
  }, "http://127.0.0.1:51234");
  let provider = createProvider();
  const sessions = { get: (id: string) => provider.get(id), list: () => provider.list(), delete: (id: string) => provider.delete(id) };
  const overseerCall = (contract: { id: string }, input: unknown) => dispatchMethod(provider.plugins.methods, contract.id, input);
  const chatMethod = (contract: { id: string }) => coreMethods(coreSources(sessions)).find((entry) => entry.contract.id === contract.id)!;
  const chatChannel = (contract: { id: string }) => coreChannels({ sessions: sessions as never, plugins: provider.plugins, global: undefined, runOwner: () => undefined, runOwnerOnly: () => false }).find((entry) => entry.contract.id === contract.id)!;
  const normalStarted = deferred();
  const releaseNormal = deferred();
  const globalStarted = deferred();
  const globalAborted = deferred();
  const releaseGlobal = deferred();
  const freshContexts: string[] = [];
  faux.setResponses([
    (context) => {
      const selected = context.tools?.map((tool) => tool.name) ?? [];
      for (const name of ["actor_program_create", "actor_program_diagnostics", "global_app_register", "global_app_list", "global_app_read", "global_app_run", "global_app_pause", "global_app_remove", "write", "edit", "read", "typescript_api", "typescript_eval"]) assert.ok(selected.includes(name), name);
      assert.match(context.systemPrompt ?? "", /Build a global mini-app/);
      assert.match(context.systemPrompt ?? "", /daily: \{at: "08:00"\}/);
      assert.doesNotMatch(context.systemPrompt ?? "", /reset-test-only-token/);
      return fauxAssistantMessage([fauxToolCall("typescript_eval", { code: `return await context.functions.write(${JSON.stringify({ file_path: "request.json", content: '{"title":"Test"}' })});` }, { id: "global-write" })]);
    },
    () => fauxAssistantMessage([fauxToolCall("typescript_eval", { code: `return await context.functions.read(${JSON.stringify({ file_path: `$RAGENTS_JOURNAL_DIR/${G}/journal.jsonl` })});` }, { id: "global-read" })]),
    () => fauxAssistantMessage([fauxToolCall("typescript_eval", { code: `return await context.functions.bash(${JSON.stringify({ command: 'test -n "$RAGENTS_API_TOKEN" && test "$RAGENTS_API_BASE_URL" = http://127.0.0.1:51234 && rg -l "Old conversation" "$RAGENTS_JOURNAL_DIR"', timeout: 5_000 })});` }, { id: "global-bash" })]),
    (context) => {
      const results = context.messages.filter((message) => message.role === "toolResult");
      assert.equal(results.length, 3);
      assert.ok(results.every((result) => !result.isError));
      assert.match(JSON.stringify(results), /Old conversation/);
      assert.doesNotMatch(JSON.stringify(results), /reset-test-only-token/);
      return fauxAssistantMessage("Old answer");
    },
    async () => { normalStarted.resolve(); await releaseNormal.promise; return fauxAssistantMessage("Normal completed"); },
    async (_context, options) => { globalStarted.resolve(); options?.signal?.addEventListener("abort", globalAborted.resolve, { once: true }); await releaseGlobal.promise; return fauxAssistantMessage("Stale late answer"); },
    (context) => { freshContexts.push(JSON.stringify(context.messages)); return fauxAssistantMessage("Fresh start"); },
    (context) => { freshContexts.push(JSON.stringify(context.messages)); return fauxAssistantMessage("Fresh restart"); },
  ]);
  try {
    await provider.init();
    const global = await provider.get(G);
    const observed: ChatEvent[] = [];
    const unsubscribe = global.subscribe((event) => observed.push(event));
    await global.send("Old conversation");
    await until(() => management!.view(G).turns[0]?.status === "completed");
    const toolPolicy = provider.plugins.service(globalChatToken);
    const currentTools = Object.getOwnPropertyDescriptor(toolPolicy, "toolNames")!;
    Object.defineProperty(toolPolicy, "toolNames", { configurable: true, value: ["legacy-management-tool"] });
    assert.equal(await provider.get(G), global);
    await assert.rejects(async () => global.send("Stale tool selection"), /tools.*Reset/);
    Object.defineProperty(toolPolicy, "toolNames", currentTools);
    await assert.rejects(overseerCall(overseerContracts.reset, { confirm: false }), /Invalid input/);
    await assert.rejects(overseerCall(overseerContracts.reset, {}), /Invalid input/);
    assert.equal(provider.hasRun(G), true);
    const selection = { provider: model.provider, model: model.id, thinking: "high" };
    const settingsBefore = await overseerCall(overseerContracts.settings.save, selection);
    const normalId = await management!.create({ title: "Normal stays", user: null, kind: "message", message: "Normal running task" });
    await normalStarted.promise;
    const normalBefore = management!.view(normalId);
    await global.send("Global running task " + "with many details. ".repeat(300));
    await globalStarted.promise;
    assert.ok((await readdir(path.join(directory, "runs", G, "payloads"))).length > 0);
    const programs = provider.plugins.service(actorProgramsToken);
    const sources = {
      "package.json": JSON.stringify({ name: "date", private: true, type: "module", ragents: { title: "Daily date", backend: "src/server.ts" } }),
      "src/server.ts": 'import { Type } from "typebox"; import { defineActor } from "@ragents/server"; export default defineActor({ state: Type.Object({ count: Type.Optional(Type.Integer()) }), functions: {}, input: { capabilities: ["global_app_trigger"] } }, { functions: {}, onInput: async (_input, context) => { await context.functions.global_app_trigger({}); context.state.replace({ count: (context.state.read().count ?? 0) + 1 }); context.log("Daily date result"); } });',
    };
    await writeAppFiles(path.join(directory, "sessions", G, "plugins", "ragents.actor-programs", "programs"), "date", sources);
    const appCall = (contract: { id: string }, input: unknown) => dispatchMethod(provider.plugins.methods, contract.id, input);
    await appCall(globalAppsContracts.register, { sourceRunId: G, name: "daily-date", description: "The daily date", program: "date", triggers: { daily: { at: "08:00", timeZone: "Europe/Berlin" } }, permissions: {} });
    await appCall(globalAppsContracts.run, { name: "daily-date" });
    await until(() => management!.view(G).turns.some((turn) => turn.status !== "running" && turn.actorId !== management!.view(G).primaryActorId));
    assert.equal(management!.view(G).turns.find((turn) => turn.actorId !== management!.view(G).primaryActorId)?.status, "completed", JSON.stringify(await appCall(globalAppsContracts.read, { name: "daily-date" })));
    await appCall(globalAppsContracts.pause, { name: "daily-date", paused: false });
    const appBefore = await appCall(globalAppsContracts.read, { name: "daily-date" });
    const roomsBefore = management!.view(G).rooms;
    const oldActor = management!.view(G).primaryActorId;
    assert.ok(oldActor);
    assert.match(await readFile(path.join(directory, "runs", G, "journal.jsonl"), "utf8"), /"model\.input\.presented"/, "the model context is in the journal");
    const reset = management!.resetGlobal(G);
    assert.equal(management!.resetGlobal(G), reset);
    await assert.rejects(provider.get(G), /is being reset/);
    await assert.rejects(async () => global.send("Concurrent message"), /is being reset/);
    await globalAborted.promise;
    assert.equal(management!.view(G).actors.find((actor) => actor.id === oldActor)?.lifecycle.kind, "stopped");
    await appCall(globalAppsContracts.run, { name: "daily-date" });
    await until(() => management!.view(G).turns.filter((turn) => turn.actorId === (appBefore as { app: { actorId: string } }).app.actorId && turn.status === "completed").length === 2);
    const appWhileReset = await appCall(globalAppsContracts.read, { name: "daily-date" });
    let finished = false;
    void reset.then(() => { finished = true; });
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.equal(finished, false);
    assert.deepEqual(management!.view(normalId), normalBefore);
    assert.ok(management!.view(G).rooms.length > 0, "app rooms remain accessible while the conversation resets");
    releaseGlobal.resolve();
    await reset;
    assert.equal(provider.hasRun(G), true);
    assert.equal(existsSync(path.join(directory, "sessions", G)), true);
    assert.equal(existsSync(path.join(directory, "runs", G)), true);
    assert.deepEqual(management!.view(normalId), normalBefore);
    assert.deepEqual(await overseerCall(overseerContracts.settings.read, {}), settingsBefore);
    assert.equal(observed.filter((event) => event.kind === "reset" && event.reason === "conversation-reset").length, 1);
    assert.equal(await provider.get(G), global);
    const replay: ChatEvent[] = [];
    global.subscribe((event) => replay.push(event))();
    const resetId = management!.events(G).find((event) => event.type === "agent.spawned" && event.commandId.startsWith("conversation-reset:"))!.eventId;
    assert.deepEqual(replay, [{ kind: "reset", conversationId: resetId }, { kind: "status", running: false }, { kind: "replay-end", conversationId: resetId }]);
    assert.deepEqual(await appCall(globalAppsContracts.read, { name: "daily-date" }), appWhileReset);
    assert.deepEqual(management!.view(G).rooms, roomsBefore);
    const workspace = provider.plugins.service(globalChatToken).workspaceDirectory(G);
    assert.equal(existsSync(path.join(workspace, "rpc-reference.md")), true);
    await global.send("New question");
    await until(() => management!.view(G).turns.some((turn) => turn.actorId === management!.view(G).primaryActorId && turn.status === "completed"));
    assert.notEqual(management!.view(G).primaryActorId, oldActor);
    assert.match(await readFile(path.join(workspace, "rpc-reference.md"), "utf8"), new RegExp(overseerContracts.listRuns.id));
    assert.ok(JSON.parse(await readFile(path.join(workspace, "openrpc.json"), "utf8")).methods.length > 0);
    assert.ok(observed.some((event) => event.kind === "text" && event.delta.includes("Fresh")));
    assert.ok(freshContexts[0].includes("New question"));
    assert.doesNotMatch(freshContexts[0], /Old conversation|Old answer|Global running task|Stale late answer/);
    releaseNormal.resolve();
    await until(() => management!.view(normalId).turns[0]?.status === "completed");
    unsubscribe();
    const intents = provider.plugins.service(globalChatToken).resetIntentDirectory!;
    const intent = path.join(intents, `${G}.json`);
    const previousPrimary = management!.view(G).primaryActorId;
    const completedReset = management!.events(G).find((event) => event.eventId === resetId)!;
    const completedKey = completedReset.commandId.slice("conversation-reset:".length, -":spawn".length);
    const spawnCount = management!.events(G).filter((event) => event.type === "agent.spawned").length;
    await provider.shutdown();
    await writeFile(intent, JSON.stringify({ version: 1, runId: G, key: completedKey, oldActorId: oldActor }));
    provider = createProvider();
    await provider.init();
    assert.equal(existsSync(intent), false);
    assert.equal(management!.view(G).primaryActorId, previousPrimary);
    assert.equal(management!.events(G).filter((event) => event.type === "agent.spawned").length, spawnCount, "recovery after coordinator creation must reuse the durable replacement");
    assert.deepEqual(await appCall(globalAppsContracts.read, { name: "daily-date" }), appWhileReset);
    assert.deepEqual(management!.view(G).rooms, roomsBefore);
    await provider.shutdown();
    await writeFile(intent, JSON.stringify({ version: 1, runId: G, key: randomUUID(), oldActorId: previousPrimary }));
    provider = createProvider();
    await provider.init();
    assert.equal(provider.hasRun(G), true);
    assert.equal(existsSync(intent), false);
    assert.notEqual(management!.view(G).primaryActorId, previousPrimary);
    assert.deepEqual(await appCall(globalAppsContracts.read, { name: "daily-date" }), appWhileReset);
    assert.deepEqual(management!.view(G).rooms, roomsBefore);
    assert.ok(provider.hasRun(normalId));
    assert.deepEqual(await overseerCall(overseerContracts.settings.read, {}), settingsBefore);
    await (await provider.get(G)).send("After the restart");
    await until(() => management!.view(G).turns.some((turn) => turn.actorId === management!.view(G).primaryActorId && turn.status === "completed"));
    assert.doesNotMatch(freshContexts[1], /New question|Fresh start|Old conversation/);
    const current = await provider.get(G);
    const policy = provider.plugins.service(globalChatToken);
    const blocker = path.join(directory, "blocked-marker-parent");
    await writeFile(blocker, "file");
    policy.resetIntentDirectory = blocker;
    await assert.rejects(overseerCall(overseerContracts.reset, { confirm: true }));
    assert.equal(await provider.get(G), current);
    assert.equal(provider.hasRun(G), true);
    policy.resetIntentDirectory = intents;
    const engine = (provider as unknown as { engine: Engine }).engine;
    const interrupt = engine.scheduler.interruptTurn.bind(engine.scheduler);
    engine.scheduler.interruptTurn = async () => { throw new Error("Test: the runtime cannot be stopped yet"); };
    await assert.rejects(overseerCall(overseerContracts.reset, { confirm: true }), /cannot be stopped yet/);
    assert.equal(provider.hasRun(G), true);
    assert.ok(existsSync(intent));
    assert.ok(provider.hasRun(normalId));
    await assert.rejects(provider.get(G), /repeat the reset/);
    await assert.rejects(async () => current.send("After a failed reset"), /is being reset/);
    engine.scheduler.interruptTurn = interrupt;
    assert.equal(await overseerCall(overseerContracts.reset, { confirm: true }), null);
    assert.equal(provider.hasRun(G), true);
    assert.ok((await readFile(path.join(directory, "runs", normalId, "journal.jsonl"), "utf8")).includes("Normal running task"));
    await provider.shutdown();
    const firstRecord = JSON.parse((await readFile(path.join(directory, "runs", normalId, "journal.jsonl"), "utf8")).split("\n")[0]);
    const legacyId = randomUUID();
    const corruptId = randomUUID();
    const malformedId = randomUUID();
    const unavailable = new Map([
      [legacyId, JSON.stringify({ ...firstRecord, runId: legacyId, formatVersion: 3 }) + "\n"],
      [corruptId, JSON.stringify({ ...firstRecord, runId: corruptId }) + '\n{"formatVersion":4}\n'],
      [malformedId, "{invalid JSON}\n"],
      [G, JSON.stringify({ ...firstRecord, runId: G, formatVersion: 3 }) + "\n"],
    ]);
    for (const [id, content] of unavailable) {
      await mkdir(path.join(directory, "runs", id), { recursive: true });
      await writeFile(path.join(directory, "runs", id, "journal.jsonl"), content);
    }
    const oldSession = path.join(directory, "sessions", corruptId, "chat", "agent", "ragents-old.jsonl");
    await mkdir(path.dirname(oldSession), { recursive: true });
    await writeFile(oldSession, "{\"type\":\"session\"}\n");
    for (let restart = 0; restart < 2; restart++) {
      resolvedWorkspaces.length = 0;
      provider = createProvider();
      await provider.init();
      assert.equal(provider.hasRun(normalId), true);
      assert.ok((await provider.list()).some((run) => run.id === normalId));
      assert.ok(await provider.get(normalId));
      for (const [id, content] of unavailable) {
        assert.equal(provider.hasRun(id), false);
        assert.equal(resolvedWorkspaces.includes(id), false);
        assert.equal((provider as unknown as { sessions: Map<string, unknown> }).sessions.has(id), false);
        await assert.rejects(provider.get(id), { code: "journal-unavailable", status: 409 });
        await assert.rejects(chatChannel(coreContracts.channels.chat).open({ runId: id } as never, () => undefined, { access: unrestrictedAccess, connection: methodContext().connection }),
          { code: "journal-unavailable", status: 409 });
        assert.equal(await readFile(path.join(directory, "runs", id, "journal.jsonl"), "utf8"), content);
      }
      const journal = (provider as unknown as { engine: Engine }).engine.journal;
      assert.equal(journal.loadFailures().length, unavailable.size);
      const listed = await provider.list() as (SessionInfo & { workspaceAccessible?: boolean })[];
      for (const id of unavailable.keys()) {
        const entry = listed.find((run) => run.id === id);
        if (id === G) { assert.equal(entry, undefined, "the global coordinator stays out of the run list even when locked"); continue; }
        assert.equal(entry?.locked, journal.failureOf(id)?.message, "a locked run stays in the list with its cause");
        assert.equal(entry?.workspaceAccessible, false);
      }
      assert.match(listed.find((run) => run.id === legacyId)?.locked ?? "", /format/i);
      if (restart === 0) await provider.shutdown();
    }
    await provider.delete(corruptId);
    await provider.deletion(corruptId);
    assert.equal((await provider.list()).some((run) => run.id === corruptId), false, "the deleted locked run disappears from the list");
    assert.equal((provider as unknown as { engine: Engine }).engine.journal.failureOf(corruptId), null);
    assert.equal(existsSync(path.join(directory, "runs", corruptId)), false);
    assert.equal(await readFile(path.join(directory, "archive", corruptId, "run", "journal.jsonl"), "utf8"), unavailable.get(corruptId));
    assert.equal(await readFile(path.join(directory, "archive", corruptId, "chat", "agent", "ragents-old.jsonl"), "utf8"), "{\"type\":\"session\"}\n", "the session of the old format stays in the archive");
    unavailable.delete(corruptId);
    faux.setResponses([
      () => fauxAssistantMessage("Healthy run after damaged journals"),
      () => fauxAssistantMessage("New run after damaged journals"),
      () => fauxAssistantMessage("Global after explicit reset"),
    ]);
    await (await provider.get(normalId)).send("Continue existing run");
    await until(() => management!.view(normalId).turns.length === 2 && management!.view(normalId).turns.every((turn) => turn.status === "completed"));
    const freshId = await management!.create({ title: "New healthy run", user: null, kind: "message", message: "Start despite old journals" });
    await until(() => management!.view(freshId).turns[0]?.status === "completed");
    await assert.rejects(overseerCall(overseerContracts.reset, { confirm: true }), { code: "journal-unavailable", status: 409 });
    assert.equal(await readFile(path.join(directory, "runs", G, "journal.jsonl"), "utf8"), unavailable.get(G));
    assert.equal(provider.hasRun(normalId), true);
    assert.equal(provider.hasRun(freshId), true);
    for (const [id, content] of unavailable) {
      if (id === G) continue;
      assert.equal(await readFile(path.join(directory, "runs", id, "journal.jsonl"), "utf8"), content);
    }
  } finally {
    releaseGlobal.resolve(); releaseNormal.resolve();
    await provider.shutdown(); faux.unregister(); await rm(directory, { recursive: true, force: true });
  }
});
