import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { Type } from "typebox";
import { Value } from "typebox/value";
import { PluginHost, unrestrictedAccess, type JournalEvent, type RunView } from "@aicontainer/ragents";
import { createManagementApi, MANAGEMENT_API_PREFIX, managementHttpReference, managementOpenApi, managementRouteContracts } from "../../../plugins/ragents.overseer/server/http-api.ts";
import { RunDirectory } from "../../../plugins/ragents.overseer/server/run-directory.ts";
import type { ManagedRunStart, SessionManagement } from "../src/ragents/global-chat.ts";

const viewOf = (id: string): RunView => ({ id, revision: 3, title: "Analyse", ownerId: "owner", primaryActorId: "worker", createdAt: "2026-09-07T00:00:00Z", forkedFrom: null, actors: [], inputs: [], turns: [], subscriptions: [], pluginStates: [], actions: [], artifacts: [] });
const eventOf = (sequence: number): JournalEvent => ({
  eventId: `event-${sequence}`, runId: "first", sequence, schemaVersion: 3, occurredAt: "2026-09-07T00:00:00Z", actorId: "worker", commandId: `command-${sequence}`, correlationId: null, causationId: null,
  type: "model.output.completed", payload: { turnId: `turn-${sequence}`, text: `Vollständiger Text ${sequence}` },
});

test("HTTP reference, examples and OpenAPI follow the registered executable contracts", () => {
  const api = managementOpenApi();
  const markdown = managementHttpReference();
  assert.equal(api.openapi, "3.1.0");
  assert.deepEqual(api.security, []);
  assert.match(markdown, /Routenübersicht/);
  assert.match(markdown, /encodeURIComponent\(created.runId\)/);
  assert.match(markdown, /verschachtelte|Verschachtelte/);
  assert.match(markdown, /kein HTTP-SDK/);
  assert.equal([...markdown.matchAll(/node --input-type=module/g)].length, 2);
  for (const route of managementRouteContracts) {
    const entry = api.paths[route.path][route.method.toLowerCase()];
    assert.equal(entry.operationId, route.id);
    assert.deepEqual(entry.responses[route.status].content[route.contentType?.split(";")[0] ?? "application/json"].schema, JSON.parse(JSON.stringify(route.result)));
    if (route.example?.body !== undefined) assert.equal(Value.Check(route.body!, route.example.body), true, route.id);
    if (route.example?.query) assert.equal(Value.Check(route.query, route.example.query), true, route.id);
    assert.ok(markdown.includes(`${route.method} ${MANAGEMENT_API_PREFIX}${route.path}`));
  }
});

test("management HTTP validates requests, resolves references, pages events and awaits accepted work", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "ragents-http-api-"));
  const host = new PluginHost({ product: { id: "test", title: "Test" }, dataDirectory: directory });
  host.register({ manifest: { id: "test" }, register: (registration) => {
    registration.startOptions({ id: "test.language", schema: Type.Union([Type.Literal("de"), Type.Literal("en")]), selectable: () => true, defaultValue: () => "de", accept: (value) => value, describe: (value) => ({ label: value }) });
    registration.startEntries({ id: "test.script", title: "Vorbereitung", description: "Test", action: "script", script: { handle: "setup", coordinator: true, files: [{path: "package.json", content: "{}"}], programs: [] } });
  } });
  const runs: Awaited<ReturnType<SessionManagement["list"]>> = [{ id: "first", title: "Analyse", createdAt: 0, updatedAt: 1 }, { id: "second", title: "Analyse", updatedAt: 2 }];
  const starts: ManagedRunStart[] = [];
  const sends: Array<[string, string]> = [];
  const stops: string[] = [];
  let releaseCreate: (() => void) | undefined;
  let signalCreate: (() => void) | undefined;
  let pauseCreate = false;
  let invalidResult = false;
  const management: SessionManagement = {
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
  const route = createManagementApi(host, () => management, new RunDirectory(path.join(directory, "references.json")));
  const server = createServer((request, response) => {
    const url = new URL(request.url ?? "/", "http://localhost");
    if (!route.matches(request, url)) { response.writeHead(404).end(); return; }
    void route.handle({ request, response, url, access: unrestrictedAccess });
  });
  try {
    await new Promise<void>((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}${MANAGEMENT_API_PREFIX}`;
    const request = async (routePath: string, body?: unknown, method = body === undefined ? "GET" : "POST") => {
      const response = await fetch(base + routePath, { method, headers: { "Content-Type": "application/json" }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
      return { status: response.status, body: await response.json() as any, allow: response.headers.get("Allow") };
    };
    const list = await request("/runs");
    assert.equal(list.status, 200);
    assert.deepEqual(list.body.map((run: { reference: string }) => run.reference), ["Lauf 1", "Lauf 2"]);
    assert.equal((await request("/runs/Analyse")).status, 409);
    assert.equal((await request("/runs/missing")).status, 404);
    assert.equal((await request("/runs/first")).body.id, "first");
    assert.equal((await request("/runs/Lauf%202")).body.id, "second");
    const page = await request("/runs/Lauf%201/events?after=1&limit=1&type=model.output.completed");
    assert.equal(page.status, 200);
    assert.deepEqual(page.body.events, [eventOf(2)]);
    assert.equal(page.body.hasMore, true);
    const finalPage = await request(`/runs/first/events?after=${page.body.nextAfter}&limit=1`);
    assert.deepEqual(finalPage.body.events, [eventOf(3)]);
    assert.equal(finalPage.body.hasMore, false);
    for (const query of ["limit=0", "limit=201", "limit=1.5", "limit=no", "after=-1", "type=made.up", "limit=1&limit=2", "unknown=1", "__proto__=x", "constructor=x"]) {
      assert.equal((await request(`/runs/first/events?${query}`)).status, 400, query);
    }
    assert.equal((await request("/runs/%ZZ/events")).status, 400);
    assert.equal((await request("/runs", undefined, "DELETE")).status, 405);
    assert.equal((await request("/runs", undefined, "DELETE")).allow, "GET, POST");
    for (const body of [{ title: "x" }, { title: "x", message: "hi", script: "test.script" }, { title: "x", message: "hi", input: {} }, { title: " ", message: "hi" }, { title: "x", message: " " }, { title: "x", script: "test.script", packageDirectory: directory }, { title: "x", packageDirectory: "relative" }]) {
      assert.equal((await request("/runs", body)).status, 400, JSON.stringify(body));
    }
    assert.equal(starts.length, 0);
    assert.equal((await request("/runs", { title: "x", script: "missing" })).status, 400);
    pauseCreate = true;
    const entered = new Promise<void>((resolve) => { signalCreate = resolve; });
    let settled = false;
    const creating = request("/runs", { title: "Neuer Auftrag", message: "  Hallo  ", options: { "test.language": "en" } }).then((value) => { settled = true; return value; });
    await entered;
    assert.equal(settled, false, "Response waits for management.create to finish");
    releaseCreate!();
    const created = await creating;
    assert.equal(created.status, 201);
    assert.equal(created.body.accepted, true);
    assert.deepEqual(starts[0], { kind: "message", title: "Neuer Auftrag", message: "Hallo", options: { "test.language": "en" } });
    pauseCreate = false;
    assert.equal((await request("/runs", { title: "Script", script: "Vorbereitung", input: { topic: "Test" } })).status, 201);
    assert.deepEqual(starts[1], { kind: "script", title: "Script", entryId: "test.script", input: { topic: "Test" } });
    assert.equal((await request("/runs", { title: "Paket", packageDirectory: directory, input: { size: 2 } })).status, 201);
    assert.deepEqual(starts[2], { kind: "package", title: "Paket", directory, input: { size: 2 } });
    const send = await request(`/runs/${created.body.runId}/messages`, { message: " Prüfen " });
    assert.equal(send.status, 202);
    assert.deepEqual(sends, [[created.body.runId, "Prüfen"]]);
    assert.equal((await request(`/runs/${created.body.runId}/stop`, {})).status, 200);
    assert.deepEqual(stops, [created.body.runId]);
    const catalog = await request("/catalog");
    assert.equal(catalog.status, 200);
    assert.deepEqual(catalog.body.options[0].schema, JSON.parse(JSON.stringify(host.startOptions.entries()[0].option.schema)));
    assert.equal(catalog.body.options[0].value, "de");
    assert.equal(catalog.body.entries[0].id, "test.script");
    assert.deepEqual((await request("/openapi.json")).body, JSON.parse(JSON.stringify(managementOpenApi())));
    const reference = await fetch(base + "/reference.md");
    assert.match(reference.headers.get("Content-Type")!, /text\/markdown/);
    assert.equal(await reference.text(), managementHttpReference());
    invalidResult = true;
    const broken = await request("/runs");
    assert.equal(broken.status, 500);
    assert.equal(broken.body.code, "invalid-response");
  } finally {
    server.closeAllConnections();
    if (server.listening) await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    await rm(directory, { recursive: true, force: true });
  }
});
