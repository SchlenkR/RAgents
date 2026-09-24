import { strict as assert } from "node:assert";
import { test } from "node:test";
import { coreContracts } from "@ragents/host/api/contracts";
import { accessSnapshotFrom, observeAccessExpiry } from "../src/access-session";
import { RpcClient } from "../src/rpc/client";

test("access snapshot accepts optional login and rejects incomplete user rights", () => {
  assert.deepEqual(accessSnapshotFrom({ enabled: false, user: null }), { enabled: false, user: null });
  assert.deepEqual(accessSnapshotFrom({ enabled: true, user: { id: "reader", label: "Lesen", rights: ["runs.read"] } }).user?.rights, ["runs.read"]);
  for (const value of [null, {}, { enabled: true }, { enabled: true, user: {} }, { enabled: true, user: { id: "x", label: "X", rights: [1] } }]) {
    assert.throws(() => accessSnapshotFrom(value));
  }
});

test("access snapshot preserves the allowed setup list and rejects malformed entries", () => {
  const user = { id: "operator", label: "Operator", rights: ["runs.read", "runs.write"], startEntries: ["example.sync"] };
  assert.deepEqual(accessSnapshotFrom({ enabled: true, user }).user, user);
  for (const startEntries of ["example.sync", [3], [""], null]) {
    assert.throws(() => accessSnapshotFrom({ enabled: true, user: { ...user, startEntries } }));
  }
});

test("protected API expiry is observed without consuming its response or changing the request", async () => {
  const response = Response.json({ error: "Bitte einloggen" }, { status: 401 });
  const init: RequestInit = { method: "POST", body: "payload", credentials: "same-origin" };
  let expired = 0;
  const request = observeAccessExpiry(async (input, options) => {
    assert.equal(input, "/rpc");
    assert.equal(options, init);
    return response;
  }, "https://ragents.test", () => { expired++; });
  assert.equal(await request("/rpc", init), response);
  assert.equal(expired, 1);
  assert.deepEqual(await response.json(), { error: "Bitte einloggen" });
});

test("login failure, forbidden rights and external authentication do not expire the app session", async () => {
  let expired = 0;
  for (const [url, status] of [
    ["/api/access/login", 401], ["/api/access/logout", 401], ["/rpc", 403],
    ["https://other.test/api/private", 401], ["/help/reference.md", 401], ["/api/plugins", 200], ["/rpcx", 401],
  ] as const) {
    await observeAccessExpiry(async () => new Response(null, { status }), "https://ragents.test", () => { expired++; })(url);
  }
  assert.equal(expired, 0);
  for (const input of [new URL("https://ragents.test/api/plugins"), new Request("https://ragents.test/rpc/stream"), "/files/runs/run-a/artifacts/a1"]) {
    await observeAccessExpiry(async () => new Response(null, { status: 401 }), "https://ragents.test", () => { expired++; })(input);
  }
  assert.equal(expired, 3);
});

test("an expired login is noticed on the message layer, for a call as for the event stream", async () => {
  let expired = 0;
  const client = new RpcClient({ fetch: observeAccessExpiry(async () => Response.json({ error: "Bitte melde dich an.", code: "login-required" }, { status: 401 }),
    "https://ragents.test", () => { expired++; }) });
  try {
    await assert.rejects(client.call(coreContracts.sessions.list, {}), /Bitte melde dich an/);
    assert.equal(expired, 1);
    const unauthorized = new Promise<void>((resolve) => client.onStatus((status) => { if (status.kind === "unauthorized") resolve(); }));
    client.subscribe(coreContracts.channels.sessions, {}, () => undefined);
    await unauthorized;
    assert.equal(expired, 2);
  } finally {
    client.close();
  }
});
