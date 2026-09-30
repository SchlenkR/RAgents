import assert from "node:assert/strict";
import { setTimeout as delay } from "node:timers/promises";
import test from "node:test";
import { ServerClient } from "../src/server-client.ts";

const user = { id: "alice", label: "Alice", rights: [] };
const token = (generation: number) => String(generation).repeat(43);

const fixture = (options: { missing?: boolean; rejected?: boolean } = {}) => {
  let generation = 1;
  let logins = 0;
  const issued: string[] = [];
  const logs: string[] = [];
  const request: typeof fetch = async (input, init) => {
    const url = String(input);
    if (url.endsWith("/api/access/login")) {
      logins += 1;
      assert.equal(new Headers(init?.headers).get("authorization"), null);
      assert.deepEqual(JSON.parse(String(init?.body)), { id: "alice", password: "private-password" });
      await delay(5);
      return options.rejected
        ? Response.json({ error: "private-password must never be logged" }, { status: 401 })
        : Response.json({ enabled: true, user }, { headers: { "set-cookie": `session=${token(generation)}; HttpOnly` } });
    }
    const authenticated = new Headers(init?.headers).get("authorization") === `Bearer ${token(generation)}`;
    if (url.endsWith("/api/access")) return Response.json({ enabled: true, user: authenticated ? user : null });
    return Response.json(authenticated ? { ok: true } : { error: "Sign-in required", code: "login-required" }, { status: authenticated ? 200 : 401 });
  };
  const client = new ServerClient("http://example.test", "expired", request, {
    credentials: async () => options.missing ? undefined : { id: "alice", password: "private-password" },
    onToken: async (value) => { issued.push(value); },
    log: (line) => logs.push(line),
  });
  return { client, issued, logs, logins: () => logins, expire: () => { generation += 1; } };
};

test("concurrent rejected requests share one sign-in and retry with the renewed token", async () => {
  const { client, issued, logs, logins } = fixture();
  const responses = await Promise.all([client.fetch("/rpc"), client.fetch("/rpc/stream"), client.fetch("/files/example")]);
  assert.deepEqual(responses.map((response) => response.status), [200, 200, 200]);
  assert.equal(logins(), 1);
  assert.deepEqual(issued, [token(1)]);
  assert.deepEqual(logs, ["== Signing in to http://example.test with configured credentials"]);
});

test("every later session expiry renews again", async () => {
  const { client, expire, logs, logins } = fixture();
  assert.equal((await client.fetch("/rpc")).status, 200);
  expire();
  assert.equal((await client.fetch("/rpc")).status, 200);
  expire();
  assert.equal((await client.fetch("/rpc")).status, 200);
  assert.equal(logins(), 3);
  assert.equal(logs.length, 3);
  assert.ok(logs.every((line) => !line.includes("private-password") && !line.includes(token(1))));
});

test("the extension's anonymous access snapshot also signs in through the shared path", async () => {
  const { client, logins } = fixture();
  assert.deepEqual(await client.access(), { enabled: true, user });
  assert.equal(logins(), 1);
});

for (const options of [{ missing: true }, { rejected: true }]) {
  test(`unavailable credentials produce a clear failure without retries or secrets: ${JSON.stringify(options)}`, async () => {
    const { client, logins } = fixture(options);
    assert.equal((await client.fetch("/rpc")).status, 401);
    assert.match(client.signInFailure()!, /Sign-in required/);
    assert.ok(!client.signInFailure()!.includes("private-password"));
    assert.equal(logins(), options.missing ? 0 : 1);
  });
}

test("a server rejecting even the new session is retried only once", async () => {
  let logins = 0;
  const client = new ServerClient("http://example.test", undefined, async (input) => {
    if (String(input).endsWith("/login")) {
      logins += 1;
      return Response.json({ enabled: true, user }, { headers: { "set-cookie": `session=${token(1)}` } });
    }
    return Response.json({ code: "login-required" }, { status: 401 });
  }, { credentials: async () => ({ id: "alice", password: "secret" }) });
  assert.equal((await client.fetch("/rpc")).status, 401);
  assert.equal(logins, 1);
  assert.match(client.signInFailure()!, /rejected the renewed session/);
});

test("closing a request during sign-in does not reopen its stream", async () => {
  const controller = new AbortController();
  let requests = 0;
  const client = new ServerClient("http://example.test", undefined, async (input) => {
    if (String(input).endsWith("/login")) {
      controller.abort();
      return Response.json({ enabled: true, user }, { headers: { "set-cookie": `session=${token(1)}` } });
    }
    requests += 1;
    return Response.json({ code: "login-required" }, { status: 401 });
  }, { credentials: async () => ({ id: "alice", password: "secret" }) });
  await client.fetch("/rpc/stream", { signal: controller.signal });
  assert.equal(requests, 1);
});

for (const endpoint of ["/api/access", "/rpc/stream"]) {
  test(`a token-gated server at ${endpoint} never receives saved credentials`, async () => {
    const requested: string[] = [];
    const logs: string[] = [];
    const client = new ServerClient("http://example.test", "invalid-token", async (input) => {
      requested.push(String(input));
      return endpoint === "/api/access"
        ? Response.json({ error: "Access token missing" }, { status: 401 })
        : new Response("<html>Access token required</html>", { status: 401 });
    }, {
      credentials: async () => { assert.fail("Token gates must not even load saved credentials"); },
      log: (line) => logs.push(line),
    });
    const response = await client.fetch(endpoint);
    assert.equal(response.status, 401);
    assert.match(await response.text(), /Access token/);
    assert.match(client.signInFailure()!, /Access token required.*does not accept automatic user\/password sign-in/);
    assert.deepEqual(requested, [`http://example.test${endpoint}`]);
    assert.deepEqual(logs, []);
  });
}
