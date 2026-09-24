import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test, { type TestContext } from "node:test";
import { Journal, Orchestration, type RunView } from "@ragents/engine";
import { executionFor, testServices } from "../../../packages/ragents/tests/support.ts";
import {
  assertRunIdFree,
  assertRunStopped,
  assertWorkspaceReplacement,
  installSessionDirectory,
  packRunArchive,
  runTransferSessionDirectory,
  runTransferStagingDirectory,
  unpackRunArchive,
  RUN_TRANSFER_FORMAT_VERSION,
  type RunTransferManifest,
  type RunTransferPlaces,
} from "../src/run-transfer.ts";
import { parseArguments } from "../../../scripts/run-transfer/run-transfer.ts";

const HOST_VERSION = "a".repeat(40);
const EXECUTOR_VERSION = "1";
const RUN_ID = "umzug-run";
const LONG_NOTE = "Ein langer Auftrag. ".repeat(400);

const placesFor = (dataDirectory: string): RunTransferPlaces =>
  ({ dataDirectory, hostVersion: HOST_VERSION, executorVersion: EXECUTOR_VERSION });

const temporaryDirectory = async (t: TestContext, prefix: string): Promise<string> => {
  const directory = await mkdtemp(path.join(tmpdir(), prefix));
  t.after(() => rm(directory, { recursive: true, force: true }));
  return directory;
};

const openJournal = (t: TestContext, dataDirectory: string): Journal => {
  const journal = new Journal(path.join(dataDirectory, "runs"), testServices());
  t.after(() => journal.close());
  return journal;
};

/** Ein Run mit Journal, ausgelagertem Payload, Modellkontext und einer Datei in der Ablage. */
const source = async (t: TestContext): Promise<{ dataDirectory: string; journal: Journal; view: RunView }> => {
  const dataDirectory = await temporaryDirectory(t, "ragents-transfer-source-");
  const journal = openJournal(t, dataDirectory);
  const runtime = new Orchestration(journal, testServices());
  const created = runtime.createRun({ commandId: "create-run" }, { runId: RUN_ID, title: "Umzug", ownerHandle: "owner", ownerDisplayName: "Owner" });
  const spawned = runtime.spawnAgent({ actorId: created.ownerId, commandId: "spawn-worker" }, created.id, {
    handle: "worker",
    displayName: "Worker",
    prompt: "Arbeite den Auftrag ab.",
    execution: executionFor("worker", { profile: "agent", isolateWorkspace: false }),
    grants: [],
    toolNames: null,
  });
  const worker = spawned.actors.find((actor) => actor.kind === "agent");
  assert.ok(worker);
  const view = runtime.enqueueInput({ actorId: created.ownerId, commandId: "input-1" }, created.id, { actorId: worker.id, content: LONG_NOTE });
  const session = runTransferSessionDirectory(dataDirectory, created.id);
  await mkdir(path.join(session, "chat", "coordinator"), { recursive: true });
  await writeFile(path.join(session, "chat", "coordinator", "session.jsonl"), '{"role":"user","content":"Hallo"}\n', "utf8");
  await mkdir(path.join(session, "plugins", "ragents.documents", "documents"), { recursive: true });
  await writeFile(path.join(session, "plugins", "ragents.documents", "documents", "notiz.md"), "# Notiz\n", "utf8");
  await mkdir(path.join(session, "plugins", "ragents.workspace", "workspace"), { recursive: true });
  await writeFile(path.join(session, "plugins", "ragents.workspace", "workspace", "datei.txt"), "Inhalt der Quelle\n", "utf8");
  return { dataDirectory, journal, view };
};

const manifestFor = (journal: Journal, view: RunView, overrides: Partial<RunTransferManifest> = {}): RunTransferManifest => ({
  formatVersion: RUN_TRANSFER_FORMAT_VERSION,
  runId: view.id,
  hostVersion: HOST_VERSION,
  executorVersion: EXECUTOR_VERSION,
  profile: "core",
  title: view.title,
  revision: view.revision,
  events: journal.load(view.id).length,
  boundDirectory: null,
  exportedAt: "2026-09-20T10:00:00.000Z",
  ...overrides,
});

test("ein Run zieht mit Journal, Payloads, Modellkontext und Plugin-Ablagen auf einen zweiten Datenordner um", async (t) => {
  const origin = await source(t);
  const manifest = manifestFor(origin.journal, origin.view);
  assert.ok(existsSync(path.join(origin.dataDirectory, "runs", RUN_ID, "payloads")), "Der lange Auftrag liegt als Payload neben dem Journal");

  const archive = await packRunArchive({ places: placesFor(origin.dataDirectory), runId: RUN_ID, manifest });
  assert.ok(archive.byteLength > 0);
  assert.equal(existsSync(path.join(origin.dataDirectory, "transfer", "manifest.json")), false, "Das Manifest bleibt nicht im Datenordner liegen");

  const targetDirectory = await temporaryDirectory(t, "ragents-transfer-target-");
  const places = placesFor(targetDirectory);
  const staging = runTransferStagingDirectory(targetDirectory, "import");
  const unpacked = await unpackRunArchive({ places, archive, staging });
  assert.equal(unpacked.manifest.runId, RUN_ID);
  assert.equal(unpacked.records.length, origin.journal.records(RUN_ID).length);

  const installed = await installSessionDirectory({ places, runId: RUN_ID, staging, mode: 0o711 });
  assert.equal(installed, runTransferSessionDirectory(targetDirectory, RUN_ID));

  const target = openJournal(t, targetDirectory);
  target.adopt(unpacked.records);
  await rm(staging, { recursive: true, force: true });

  const before = origin.journal.load(RUN_ID);
  const after = target.load(RUN_ID);
  assert.deepEqual(after.map((event) => [event.sequence, event.type]), before.map((event) => [event.sequence, event.type]));
  assert.equal(after.at(-1)?.sequence, before.at(-1)?.sequence);
  assert.equal(target.stateOf(RUN_ID)?.revision, origin.journal.stateOf(RUN_ID)?.revision);
  const enqueued = after.find((event) => event.type === "actor.input.enqueued");
  const original = before.find((event) => event.type === "actor.input.enqueued");
  assert.ok(enqueued && "content" in enqueued.payload && original && "content" in original.payload);
  assert.ok(String(original.payload.content).length > 4096, "Der Auftrag ist groß genug für eine eigene Payload-Datei");
  assert.equal(enqueued.payload.content, original.payload.content, "Der ausgelagerte Payload wird im Ziel wieder aufgelöst");
  assert.ok(existsSync(path.join(targetDirectory, "runs", RUN_ID, "payloads")), "Das Ziel schreibt die Payloads neu");

  const session = runTransferSessionDirectory(targetDirectory, RUN_ID);
  assert.equal(await readFile(path.join(session, "plugins", "ragents.documents", "documents", "notiz.md"), "utf8"), "# Notiz\n");
  assert.equal(await readFile(path.join(session, "plugins", "ragents.workspace", "workspace", "datei.txt"), "utf8"), "Inhalt der Quelle\n");
  assert.equal(await readFile(path.join(session, "chat", "coordinator", "session.jsonl"), "utf8"), '{"role":"user","content":"Hallo"}\n');
});

test("das Ziel lehnt ein Archiv einer anderen Host-Version und eines anderen Executors mit Ursache ab", async (t) => {
  const origin = await source(t);
  const targetDirectory = await temporaryDirectory(t, "ragents-transfer-version-");
  const staging = runTransferStagingDirectory(targetDirectory, "import");

  const foreignHost = await packRunArchive({
    places: placesFor(origin.dataDirectory),
    runId: RUN_ID,
    manifest: manifestFor(origin.journal, origin.view, { hostVersion: "b".repeat(40) }),
  });
  await assert.rejects(unpackRunArchive({ places: placesFor(targetDirectory), archive: foreignHost, staging }), (error: unknown) => {
    assert.ok(error instanceof Error);
    assert.match(error.message, /Host b{40}/);
    assert.match(error.message, /a{40}/);
    return true;
  });

  const foreignExecutor = await packRunArchive({
    places: placesFor(origin.dataDirectory),
    runId: RUN_ID,
    manifest: manifestFor(origin.journal, origin.view, { executorVersion: "9" }),
  });
  await assert.rejects(unpackRunArchive({ places: placesFor(targetDirectory), archive: foreignExecutor, staging }), (error: unknown) => {
    assert.ok(error instanceof Error);
    assert.match(error.message, /Executor 9/);
    return true;
  });
  await rm(staging, { recursive: true, force: true });
});

test("ein Manifest, das nicht zum Journal im Archiv passt, wird abgelehnt", async (t) => {
  const origin = await source(t);
  const targetDirectory = await temporaryDirectory(t, "ragents-transfer-manifest-");
  const archive = await packRunArchive({
    places: placesFor(origin.dataDirectory),
    runId: RUN_ID,
    manifest: manifestFor(origin.journal, origin.view, { events: 99 }),
  });
  const staging = runTransferStagingDirectory(targetDirectory, "import");
  await assert.rejects(unpackRunArchive({ places: placesFor(targetDirectory), archive, staging }), (error: unknown) => {
    assert.ok(error instanceof Error);
    assert.match(error.message, /99 Ereignisse/);
    return true;
  });
});

test("eine belegte Kennung auf dem Ziel bricht den Import ab, bevor etwas angelegt wird", async (t) => {
  const targetDirectory = await temporaryDirectory(t, "ragents-transfer-kollision-");
  const occupied = path.join(targetDirectory, "runs", RUN_ID);
  await mkdir(occupied, { recursive: true });

  assert.throws(() => assertRunIdFree({ runId: RUN_ID, known: false, directories: [occupied] }), (error: unknown) => {
    assert.ok(error instanceof Error);
    assert.match(error.message, new RegExp(`Kennung ${RUN_ID} ist auf diesem Server belegt`));
    return true;
  });
  assert.throws(() => assertRunIdFree({ runId: RUN_ID, known: true, directories: [] }), /gibt es auf diesem Server schon/);
  assert.doesNotThrow(() => assertRunIdFree({ runId: "frei", known: false, directories: [path.join(targetDirectory, "runs", "frei")] }));

  const places = placesFor(targetDirectory);
  const staging = runTransferStagingDirectory(targetDirectory, "import");
  await mkdir(path.join(staging, "sessions", RUN_ID), { recursive: true });
  await mkdir(runTransferSessionDirectory(targetDirectory, RUN_ID), { recursive: true });
  await assert.rejects(installSessionDirectory({ places, runId: RUN_ID, staging, mode: 0o711 }), /gibt es schon/);
});

test("ein Run mit Bindung an einen Projektordner braucht beim Import einen Ersatzordner", async (t) => {
  const origin = await source(t);
  const bound = manifestFor(origin.journal, origin.view, { boundDirectory: "/Users/example/projekt" });
  assert.throws(() => assertWorkspaceReplacement(bound, undefined), (error: unknown) => {
    assert.ok(error instanceof Error);
    assert.match(error.message, /\/Users\/example\/projekt/);
    assert.match(error.message, /Ersatzordner/);
    return true;
  });
  assert.doesNotThrow(() => assertWorkspaceReplacement(bound, "/tmp/ersatz"));
  assert.doesNotThrow(() => assertWorkspaceReplacement(manifestFor(origin.journal, origin.view), undefined));
});

test("der Export verlangt einen ruhenden Run: kein laufender Turn, keine wartende Eingabe", async (t) => {
  const origin = await source(t);
  const state = origin.journal.stateOf(RUN_ID);
  assert.ok(state);
  const stopped = { runId: RUN_ID, state, isRunning: () => false, sessionRunning: false };
  assert.throws(() => assertRunStopped(stopped), /wartende Eingabe/);

  const quiet = { ...state, inputs: new Map() };
  assert.doesNotThrow(() => assertRunStopped({ ...stopped, state: quiet }));
  assert.throws(() => assertRunStopped({ ...stopped, state: quiet, sessionRunning: true }), /arbeitet gerade/);
  assert.throws(() => assertRunStopped({ ...stopped, state: quiet, isRunning: () => true }), /arbeitet gerade \(@worker\)/);
});

test("das Umzugsskript liest Quelle, Ziel, Kennung und den Ersatzordner", () => {
  const plain = parseArguments(["http://a:4723", "http://b:4724", RUN_ID]);
  assert.deepEqual(plain, { sourceUrl: "http://a:4723", targetUrl: "http://b:4724", runId: RUN_ID, workspacePath: undefined });

  const bound = parseArguments(["http://a:4723", "http://b:4724", RUN_ID, "--workspace", "/tmp/projekt"]);
  assert.equal(bound.workspacePath, path.resolve("/tmp/projekt"));

  assert.throws(() => parseArguments(["http://a:4723", RUN_ID]), /Quelle, Ziel und Run-Kennung/);
  assert.throws(() => parseArguments(["http://a", "http://b", RUN_ID, "--workspace"]), /--workspace braucht einen Ordner/);
  assert.throws(() => parseArguments(["--was", "http://a", "http://b", RUN_ID]), /Unbekanntes Argument/);
});
