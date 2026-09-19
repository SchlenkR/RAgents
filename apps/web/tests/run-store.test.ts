import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import { setImmediate } from "node:timers/promises";
import { subscribeRunView } from "../src/RunStore.ts";

interface RpcCall {
  id: number;
  method: string;
  params: Record<string, unknown>;
}

interface PendingRequest {
  method: string;
  resolve: (result: unknown) => void;
  fail: (message: string) => void;
}

function fixture(t: TestContext) {
  const encoder = new TextEncoder();
  const requests: PendingRequest[] = [];
  const timers = new Map<number, () => void>();
  const closers: (() => void)[] = [];
  t.after(() => { for (const close of closers) close(); });
  let timerId = 0;
  let timerCount = 0;
  let deliver: ((chunk: string) => void) | undefined;
  const channels: string[] = [];
  const answer = (id: number, result: unknown) => Response.json({ jsonrpc: "2.0", id, result });
  const stream = () => new ReadableStream<Uint8Array>({
    start(controller) {
      deliver = (chunk) => controller.enqueue(encoder.encode(chunk));
      deliver(`event: hello\ndata: ${JSON.stringify({ connection: "test" })}\n\n`);
    },
  });
  for (const [key, value] of Object.entries({
    window: {
      setTimeout: (callback: () => void) => { timers.set(++timerId, callback); timerCount += 1; return timerId; },
      clearTimeout: (id: number) => { if (timers.delete(id)) timerCount -= 1; },
    },
  })) {
    const previous = Object.getOwnPropertyDescriptor(globalThis, key);
    Object.defineProperty(globalThis, key, { configurable: true, value });
    t.after(() => {
      if (previous) Object.defineProperty(globalThis, key, previous);
      else Reflect.deleteProperty(globalThis, key);
    });
  }
  t.mock.method(globalThis, "fetch", async (url: string, init: RequestInit) => {
    if (String(url).endsWith("/rpc/stream")) return new Response(stream(), { headers: { "content-type": "text/event-stream" } });
    const call = JSON.parse(String(init.body)) as RpcCall;
    if (call.method === "rpc.subscribe") {
      const subscription = `subscription-${call.id}`;
      channels.push(subscription);
      return answer(call.id, { subscription });
    }
    if (call.method === "rpc.unsubscribe") return answer(call.id, null);
    return new Promise<Response>((resolve) => requests.push({
      method: call.method,
      resolve: (result) => resolve(answer(call.id, result)),
      fail: (message) => resolve(Response.json({ jsonrpc: "2.0", id: call.id, error: { code: -32000, message } })),
    }));
  });
  const views: unknown[] = [];
  const errors: (string | undefined)[] = [];
  const conversations: unknown[] = [];
  const settled = async () => { for (let round = 0; round < 12; round++) await setImmediate(); };
  const subscribe = async (id: string, includeConversations = false) => {
    const close = subscribeRunView(id, (view) => views.push(view), (error) => errors.push(error),
      includeConversations ? (value) => conversations.push(value) : undefined);
    closers.push(close);
    await settled();
    return close;
  };
  const emit = async (kind: string, channel = channels.length - 1) => {
    deliver?.(`data: ${JSON.stringify({ jsonrpc: "2.0", method: "rpc.event", params: { subscription: channels[channel], channel: "ragents.run", message: { kind } } })}\n\n`);
    await settled();
  };
  const tick = async () => {
    const callbacks = [...timers.values()];
    timers.clear();
    timerCount = 0;
    for (const callback of callbacks) callback();
    await settled();
  };
  return { requests, views, errors, conversations, subscribe, emit, settled, tick, timers: { get size() { return timerCount; } } };
}

test("langsame Run-Antworten bleiben bei fortlaufenden Kanalereignissen sichtbar", async (t) => {
  const f = fixture(t);
  await f.subscribe("new-run");
  for (let index = 0; index < 12; index++) {
    await f.emit("run");
    await f.tick();
  }
  assert.equal(f.requests.length, 1, "laufende Anfrage wird nicht durch weitere Anfragen überholt");
  f.requests[0]!.resolve({ id: "new-run", revision: 1 });
  await f.settled();
  assert.deepEqual(f.views, [{ id: "new-run", revision: 1 }]);
  assert.equal(f.requests.length, 2, "alle zwischenzeitlichen Ereignisse ergeben eine Folgeanfrage");
  await f.emit("run");
  await f.tick();
  f.requests[1]!.resolve({ id: "new-run", revision: 2 });
  await f.settled();
  assert.equal(f.views.length, 2);
  assert.equal(f.requests.length, 3);
});

test("ein noch nicht gestarteter Run wird auch bei einem frühen ready-Ereignis geladen", async (t) => {
  const f = fixture(t);
  await f.subscribe("new-run");
  await f.emit("ready");
  await f.tick();
  f.requests[0]!.resolve(null);
  await f.settled();
  assert.deepEqual(f.views, [undefined]);
  f.requests[1]!.resolve({ id: "new-run" });
  await f.settled();
  assert.deepEqual(f.views, [undefined, { id: "new-run" }]);
});

test("Abmelden verwirft späte Antworten und bereits eingereihte Kanalereignisse", async (t) => {
  const f = fixture(t);
  const close = await f.subscribe("old-run");
  await f.emit("run");
  close();
  assert.equal(f.timers.size, 0);
  await f.subscribe("new-run");
  f.requests[1]!.resolve({ id: "new-run" });
  await f.settled();
  f.requests[0]!.resolve({ id: "old-run" });
  await f.emit("ready", 0);
  await f.emit("run", 0);
  await f.tick();
  await f.settled();
  assert.deepEqual(f.views, [{ id: "new-run" }]);
  assert.deepEqual(f.errors, [undefined]);
  assert.equal(f.requests.length, 2);
});

test("fehlgeschlagene Run-Abfragen melden den Fehler und erlauben den nächsten Refresh", async (t) => {
  const f = fixture(t);
  await f.subscribe("new-run");
  f.requests[0]!.fail("Nicht erreichbar");
  await f.settled();
  assert.deepEqual(f.views, []);
  assert.deepEqual(f.errors, ["Nicht erreichbar"]);
  await f.emit("run");
  await f.tick();
  f.requests[1]!.resolve({ id: "new-run" });
  await f.settled();
  assert.deepEqual(f.views, [{ id: "new-run" }]);
  assert.equal(f.errors.at(-1), undefined);
});

test("actor histories refresh with run events and discard results after changing runs", async (t) => {
  const f = fixture(t);
  const close = await f.subscribe("trace-run", true);
  f.requests[0]!.resolve({ id: "trace-run", revision: 4 });
  await f.settled();
  assert.equal(f.requests[1]!.method, "ragents.chat.actorHistory");
  const actors = { coordinator: [{ key: "tool", role: "tool", text: "read" }] };
  f.requests[1]!.resolve({ revision: 4, actors });
  await f.settled();
  assert.deepEqual(f.conversations, [actors]);
  assert.equal(f.views.length, 1);
  await f.emit("run");
  await f.tick();
  f.requests[2]!.resolve({ id: "trace-run", revision: 5 });
  await f.settled();
  close();
  f.requests[3]!.resolve({ revision: 5, actors: {} });
  await f.settled();
  assert.deepEqual(f.conversations, [actors]);
  assert.equal(f.views.length, 1);
});

test("actor history failures are visible and do not replace an existing history", async (t) => {
  const f = fixture(t);
  await f.subscribe("trace-run", true);
  f.requests[0]!.resolve({ id: "trace-run", revision: 4 });
  await f.settled();
  f.requests[1]!.fail("Gespräch nicht erreichbar");
  await f.settled();
  assert.deepEqual(f.conversations, []);
  assert.deepEqual(f.errors, ["Gespräch nicht erreichbar"]);
  await f.emit("run");
  await f.tick();
  f.requests[2]!.resolve({ id: "trace-run", revision: 5 });
  await f.settled();
  f.requests[3]!.resolve({ revision: 5, actors: {} });
  await f.settled();
  assert.deepEqual(f.conversations, [{}]);
  assert.equal(f.errors.at(-1), undefined);
});
