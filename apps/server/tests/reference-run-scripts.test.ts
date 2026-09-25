import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import {
  Journal,
  LiveBus,
  Orchestration,
  ScriptDriver,
  StaticModelCatalog,
  ToolRegistry,
  TurnScheduler,
  type RuntimeServices,
} from "@ragents/engine";
import { noUsage, testServices } from "../../../packages/ragents/tests/support.ts";
import { actorProgramsToken } from "../src/plugin-support/actor-programs/service.ts";
import { nativeExecutorFixture } from "./native-executor-fixture.ts";
import type { Engine } from "../src/ragents/engine.ts";
import { RunChatSession } from "../src/ragents/session.ts";
import { ACTOR_PROGRAMS_STATE_ID, resolveActorView, type ActorProgramState } from "../../../apps/server/src/plugin-support/actor-programs/contract.ts";
import { ORCHESTRATION_PLUGIN_ID, surfaceLayoutOf } from "../../../plugins/ragents.orchestration/contract.ts";
import { checkLayoutAgainstRun } from "../../../plugins/ragents.orchestration/server/surface-tool.ts";
import type { ActorProgramRuntime } from "../../../plugins/ragents.actor-programs/server/runtime.ts";
import { invocationResult } from "./actor-runtime-fixture.ts";

process.env.DATA_DIR = mkdtempSync(path.join(tmpdir(), "ragents-reference-scripts-"));
process.env.AGENT_MODEL ??= "z-ai/glm-5.3";
process.env.AGENT_COORDINATOR_MODEL ??= "z-ai/glm-5.3-flash";
process.env.OPENROUTER_API_KEY ??= "test-key";
process.env.PRODUCT_ID ??= "ragents";
process.env.PRODUCT_TITLE ??= "RAgents";

const repoRoot = path.resolve(import.meta.dirname, "../../..");
const workspaceDirectory = mkdtempSync(path.join(tmpdir(), "ragents-reference-scripts-workspace-"));

const { loadPlugins } = await import("../src/profile/plugin-discovery.ts");
const { composeProfile } = await import("../src/profile/compose.ts");
const { folderRunScripts, pluginFolder } = await import("../src/plugin-support/plugin-folder.ts");

const coreProfile = async () => {
  const module = await import(path.join(repoRoot, "ragents.config.core.ts")) as {
    config: { host: { PRODUCT_ID: string; PRODUCT_TITLE: string; PLUGINS: readonly string[] } };
  };
  return { product: { id: module.config.host.PRODUCT_ID, title: module.config.host.PRODUCT_TITLE }, plugins: module.config.host.PLUGINS };
};

const referenceFixture = async () => {
  const native = nativeExecutorFixture();
  const services: RuntimeServices = { ...testServices(), nativeTypeScriptExecutor: native.executor };
  const journal = new Journal(":memory:", services);
  const runtime = new Orchestration(journal, services);
  const profile = await coreProfile();
  const loaded = await loadPlugins(profile.plugins);
  const host = composeProfile(
    { product: profile.product, pluginIds: profile.plugins, modules: loaded.modules, web: loaded.web },
    {
      ensureSession: () => {},
      ensureWorkspaceAccess: () => {},
      runtime: () => runtime,
      sessionWorkspaceFor: () => Promise.resolve({
        cwd: workspaceDirectory,
        currentRoot: () => Promise.resolve(workspaceDirectory),
        runOperation: <T>(operation: () => Promise<T>) => operation(),
      }),
    },
  );
  const registry = new ToolRegistry();
  for (const contributor of host.tools.entries()) registry.register(contributor);
  services.actorPrograms = host.service(actorProgramsToken);
  return { host, journal, runtime, registry, close: async () => {
    await host.lifecycle.shutdown();
    await native.close();
    journal.close();
  } };
};

test("every reference setup activates as a native actor package against the tools of the core profile", async () => {
  const { host, runtime, close } = await referenceFixture();
  const packages = folderRunScripts(pluginFolder("ragents.reference"), "ragents.reference");
  assert.deepEqual(packages.map((entry) => entry.script.handle), ["balcony-wizard", "conversation-circle", "learning-afternoon", "moderated-round", "shared-actor-list", "word-game"]);

  try {
    for (const entry of packages) {
      const view = runtime.createRun(
        { commandId: `create:${entry.script.handle}` },
        { title: entry.title, ownerHandle: "owner", ownerDisplayName: "Owner" },
      );
      const installed = await host.service(actorProgramsToken).importPackage(
        {actorId: view.ownerId, commandId: `activate:${entry.script.handle}`},
        view.id, entry.script.handle, entry.script.files,
      );
      const actor = runtime.view(view.id).actors.find((candidate) => candidate.id === installed.actorId);
      assert.ok(actor && actor.kind === "script", `${entry.id} wurde nicht installiert`);
      assert.equal("source" in actor, false);
      assert.equal("program" in actor, false);
      assert.equal(actor.toolNames, null);
    }
  } finally {
    await close();
  }
});

test("the reference scripts stay honest about their kind", () => {
  const packages = folderRunScripts(pluginFolder("ragents.reference"), "ragents.reference");
  const byHandle = new Map(packages.map((entry) => [entry.script.handle, entry]));
  assert.equal(byHandle.get("moderated-round")?.script.coordinator, false);
  assert.equal(byHandle.get("conversation-circle")?.script.coordinator, true);
  assert.equal(byHandle.get("balcony-wizard")?.script.coordinator, false);
  assert.equal(byHandle.get("learning-afternoon")?.script.coordinator, false);
  assert.equal(byHandle.get("word-game")?.script.coordinator, false);
  assert.deepEqual(byHandle.get("balcony-wizard")?.script.programs.map((program) => program.name), ["balcony-app"]);
  assert.deepEqual(byHandle.get("shared-actor-list")?.script.programs.map((program) => program.name), ["shared-list"]);
  for (const entry of packages) {
    assert.ok(entry.script.files.some((file) => /^tests\/.*\.test\.ts$/.test(file.path)), `${entry.id} needs a Node test`);
    assert.ok(entry.script.files.some((file) => file.path === "package.json"));
    assert.equal(entry.script.files.some((file) => file.path === "tests.json" || file.path === "setup.ts"), false);
  }
});

test("the balcony setup builds its advisor, view and surface through native core tools before any model input", async () => {
  const { host, journal, runtime, registry, close } = await referenceFixture();
  const catalog = new StaticModelCatalog(host.profiles.models(), host.profiles.profiles());
  let modelCalls = 0;
  const scheduler = new TurnScheduler(runtime, journal, {
    registry, catalog, workspaces: { ensure: () => workspaceDirectory },
    drivers: {
      script: new ScriptDriver({ runtime }),
      agent: { kind: "agent", runTurn: async () => { modelCalls++; throw new Error("The balcony setup must not invoke a model before the user starts it"); } },
    },
  });
  const engine = { runtime, journal, registry, catalog, catalogModels: host.profiles.models(), scheduler,
    live: new LiveBus(), startOptions: host.startOptions } as Engine;
  const entry = folderRunScripts(pluginFolder("ragents.reference"), "ragents.reference").find((entry) => entry.script.handle === "balcony-wizard");
  assert.ok(entry);
  const session = new RunChatSession({
    engine, id: "balcony-reference-run",
    coordinator: { handle: "coordinator", displayName: "Koordinator", profile: "coordinator", runTitle: "Balkon-Wizard", ownerHandle: "owner", ownerDisplayName: "Owner" },
    prompt: () => "Unexpected coordinator", assertUsable: () => {}, prepare: async () => {}, prepareWorkspace: async () => {}, started: async () => {},
    scriptEntryFor: () => undefined, startEntryFor: () => undefined, actorPrograms: host.service(actorProgramsToken),
  });
  try {
    const { script, ...descriptor } = entry;
    await session.startPackageAndWait({ ...script, entry: { ...descriptor, coordinator: script.coordinator } }, null);
    scheduler.start();
    await scheduler.waitForIdle();
    const view = runtime.view(session.id);
    assert.equal(view.turns.length, 1);
    assert.equal(view.turns[0]!.status, "completed", view.turns[0]!.reason ?? "");
    assert.equal(modelCalls, 0);
    assert.equal(view.actors.some((actor) => actor.handle === "coordinator"), false);
    const advisor = view.actors.find((actor) => actor.handle === "balcony-advisor");
    assert.ok(advisor && advisor.kind === "agent");
    assert.deepEqual(advisor.toolNames, []);
    assert.equal(view.primaryActorId, advisor.id);
    const standard = catalog.profiles().find((profile) => profile.name === "standard");
    assert.ok(standard && standard.driver === "agent");
    assert.equal(advisor.execution.driver.config.provider, standard.provider);
    assert.equal(advisor.execution.driver.config.model, standard.model);
    assert.equal(view.inputs.some((input) => input.actorId === advisor.id), false);
    const programs = view.pluginStates.flatMap((entry) => entry.pluginId === ACTOR_PROGRAMS_STATE_ID
      ? [(entry.state as unknown as ActorProgramState).program].filter((program) => program !== null) : []);
    const app = resolveActorView(programs, "balcony-app/main");
    assert.equal(app.program.actorId, advisor.id);
    assert.equal(app.view.visible, true);
    assert.equal(resolveActorView(programs, "@balcony-advisor/main").view.id, app.view.id);
    const state = view.pluginStates.find((entry) => entry.pluginId === ORCHESTRATION_PLUGIN_ID && entry.scope.kind === "run");
    assert.ok(state);
    const layout = surfaceLayoutOf(state.state);
    assert.deepEqual(checkLayoutAgainstRun(view, layout), layout);
    assert.deepEqual(layout.root, { entity: `app:${app.view.id}` });
  } finally {
    session.dispose();
    await scheduler.stop();
    await close();
  }
});

for (const sample of ["word-game", "learning-afternoon"]) {
  test(`${sample} starts from its real view function and completes through native actors and subscriptions`, async () => {
    const { host, journal, runtime, registry, close } = await referenceFixture();
    const catalog = new StaticModelCatalog(host.profiles.models(), host.profiles.profiles());
    const programs = host.service(actorProgramsToken) as ActorProgramRuntime;
    const words = ["Wärme", "Sommer", "Eis", "Wasser", "Meer", "Welle", "Wind", "Segel", "Boot", "Hafen", "Reise", "Zug"];
    const calls: string[] = [];
    let active = 0;
    let parallel = 0;
    const scheduler = new TurnScheduler(runtime, journal, {
      registry, catalog, workspaces: { ensure: () => workspaceDirectory },
      drivers: {
        script: new ScriptDriver({ runtime }),
        agent: { kind: "agent", supportsPlainLlm: true, runTurn: async (request) => {
          const actor = runtime.view(request.runId).actors.find((entry) => entry.id === request.agentId)!;
          assert.deepEqual(request.tools, []);
          calls.push(actor.handle);
          const text = sample === "word-game" ? words[calls.length - 1]! : `Idee von ${actor.handle}`;
          active++;
          parallel = Math.max(parallel, active);
          await new Promise((resolve) => setTimeout(resolve, 20));
          request.emit({ kind: "assistant", text });
          active--;
          return { failure: null, usage: noUsage() };
        } },
      },
    });
    const engine = { runtime, journal, registry, catalog, catalogModels: host.profiles.models(), scheduler,
      live: new LiveBus(), startOptions: host.startOptions } as Engine;
    const entry = folderRunScripts(pluginFolder("ragents.reference"), "ragents.reference").find((entry) => entry.script.handle === sample)!;
    const session = new RunChatSession({
      engine, id: `reference-${sample}`,
      coordinator: { handle: "coordinator", displayName: "Koordinator", profile: "coordinator", runTitle: entry.title, ownerHandle: "reader", ownerDisplayName: "Reader" },
      prompt: () => "Unexpected coordinator", assertUsable: () => {}, prepare: async () => {}, prepareWorkspace: async () => {}, started: async () => {},
      scriptEntryFor: () => undefined, startEntryFor: () => undefined, actorPrograms: programs,
    });
    try {
      const { script, ...descriptor } = entry;
      await session.startPackageAndWait({ ...script, entry: { ...descriptor, coordinator: script.coordinator } }, null);
      scheduler.start();
      await scheduler.waitForIdle();
      const setup = runtime.view(session.id);
      assert.equal(setup.turns[0]?.status, "completed", setup.turns[0]?.reason ?? "");
      assert.equal(calls.length, 0, "Building a sample must not call a model");
      assert.equal(setup.actors.some((actor) => actor.handle === "coordinator"), false);
      const app = programs.apps(session.id).find((app) => app.actorHandle === sample)!;
      assert.ok(app && app.visible, "The prepared UI must be visible");
      assert.equal(setup.primaryActorId, app.actorId);
      const invocation = programs.startInvocation(session.id, app.id, app.revision, "start", `${sample}-start`, {});
      const result = await invocationResult(programs, session.id, app.id, invocation.id);
      assert.equal(result.status, "succeeded", JSON.stringify(result));
      await scheduler.waitForIdle();
      const state = programs.apps(session.id).find((entry) => entry.id === app.id)!.state.values;
      const failed = runtime.view(session.id).turns.filter((turn) => turn.status !== "completed");
      assert.deepEqual(failed, [], JSON.stringify(failed));
      if (sample === "word-game") {
        assert.equal(state.status, "completed", JSON.stringify(state));
        assert.deepEqual(calls, Array.from({ length: 12 }, (_, index) => ["red", "yellow", "blue", "green"][index % 4]));
        assert.deepEqual(state.entries, words.map((word, index) => ({ participant: index % 4, word })));
        assert.match(String(state.document), /12\. Grün: Zug/);
        assert.equal(parallel, 1);
      } else {
        const board = state.board as { phase: string; helpers: { status: string; text: string }[] };
        assert.equal(board.phase, "complete", JSON.stringify(state));
        assert.equal(board.helpers.length, 2);
        assert.ok(board.helpers.every((helper) => helper.status === "complete" && helper.text.startsWith("Idee von ")));
        assert.deepEqual(calls.sort(), ["learning-experiment", "learning-quiz"]);
        assert.equal(parallel, 2, "The helpers should work concurrently");
      }
      const repeated = programs.startInvocation(session.id, app.id, app.revision, "start", `${sample}-repeat`, {});
      assert.equal((await invocationResult(programs, session.id, app.id, repeated.id)).status, "succeeded");
      await scheduler.waitForIdle();
      assert.equal(calls.length, sample === "word-game" ? 12 : 2, "Repeated clicks must not restart completed work");
    } finally {
      session.dispose();
      await scheduler.stop();
      await close();
    }
  });
}
