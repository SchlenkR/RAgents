import { setupPackageFiles } from "./actor-programs-fixture.ts";
import { actorProgramsToken } from "../src/plugin-support/actor-programs/service.ts";
import { ActorProgramRuntime } from "../../../plugins/ragents.actor-programs/server/runtime.ts";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { Type } from "typebox";
import { agentTools, createAccessContext, DomainError, ScriptDriver, PluginHost, type AccessContext } from "@ragents/engine";
import { plugin } from "../../../plugins/ragents.overseer/server/index.ts";
import { RunDirectory } from "../../../plugins/ragents.overseer/server/run-directory.ts";
import { OVERSEER_RUN_ID, overseerContracts } from "../../../plugins/ragents.overseer/contract.ts";
import { methodContext } from "./rpc-fixture.ts";
import { globalChatToken, sessionManagementToken, type SessionManagement } from "../src/ragents/global-chat.ts";
import { productRuntimeToken } from "../src/ragents/product-runtime.ts";
import { workspaceRuntimeToken } from "../src/ragents/workspace-runtime.ts";
import { sandboxServicesToken } from "../src/plugin-support/workspace-sandbox-host.ts";
import { parseJournalRecord } from "../../../packages/ragents/src/runtime/journal-storage.ts";
import { project } from "../../../packages/ragents/src/domain/projection.ts";

const dataDirectory = await mkdtemp(path.join(tmpdir(), "ragents-overseer-"));
process.env.DATA_DIR = dataDirectory;
process.env.PRODUCT_PROFILE = "core";
process.env.PRODUCT_ID = "test";
process.env.PRODUCT_TITLE = "Test";
process.env.COMPACTION_MODEL = "";
const { RunSessionProvider } = await import("../src/provider.ts");

test("run references survive sorting, deletion and restart; duplicate titles require a short reference", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "ragents-run-directory-"));
  try {
    const file = path.join(root, "references.json");
    const directory = new RunDirectory(file);
    const one = { id: "first-run", title: "Analyse", updatedAt: 1 };
    const two = { id: "second-run", title: "Analyse", updatedAt: 2 };
    assert.deepEqual((await directory.describe([one, two])).map((entry) => entry.reference), ["Lauf 1", "Lauf 2"]);
    assert.deepEqual((await directory.describe([two, one])).map((entry) => entry.reference), ["Lauf 2", "Lauf 1"]);
    await assert.rejects(directory.resolve("Analyse", [one, two]), /mehrdeutig.*Lauf 1.*Lauf 2/);
    assert.equal((await directory.resolve("Lauf 2", [one, two])).id, two.id);
    const restored = new RunDirectory(file);
    assert.equal((await restored.resolve("Analyse", [two])).reference, "Lauf 2");
    await assert.rejects(restored.resolve("Lauf 1", [two]), /unbekannt.*Lauf 2/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("global coordinator persists separately and manages ordinary runs through the normal startup and stop lifecycle", async () => {
  let management: SessionManagement;
  let workspaceResolutions = 0;
  let preparations = 0;
  const createProvider = () => new RunSessionProvider((bridges) => {
    management = bridges.sessions!();
    const host = new PluginHost({ product: { id: "test", title: "Test" }, dataDirectory });
    host.provideHost(sessionManagementToken, () => management);
    host.register({
      manifest: { id: "test.product" },
      register: (registration) => {
        registration.provide(productRuntimeToken, {
          coordinator: { handle: "coordinator", displayName: "Koordinator", profile: "manual", runTitle: "Neuer Run", ownerHandle: "owner", ownerDisplayName: "Owner" },
          roleFor: (view, actor) => view.primaryActorId === actor.id ? "primary" : "worker",
          contract: () => "Product-specific contract",
          promptComposition: "test",
          systemPrompts: () => ({ mode: "fixed", options: [], defaultIds: [], shareDefault: false }),
        });
        registration.provide(workspaceRuntimeToken, {
          describe: () => ({ mode: "test", directoryPattern: dataDirectory }),
          resolve: async () => {
            workspaceResolutions += 1;
            return { cwd: dataDirectory, currentRoot: async () => dataDirectory, runOperation: (operation) => operation() };
          },
        });
        registration.provide(sandboxServicesToken, {
          serverProcessContextFor: async (runId) => ({ runId, cwd: dataDirectory, root: dataDirectory, home: dataDirectory, env: { ...process.env } }),
          registerWorkspaceRoot: () => {},
          execute: async () => null,
          shutdown: async () => {},
        });
        registration.provide(actorProgramsToken, new ActorProgramRuntime({
          runtime: bridges.runtime,
          agentToolsFor: async (runId, actorId, provisional) => {
            const view = bridges.runtime().view(runId);
            const actor = provisional ?? view.actors.find((entry) => entry.id === actorId)!;
            return agentTools.filter((tool) => tool.available(actor, view));
          },
          askService: () => ({ask: async () => {throw new Error("Unexpected question");}}),
          reservedToolNames: () => [],
          serverProcessContextFor: async (runId) => ({runId, cwd: dataDirectory, root: dataDirectory, home: dataDirectory, env: {...process.env}}),
          operations: {list: () => [], operation: () => undefined, invoke: async () => {throw new Error("Unexpected operation");}},
          directoryFor: (runId) => path.join(dataDirectory, "programs", runId),
          scriptSources: () => undefined,
        }));
        registration.script({id: "test.script", create: ({runtime}) => ({driver: new ScriptDriver({runtime})})});
        registration.profiles({
          id: "test.profiles", models: () => [],
          profiles: () => [{ name: "manual", description: "Manual", driver: "manual", turnTimeoutMs: null, isolateWorkspace: false }],
        });
        registration.startOptions({
          id: "test.language", schema: Type.String(), selectable: () => true,
          defaultValue: () => "de", accept: (value) => {
            if (value !== "de" && value !== "en") throw new Error("Gültige Sprachen: de, en");
            return value;
          }, describe: () => ({ options: ["de", "en"] }),
        }, {
          id: "test.machine", schema: Type.String(), selectable: () => true,
          defaultValue: () => "server", accept: (value) => value, describe: () => ({ options: ["server", "workstation"] }),
          ownerOnly: (value) => value === "workstation",
        });
        registration.startEntries({
          id: "test.script", action: "script", title: "Test script", description: "Build a run",
          script: {
            handle: "setup", coordinator: true, files: setupPackageFiles(), programs: [],
          },
        }, {
          id: "test.english", action: "script", title: "English script", description: "Always in English",
          fixedStartOptions: { "test.language": "en" },
          script: {
            handle: "setup", coordinator: true, files: setupPackageFiles(), programs: [],
          },
        }, {
          id: "test.broken", action: "script", title: "Broken script", description: "Fail the compiler",
          script: {
            handle: "broken", coordinator: true, files: setupPackageFiles("this is not typescript"), programs: [],
          },
        });
        registration.lifecycle({ id: "test.lifecycle", prepareSession: () => { preparations += 1; } });
      },
    });
    host.register(plugin.create(host));
    host.seal();
    return host;
  }, undefined);
  let provider = createProvider();
  const call = async <C extends { id: string }>(contract: C, input: unknown, access?: AccessContext): Promise<Record<string, unknown>> => {
    const found = provider.plugins.methods.find(contract.id);
    if (!found) throw new Error(`Die Methode ${contract.id} ist nicht registriert`);
    return await found.contribution.execute(input as never, methodContext(access)) as Record<string, unknown>;
  };
  try {
    await provider.init();
    const global = await provider.get(OVERSEER_RUN_ID);
    global.send("Zeige meine Läufe");
    await (global as { settle(): Promise<void> }).settle();
    const globalView = management!.view(OVERSEER_RUN_ID);
    const primary = globalView.actors.find((actor) => actor.id === globalView.primaryActorId);
    assert.ok(primary && primary.kind === "agent");
    assert.deepEqual(primary.toolNames, provider.plugins.service(globalChatToken).toolNames);
    assert.match(primary.prompt, /übergeordnete Koordinator/);
    assert.equal(workspaceResolutions, 0, "global chat does not allocate a product workspace");
    assert.equal(preparations, 0, "global chat does not prepare product sessions");
    assert.deepEqual(await provider.list(), []);
    await assert.rejects(provider.delete(OVERSEER_RUN_ID), /kann nicht gelöscht/);

    const largeInput = "Analysiere " + "den vollständigen Inhalt. ".repeat(300).trimEnd();
    const created = await call(overseerContracts.createRun, { title: "Analyse", message: largeInput, options: { "test.language": "en" } });
    const runId = created.runId as string;
    assert.equal(created.title, "Analyse");
    assert.equal(created.reference, "Lauf 1");
    assert.equal(created.accepted, true);
    const runView = management!.view(runId);
    assert.ok(runView.inputs.some((input) => input.content === largeInput));
    const runDirectory = path.join(dataDirectory, "runs", runId);
    const payloadFiles = await readdir(path.join(runDirectory, "payloads"));
    assert.ok(payloadFiles.length > 0);
    assert.equal((await readFile(path.join(runDirectory, "journal.jsonl"), "utf8")).includes(largeInput), false);
    assert.equal(provider.startOptions(runId, null)[0].value, "en");
    assert.equal(workspaceResolutions, 1);
    assert.equal((await provider.list()).length, 1);

    const firstPage = await call(overseerContracts.readEvents, { run: "Analyse", limit: 2 });
    assert.equal(firstPage.hasMore, true);
    const nextPage = await call(overseerContracts.readEvents, { run: "Lauf 1", after: firstPage.nextAfter });
    assert.ok((nextPage.events as Array<{ sequence: number }>).every((event) => event.sequence > Number(firstPage.nextAfter)));
    assert.ok((nextPage.events as Array<{ payload: { content?: string } }>).some((event) => event.payload.content === largeInput));
    await call(overseerContracts.sendMessage, { run: "Lauf 1", message: "Prüfe das Ergebnis" });
    assert.ok(management!.view(runId).inputs.some((input) => input.content === "Prüfe das Ergebnis"));
    const stopped = await call(overseerContracts.stopRun, { run: "Analyse" });
    assert.equal(stopped.stopped, true);
    assert.equal(management!.view(runId).primaryActorId, runView.primaryActorId);

    const script = await call(overseerContracts.createRun, { title: "Vorbereiteter Lauf", script: "Test script", input: { topic: "Test" } });
    const scriptView = management!.view(script.runId as string);
    assert.equal(scriptView.title, "Vorbereiteter Lauf");
    assert.ok(scriptView.actors.some((actor) => actor.kind === "script"));
    assert.deepEqual(JSON.parse(scriptView.inputs[0].content).input, { topic: "Test" });
    await assert.rejects(call(overseerContracts.createRun, { title: "Fehler", script: "Missing" }), /Gültige Titel und Kennungen.*Test script/);
    await assert.rejects(call(overseerContracts.createRun, { title: "Fehler", message: "Hi", options: { "test.language": "xx" } }), /Gültige Sprachen/);
    await assert.rejects(call(overseerContracts.createRun, { title: "Compilerfehler", script: "Broken script" }), /Build failed|Expected/);
    await assert.rejects(call(overseerContracts.createRun, { title: "Widerspruch", script: "English script", options: { "test.language": "de" } }), (error: unknown) =>
      error instanceof DomainError && error.code === "start-option-fixed" && error.message.includes("English script"));
    const english = await call(overseerContracts.createRun, { title: "Englisch", script: "English script" });
    assert.equal(provider.startOptions(english.runId as string, null)[0]!.value, "en", "der Einstieg legt die Sprache fest");

    const packageDirectory = path.join(dataDirectory, "own-setup");
    await mkdir(packageDirectory);
    await writeFile(path.join(packageDirectory, "RUN.md"), "---\ntitle: Lokales Paket\ndescription: Eigenes Run-Setup\n---\n");
    for (const file of setupPackageFiles()) {
      const target = path.join(packageDirectory, file.path);
      await mkdir(path.dirname(target), {recursive: true});
      await writeFile(target, file.content);
    }
    const local = await call(overseerContracts.createRun, { title: "Eigener Aufbau", packageDirectory, input: { topic: "Lokal" } });
    const localView = management!.view(local.runId as string);
    assert.equal(localView.title, "Eigener Aufbau");
    assert.ok(localView.actors.some((actor) => actor.kind === "script" && actor.handle === "own-setup"));
    assert.deepEqual(JSON.parse(localView.inputs[0]!.content).input, { topic: "Lokal" });
    assert.ok(!provider.plugins.startEntries.describe().some((entry) => entry.title === "Lokales Paket"));

    const bound = await call(overseerContracts.createRun, { title: "Am Arbeitsplatz", message: "Baue", options: { "test.machine": "workstation" } });
    const admin = createAccessContext({ enabled: true, user: { id: "root", label: "Root", rights: ["*"] } });
    await assert.rejects(call(overseerContracts.sendMessage, { run: bound.reference, message: "Fremder Auftrag" }, admin), (error: unknown) =>
      error instanceof DomainError && error.code === "run-owner-only" && error.status === 403);
    assert.ok(!management!.view(bound.runId as string).inputs.some((input) => input.content === "Fremder Auftrag"));
    assert.equal((await call(overseerContracts.readRun, { run: bound.reference }, admin)).id, bound.runId);
    assert.equal((await call(overseerContracts.stopRun, { run: bound.reference }, admin)).stopped, true);

    const alice = createAccessContext({ enabled: true, user: { id: "alice", label: "Alice", rights: ["runs.read", "runs.write", "runs.create"] } });
    const bob = createAccessContext({ enabled: true, user: { id: "bob", label: "Bob", rights: ["runs.read", "runs.write", "runs.create"] } });
    const ownRuns = [
      await call(overseerContracts.createRun, { title: "Von Alice", message: "Baue" }, alice),
      await call(overseerContracts.createRun, { title: "Script von Alice", script: "Test script" }, alice),
      await call(overseerContracts.createRun, { title: "Paket von Alice", packageDirectory }, alice),
    ];
    for (const own of ownRuns) {
      assert.equal(provider.runOwner(own.runId as string), "alice", `${String(own.title)} gehört dem Aufrufer`);
      assert.equal((await call(overseerContracts.readRun, { run: own.runId }, alice)).id, own.runId);
      await assert.rejects(call(overseerContracts.readRun, { run: own.runId }, bob), (error: unknown) =>
        error instanceof DomainError && error.code === "run-not-found");
    }
    assert.deepEqual((await call(overseerContracts.listRuns, {}, alice) as unknown as Array<{ runId: string }>).map((entry) => entry.runId).sort(),
      ownRuns.map((own) => own.runId as string).sort());
    await call(overseerContracts.sendMessage, { run: ownRuns[0]!.runId, message: "Weiter, Alice" }, alice);
    assert.ok(management!.view(ownRuns[0]!.runId as string).inputs.some((input) => input.content === "Weiter, Alice"));

    await provider.shutdown();
    provider = createProvider();
    await provider.init();
    const restored = await provider.get(OVERSEER_RUN_ID);
    const history: unknown[] = [];
    const unsubscribe = restored.subscribe((event) => history.push(event));
    unsubscribe();
    assert.ok(history.some((event) => (event as { kind: string; text?: string }).kind === "user" && (event as { text: string }).text === "Zeige meine Läufe"));
    assert.ok((await provider.list()).every((run) => run.id !== OVERSEER_RUN_ID));
    assert.equal((await call(overseerContracts.readEvents, { run: "Lauf 1", limit: 1 })).runId, runId);
    assert.ok(management!.view(runId).inputs.some((input) => input.content === largeInput));
    await provider.delete(runId);
    assert.ok((await provider.list()).every((run) => run.id !== runId));
    await provider.deletion(runId);
    const archiveDirectory = path.join(dataDirectory, "archive", runId, "run");
    assert.deepEqual(await readdir(path.join(archiveDirectory, "payloads")), payloadFiles);
    const archivedLines = (await readFile(path.join(archiveDirectory, "journal.jsonl"), "utf8")).trim().split("\n");
    const archivedEvents = archivedLines.flatMap((line, index) => parseJournalRecord(line, archiveDirectory, `archive:${index + 1}`).events);
    assert.ok([...project(archivedEvents)!.inputs.values()].some((input) => input.content === largeInput));
    await assert.rejects(readdir(runDirectory), { code: "ENOENT" });
  } finally {
    await provider.shutdown();
    await rm(dataDirectory, { recursive: true, force: true });
  }
});
