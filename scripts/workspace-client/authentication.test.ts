import assert from "node:assert/strict";
import { tmpdir } from "node:os";
import { setTimeout as delay } from "node:timers/promises";
import test from "node:test";
import { ServerClient } from "../../apps/web/src/server-client.ts";
import { workspaceClientTransport } from "../../plugins/ragents.workspace/client/transport.ts";
import { WorkspaceClient } from "../../plugins/ragents.workspace/client/workspace-client.ts";

const until = async (condition: () => boolean): Promise<void> => {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (condition()) return;
    await delay(10);
  }
  assert.ok(condition(), "Expected client state was not reached");
};

const fixture = () => {
  let generation = 1;
  let credentials = true;
  let registrations = 0;
  let logins = 0;
  const token = () => String(generation).repeat(43);
  const request: typeof fetch = async (input, init) => {
    if (String(input).endsWith("/login")) {
      logins += 1;
      return Response.json({ enabled: true, user: { id: "alice", label: "Alice", rights: [] } }, {
        headers: { "set-cookie": `session=${token()}; HttpOnly` },
      });
    }
    if (new Headers(init?.headers).get("authorization") !== `Bearer ${token()}`) return Response.json({ code: "login-required" }, { status: 401 });
    if (String(input).endsWith("/rpc/stream")) {
      return new Response(new ReadableStream({ start(controller) {
        controller.enqueue(new TextEncoder().encode(`event: hello\ndata: {"connection":"connection-${generation}"}\n\n`));
        init?.signal?.addEventListener("abort", () => controller.close(), { once: true });
      } }), { headers: { "content-type": "text/event-stream" } });
    }
    const message = JSON.parse(String(init?.body)) as { id: string; method: string };
    if (message.method.endsWith("clients.register")) registrations += 1;
    return Response.json({ jsonrpc: "2.0", id: message.id, result: message.method.endsWith("clients.contributions") ? [] : null });
  };
  const transport = new ServerClient("http://example.test", "expired", request, {
    credentials: async () => credentials ? { id: "alice", password: "secret" } : undefined,
  });
  const client = new WorkspaceClient(transport, {
    id: "cli-test-client", label: "Test workstation", hostname: "test", platform: process.platform,
    folders: [tmpdir()], runsDirectory: tmpdir(),
  }, { hostRoot: () => undefined });
  return {
    transport, client, logins: () => logins, registrations: () => registrations,
    expire: (renew: boolean) => {
      credentials = renew;
      generation += 1;
      transport.rpc.close();
      transport.rpc.connect();
    },
  };
};

test("the shared workstation renews credentials and re-registers after each reconnect", async (t) => {
  const { client, transport, expire, registrations, logins } = fixture();
  t.after(async () => { await client.unregister(); transport.rpc.close(); });
  await client.register();
  assert.equal(client.status.kind, "registered");
  assert.equal(registrations(), 1);
  expire(true);
  await until(() => registrations() === 2);
  expire(true);
  await until(() => registrations() === 3);
  assert.equal(logins(), 3);
  assert.equal(client.status.kind, "registered");
});

test("later missing credentials visibly fail an already registered workstation", async (t) => {
  const { client, transport, expire, registrations, logins } = fixture();
  t.after(async () => { await client.unregister(); transport.rpc.close(); });
  await client.register();
  expire(false);
  await until(() => client.status.kind === "failed");
  assert.equal(client.status.kind, "failed");
  if (client.status.kind === "failed") assert.match(client.status.message, /no credentials/);
  assert.equal(registrations(), 1);
  assert.equal(logins(), 1);
});

test("CLI environment credentials never trigger a login on a token-gated server", async (t) => {
  const requested: string[] = [];
  const log = t.mock.method(console, "error", () => undefined);
  t.mock.method(globalThis, "fetch", async (input: Parameters<typeof fetch>[0]) => {
    requested.push(String(input));
    return Response.json({ error: "Access token missing" }, { status: 401 });
  });
  const transport = workspaceClientTransport("http://example.test", undefined, { RAGENTS_USER: "alice", RAGENTS_PASSWORD: "secret" });
  assert.equal((await transport.fetch("/rpc/stream")).status, 401);
  assert.match(transport.signInFailure()!, /Access token required/);
  assert.deepEqual(requested, ["http://example.test/rpc/stream"]);
  assert.equal(log.mock.callCount(), 0);
});

test("CLI silent sign-in logs to stderr without credentials or the session token", async (t) => {
  const log = t.mock.method(console, "error", () => undefined);
  let signedIn = false;
  t.mock.method(globalThis, "fetch", async (input: Parameters<typeof fetch>[0]) => {
    if (String(input).endsWith("/login")) {
      signedIn = true;
      return Response.json({ enabled: true, user: { id: "alice", label: "Alice", rights: [] } }, {
        headers: { "set-cookie": `session=${"a".repeat(43)}; HttpOnly` },
      });
    }
    return Response.json({ code: "login-required" }, { status: signedIn ? 200 : 401 });
  });
  const transport = workspaceClientTransport("http://example.test", undefined, { RAGENTS_USER: "alice", RAGENTS_PASSWORD: "secret" });
  assert.equal((await transport.fetch("/rpc/stream")).status, 200);
  assert.deepEqual(log.mock.calls.map((call) => call.arguments), [["== Signing in to http://example.test with configured credentials"]]);
});
