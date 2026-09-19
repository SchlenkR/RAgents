import assert from "node:assert/strict";
import { createServer, type IncomingMessage } from "node:http";
import test from "node:test";
import { canStartEntry, createAccessContext, HttpContributionRegistry, unrestrictedAccess, type AccessContext } from "@aicontainer/ragents";
import { runRights } from "../src/api/rights.ts";
import { accessServiceToken, isAccessServiceRequest } from "../src/access-service.ts";

const access = (...rights: string[]): AccessContext => createAccessContext({ enabled: true, user: { id: "user", label: "User", rights } });
const global = { runId: "overseer", read: "ragents.overseer.read", write: "ragents.overseer.write" };

test("run rights follow the kind of access and the global chat uses its own rights", () => {
  assert.deepEqual(runRights("example", "read", undefined), ["runs.read"]);
  assert.deepEqual(runRights("example", "inspect", undefined), ["runs.read", "runs.inspect"]);
  assert.deepEqual(runRights("example", "write", undefined), ["runs.read", "runs.write"]);
  assert.deepEqual(runRights("example", "write-inspect", undefined), ["runs.read", "runs.write", "runs.inspect"]);
  assert.deepEqual(runRights("example", "write", global), ["runs.read", "runs.write"]);
  assert.deepEqual(runRights("overseer", "read", global), [global.read]);
  assert.deepEqual(runRights("overseer", "inspect", global), [global.read, "runs.inspect"]);
  assert.deepEqual(runRights("overseer", "write", global), [global.read, global.write]);
  assert.deepEqual(runRights("overseer", "write-inspect", global), [global.read, global.write, "runs.inspect"]);
  assert.equal(access("runs.*").can("runs.read"), false);
  assert.equal(access("runs.write").can("runs.read"), false);
  assert.equal(access("*").can("extension.custom"), true);
  assert.equal(unrestrictedAccess.can("extension.custom"), true);
  assert.equal(createAccessContext({ enabled: true, user: null }).can("runs.read"), false);
});

test("delivery routes keep their own rights check before the handler runs", async () => {
  const routes = new HttpContributionRegistry();
  let mutations = 0;
  routes.register("example", [{
    id: "ordinary", isApiPath: (path) => path === "/files/example", matches: (_request, url) => url.pathname === "/files/example",
    handle: ({ request, response, access: context }) => {
      if (request.method === "POST") mutations++;
      response.end(JSON.stringify({ user: context.user?.id, mutations }));
    },
  }, {
    id: "custom", isApiPath: (path) => path === "/files/custom", matches: (_request, url) => url.pathname === "/files/custom",
    requiredRights: (request) => request.method === "GET" ? ["example.read"] : ["example.read", "example.write"],
    handle: ({ response, access: context }) => { response.end(JSON.stringify({ allowed: context.can("example.read") })); },
  }]);
  const identities = { reader: access("runs.read"), writer: access("runs.read", "runs.write"), custom: access("example.read"), admin: access("*") };
  const server = createServer(async (request, response) => {
    const url = new URL(request.url!, "http://localhost");
    const current = identities[request.headers["x-test-identity"] as keyof typeof identities] ?? createAccessContext({ enabled: true, user: null });
    if (await routes.dispatch(request, response, url, current)) return;
    response.end("allowed");
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const call = (identity: string, path: string, method = "GET") => fetch(`http://127.0.0.1:${address.port}${path}`, { method, headers: { "x-test-identity": identity } });
  try {
    assert.equal((await call("reader", "/files/example")).status, 200);
    assert.equal((await call("reader", "/files/example", "POST")).status, 403);
    assert.equal(mutations, 0);
    assert.equal((await call("writer", "/files/example", "POST")).status, 200);
    assert.equal(mutations, 1);
    assert.equal((await call("writer", "/files/custom")).status, 403);
    assert.deepEqual(await (await call("custom", "/files/custom")).json(), { allowed: true });
    assert.equal((await call("custom", "/files/custom", "POST")).status, 403);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});

test("the internal service identity is accepted only locally for the message layer and help", () => {
  const request = (address: string, token: string) => ({ socket: { remoteAddress: address }, headers: { authorization: `Bearer ${token}` } }) as IncomingMessage;
  const url = (path: string) => new URL(path, "http://localhost");
  const valid = request("127.0.0.1", accessServiceToken());
  assert.equal(isAccessServiceRequest(valid, url("/rpc")), true);
  assert.equal(isAccessServiceRequest(valid, url("/rpc/stream")), true);
  assert.equal(isAccessServiceRequest(valid, url("/help/llms.txt")), true);
  for (const path of ["/api/access", "/files/runs/example/artifacts/a", "/api/plugins/ragents.overseer/settings"]) assert.equal(isAccessServiceRequest(valid, url(path)), false);
  assert.equal(isAccessServiceRequest(request("203.0.113.7", accessServiceToken()), url("/rpc")), false);
  assert.equal(isAccessServiceRequest(request("127.0.0.1", "legacy-token"), url("/rpc")), false);
});

test("setup approvals replace neither write rights nor free run creation", () => {
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
});
