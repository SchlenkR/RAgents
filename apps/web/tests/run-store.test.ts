import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import { setImmediate } from "node:timers/promises";
import { subscribeRunView } from "../src/RunStore.ts";
import type { ChannelSubscription, EventHubLike } from "../src/events.ts";

function fixture(t: TestContext) {
  const requests: { url: string; resolve: (value: Response) => void }[] = [];
  const sources: Stream[] = [];
  const timers = new Map<number, () => void>();
  const subscriptions: (() => void)[] = [];
  t.after(() => { for (const close of subscriptions) close(); });
  let timerId = 0;
  class Stream {
    closed = false;
    constructor(readonly subscription: ChannelSubscription) { sources.push(this); }
    get url() { return this.subscription.channel; }
    close() { this.closed = true; }
    emit(name: string) { this.subscription.onMessage({ kind: name }); }
    onerror() { this.subscription.onError?.("Die Live-Verbindung zum Server ist unterbrochen"); }
  }
  const hub: EventHubLike = { subscribe: (subscription) => { const stream = new Stream(subscription); return () => stream.close(); } };
  for (const [key, value] of Object.entries({
    window: {
      setTimeout: (callback: () => void) => { timers.set(++timerId, callback); return timerId; },
      clearTimeout: (id: number) => { timers.delete(id); },
    },
  })) {
    const previous = Object.getOwnPropertyDescriptor(globalThis, key);
    Object.defineProperty(globalThis, key, { configurable: true, value });
    t.after(() => {
      if (previous) Object.defineProperty(globalThis, key, previous);
      else Reflect.deleteProperty(globalThis, key);
    });
  }
  t.mock.method(globalThis, "fetch", (url: string) => new Promise<Response>((resolve) => requests.push({ url, resolve })));
  const views: unknown[] = [];
  const errors: (string | undefined)[] = [];
  const conversations: unknown[] = [];
  const subscribe = (id: string, includeConversations = false) => {
    const close = subscribeRunView(id, (view) => views.push(view), (error) => errors.push(error),
      includeConversations ? (value) => conversations.push(value) : undefined, hub);
    subscriptions.push(close);
    return close;
  };
  const tick = () => {
    const callbacks = [...timers.values()];
    timers.clear();
    for (const callback of callbacks) callback();
  };
  return { requests, sources, views, errors, conversations, subscribe, tick, timers };
}

test("langsame Run-Antworten bleiben bei fortlaufenden SSE-Ereignissen sichtbar", async (t) => {
  const f = fixture(t);
  f.subscribe("new-run");
  for (let index = 0; index < 12; index++) {
    f.sources[0]!.emit("run");
    f.tick();
  }
  assert.equal(f.requests.length, 1, "laufende Anfrage wird nicht durch weitere Anfragen überholt");
  f.requests[0]!.resolve(Response.json({ id: "new-run", revision: 1 }));
  await setImmediate();
  assert.deepEqual(f.views, [{ id: "new-run", revision: 1 }]);
  assert.equal(f.requests.length, 2, "alle zwischenzeitlichen Ereignisse ergeben eine Folgeanfrage");
  f.sources[0]!.emit("run");
  f.tick();
  f.requests[1]!.resolve(Response.json({ id: "new-run", revision: 2 }));
  await setImmediate();
  assert.equal(f.views.length, 2);
  assert.equal(f.requests.length, 3);
});

test("ein Run wird nach anfänglichem 404 auch bei einem frühen ready-Ereignis geladen", async (t) => {
  const f = fixture(t);
  f.subscribe("new-run");
  f.sources[0]!.emit("ready");
  f.tick();
  f.requests[0]!.resolve(new Response(null, { status: 404 }));
  await setImmediate();
  assert.deepEqual(f.views, [undefined]);
  f.requests[1]!.resolve(Response.json({ id: "new-run" }));
  await setImmediate();
  assert.deepEqual(f.views, [undefined, { id: "new-run" }]);
});

test("Abmelden verwirft späte Antworten und bereits eingereihte Stream-Ereignisse", async (t) => {
  const f = fixture(t);
  const close = f.subscribe("old-run");
  f.sources[0]!.emit("run");
  close();
  assert.equal(f.sources[0]!.closed, true);
  assert.equal(f.timers.size, 0);
  f.subscribe("new-run");
  f.requests[1]!.resolve(Response.json({ id: "new-run" }));
  await setImmediate();
  f.requests[0]!.resolve(Response.json({ id: "old-run" }));
  f.sources[0]!.emit("ready");
  f.sources[0]!.emit("run");
  f.sources[0]!.onerror();
  f.tick();
  await setImmediate();
  assert.deepEqual(f.views, [{ id: "new-run" }]);
  assert.deepEqual(f.errors, [undefined]);
  assert.equal(f.requests.length, 2);
});

test("fehlgeschlagene Run-Abfragen melden den Fehler und erlauben den nächsten Refresh", async (t) => {
  const f = fixture(t);
  f.subscribe("new-run");
  f.requests[0]!.resolve(Response.json({ error: "Nicht erreichbar" }, { status: 503 }));
  await setImmediate();
  assert.deepEqual(f.views, []);
  assert.deepEqual(f.errors, ["Nicht erreichbar"]);
  f.sources[0]!.emit("run");
  f.tick();
  f.requests[1]!.resolve(Response.json({ id: "new-run" }));
  await setImmediate();
  assert.deepEqual(f.views, [{ id: "new-run" }]);
  assert.equal(f.errors.at(-1), undefined);
});

test("actor histories refresh with run events and discard results after changing runs", async (t) => {
  const f = fixture(t);
  const close = f.subscribe("trace-run", true);
  f.requests[0].resolve(Response.json({ id: "trace-run", revision: 4 }));
  await setImmediate();
  assert.equal(f.requests[1].url, "/chat/trace-run/actors/history");
  const actors = { coordinator: [{ key: "tool", role: "tool", text: "read" }] };
  f.requests[1].resolve(Response.json({ revision: 4, actors }));
  await setImmediate();
  assert.deepEqual(f.conversations, [actors]);
  assert.equal(f.views.length, 1);
  f.sources[0].emit("run");
  f.tick();
  f.requests[2].resolve(Response.json({ id: "trace-run", revision: 5 }));
  await setImmediate();
  close();
  f.requests[3].resolve(Response.json({ revision: 5, actors: {} }));
  await setImmediate();
  assert.deepEqual(f.conversations, [actors]);
  assert.equal(f.views.length, 1);
});

test("actor history failures are visible and do not replace an existing history", async (t) => {
  const f = fixture(t);
  f.subscribe("trace-run", true);
  f.requests[0].resolve(Response.json({ id: "trace-run", revision: 4 }));
  await setImmediate();
  f.requests[1].resolve(Response.json({ error: "Gespräch nicht erreichbar" }, { status: 503 }));
  await setImmediate();
  assert.deepEqual(f.conversations, []);
  assert.deepEqual(f.errors, ["Gespräch nicht erreichbar"]);
  f.sources[0].emit("run");
  f.tick();
  f.requests[2].resolve(Response.json({ id: "trace-run", revision: 5 }));
  await setImmediate();
  f.requests[3].resolve(Response.json({ revision: 5, actors: {} }));
  await setImmediate();
  assert.deepEqual(f.conversations, [{}]);
  assert.equal(f.errors.at(-1), undefined);
});
