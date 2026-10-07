import assert from "node:assert/strict";
import { once } from "node:events";
import { createServer } from "node:http";
import test, { type TestContext } from "node:test";
import { Type } from "typebox";
import {
  ChannelContributionRegistry,
  createAccessContext,
  defineChannel,
  defineOperation,
  DomainError,
  implement,
  implementChannel,
  MethodContributionRegistry,
  RPC_ERROR_CODES,
  RpcError,
} from "@ragents/engine";
import { RpcClient, type RpcClientOptions } from "../../web/src/rpc/client.ts";
import { RpcDispatcher } from "../src/rpc/dispatcher.ts";
import { RpcHttpTransport } from "../src/rpc/http-transport.ts";

const greet = defineOperation({ id: "test.greet", description: "Greets", input: Type.Object({ name: Type.String() }), result: Type.Object({ text: Type.String() }) });
const fail = defineOperation({ id: "test.fail", description: "Fails", input: Type.Object({}), result: Type.Null() });
const slow = defineOperation({ id: "test.slow", description: "Waits", input: Type.Object({}), result: Type.Object({ aborted: Type.Boolean() }) });
const callback = defineOperation({ id: "test.callback", description: "Calls the client", input: Type.Object({ value: Type.String() }), result: Type.Object({ value: Type.String() }) });
const clientEcho = defineOperation({ id: "test.client.echo", description: "The client answers", implementedBy: "client", input: Type.Object({ value: Type.String() }), result: Type.Object({ value: Type.String() }) });
const ticks = defineChannel({ id: "test.ticks", description: "Counts", params: Type.Object({ runId: Type.String() }), message: Type.Object({ tick: Type.Number() }) });

const fixture = async (t: TestContext, options: RpcClientOptions = {}) => {
  const methods = new MethodContributionRegistry();
  const channels = new ChannelContributionRegistry();
  const emitters = new Map<string, (message: { tick: number }) => void>();
  const stopped: string[] = [];
  const slowSignals: AbortSignal[] = [];
  methods.register("test", [
    implement(greet, ({ name }) => ({ text: `Hello ${name}` })),
    implement(fail, () => { throw new DomainError("run-not-found", "No run", 404); }),
    implement(slow, (_input, context) => {
      slowSignals.push(context.signal);
      return new Promise((resolve) => context.signal.addEventListener("abort", () => resolve({ aborted: true })));
    }),
    implement(callback, ({ value }, context) => context.connection.call(clientEcho, { value })),
  ]);
  channels.register("test", [implementChannel(ticks, ({ runId }, emit) => {
    emitters.set(runId, emit);
    emit({ tick: 0 });
    return () => { emitters.delete(runId); stopped.push(runId); };
  })]);
  let unauthorized = false;
  const transport = new RpcHttpTransport({ dispatcher: new RpcDispatcher({ methods, channels }) });
  const server = createServer((request, response) => {
    if (unauthorized) { response.writeHead(401, { "content-type": "application/json" }); response.end(JSON.stringify({ error: "Please sign in.", code: "login-required" })); return; }
    const url = new URL(request.url ?? "/", "http://host");
    void transport.handle(request, response, url, createAccessContext({ enabled: false, user: null }), true);
  });
  t.after(() => { transport.close(); server.closeAllConnections(); server.close(); });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("test server without port");
  const client = new RpcClient({ baseUrl: `http://127.0.0.1:${address.port}`, retryDelayMs: 50, ...options });
  t.after(() => client.close());
  return { client, emitters, stopped, slowSignals, transport, setUnauthorized: (value: boolean) => { unauthorized = value; } };
};

const until = async (condition: () => boolean, timeoutMs = 3000) => {
  const started = Date.now();
  while (!condition()) {
    if (Date.now() - started > timeoutMs) throw new Error("Condition was not met.");
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
};

test("calls, failures and cancellation work without a stream", async (t) => {
  const f = await fixture(t);
  assert.deepEqual(await f.client.call(greet, { name: "Alice" }), { text: "Hello Alice" });
  await assert.rejects(f.client.call(fail, {}), (error: unknown) => error instanceof RpcError && error.domainCode === "run-not-found" && error.status === 404);
  const controller = new AbortController();
  const pending = f.client.call(slow, {}, { signal: controller.signal });
  await new Promise((resolve) => setTimeout(resolve, 30));
  controller.abort();
  await assert.rejects(pending, (error: unknown) => error instanceof RpcError && error.code === RPC_ERROR_CODES.cancelled);
  await until(() => f.slowSignals[0]?.aborted === true);
  assert.equal(f.client.status.kind, "idle");
});

test("subscriptions flow over the stream, survive a reconnect and end with unsubscribe", async (t) => {
  const f = await fixture(t);
  const seen: number[] = [];
  const errors: string[] = [];
  const release = f.client.subscribe(ticks, { runId: "run-1" }, (message) => seen.push(message.tick), (message) => errors.push(message));
  await until(() => seen.length === 1);
  assert.deepEqual(seen, [0]);
  f.emitters.get("run-1")!({ tick: 1 });
  await until(() => seen.length === 2);
  assert.equal(f.client.status.kind, "connected");

  const connections: string[] = [];
  f.client.onConnected(() => connections.push(f.client.connection!));
  f.transport.close();
  await until(() => f.client.status.kind === "retrying");
  assert.ok(errors.length > 0);
  await until(() => f.client.status.kind === "connected" && connections.length === 1);
  await until(() => seen.length === 3);
  assert.deepEqual(seen, [0, 1, 0]);
  release();
  await until(() => f.stopped.length === 2);
  await until(() => f.client.status.kind === "idle");
});

test("the server calls back into the client over the stream", async (t) => {
  const f = await fixture(t);
  const release = f.client.handle(clientEcho, ({ value }) => ({ value: `${value}-pong` }));
  await until(() => f.client.status.kind === "connected");
  assert.deepEqual(await f.client.call(callback, { value: "ping" }), { value: "ping-pong" });
  release();
  await until(() => f.client.status.kind === "idle");
});

test("a 401 stops the stream as unauthorized until connect is called again", async (t) => {
  const f = await fixture(t);
  f.setUnauthorized(true);
  await assert.rejects(f.client.call(greet, { name: "x" }), (error: unknown) => error instanceof RpcError && error.domainCode === "login-required" && error.status === 401);
  f.client.subscribe(ticks, { runId: "r" }, () => undefined);
  await until(() => f.client.status.kind === "unauthorized");
  f.setUnauthorized(false);
  f.client.connect();
  await until(() => f.client.status.kind === "connected");
});

test("a lost stream aborts the handlers still running for the server", async (t) => {
  const f = await fixture(t);
  const aborted: boolean[] = [];
  const release = f.client.handle(clientEcho, (_input, context) => new Promise((resolve) => {
    context.signal.addEventListener("abort", () => { aborted.push(true); resolve({ value: "too late" }); });
  }));
  t.after(release);
  await until(() => f.client.status.kind === "connected");
  void f.client.call(callback, { value: "ping" }).catch(() => undefined);
  await new Promise((resolve) => setTimeout(resolve, 50));
  assert.deepEqual(aborted, []);
  f.transport.close();
  await until(() => aborted.length === 1);
});

test("a stream that stays silent counts as lost and is opened again", async (t) => {
  const opened: number[] = [];
  const server = createServer((request, response) => {
    if (request.url?.startsWith("/rpc/stream")) {
      opened.push(Date.now());
      response.writeHead(200, { "content-type": "text/event-stream" });
      response.write(`event: hello\ndata: ${JSON.stringify({ connection: `silent-${opened.length}` })}\n\n`);
      return;
    }
    response.writeHead(404).end();
  });
  t.after(() => { server.closeAllConnections(); server.close(); });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("test server without port");
  const client = new RpcClient({ baseUrl: `http://127.0.0.1:${address.port}`, retryDelayMs: 20, idleTimeoutMs: 150 });
  const statuses: string[] = [];
  client.onStatus((status) => statuses.push(status.kind === "retrying" ? `retrying: ${status.message}` : status.kind));
  t.after(client.handle(clientEcho, ({ value }) => ({ value })));
  t.after(() => client.close());
  await until(() => opened.length >= 2);
  assert.ok(statuses.some((status) => /^retrying: The event stream has been silent for/.test(status)), statuses.join(", "));
});

for (const withStream of [false, true]) {
  for (const cancellation of ["abort", "timeout"] as const) {
    test(`client ${cancellation} reaches the server handler ${withStream ? "with" : "without"} a stream`, async (t) => {
      const f = await fixture(t, { requestTimeoutMs: 150 });
      if (withStream) {
        t.after(f.client.handle(clientEcho, ({ value }) => ({ value })));
        await until(() => f.client.status.kind === "connected");
      }
      const controller = new AbortController();
      const pending = f.client.call(slow, {}, { signal: controller.signal });
      const rejected = assert.rejects(pending, (error: unknown) => error instanceof RpcError && error.code === (cancellation === "abort" ? RPC_ERROR_CODES.cancelled : RPC_ERROR_CODES.timeout));
      await until(() => f.slowSignals.length === 1);
      assert.equal(f.slowSignals[0]!.aborted, false);
      if (cancellation === "abort") controller.abort();
      await rejected;
      await until(() => f.slowSignals[0]!.aborted);
    });
  }
}

test("stream loss cancels bound POST handlers and requests immediately", async (t) => {
  const f = await fixture(t);
  t.after(f.client.handle(clientEcho, ({ value }) => ({ value })));
  await until(() => f.client.status.kind === "connected");
  const pending = f.client.call(slow, {}, { timeoutMs: null });
  const rejected = assert.rejects(pending, (error: unknown) => error instanceof RpcError && error.code === RPC_ERROR_CODES.connectionClosed);
  await until(() => f.slowSignals.length === 1);
  f.transport.close();
  await rejected;
  assert.equal(f.slowSignals[0]!.aborted, true);
});

test("an explicit client close cancels bound calls while streamless calls remain available", async (t) => {
  const f = await fixture(t);
  const release = f.client.handle(clientEcho, ({ value }) => ({ value }));
  await until(() => f.client.status.kind === "connected");
  const pending = f.client.call(slow, {}, { timeoutMs: null });
  const rejected = assert.rejects(pending, (error: unknown) => error instanceof RpcError && error.code === RPC_ERROR_CODES.connectionClosed);
  await until(() => f.slowSignals.length === 1);
  f.client.close();
  await rejected;
  await until(() => f.slowSignals[0]!.aborted);
  release();
  assert.deepEqual(await f.client.call(greet, { name: "Alice" }), { text: "Hello Alice" });
});

for (const headersReceived of [false, true]) {
  test(`connection timeout covers ${headersReceived ? "waiting for hello" : "waiting for headers"}`, async (t) => {
    let opens = 0;
    let aborts = 0;
    const client = new RpcClient({ connectTimeoutMs: 30, idleTimeoutMs: 1000, retryDelayMs: 10, fetch: async (_input, init) => {
      opens += 1;
      if (headersReceived) return new Response(new ReadableStream({ start(stream) {
        stream.enqueue(new TextEncoder().encode(": ping\n\n"));
        init?.signal?.addEventListener("abort", () => { aborts += 1; stream.close(); });
      } }));
      return new Promise<Response>((_resolve, reject) => init?.signal?.addEventListener("abort", () => { aborts += 1; reject(new Error("Aborted")); }));
    } });
    t.after(() => client.close());
    t.after(client.handle(clientEcho, ({ value }) => ({ value })));
    await until(() => opens >= 2);
    assert.ok(aborts >= 1);
  });
}

const channelFixture = (t: TestContext, subscribe: (channel: string, attempt: number) => unknown) => {
  const attempts = new Map<string, number>();
  const streams: ReadableStreamDefaultController<Uint8Array>[] = [];
  const client = new RpcClient({ retryDelayMs: 30, idleTimeoutMs: 1000, requestTimeoutMs: 100, fetch: async (input, init) => {
    if (String(input).endsWith("/rpc/stream")) return new Response(new ReadableStream({ start(stream) {
      streams.push(stream);
      stream.enqueue(new TextEncoder().encode(`event: hello\ndata: {"connection":"connection-${streams.length}"}\n\n`));
      init?.signal?.addEventListener("abort", () => { try { stream.close(); } catch {} });
    } }));
    const request = JSON.parse(String(init?.body));
    if (request.method === "rpc.subscribe") {
      const channel = request.params.channel as string;
      const attempt = (attempts.get(channel) ?? 0) + 1;
      attempts.set(channel, attempt);
      const outcome = subscribe(channel, attempt);
      return Response.json({ jsonrpc: "2.0", id: request.id, ...(outcome instanceof Error ? { error: { code: -32603, message: outcome.message } } : { result: outcome }) });
    }
    return Response.json({ jsonrpc: "2.0", id: request.id, result: null });
  } });
  t.after(() => client.close());
  const emit = (subscription: string, tick: number) => streams.at(-1)!.enqueue(new TextEncoder().encode(`data: ${JSON.stringify({ jsonrpc: "2.0", method: "rpc.event", params: { subscription, channel: ticks.id, message: { tick } } })}\n\n`));
  return { client, attempts, streams, emit };
};

const otherTicks = defineChannel({ id: "test.otherTicks", description: "Other counts", params: Type.Object({ runId: Type.String() }), message: Type.Object({ tick: Type.Number() }) });

test("a failed channel retries on the same connection and exposes its own error", async (t) => {
  const f = channelFixture(t, (channel, attempt) => channel === ticks.id && attempt === 1 ? new Error("Temporary channel failure") : { subscription: channel });
  const errors: string[] = [];
  const seen: number[] = [];
  t.after(f.client.subscribe(ticks, { runId: "run-1" }, ({ tick }) => seen.push(tick), (message) => errors.push(message)));
  t.after(f.client.subscribe(otherTicks, { runId: "run-1" }, ({ tick }) => seen.push(tick)));
  await until(() => errors.length === 1);
  assert.equal(f.client.status.kind, "connected");
  assert.ok(f.client.status.kind === "connected" && f.client.status.channelErrors?.some((error) => error.channel === ticks.id));
  f.emit(otherTicks.id, 1);
  await until(() => seen.length === 1);
  await until(() => f.attempts.get(ticks.id) === 2 && f.client.status.kind === "connected" && !f.client.status.channelErrors);
  f.emit(ticks.id, 2);
  await until(() => seen.length === 2);
  assert.deepEqual(seen, [1, 2]);
  assert.equal(f.streams.length, 1);
  assert.equal(f.attempts.get(otherTicks.id), 1);
});

test("unsubscribing a failed channel clears its pending retry", async (t) => {
  const f = channelFixture(t, () => new Error("Temporary channel failure"));
  const errors: string[] = [];
  const release = f.client.subscribe(ticks, { runId: "run-1" }, () => undefined, (message) => errors.push(message));
  t.after(f.client.handle(clientEcho, ({ value }) => ({ value })));
  await until(() => errors.length === 1);
  release();
  await new Promise((resolve) => setTimeout(resolve, 80));
  assert.equal(f.attempts.get(ticks.id), 1);
  assert.equal(f.streams.length, 1);
});

test("throwing message and error callbacks preserve healthy channels and stream retries", async (t) => {
  const f = channelFixture(t, (channel) => ({ subscription: channel }));
  const reported: string[] = [];
  const logging = t.mock.method(console, "error", (message: string) => reported.push(message));
  const healthy: number[] = [];
  t.after(f.client.subscribe(ticks, { runId: "run-1" }, () => { throw new Error("Broken callback"); }, () => { throw new Error("Broken error callback"); }));
  t.after(f.client.subscribe(otherTicks, { runId: "run-1" }, ({ tick }) => healthy.push(tick)));
  await until(() => f.attempts.size === 2);
  f.emit(ticks.id, 1);
  f.emit(otherTicks.id, 2);
  await until(() => healthy.length === 1);
  assert.deepEqual(healthy, [2]);
  assert.equal(f.client.status.kind, "connected");
  assert.equal(f.streams.length, 1);
  f.streams[0]!.close();
  await until(() => f.streams.length === 2);
  assert.ok(reported.some((message) => message.includes("Broken error callback")));
  logging.mock.restore();
});

test("explicit close cancels streamless pending calls and permits later requests", async (t) => {
  const f = await fixture(t);
  const pending = f.client.call(slow, {}, { timeoutMs: null });
  const rejected = assert.rejects(pending, (error: unknown) => error instanceof RpcError && error.code === RPC_ERROR_CODES.connectionClosed);
  await until(() => f.slowSignals.length === 1);
  f.client.close();
  await rejected;
  await until(() => f.slowSignals[0]!.aborted);
  assert.deepEqual(await f.client.call(greet, { name: "Alice" }), { text: "Hello Alice" });
});

test("cancellation bypasses a blocked notification without reordering unrelated progress and responses", async (t) => {
  let stream: ReadableStreamDefaultController<Uint8Array> | undefined;
  let finishProgress: (() => void) | undefined;
  const sent: Array<{ id?: number; method?: string; params?: { id?: number } }> = [];
  const client = new RpcClient({ requestTimeoutMs: 300, fetch: async (input, init) => {
    if (String(input).endsWith("/rpc/stream")) return new Response(new ReadableStream({ start(controller) {
      stream = controller;
      controller.enqueue(new TextEncoder().encode('event: hello\ndata: {"connection":"active"}\n\n'));
      init?.signal?.addEventListener("abort", () => { try { controller.close(); } catch {} });
    } }));
    const message = JSON.parse(String(init?.body));
    sent.push(message);
    if (message.method === "rpc.progress" && message.params.id === 100) {
      return new Promise<Response>((resolve) => { finishProgress = () => resolve(new Response(null, { status: 202 })); });
    }
    if (message.method === slow.id) {
      return new Promise<Response>((_resolve, reject) => init?.signal?.addEventListener("abort", () => reject(new Error("Aborted"))));
    }
    return new Response(null, { status: 202 });
  } });
  t.after(() => { finishProgress?.(); client.close(); });
  t.after(client.handle(clientEcho, ({ value }, context) => { context.progress(value); return { value }; }));
  await until(() => client.status.kind === "connected");
  const request = (id: number) => stream!.enqueue(new TextEncoder().encode(`data: ${JSON.stringify({ jsonrpc: "2.0", id, method: clientEcho.id, params: { value: String(id) } })}\n\n`));
  request(100);
  await until(() => finishProgress !== undefined);
  const pending = client.call(slow, {}, { timeoutMs: 40 });
  const rejected = assert.rejects(pending, (error: unknown) => error instanceof RpcError && error.code === RPC_ERROR_CODES.timeout);
  request(101);
  await rejected;
  await until(() => sent.some((message) => message.method === "rpc.cancel"));
  assert.equal(sent.some((message) => message.method === "rpc.progress" && message.params?.id === 101), false);
  assert.equal(sent.some((message) => message.id === 100 && message.method === undefined), false);
  finishProgress!();
  await until(() => sent.some((message) => message.id === 101 && message.method === undefined));
  assert.deepEqual(sent.filter((message) => message.method !== slow.id && message.method !== "rpc.cancel").map((message) => [message.method ?? "response", message.params?.id ?? message.id]), [
    ["rpc.progress", 100], ["response", 100], ["rpc.progress", 101], ["response", 101],
  ]);
});

test("releasing the last stream consumer preserves a streamless request already in flight", async (t) => {
  const f = await fixture(t);
  const controller = new AbortController();
  const pending = f.client.call(slow, {}, { signal: controller.signal, timeoutMs: null });
  const rejected = assert.rejects(pending, (error: unknown) => error instanceof RpcError && error.code === RPC_ERROR_CODES.cancelled);
  await until(() => f.slowSignals.length === 1);
  const release = f.client.handle(clientEcho, ({ value }) => ({ value }));
  await until(() => f.client.status.kind === "connected");
  release();
  assert.equal(f.client.status.kind, "idle");
  assert.equal(f.slowSignals[0]!.aborted, false);
  controller.abort();
  await rejected;
  await until(() => f.slowSignals[0]!.aborted);
});

test("asynchronous subscriber, error, status and connection callbacks cannot tear down the shared stream", async (t) => {
  const f = channelFixture(t, (channel) => ({ subscription: channel }));
  const errors: string[] = [];
  t.mock.method(console, "error", (message: string) => errors.push(message));
  const healthy: number[] = [];
  t.after(f.client.onStatus(async () => { throw new Error("Async status failure"); }));
  t.after(f.client.onConnected(async () => { throw new Error("Async connection failure"); }));
  t.after(f.client.subscribe(ticks, { runId: "run-1" }, async () => { throw new Error("Async message failure"); }, async () => { throw new Error("Async error failure"); }));
  t.after(f.client.subscribe(otherTicks, { runId: "run-1" }, ({ tick }) => healthy.push(tick)));
  await until(() => f.attempts.size === 2);
  f.emit(ticks.id, 1);
  f.emit(otherTicks.id, 2);
  await until(() => healthy.length === 1 && errors.some((message) => message.includes("Async error failure")));
  assert.deepEqual(healthy, [2]);
  assert.equal(f.client.status.kind, "connected");
  assert.equal(f.streams.length, 1);
  f.streams[0]!.close();
  await until(() => f.streams.length === 2);
  assert.ok(errors.some((message) => message.includes("Async status failure")));
  assert.ok(errors.some((message) => message.includes("Async connection failure")));
});

test("a late callback from the old connection cannot answer a new callback with its reused request ID", async (t) => {
  const f = await fixture(t);
  const handlers: Array<{ signal: AbortSignal; finish: () => void }> = [];
  t.after(f.client.handle(clientEcho, ({ value }, context) => new Promise((resolve) => {
    handlers.push({ signal: context.signal, finish: () => resolve({ value }) });
  })));
  await until(() => f.client.status.kind === "connected");
  const oldConnection = f.client.connection;
  const first = f.client.call(callback, { value: "old" }, { timeoutMs: null });
  const firstRejected = assert.rejects(first, (error: unknown) => error instanceof RpcError && error.code === RPC_ERROR_CODES.connectionClosed);
  await until(() => handlers.length === 1);
  f.transport.close();
  await firstRejected;
  await until(() => f.client.status.kind === "connected" && f.client.connection !== oldConnection);
  let secondSettled = false;
  const second = f.client.call(callback, { value: "new" }, { timeoutMs: null });
  void second.then(() => { secondSettled = true; }, () => { secondSettled = true; });
  const secondRejected = assert.rejects(second, (error: unknown) => error instanceof RpcError && error.code === RPC_ERROR_CODES.connectionClosed);
  await until(() => handlers.length === 2);
  handlers[0]!.finish();
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.equal(secondSettled, false, "the old handler cannot satisfy the new callback");
  f.transport.close();
  await secondRejected;
  await until(() => handlers[1]!.signal.aborted);
  handlers[1]!.finish();
});

test("an abort before HTTP dispatch sends no mutation and keeps later requests available", async (t) => {
  const f = await fixture(t);
  const controller = new AbortController();
  const pending = f.client.call(slow, {}, { signal: controller.signal, timeoutMs: null });
  controller.abort();
  await assert.rejects(pending, (error: unknown) => error instanceof RpcError && error.code === RPC_ERROR_CODES.cancelled);
  assert.deepEqual(f.slowSignals, []);
  assert.deepEqual(await f.client.call(greet, { name: "Alice" }), { text: "Hello Alice" });
});

test("a synchronous close from a retry status listener prevents reconnecting retained consumers", async (t) => {
  let opened = 0;
  let closed = false;
  const client = new RpcClient({ retryDelayMs: 20, fetch: async () => { opened += 1; throw new Error("Connection failed"); } });
  t.after(() => client.close());
  t.after(client.onStatus((status) => {
    if (status.kind !== "retrying") return;
    client.close();
    closed = true;
  }));
  t.after(client.handle(clientEcho, ({ value }) => ({ value })));
  await until(() => closed);
  await new Promise((resolve) => setTimeout(resolve, 70));
  assert.equal(client.status.kind, "idle");
  assert.equal(opened, 1, "close clears the owned retry timer even inside the status callback");
});

test("aborting while reading response JSON reports cancellation instead of an HTTP failure", async (t) => {
  let bodyOpened = false;
  const client = new RpcClient({ fetch: async (_input, init) => new Response(new ReadableStream({ start(stream) {
    bodyOpened = true;
    stream.enqueue(new TextEncoder().encode('{"jsonrpc":"2.0",'));
    init?.signal?.addEventListener("abort", () => stream.error(new DOMException("Aborted", "AbortError")));
  } }), { headers: { "content-type": "application/json" } }) });
  t.after(() => client.close());
  const controller = new AbortController();
  const pending = client.call(greet, { name: "Alice" }, { signal: controller.signal });
  await until(() => bodyOpened);
  controller.abort();
  await assert.rejects(pending, (error: unknown) => error instanceof RpcError && error.code === RPC_ERROR_CODES.cancelled);
});
