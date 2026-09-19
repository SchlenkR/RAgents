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
} from "@aicontainer/ragents";
import { RpcClient } from "../../web/src/rpc/client.ts";
import { RpcDispatcher } from "../src/rpc/dispatcher.ts";
import { RpcHttpTransport } from "../src/rpc/http-transport.ts";

const greet = defineOperation({ id: "test.greet", description: "Grüßt", input: Type.Object({ name: Type.String() }), result: Type.Object({ text: Type.String() }) });
const fail = defineOperation({ id: "test.fail", description: "Scheitert", input: Type.Object({}), result: Type.Null() });
const slow = defineOperation({ id: "test.slow", description: "Wartet", input: Type.Object({}), result: Type.Object({ aborted: Type.Boolean() }) });
const callback = defineOperation({ id: "test.callback", description: "Ruft den Client", input: Type.Object({ value: Type.String() }), result: Type.Object({ value: Type.String() }) });
const clientEcho = defineOperation({ id: "test.client.echo", description: "Der Client antwortet", implementedBy: "client", input: Type.Object({ value: Type.String() }), result: Type.Object({ value: Type.String() }) });
const ticks = defineChannel({ id: "test.ticks", description: "Zählt", params: Type.Object({ runId: Type.String() }), message: Type.Object({ tick: Type.Number() }) });

const fixture = async (t: TestContext) => {
  const methods = new MethodContributionRegistry();
  const channels = new ChannelContributionRegistry();
  const emitters = new Map<string, (message: { tick: number }) => void>();
  const stopped: string[] = [];
  methods.register("test", [
    implement(greet, ({ name }) => ({ text: `Hallo ${name}` })),
    implement(fail, () => { throw new DomainError("run-not-found", "Kein Run", 404); }),
    implement(slow, (_input, context) => new Promise((resolve) => context.signal.addEventListener("abort", () => resolve({ aborted: true })))),
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
    if (unauthorized) { response.writeHead(401, { "content-type": "application/json" }); response.end(JSON.stringify({ error: "Bitte melde dich an.", code: "login-required" })); return; }
    const url = new URL(request.url ?? "/", "http://host");
    void transport.handle(request, response, url, createAccessContext({ enabled: false, user: null }), true);
  });
  t.after(() => { transport.close(); server.closeAllConnections(); server.close(); });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Testserver ohne Port");
  const client = new RpcClient({ baseUrl: `http://127.0.0.1:${address.port}`, retryDelayMs: 50 });
  t.after(() => client.close());
  return { client, emitters, stopped, transport, setUnauthorized: (value: boolean) => { unauthorized = value; } };
};

const until = async (condition: () => boolean, timeoutMs = 3000) => {
  const started = Date.now();
  while (!condition()) {
    if (Date.now() - started > timeoutMs) throw new Error("Bedingung wurde nicht erfüllt.");
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
};

test("calls, failures and cancellation work without a stream", async (t) => {
  const f = await fixture(t);
  assert.deepEqual(await f.client.call(greet, { name: "Ronald" }), { text: "Hallo Ronald" });
  await assert.rejects(f.client.call(fail, {}), (error: unknown) => error instanceof RpcError && error.domainCode === "run-not-found" && error.status === 404);
  const controller = new AbortController();
  const pending = f.client.call(slow, {}, { signal: controller.signal });
  await new Promise((resolve) => setTimeout(resolve, 30));
  controller.abort();
  await assert.rejects(pending, (error: unknown) => error instanceof RpcError && error.code === RPC_ERROR_CODES.cancelled);
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
