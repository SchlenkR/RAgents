import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test, { type TestContext } from "node:test";
import { Type } from "typebox";
import { createAccessContext, PluginHost, RPC_ERROR_CODES, type JournalEvent, type RunView } from "@ragents/engine";
import { methodReference, openRpcDocument } from "../src/api/reference.ts";
import { overseerContracts } from "../../../plugins/ragents.overseer/contract.ts";
import { managementMethods } from "../../../plugins/ragents.overseer/server/api.ts";
import { RunDirectory } from "../../../plugins/ragents.overseer/server/run-directory.ts";
import type { ManagedRunStart, RunManagement } from "../src/ragents/global-chat.ts";
import { startRpcServer } from "./rpc-fixture.ts";

const viewOf = (id: string): RunView => ({ id, revision: 3, title: "Analyse", ownerId: "owner", primaryActorId: "worker", createdAt: "2026-09-07T00:00:00Z", forkedFrom: null, actors: [], inputs: [], turns: [], subscriptions: [], pluginStates: [], actions: [], artifacts: [] });
const eventOf = (sequence: number): JournalEvent => ({
  eventId: `event-${sequence}`, runId: "first", sequence, schemaVersion: 3, occurredAt: "2026-09-07T00:00:00Z", actorId: "worker", commandId: `command-${sequence}`, correlationId: null, causationId: null,
  type: "model.output.completed", payload: { turnId: `turn-${sequence}`, text: `Vollständiger Text ${sequence}` },
});
const inspector = createAccessContext({ enabled: true, user: { id: "inspector", label: "Inspector", rights: ["runs.read", "runs.inspect", "runs.write", "runs.create"] } });
const operator = createAccessContext({ enabled: true, user: { id: "operator", label: "Operator", rights: ["runs.read", "runs.write"] } });

const hostWith = async (t: TestContext) => {
  const directory = await mkdtemp(path.join(tmpdir(), "ragents-overseer-api-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const host = new PluginHost({ product: { id: "test", title: "Test" }, dataDirectory: directory });
  host.register({ manifest: { id: "test" }, register: (registration) => {
    registration.startOptions({ id: "test.language", schema: Type.Union([Type.Literal("de"), Type.Literal("en")]), selectable: () => true, defaultValue: () => "de", accept: (value) => value, describe: (value) => ({ label: value }) });
    registration.startEntries({ id: "test.script", title: "Vorbereitung", description: "Test", action: "script", script: { handle: "setup", coordinator: true, files: [{ path: "package.json", content: "{}" }], programs: [] } });
  } });
  return { host, directory };
};

test("reference and OpenRPC follow the registered contracts of methods and channels", async (t) => {
  const { host, directory } = await hostWith(t);
  const methods = managementMethods({
    root: host, management: () => { throw new Error("Die Referenz fragt keine Runs ab"); },
    directory: new RunDirectory(path.join(directory, "references.json")), authentication: { kind: "open" },
  });
  host.methods.register("ragents.overseer", methods);
  const markdown = methodReference(host);
  const document = openRpcDocument(host);
  assert.equal(document.openrpc, "1.3.0");
  assert.match(markdown, /Methodenübersicht/);
  assert.match(markdown, /POST \/rpc/);
  assert.match(markdown, /keine Anmeldung/);
  const described = host.methods.describe();
  assert.equal(described.length, methods.length);
  for (const method of described) {
    assert.ok(markdown.includes(`## ${method.id}`), method.id);
    assert.ok(markdown.includes(method.description), method.id);
    const entry = (document.methods as Array<Record<string, unknown>>).find((candidate) => candidate.name === method.id);
    assert.ok(entry, method.id);
    assert.deepEqual(entry.params, [{ name: "input", required: true, schema: JSON.parse(JSON.stringify(method.input)) }]);
    assert.deepEqual(entry.result, { name: "result", schema: JSON.parse(JSON.stringify(method.result)) });
    assert.deepEqual(entry["x-rights"], [...method.rights]);
  }
  assert.match(methodReference(host, { kind: "token" }), /ACCESS_TOKEN/);
  assert.match(String((openRpcDocument(host, { kind: "users", cookieName: "test-core-user" }).info as { description: string }).description), /Benutzeranmeldung/);
});

test("the management methods validate input, resolve references, page events and await accepted work", async (t) => {
  const { host, directory } = await hostWith(t);
  const runs: Awaited<ReturnType<RunManagement["list"]>> = [{ id: "first", title: "Analyse", createdAt: 0, updatedAt: 1 }, { id: "second", title: "Analyse", updatedAt: 2 }];
  const starts: ManagedRunStart[] = [];
  const sends: Array<[string, string]> = [];
  const stops: string[] = [];
  let releaseCreate: (() => void) | undefined;
  let signalCreate: (() => void) | undefined;
  let pauseCreate = false;
  let invalidResult = false;
  const management: RunManagement = {
    list: async () => invalidResult ? [{ ...runs[0], updatedAt: "wrong" }] as never : runs,
    view: viewOf, events: () => [eventOf(1), eventOf(2), eventOf(3)],
    create: async (start) => {
      starts.push(start);
      if (pauseCreate) { const wait = new Promise<void>((resolve) => { releaseCreate = resolve; }); signalCreate?.(); await wait; }
      const id = `created-${starts.length}`;
      runs.push({ id, title: start.title, updatedAt: 3 });
      return id;
    },
    send: async (id, message) => { sends.push([id, message]); }, stop: async (id) => { stops.push(id); }, resetGlobal: async () => undefined,
  };
  const methods = managementMethods({ root: host, management: () => management, directory: new RunDirectory(path.join(directory, "references.json")), authentication: { kind: "open" } });
  host.methods.register("ragents.overseer", methods);
  const server = await startRpcServer(t, {
    methods,
    accessFor: (request) => request.headers["x-test-operator"] ? operator : inspector,
  });
  const call = (method: string, params: unknown) => server.call(method, params);
  const failure = async (method: string, params: unknown) => {
    const reply = await server.call(method, params);
    assert.ok(reply.error, `${method} sollte scheitern`);
    return { code: reply.error.code, data: reply.error.data as { code?: string; status?: number } | undefined };
  };

  const list = await call(overseerContracts.listRuns.id, {});
  assert.deepEqual((list.result as Array<{ reference: string }>).map((entry) => entry.reference), ["Run 1", "Run 2"]);
  assert.equal((await failure(overseerContracts.readRun.id, { run: "Analyse" })).data?.status, 409);
  assert.equal((await failure(overseerContracts.readRun.id, { run: "missing" })).data?.status, 404);
  assert.equal(((await call(overseerContracts.readRun.id, { run: "first" })).result as RunView).id, "first");
  assert.equal(((await call(overseerContracts.readRun.id, { run: "Run 2" })).result as RunView).id, "second");
  const page = (await call(overseerContracts.readEvents.id, { run: "Run 1", after: 1, limit: 1, type: "model.output.completed" })).result as { events: JournalEvent[]; nextAfter: number; hasMore: boolean };
  assert.deepEqual(page.events, [eventOf(2)]);
  assert.equal(page.hasMore, true);
  const finalPage = (await call(overseerContracts.readEvents.id, { run: "first", after: page.nextAfter, limit: 1 })).result as { events: JournalEvent[]; hasMore: boolean };
  assert.deepEqual(finalPage.events, [eventOf(3)]);
  assert.equal(finalPage.hasMore, false);
  for (const input of [{ limit: 0 }, { limit: 201 }, { limit: 1.5 }, { limit: "no" }, { after: -1 }, { type: "made.up" }, { unknown: 1 }]) {
    assert.equal((await failure(overseerContracts.readEvents.id, { run: "first", ...input })).code, RPC_ERROR_CODES.invalidParams, JSON.stringify(input));
  }
  for (const input of [{ title: "x" }, { title: "x", message: "hi", script: "test.script" }, { title: "x", message: "hi", input: {} }, { title: " ", message: "hi" }, { title: "x", message: " " }, { title: "x", script: "test.script", packageDirectory: directory }]) {
    assert.equal((await failure(overseerContracts.createRun.id, input)).code, RPC_ERROR_CODES.invalidParams, JSON.stringify(input));
  }
  assert.equal((await failure(overseerContracts.createRun.id, { title: "x", packageDirectory: "relative" })).data?.code, "invalid-package-directory");
  assert.equal(starts.length, 0);
  assert.equal((await failure(overseerContracts.createRun.id, { title: "x", script: "missing" })).data?.code, "invalid-script");

  pauseCreate = true;
  const entered = new Promise<void>((resolve) => { signalCreate = resolve; });
  let settled = false;
  const creating = call(overseerContracts.createRun.id, { title: "Neuer Auftrag", message: "  Hallo  ", options: { "test.language": "en" } }).then((value) => { settled = true; return value; });
  await entered;
  assert.equal(settled, false, "Das Ergebnis wartet auf management.create");
  releaseCreate!();
  const created = (await creating).result as { runId: string; accepted: true };
  assert.equal(created.accepted, true);
  assert.deepEqual(starts[0], { kind: "message", title: "Neuer Auftrag", user: { id: "inspector", label: "Inspector" }, message: "Hallo", options: { "test.language": "en" } });
  pauseCreate = false;
  assert.ok((await call(overseerContracts.createRun.id, { title: "Script", script: "Vorbereitung", input: { topic: "Test" } })).result);
  assert.deepEqual(starts[1], { kind: "script", title: "Script", user: { id: "inspector", label: "Inspector" }, entryId: "test.script", input: { topic: "Test" } });
  assert.ok((await call(overseerContracts.createRun.id, { title: "Paket", packageDirectory: directory, input: { size: 2 } })).result);
  assert.deepEqual(starts[2], { kind: "package", title: "Paket", user: { id: "inspector", label: "Inspector" }, directory, input: { size: 2 } });
  assert.ok((await call(overseerContracts.sendMessage.id, { run: created.runId, message: " Prüfen " })).result);
  assert.deepEqual(sends, [[created.runId, "Prüfen"]]);
  assert.ok((await call(overseerContracts.stopRun.id, { run: created.runId })).result);
  assert.deepEqual(stops, [created.runId]);

  const catalog = (await call(overseerContracts.readCatalog.id, {})).result as { entries: Array<{ id: string }>; options: Array<{ schema: unknown; value: unknown }> };
  assert.deepEqual(catalog.options[0].schema, JSON.parse(JSON.stringify(host.startOptions.entries()[0].option.schema)));
  assert.equal(catalog.options[0].value, "de");
  assert.equal(catalog.entries[0].id, "test.script");
  const reference = (await call(overseerContracts.readReference.id, {})).result as string;
  assert.match(reference, new RegExp(`## ${overseerContracts.listRuns.id}`));
  assert.deepEqual((await call(overseerContracts.readOpenRpc.id, {})).result, JSON.parse(JSON.stringify(openRpcDocument(host))));

  for (const method of [overseerContracts.readCatalog.id, overseerContracts.createRun.id]) {
    const restricted = await server.call(method, { title: "x", message: "hi" }, { "x-test-operator": "yes" });
    assert.deepEqual(restricted.error?.data, { code: "access-denied", status: 403 }, method);
  }

  invalidResult = true;
  assert.equal((await failure(overseerContracts.listRuns.id, {})).code, RPC_ERROR_CODES.internal);
});
