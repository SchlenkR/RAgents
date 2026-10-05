import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test, { after } from "node:test";
import { fauxAssistantMessage, registerFauxProvider } from "@ragents/ai";
import { DomainError, Journal, Orchestration, PluginHost, type AgentExecution } from "@ragents/engine";
import { manualExecution, testServices } from "../../../packages/ragents/tests/support.ts";
import { WorkspaceSandboxHost, sandboxServicesToken } from "../src/plugin-support/workspace-sandbox-host.ts";
import { productRuntimeToken } from "../src/ragents/product-runtime.ts";
import { workspaceRuntimeToken } from "../src/ragents/workspace-runtime.ts";
import type { Engine } from "../src/ragents/engine.ts";

const directory = await mkdtemp(path.join(tmpdir(), "ragents-workspace-startup-"));
process.env.DATA_DIR = directory;
process.env.PRODUCT_PROFILE = "core";
process.env.PRODUCT_ID = "test";
process.env.PRODUCT_TITLE = "Test";
process.env.COMPACTION_MODEL = "";
delete process.env.ACCESS_TOKEN;
const { RunSessionProvider } = await import("../src/provider.ts");
const { layout } = await import("../src/layout.ts");
after(() => rm(directory, { recursive: true, force: true }));

test("workspace resolution failures lock only their runs, preserve pending inputs and allow healthy startup and new runs", { timeout: 20000 }, async () => {
  const faux = registerFauxProvider({ models: [{ id: "startup-model" }] });
  const model = faux.getModel();
  const execution: AgentExecution = {
    driver: { kind: "agent", config: { provider: model.provider, model: model.id, thinking: "off" } },
    workspacePath: null, turnTimeoutMs: null,
  };
  const failures = new Map<string, Error>([
    ["blocked-folder", new DomainError("test-workspace-policy", "Existing server folder is not permitted for this run.", 403)],
    ["blocked-metadata", new Error("Existing workspace metadata is unsafe.")],
    ["new-blocked", new Error("The new workspace could not be resolved.")],
  ]);
  const resolved: string[] = [];
  const toolsResolved: string[] = [];
  const modelInputs: string[] = [];
  const createProvider = () => new RunSessionProvider((bridges) => {
    const host = new PluginHost({ product: { id: "test", title: "Test" }, dataDirectory: directory });
    const sandbox = new WorkspaceSandboxHost({ contributorName: "test.workspace", contributions: [], workspaceFor: bridges.sessionWorkspaceFor,
      identFor: async () => undefined, homeFor: async () => ({ home: directory }), skillPaths: async () => [] });
    host.register({ manifest: { id: "test.product" }, register: (registration) => {
      registration.provide(sandboxServicesToken, sandbox);
      registration.lifecycle({ id: "test.sandbox", shutdown: () => sandbox.shutdownAll() });
      registration.functions({ name: "test.tools", descriptors: [], dynamic: true, tools: ({ runId }) => { toolsResolved.push(runId); return []; } });
      registration.sessionMetadata({ id: "test.workspace-metadata", requiresWorkspace: true,
        describe: ({ runId }) => runId === "metadata-first" ? bridges.sessionWorkspaceFor(runId).then(() => "Ready") : undefined });
      registration.provide(productRuntimeToken, {
        coordinator: { handle: "coordinator", displayName: "Coordinator", profile: "coordinator", runTitle: "New", ownerHandle: "owner", ownerDisplayName: "Owner" },
        roleFor: (view, actor) => view.primaryActorId === actor.id ? "primary" : "worker",
        contract: () => "", promptComposition: "test", systemPrompts: () => ({ mode: "fixed", options: [], defaultIds: [], shareDefault: false }),
      });
      registration.provide(workspaceRuntimeToken, {
        describe: () => ({ mode: "test", directoryPattern: directory }), placementOf: () => ({ machine: "server", folder: "fresh" }),
        resolve: async (runId) => {
          resolved.push(runId);
          const failure = failures.get(runId);
          if (failure) throw failure;
          const cwd = path.join(directory, "workspaces", runId);
          await mkdir(cwd, { recursive: true });
          return { cwd, currentRoot: async () => cwd, runOperation: (operation) => operation() };
        },
      });
      registration.profiles({ id: "models", models: () => [{ driver: "agent", provider: model.provider, model: model.id, label: "Startup Model", thinking: ["off"] }],
        providers: () => [{ id: model.provider, config: { api: faux.api, baseUrl: model.baseUrl, apiKey: "faux-test-key", models: faux.models } }],
        profiles: () => [{ name: "coordinator", description: "Coordinator", driver: "agent", provider: model.provider, model: model.id, thinking: "off", turnTimeoutMs: null, isolateWorkspace: false }] });
    } });
    host.seal();
    return host;
  }, undefined);
  const journalFile = (id: string) => path.join(layout.runsDir, id, "journal.jsonl");
  const ownedFile = (id: string) => path.join(directory, "workspaces", id, "owned.txt");
  const services = { ...testServices(), newId: () => randomUUID() };
  await mkdir(layout.runsDir, { recursive: true });
  const journal = new Journal(layout.runsDir, services);
  const runtime = new Orchestration(journal, services);
  const actorIds = new Map<string, string>();
  for (const id of ["healthy", "healthy-administrator", "blocked-folder", "blocked-metadata"]) {
    let view = runtime.createRun({ commandId: `create-${id}` }, { runId: id, title: id, ownerHandle: "owner", ownerDisplayName: "Owner" });
    view = runtime.spawnAgent({ actorId: view.ownerId, commandId: `spawn-${id}` }, id, {
      handle: "worker", displayName: "Worker", prompt: "Complete the pending task.", execution, grants: [], toolNames: [],
    });
    const actorId = view.actors.find((actor) => actor.kind === "agent")!.id;
    actorIds.set(id, actorId);
    runtime.selectPrimaryActor({ actorId: view.ownerId, commandId: `primary-${id}` }, id, actorId);
    runtime.enqueueInput({ actorId: view.ownerId, commandId: `input-${id}` }, id, { actorId, content: `Pending task ${id}.` });
    await mkdir(path.dirname(ownedFile(id)), { recursive: true });
    await writeFile(ownedFile(id), `Original data for ${id}.`);
  }
  journal.close();
  const blockedIds = ["blocked-folder", "blocked-metadata"];
  const originals = new Map(await Promise.all(blockedIds.map(async (id) => [id, await readFile(journalFile(id))] as const)));
  const respond = (context: { messages: unknown }) => { modelInputs.push(JSON.stringify(context.messages)); return fauxAssistantMessage("Complete."); };
  faux.setResponses([respond, respond, respond, respond, respond]);
  let provider = createProvider();
  try {
    await provider.init();
    const engine = (provider as unknown as { engine: Engine }).engine;
    await engine.scheduler.waitForIdle();
    assert.equal(faux.state.callCount, 2);
    assert.ok(await provider.get("healthy"));
    assert.ok(await provider.get("healthy-administrator"));
    const listed = await provider.list();
    for (const id of blockedIds) {
      const entry = listed.find((run) => run.id === id)!;
      assert.ok(entry.locked?.includes(failures.get(id)!.message));
      assert.equal(entry.workspaceAccessible, false);
      assert.equal(entry.operable, false);
      assert.equal(entry.running, false);
      assert.equal(entry.title, id);
      await assert.rejects(provider.get(id), { code: "workspace-unavailable", status: 409 });
      assert.equal(engine.journal.failureOf(id), null, "the journal remains readable and is not quarantined");
      assert.equal(engine.runtime.view(id).turns.length, 0);
      assert.deepEqual(engine.runtime.view(id).inputs.map((input) => input.lifecycle.kind), ["pending"]);
      assert.deepEqual(await readFile(journalFile(id)), originals.get(id));
      assert.equal(await readFile(ownedFile(id), "utf8"), `Original data for ${id}.`);
      assert.equal(toolsResolved.includes(id), false);
      assert.equal((provider as unknown as { sessions: Map<string, unknown> }).sessions.has(id), false);
    }
    const blockedView = engine.runtime.view("blocked-folder");
    engine.runtime.enqueueInput({ actorId: blockedView.ownerId, commandId: "blocked-later" }, blockedView.id,
      { actorId: actorIds.get(blockedView.id)!, content: "Later blocked task." });
    const afterTrigger = await readFile(journalFile(blockedView.id));
    await engine.scheduler.waitForIdle();
    assert.equal(faux.state.callCount, 2);
    assert.deepEqual(await readFile(journalFile(blockedView.id)), afterTrigger);

    failures.set("metadata-first", new Error("The workspace metadata resolver refused this run."));
    const metadataRun = engine.runtime.createRun({ commandId: "create-metadata-first" }, {
      runId: "metadata-first", title: "Metadata first", ownerHandle: "owner", ownerDisplayName: "Owner",
    });
    const metadataView = engine.runtime.spawnAgent({ actorId: metadataRun.ownerId, commandId: "spawn-metadata-first" }, metadataRun.id, {
      handle: "manual", displayName: "Manual", prompt: "Manual fixture.", execution: manualExecution(), grants: [], toolNames: [],
    });
    engine.runtime.selectPrimaryActor({ actorId: metadataRun.ownerId, commandId: "primary-metadata-first" }, metadataRun.id,
      metadataView.actors.find((actor) => actor.kind === "agent")!.id);
    const metadataSession = await provider.get(metadataRun.id);
    assert.equal(metadataSession.started, true);
    const metadataJournal = await readFile(journalFile(metadataRun.id));
    let notices = 0;
    const unsubscribe = provider.subscribeList(() => { notices += 1; }, null);
    const metadataEntries = (await provider.list()).filter((run) => run.id === metadataRun.id);
    unsubscribe();
    assert.equal(notices, 1, "the first resolution failure refreshes the run list");
    assert.equal(metadataEntries.length, 1, "a failure during metadata replaces the unlocked row");
    assert.match(metadataEntries[0]?.locked ?? "", /metadata resolver refused/);
    assert.equal(metadataEntries[0]?.operable, false);
    assert.deepEqual(await readFile(journalFile(metadataRun.id)), metadataJournal);
    await assert.rejects(provider.get(metadataRun.id), { code: "workspace-unavailable" });

    const failed = await provider.get("new-blocked");
    await assert.rejects(failed.send("Start a new task."), { code: "workspace-unavailable", status: 409 });
    const failedEntries = (await provider.list()).filter((run) => run.id === "new-blocked");
    assert.equal(failedEntries.length, 1);
    assert.match(failedEntries[0]?.locked ?? "", /new workspace could not be resolved/);
    const failedStartJournal = await readFile(journalFile("new-blocked"));
    await assert.rejects(provider.get("new-blocked"), { code: "workspace-unavailable" });
    assert.deepEqual(await readFile(journalFile("new-blocked")), failedStartJournal);
    assert.equal(engine.runtime.view("new-blocked").actors.filter((actor) => actor.kind !== "human").length, 0);
    await (await provider.get("new-healthy")).send("New healthy task.");
    await engine.scheduler.waitForIdle();
    assert.equal(faux.state.callCount, 3);
    assert.ok(modelInputs.every((input) => !input.includes("blocked-folder") && !input.includes("blocked-metadata")));

    failures.delete("blocked-metadata");
    const metadataAttempts = resolved.filter((id) => id === "blocked-metadata").length;
    await assert.rejects(provider.get("blocked-metadata"), { code: "workspace-unavailable" });
    assert.equal(resolved.filter((id) => id === "blocked-metadata").length, metadataAttempts, "resolution failures stay locked until restart");
    await provider.shutdown();
    provider = createProvider();
    await provider.init();
    const restarted = (provider as unknown as { engine: Engine }).engine;
    await restarted.scheduler.waitForIdle();
    assert.ok(await provider.get("blocked-metadata"), "a repaired workspace is resolved at the next startup");
    assert.equal(restarted.runtime.view("blocked-metadata").turns[0]?.status, "completed");
    assert.equal(restarted.runtime.view("blocked-folder").turns.length, 0);
    assert.deepEqual(await readFile(journalFile("blocked-folder")), afterTrigger);
    assert.equal(faux.state.callCount, 4);
  } finally {
    await provider.shutdown();
    faux.unregister();
  }
});
