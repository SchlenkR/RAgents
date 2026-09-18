import assert from "node:assert/strict";
import { createServer, type IncomingMessage } from "node:http";
import test from "node:test";
import { canStartEntry, createAccessContext, HttpContributionRegistry, unrestrictedAccess } from "@aicontainer/ragents";
import { enforceHostAccess, hostRequiredRights } from "../src/access-policy.ts";
import { accessServiceToken, isAccessServiceRequest } from "../src/access-service.ts";
import { managementOpenApi } from "../../../plugins/ragents.overseer/server/http-api.ts";

const access = (...rights: string[]) => createAccessContext({ enabled: true, user: { id: "test", label: "Test", rights } });
const global = { runId: "overseer", read: "ragents.overseer.read", write: "ragents.overseer.write" };

test("HTTP-Rechte unterscheiden Lesen, Bearbeiten, Löschen und Einstellungen", () => {
  assert.deepEqual(hostRequiredRights("GET", "/chat/sessions"), ["runs.read"]);
  assert.deepEqual(hostRequiredRights("GET", "/chat/sessions/stream"), ["runs.read"]);
  assert.deepEqual(hostRequiredRights("GET", "/api/settings/titles"), ["settings.read"]);
  assert.deepEqual(hostRequiredRights("PUT", "/api/settings/titles"), ["settings.read", "settings.write"]);
  assert.deepEqual(hostRequiredRights("POST", "/chat/example/send"), ["runs.read", "runs.write"]);
  assert.deepEqual(hostRequiredRights("DELETE", "/chat/example"), ["runs.read", "runs.delete"]);
  assert.deepEqual(hostRequiredRights("GET", "/api/settings/skills/example"), ["settings.read"]);
  assert.deepEqual(hostRequiredRights("POST", "/extern"), ["settings.read", "settings.write"]);
  assert.deepEqual(hostRequiredRights("POST", "/ragents/api/runs/example/actions/question/resolve"), ["runs.read", "runs.write"]);
  for (const route of ["/chat/overseer/send", "/chat//overseer/send", "/chat/%6fverseer/send", "/ragents/api/runs/overseer/actors/actor/inputs", "/api/plugins/example/runs/overseer/action"]) {
    assert.deepEqual(hostRequiredRights("POST", route, global), [global.read, global.write], route);
    assert.deepEqual(hostRequiredRights("GET", route, global), [global.read], route);
  }
  assert.equal(access("runs.*").can("runs.read"), false);
  assert.equal(access("runs.write").can("runs.read"), false);
  assert.equal(access("*").can("extension.custom"), true);
  assert.equal(unrestrictedAccess.can("extension.custom"), true);
  assert.equal(createAccessContext({ enabled: true, user: null }).can("runs.read"), false);
});

test("direkte HTTP-Aufrufe können Host- und Extension-Schreibschutz nicht umgehen", async () => {
  const routes = new HttpContributionRegistry();
  let mutations = 0;
  routes.register("example", [{
    id: "ordinary", isApiPath: (path) => path === "/api/example", matches: (_request, url) => url.pathname === "/api/example",
    handle: ({ request, response, access: context }) => {
      if (request.method === "POST") mutations++;
      response.end(JSON.stringify({ user: context.user?.id, mutations }));
    },
  }, {
    id: "custom", isApiPath: (path) => path === "/api/custom", matches: (_request, url) => url.pathname === "/api/custom",
    requiredRights: (request) => request.method === "GET" ? ["example.read"] : ["example.read", "example.write"],
    handle: ({ response, access: context }) => { response.end(JSON.stringify({ allowed: context.can("example.read") })); },
  }]);
  const identities = { reader: access("runs.read"), writer: access("runs.read", "runs.write"), custom: access("example.read"), admin: access("*") };
  const server = createServer(async (request, response) => {
    const url = new URL(request.url!, "http://localhost");
    const current = identities[request.headers["x-test-identity"] as keyof typeof identities] ?? createAccessContext({ enabled: true, user: null });
    if (enforceHostAccess(request, response, url, current, global)) return;
    if (await routes.dispatch(request, response, url, current)) return;
    response.end("allowed");
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const call = (identity: string, path: string, method = "GET") => fetch(`http://127.0.0.1:${address.port}${path}`, { method, headers: { "x-test-identity": identity } });
  try {
    assert.equal((await call("reader", "/api/example")).status, 200);
    assert.equal((await call("reader", "/api/example", "POST")).status, 403);
    assert.equal(mutations, 0);
    assert.equal((await call("writer", "/api/example", "POST")).status, 200);
    assert.equal(mutations, 1);
    assert.equal((await call("writer", "/api/custom")).status, 403);
    assert.deepEqual(await (await call("custom", "/api/custom")).json(), { allowed: true });
    assert.equal((await call("custom", "/api/custom", "POST")).status, 403);
    assert.equal((await call("reader", "/api/settings")).status, 403);
    assert.equal((await call("writer", "/chat/example", "DELETE")).status, 403);
    assert.equal((await call("admin", "/chat/example", "DELETE")).status, 200);
    assert.equal((await call("writer", "/chat//overseer/send", "POST")).status, 403);
    assert.equal((await call("reader", "/ragents/api/runs/overseer/events")).status, 403);
    assert.equal((await call("reader", "/chat/%ZZ/run")).status, 400);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});

test("interne Dienstidentität gilt nur lokal für Management und Hilfe", () => {
  const request = (address: string, token: string) => ({ socket: { remoteAddress: address }, headers: { authorization: `Bearer ${token}` } }) as IncomingMessage;
  const url = (path: string) => new URL(path, "http://localhost");
  const valid = request("127.0.0.1", accessServiceToken());
  assert.equal(isAccessServiceRequest(valid, url("/api/plugins/ragents.overseer/runs")), true);
  assert.equal(isAccessServiceRequest(valid, url("/help/llms.txt")), true);
  for (const path of ["/api/settings", "/api/access", "/chat/overseer/send", "/ragents/api/runs/example", "/api/plugins/ragents.overseer/settings", "/api/plugins/ragents.overseer/reset"]) assert.equal(isAccessServiceRequest(valid, url(path)), false);
  assert.equal(isAccessServiceRequest(request("203.0.113.7", accessServiceToken()), url("/api/plugins/ragents.overseer/runs")), false);
  assert.equal(isAccessServiceRequest(request("127.0.0.1", "legacy-token"), url("/api/plugins/ragents.overseer/runs")), false);
});

test("OpenAPI gibt den tatsächlichen Anmeldemodus und dieselben Routenrechte aus", () => {
  assert.deepEqual(managementOpenApi().security, []);
  assert.deepEqual(managementOpenApi({ kind: "token" }).security, [{ bearerAuth: [] }]);
  const schema = managementOpenApi({ kind: "users", cookieName: "product-profile-user" });
  assert.deepEqual(schema.security, [{ userSession: [] }]);
  assert.deepEqual(schema.components.securitySchemes.userSession, { type: "apiKey", in: "cookie", name: "product-profile-user" });
  assert.deepEqual(schema.paths["/runs"].get["x-required-rights"], ["runs.read"]);
  assert.deepEqual(schema.paths["/runs"].post["x-required-rights"], ["runs.read", "runs.write", "runs.create"]);
});


test("Setup-Freigaben ersetzen weder Schreibrechte noch freie Run-Erstellung", () => {
  const operator = createAccessContext({ enabled: false, user: { id: "operator", label: "Operator", rights: ["runs.read", "runs.write"], startEntries: ["example.allowed"] } });
  assert.equal(operator.can("runs.create"), false);
  assert.equal(operator.can("settings.read"), false);
  assert.equal(canStartEntry(operator, "example.allowed"), true);
  assert.equal(canStartEntry(operator, "example.other"), false);
  assert.equal(canStartEntry(access("runs.read"), "example.allowed"), false);
  assert.equal(canStartEntry(access("runs.create"), "example.allowed"), false);
  assert.equal(canStartEntry(access("runs.write", "runs.create"), "example.other"), true);
  assert.equal(canStartEntry(access("*"), "example.other"), true);
  assert.equal(canStartEntry(unrestrictedAccess, "example.other"), true);
  assert.deepEqual(hostRequiredRights("POST", "/chat/example/prepare"), ["runs.read", "runs.write", "runs.create"]);
  assert.deepEqual(hostRequiredRights("GET", "/chat/example/options"), ["runs.read", "runs.create", "runs.inspect"]);
  assert.deepEqual(hostRequiredRights("PUT", "/chat/example/options/ragents.model"), ["runs.read", "runs.write", "runs.create", "runs.inspect"]);
  assert.deepEqual(hostRequiredRights("GET", "/ragents/api/runs/example/events"), ["runs.read", "runs.inspect"]);
});
