import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import { Type } from "typebox";
import { defineChannel } from "../../../packages/ragents/src/rpc/contract";
import { RpcClient } from "../src/rpc/client";
import { fetchEventStream } from "../src/rpc/event-source";

const fixture = (t: TestContext) => {
  let source: Source;
  class Source extends EventTarget {
    closed = false;
    constructor(readonly url: string) { super(); source = this; }
    close() { this.closed = true; }
    send(type: string, data?: string) { this.dispatchEvent(data === undefined ? new Event(type) : new MessageEvent(type, { data })); }
  }
  const original = Object.getOwnPropertyDescriptor(globalThis, "EventSource");
  Object.defineProperty(globalThis, "EventSource", { value: Source, configurable: true });
  t.after(() => {
    if (original) Object.defineProperty(globalThis, "EventSource", original);
    else Reflect.deleteProperty(globalThis, "EventSource");
  });
  return { source: () => source };
};

test("native SSE carries large channel messages through the shared RPC subscription", async (t) => {
  const f = fixture(t);
  const values: string[] = [];
  const channel = defineChannel({ id: "example.updates", description: "Example updates", rights: [], params: Type.Object({}), message: Type.String() });
  const client = new RpcClient({ fetch: async (input, init) => {
    if (input === "/rpc/stream") return fetchEventStream("/rpc/stream?access=example", init?.signal);
    const request = JSON.parse(String(init?.body));
    assert.equal(new Headers(init?.headers).get("x-ragents-connection"), "connection");
    return Response.json({ jsonrpc: "2.0", id: request.id, result: { subscription: "updates" } });
  } });
  t.after(() => client.close());
  client.subscribe(channel, {}, (value) => { values.push(value); });
  assert.equal(f.source().url, "/rpc/stream?access=example");
  f.source().send("open");
  f.source().send("hello", JSON.stringify({ connection: "connection" }));
  await new Promise(setImmediate);
  for (const text of ["ä".repeat(600_000), "second", "third"]) {
    f.source().send("message", JSON.stringify({ jsonrpc: "2.0", method: "rpc.event", params: { subscription: "updates", channel: channel.id, message: text } }));
  }
  f.source().send("ping", "{}");
  await new Promise(setImmediate);
  assert.deepEqual(values.map((value) => value.length), [600_000, 6, 5]);
  assert.equal(client.status.kind, "connected");
  client.close();
  assert.equal(f.source().closed, true);
});

test("native SSE preserves multiline data and exposes keepalives to the stream reader", async (t) => {
  const f = fixture(t);
  const pending = fetchEventStream("/rpc/stream");
  f.source().send("open");
  const response = await pending;
  assert.equal(response.headers.get("content-type"), "text/event-stream");
  const reader = response.body!.pipeThrough(new TextDecoderStream()).getReader();
  f.source().send("message", "first\nsecond");
  f.source().send("ping", "{}");
  assert.equal((await reader.read()).value, "event: message\ndata: first\ndata: second\n\n");
  assert.equal((await reader.read()).value, "event: ping\ndata: {}\n\n");
  await reader.cancel();
  assert.equal(f.source().closed, true);
});

test("native keepalives prevent the shared RPC idle deadline from reconnecting a healthy stream", async (t) => {
  const f = fixture(t);
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const client = new RpcClient({ fetch: (_input, init) => fetchEventStream("/rpc/stream", init?.signal) });
  t.after(() => client.close());
  client.connect();
  f.source().send("open");
  f.source().send("hello", JSON.stringify({ connection: "connection" }));
  await new Promise(setImmediate);
  for (let ping = 0; ping < 3; ping += 1) {
    t.mock.timers.tick(30_000);
    f.source().send("ping", "{}");
    await new Promise(setImmediate);
  }
  assert.equal(client.status.kind, "connected");
  assert.equal(f.source().closed, false);
});

test("an already aborted native SSE request opens no connection", async (t) => {
  const f = fixture(t);
  const controller = new AbortController();
  controller.abort(new Error("Stopped"));
  await assert.rejects(fetchEventStream("/rpc/stream", controller.signal), /Stopped/);
  assert.equal(f.source(), undefined);
});

test("aborting native SSE before headers rejects the request and closes its connection", async (t) => {
  const f = fixture(t);
  const controller = new AbortController();
  const pending = fetchEventStream("/rpc/stream", controller.signal);
  controller.abort(new Error("Stopped"));
  await assert.rejects(pending, /Stopped/);
  assert.equal(f.source().closed, true);
});

test("native SSE failures and aborts reject pending reads without native reconnection", async (t) => {
  const f = fixture(t);
  for (const failure of ["abort", "error"]) {
    const controller = new AbortController();
    const pending = fetchEventStream("/rpc/stream", controller.signal);
    f.source().send("open");
    const reader = (await pending).body!.getReader();
    const read = reader.read();
    if (failure === "abort") controller.abort(new Error("Stopped"));
    else f.source().send("error");
    await assert.rejects(read, failure === "abort" ? /Stopped/ : /event stream was closed/);
    assert.equal(f.source().closed, true);
    f.source().send("message", "late");
  }
});
