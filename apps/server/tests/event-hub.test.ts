import assert from "node:assert/strict";
import { createServer } from "node:http";
import { once } from "node:events";
import test, { type TestContext } from "node:test";
import { createAccessContext, DomainError } from "@aicontainer/ragents";
import { EventHub, type ChannelEmit } from "../src/event-hub.ts";

const fixture = async (t: TestContext) => {
  const hub = new EventHub();
  const listeners = new Map<string, ChannelEmit>();
  const stopped: string[] = [];
  hub.channels(
    {
      id: "sessions",
      matches: (channel) => channel === "sessions",
      requiredRights: () => ["runs.read"],
      open: (channel, emit) => {
        listeners.set(channel, emit);
        emit({ type: "changed" });
        return () => { listeners.delete(channel); stopped.push(channel); };
      },
    },
    {
      id: "run",
      matches: (channel) => channel.startsWith("run:"),
      requiredRights: () => ["runs.read", "runs.inspect"],
      open: async (channel, emit) => {
        if (channel === "run:gone") throw new DomainError("run-deleted", "Die Unterhaltung wurde gelöscht", 410);
        listeners.set(channel, emit);
        return () => { listeners.delete(channel); stopped.push(channel); };
      },
    },
  );
  let user = { id: "reader", label: "Reader", rights: ["runs.read"] };
  const server = createServer((request, response) => {
    void hub.handle(request, response, new URL(request.url ?? "/", "http://host"), createAccessContext({ enabled: true, user }));
  });
  t.after(() => { hub.close(); server.closeAllConnections(); server.close(); });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Testserver ohne Port.");
  const base = `http://127.0.0.1:${address.port}`;
  const connect = async () => {
    const controller = new AbortController();
    const response = await fetch(`${base}/api/events`, { signal: controller.signal });
    assert.equal(response.status, 200);
    assert.match(response.headers.get("content-type")!, /text\/event-stream/);
    const reader = response.body!.pipeThrough(new TextDecoderStream()).getReader();
    let buffered = "";
    const next = async (): Promise<{ event?: string; data: unknown }> => {
      for (;;) {
        const end = buffered.indexOf("\n\n");
        if (end >= 0) {
          const block = buffered.slice(0, end);
          buffered = buffered.slice(end + 2);
          if (block.startsWith(":")) continue;
          const lines = block.split("\n");
          const event = lines.find((line) => line.startsWith("event: "))?.slice(7);
          const data = lines.filter((line) => line.startsWith("data: ")).map((line) => line.slice(6)).join("\n");
          return { ...(event ? { event } : {}), data: JSON.parse(data) };
        }
        const { done, value } = await reader.read();
        if (done) throw new Error("Der Ereignisstrom wurde beendet.");
        buffered += value;
      }
    };
    const hello = await next();
    assert.equal(hello.event, "hello");
    const connection = (hello.data as { connection: string }).connection;
    const subscribe = async (channel: string) => {
      const reply = await fetch(`${base}/api/events/${connection}/subscriptions`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ channel }) });
      return { status: reply.status, body: await reply.json() as Record<string, unknown> };
    };
    const unsubscribe = async (channel: string) => (await fetch(`${base}/api/events/${connection}/subscriptions/${encodeURIComponent(channel)}`, { method: "DELETE" })).status;
    return { controller, connection, next, subscribe, unsubscribe };
  };
  return { hub, base, listeners, stopped, connect, setUser: (value: typeof user) => { user = value; } };
};

test("eine Verbindung bündelt mehrere Kanäle und meldet Kanäle beim Schließen ab", async (t) => {
  const f = await fixture(t);
  const client = await f.connect();
  assert.equal(f.hub.connectionCount(), 1);
  assert.deepEqual(await client.subscribe("sessions"), { status: 200, body: { subscribed: true, channel: "sessions" } });
  assert.deepEqual(await client.next(), { data: { channel: "sessions", data: { type: "changed" } } });
  assert.deepEqual(await client.subscribe("sessions"), { status: 200, body: { subscribed: true, channel: "sessions" } });
  assert.equal(f.listeners.size, 1);
  f.setUser({ id: "reader", label: "Reader", rights: ["runs.read", "runs.inspect"] });
  assert.equal((await client.subscribe("run:one")).status, 200);
  f.listeners.get("run:one")!({ kind: "run" });
  f.listeners.get("sessions")!({ type: "changed" });
  assert.deepEqual(await client.next(), { data: { channel: "run:one", data: { kind: "run" } } });
  assert.deepEqual(await client.next(), { data: { channel: "sessions", data: { type: "changed" } } });
  assert.equal(await client.unsubscribe("run:one"), 200);
  assert.deepEqual(f.stopped, ["run:one"]);
  assert.equal(f.listeners.has("run:one"), false);
  client.controller.abort();
  await new Promise((resolve) => setTimeout(resolve, 50));
  assert.deepEqual(f.stopped, ["run:one", "sessions"]);
  assert.equal(f.hub.connectionCount(), 0);
  assert.equal((await fetch(`${f.base}/api/events/${client.connection}/subscriptions`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ channel: "sessions" }) })).status, 404);
});

test("Abonnements prüfen Kanal, Rechte, Benutzer und Fehler des Anbieters", async (t) => {
  const f = await fixture(t);
  const client = await f.connect();
  assert.deepEqual(await client.subscribe("unknown"), { status: 400, body: { error: "Unbekannter Ereigniskanal: unknown" } });
  assert.deepEqual(await client.subscribe("run:one"), { status: 403, body: { error: "Das Recht runs.inspect fehlt." } });
  assert.equal((await client.subscribe("")).status, 400);
  f.setUser({ id: "reader", label: "Reader", rights: ["runs.read", "runs.inspect"] });
  assert.deepEqual(await client.subscribe("run:gone"), { status: 410, body: { error: "Die Unterhaltung wurde gelöscht" } });
  f.setUser({ id: "other", label: "Other", rights: ["runs.read", "runs.inspect"] });
  assert.equal((await client.subscribe("sessions")).status, 403);
  assert.equal(f.listeners.size, 0);
  assert.equal((await fetch(`${f.base}/api/events`, { method: "POST" })).status, 405);
  client.controller.abort();
});
