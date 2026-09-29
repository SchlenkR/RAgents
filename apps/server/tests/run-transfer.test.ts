import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { lstat, mkdir, mkdtemp, readFile, readlink, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test, { type TestContext } from "node:test";
import { DirectoryArtifactContents, Journal, Orchestration, type RunView } from "@ragents/engine";
import { executionFor, testServices } from "../../../packages/ragents/tests/support.ts";
import {
  assertRunIdFree,
  assertRunStopped,
  assertWorkspaceReplacement,
  contentHashesOf,
  installContents,
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
const RUN_ID = "move-run";
const LONG_NOTE = "A long task. ".repeat(400);

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

/** A run with journal, an offloaded payload, a content under artifacts and a file in the storage. */
const source = async (t: TestContext): Promise<{ dataDirectory: string; journal: Journal; view: RunView }> => {
  const dataDirectory = await temporaryDirectory(t, "ragents-transfer-source-");
  const journal = openJournal(t, dataDirectory);
  const runtime = new Orchestration(journal, testServices(), new DirectoryArtifactContents(path.join(dataDirectory, "artifacts")));
  const created = runtime.createRun({ commandId: "create-run" }, { runId: RUN_ID, title: "Move", ownerHandle: "owner", ownerDisplayName: "Owner" });
  const spawned = runtime.spawnAgent({ actorId: created.ownerId, commandId: "spawn-worker" }, created.id, {
    handle: "worker",
    displayName: "Worker",
    prompt: "Work through the task.",
    execution: executionFor("worker", { profile: "agent", isolateWorkspace: false }),
    grants: [],
    toolNames: null,
  });
  const worker = spawned.actors.find((actor) => actor.kind === "agent");
  assert.ok(worker);
  const picture = runtime.publishArtifact({ actorId: created.ownerId, commandId: "publish-picture" }, created.id, {
    title: "image.png", mediaType: "image/png", content: new Uint8Array([1, 2, 3]), previousVersionId: null,
  }).artifacts.at(-1)!;
  const view = runtime.enqueueInput({ actorId: created.ownerId, commandId: "input-1" }, created.id, { actorId: worker.id, content: LONG_NOTE, artifactIds: [picture.id] });
  const session = runTransferSessionDirectory(dataDirectory, created.id);
  await mkdir(path.join(session, "plugins", "ragents.documents", "documents"), { recursive: true });
  await writeFile(path.join(session, "plugins", "ragents.documents", "documents", "note.md"), "# Note\n", "utf8");
  await mkdir(path.join(session, "plugins", "ragents.workspace", "workspace"), { recursive: true });
  await writeFile(path.join(session, "plugins", "ragents.workspace", "workspace", "file.txt"), "Content of the source\n", "utf8");
  await symlink("file.txt", path.join(session, "plugins", "ragents.workspace", "workspace", "link.txt"));
  const programs = path.join(session, "plugins", "ragents.actor-programs", "programs", "actor-workspace", "node_modules");
  await mkdir(path.join(programs, ".bin"), { recursive: true });
  await symlink(path.dirname(dataDirectory), path.join(programs, "react"));
  await symlink(path.join(path.dirname(dataDirectory), "tsc"), path.join(programs, ".bin", "tsc"));
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

test("a run moves to a second data folder with journal, payloads, its contents and plugin storage", async (t) => {
  const origin = await source(t);
  const manifest = manifestFor(origin.journal, origin.view);
  assert.ok(existsSync(path.join(origin.dataDirectory, "runs", RUN_ID, "payloads")), "the long task lies as a payload next to the journal");

  const contentHashes = contentHashesOf(origin.journal.load(RUN_ID));
  assert.equal(contentHashes.length, 1);
  const archive = await packRunArchive({ places: placesFor(origin.dataDirectory), runId: RUN_ID, manifest, contentHashes });
  assert.ok(archive.byteLength > 0);
  assert.equal(existsSync(path.join(origin.dataDirectory, "transfer", "manifest.json")), false, "the manifest does not stay in the data folder");

  const targetDirectory = await temporaryDirectory(t, "ragents-transfer-target-");
  const places = placesFor(targetDirectory);
  const staging = runTransferStagingDirectory(targetDirectory, "import");
  const unpacked = await unpackRunArchive({ places, archive, staging });
  assert.equal(unpacked.manifest.runId, RUN_ID);
  assert.equal(unpacked.records.length, origin.journal.records(RUN_ID).length);

  const installed = await installSessionDirectory({ places, runId: RUN_ID, staging, mode: 0o711 });
  assert.equal(installed, runTransferSessionDirectory(targetDirectory, RUN_ID));
  await installContents({ places, staging });
  assert.deepEqual([...await readFile(path.join(targetDirectory, "artifacts", contentHashes[0]!))], [1, 2, 3]);

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
  assert.ok(String(original.payload.content).length > 4096, "the task is large enough for its own payload file");
  assert.equal(enqueued.payload.content, original.payload.content, "the offloaded payload is resolved again in the target");
  assert.ok(existsSync(path.join(targetDirectory, "runs", RUN_ID, "payloads")), "the target writes the payloads anew");

  const session = runTransferSessionDirectory(targetDirectory, RUN_ID);
  assert.equal(await readFile(path.join(session, "plugins", "ragents.documents", "documents", "note.md"), "utf8"), "# Note\n");
  assert.equal(await readFile(path.join(session, "plugins", "ragents.workspace", "workspace", "file.txt"), "utf8"), "Content of the source\n");
  assert.equal(await readlink(path.join(session, "plugins", "ragents.workspace", "workspace", "link.txt")), "file.txt");
  const programs = path.join(session, "plugins", "ragents.actor-programs", "programs", "actor-workspace", "node_modules");
  assert.equal(existsSync(path.join(programs, "react")), false, "dependencies of this server do not move along, the plugin creates them anew at the target");
  await assert.rejects(lstat(path.join(programs, ".bin", "tsc")), { code: "ENOENT" });
});

test("a link out of the run outside node_modules aborts the export with its path", async (t) => {
  const origin = await source(t);
  const outside = path.join(runTransferSessionDirectory(origin.dataDirectory, RUN_ID), "plugins", "ragents.workspace", "workspace", "foreign");
  await symlink(tmpdir(), outside);
  await assert.rejects(
    packRunArchive({ places: placesFor(origin.dataDirectory), runId: RUN_ID, contentHashes: [], manifest: manifestFor(origin.journal, origin.view) }),
    (error: unknown) => error instanceof Error && (error as { code?: string }).code === "run-transfer-link" && /workspace\/foreign/.test(error.message),
  );
});

test("the target rejects an archive of another host version and another executor with its cause", async (t) => {
  const origin = await source(t);
  const targetDirectory = await temporaryDirectory(t, "ragents-transfer-version-");
  const staging = runTransferStagingDirectory(targetDirectory, "import");

  const foreignHost = await packRunArchive({
    places: placesFor(origin.dataDirectory),
    runId: RUN_ID,
    contentHashes: [],
    manifest: manifestFor(origin.journal, origin.view, { hostVersion: "b".repeat(40) }),
  });
  await assert.rejects(unpackRunArchive({ places: placesFor(targetDirectory), archive: foreignHost, staging }), (error: unknown) => {
    assert.ok(error instanceof Error);
    assert.match(error.message, /host b{40}/);
    assert.match(error.message, /a{40}/);
    return true;
  });

  const foreignExecutor = await packRunArchive({
    places: placesFor(origin.dataDirectory),
    runId: RUN_ID,
    contentHashes: [],
    manifest: manifestFor(origin.journal, origin.view, { executorVersion: "9" }),
  });
  await assert.rejects(unpackRunArchive({ places: placesFor(targetDirectory), archive: foreignExecutor, staging }), (error: unknown) => {
    assert.ok(error instanceof Error);
    assert.match(error.message, /executor 9/);
    return true;
  });
  await rm(staging, { recursive: true, force: true });
});

test("a manifest that does not match the journal in the archive is rejected", async (t) => {
  const origin = await source(t);
  const targetDirectory = await temporaryDirectory(t, "ragents-transfer-manifest-");
  const archive = await packRunArchive({
    places: placesFor(origin.dataDirectory),
    runId: RUN_ID,
    contentHashes: [],
    manifest: manifestFor(origin.journal, origin.view, { events: 99 }),
  });
  const staging = runTransferStagingDirectory(targetDirectory, "import");
  await assert.rejects(unpackRunArchive({ places: placesFor(targetDirectory), archive, staging }), (error: unknown) => {
    assert.ok(error instanceof Error);
    assert.match(error.message, /names 99 events/);
    return true;
  });
});

test("a taken id on the target aborts the import before anything is created", async (t) => {
  const targetDirectory = await temporaryDirectory(t, "ragents-transfer-collision-");
  const occupied = path.join(targetDirectory, "runs", RUN_ID);
  await mkdir(occupied, { recursive: true });

  assert.throws(() => assertRunIdFree({ runId: RUN_ID, known: false, directories: [occupied] }), (error: unknown) => {
    assert.ok(error instanceof Error);
    assert.match(error.message, new RegExp(`The id ${RUN_ID} is taken on this server`));
    return true;
  });
  assert.throws(() => assertRunIdFree({ runId: RUN_ID, known: true, directories: [] }), /already exists on this server/);
  assert.doesNotThrow(() => assertRunIdFree({ runId: "free", known: false, directories: [path.join(targetDirectory, "runs", "free")] }));

  const places = placesFor(targetDirectory);
  const staging = runTransferStagingDirectory(targetDirectory, "import");
  await mkdir(path.join(staging, "sessions", RUN_ID), { recursive: true });
  await mkdir(runTransferSessionDirectory(targetDirectory, RUN_ID), { recursive: true });
  await assert.rejects(installSessionDirectory({ places, runId: RUN_ID, staging, mode: 0o711 }), /already exists/);
});

test("a run bound to a project folder needs a replacement folder when importing", async (t) => {
  const origin = await source(t);
  const bound = manifestFor(origin.journal, origin.view, { boundDirectory: "/Users/example/project" });
  assert.throws(() => assertWorkspaceReplacement(bound, undefined), (error: unknown) => {
    assert.ok(error instanceof Error);
    assert.match(error.message, /\/Users\/example\/project/);
    assert.match(error.message, /replacement folder/);
    return true;
  });
  assert.doesNotThrow(() => assertWorkspaceReplacement(bound, "/tmp/replacement"));
  assert.doesNotThrow(() => assertWorkspaceReplacement(manifestFor(origin.journal, origin.view), undefined));
});

test("the export requires an idle run: no running turn, no pending input", async (t) => {
  const origin = await source(t);
  const state = origin.journal.stateOf(RUN_ID);
  assert.ok(state);
  const stopped = { runId: RUN_ID, state, isRunning: () => false, sessionRunning: false };
  assert.throws(() => assertRunStopped(stopped), /pending input/);

  const quiet = { ...state, inputs: new Map() };
  assert.doesNotThrow(() => assertRunStopped({ ...stopped, state: quiet }));
  assert.throws(() => assertRunStopped({ ...stopped, state: quiet, sessionRunning: true }), /is working right now/);
  assert.throws(() => assertRunStopped({ ...stopped, state: quiet, isRunning: () => true }), /is working right now \(@worker\)/);
});

test("the move script reads source, target, id and the replacement folder", () => {
  const plain = parseArguments(["http://a:4723", "http://b:4724", RUN_ID]);
  assert.deepEqual(plain, { sourceUrl: "http://a:4723", targetUrl: "http://b:4724", runId: RUN_ID, workspacePath: undefined });

  const bound = parseArguments(["http://a:4723", "http://b:4724", RUN_ID, "--workspace", "/tmp/project"]);
  assert.equal(bound.workspacePath, path.resolve("/tmp/project"));

  assert.throws(() => parseArguments(["http://a:4723", RUN_ID]), /Source, target and run id/);
  assert.throws(() => parseArguments(["http://a", "http://b", RUN_ID, "--workspace"]), /--workspace needs a folder/);
  assert.throws(() => parseArguments(["--what", "http://a", "http://b", RUN_ID]), /Unknown argument/);
});
