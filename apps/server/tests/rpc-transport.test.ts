import assert from "node:assert/strict";
import { once } from "node:events";
import { createServer } from "node:http";
import { PassThrough } from "node:stream";
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
  RPC_METHODS,
  type RpcMessage,
} from "@ragents/engine";
import { RpcDispatcher } from "../src/rpc/dispatcher.ts";
import { RPC_CONNECTION_HEADER, RpcHttpTransport } from "../src/rpc/http-transport.ts";
import { startStdioTransport } from "../src/rpc/stdio-transport.ts";

const greet = defineOperation({
  id: "test.greet",
  description: "Grüßt",
  rights: ["runs.read"],
  input: Type.Object({ name: Type.String() }, { additionalProperties: false }),
  result: Type.Object({ text: Type.String() }),
});
const secret = defineOperation({
  id: "test.secret",
  description: "Nur für Schreiber",
  rights: ["runs.write"],
  input: Type.Object({}),
  result: Type.Null(),
});
const broken = defineOperation({
  id: "test.broken",
  description: "Verletzt den eigenen Vertrag",
  input: Type.Object({}),
  result: Type.Object({ number: Type.Number() }),
});
const echoBack = defineOperation({
  id: "test.client.echo",
  description: "Der Client antwortet",
  implementedBy: "client",
  input: Type.Object({ value: Type.String() }),
  result: Type.Object({ value: Type.String() }),
});
const ticks = defineChannel({
  id: "test.ticks",
  description: "Zählt",
  rights: ["runs.read"],
  params: Type.Object({ runId: Type.String() }),
  message: Type.Object({ tick: Type.Number() }),
});

const fixture = () => {
  const methods = new MethodContributionRegistry();
  const channels = new ChannelContributionRegistry();
  const emitters = new Map<string, (message: { tick: number }) => void>();
  const stopped: string[] = [];
  let echoed: unknown;
  methods.register("test", [
    implement(greet, ({ name }) => ({ text: `Hallo ${name}` })),
    implement(secret, () => null),
    implement(broken, () => ({ number: "keine Zahl" } as unknown as { number: number })),
    implement(defineOperation({ id: "test.fail", description: "Scheitert", input: Type.Object({}), result: Type.Null() }), () => { throw new DomainError("run-not-found", "Kein Run", 404); }),
    implement(defineOperation({ id: "test.callback", description: "Ruft den Client", input: Type.Object({}), result: Type.Object({ value: Type.String() }) }), async (_input, context) => {
      echoed = await context.connection.call(echoBack, { value: "ping" });
      return echoed as { value: string };
    }),
    implement(defineOperation({ id: "test.slow", description: "Wartet auf Abbruch", input: Type.Object({}), result: Type.Object({ aborted: Type.Boolean() }) }), (_input, context) =>
      new Promise((resolve) => { context.progress("läuft"); context.signal.addEventListener("abort", () => resolve({ aborted: true })); })),
  ]);
  channels.register("test", [implementChannel(ticks, ({ runId }, emit) => {
    emitters.set(runId, emit);
    emit({ tick: 0 });
    return () => { emitters.delete(runId); stopped.push(runId); };
  })]);
  return { dispatcher: new RpcDispatcher({ methods, channels }), emitters, stopped, echoed: () => echoed };
};

const reader = createAccessContext({ enabled: true, user: { id: "reader", label: "Reader", rights: ["runs.read"] } });

const httpFixture = async (t: TestContext) => {
  const f = fixture();
  const transport = new RpcHttpTransport({ dispatcher: f.dispatcher });
  const server = createServer((request, response) => {
    const url = new URL(request.url ?? "/", "http://host");
    void transport.handle(request, response, url, reader, true).then((handled) => { if (!handled) { response.writeHead(404); response.end(); } });
  });
  t.after(() => { transport.close(); server.closeAllConnections(); server.close(); });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Testserver ohne Port");
  const base = `http://127.0.0.1:${address.port}`;
  const post = async (message: unknown, connection?: string) => {
    const response = await fetch(`${base}/rpc`, {
      method: "POST",
      headers: { "content-type": "application/json", ...(connection ? { [RPC_CONNECTION_HEADER]: connection } : {}) },
      body: JSON.stringify(message),
    });
    return { status: response.status, body: response.status === 202 ? undefined : await response.json() as RpcMessage };
  };
  const stream = async () => {
    const controller = new AbortController();
    const response = await fetch(`${base}/rpc/stream`, { signal: controller.signal });
    const lines = response.body!.pipeThrough(new TextDecoderStream()).getReader();
    let buffered = "";
    const next = async (): Promise<{ event?: string; data: unknown }> => {
      for (;;) {
        const end = buffered.indexOf("\n\n");
        if (end >= 0) {
          const block = buffered.slice(0, end);
          buffered = buffered.slice(end + 2);
          if (block.startsWith(":")) continue;
          const event = block.match(/^event: (.+)$/m)?.[1];
          const data = block.match(/^data: (.+)$/m)?.[1];
          return { event, data: data === undefined ? undefined : JSON.parse(data) };
        }
        const chunk = await lines.read();
        if (chunk.done) throw new Error("Strom beendet");
        buffered += chunk.value;
      }
    };
    const hello = await next();
    assert.equal(hello.event, "hello");
    return { connection: (hello.data as { connection: string }).connection, next, close: () => controller.abort() };
  };
  return { ...f, transport, base, post, stream };
};

test("http: requests are answered with JSON-RPC results, failures and rights checks", async (t) => {
  const f = await httpFixture(t);
  assert.deepEqual((await f.post({ jsonrpc: "2.0", id: 1, method: "test.greet", params: { name: "Alice" } })).body, { jsonrpc: "2.0", id: 1, result: { text: "Hallo Alice" } });
  const denied = (await f.post({ jsonrpc: "2.0", id: 2, method: "test.secret", params: {} })).body as { error: { code: number; data: { code: string; status: number } } };
  assert.equal(denied.error.code, RPC_ERROR_CODES.application);
  assert.deepEqual(denied.error.data, { code: "access-denied", status: 403 });
  const invalid = (await f.post({ jsonrpc: "2.0", id: 3, method: "test.greet", params: { name: 5 } })).body as { error: { code: number; message: string } };
  assert.equal(invalid.error.code, RPC_ERROR_CODES.invalidParams);
  assert.equal(invalid.error.message, "Ungültige Eingabe für test.greet: name must be string, got 5");
  const unknown = (await f.post({ jsonrpc: "2.0", id: 4, method: "test.nothing", params: {} })).body as { error: { code: number } };
  assert.equal(unknown.error.code, RPC_ERROR_CODES.methodNotFound);
  const clientOnly = (await f.post({ jsonrpc: "2.0", id: 5, method: "test.client.echo", params: {} })).body as { error: { code: number } };
  assert.equal(clientOnly.error.code, RPC_ERROR_CODES.methodNotFound);
  const failed = (await f.post({ jsonrpc: "2.0", id: 6, method: "test.fail", params: {} })).body as { error: { data: { code: string } } };
  assert.equal(failed.error.data.code, "run-not-found");
  const contract = (await f.post({ jsonrpc: "2.0", id: 7, method: "test.broken", params: {} })).body as { error: { code: number; message: string } };
  assert.equal(contract.error.code, RPC_ERROR_CODES.internal);
  assert.equal(contract.error.message, 'Die Antwort von test.broken verletzt ihren Vertrag: number must be number, got "keine Zahl"');
  assert.equal((await f.post("nonsense")).status, 400);
  const streamless = (await f.post({ jsonrpc: "2.0", id: 8, method: RPC_METHODS.subscribe, params: { channel: "test.ticks", params: { runId: "r" } } })).body as { error: { data: { code: string } } };
  assert.equal(streamless.error.data.code, "stream-required");
});

test("http: a stream carries subscriptions, progress and requests from the server to the client", async (t) => {
  const f = await httpFixture(t);
  const stream = await f.stream();
  const subscribed = (await f.post({ jsonrpc: "2.0", id: 1, method: RPC_METHODS.subscribe, params: { channel: "test.ticks", params: { runId: "run-1" } } }, stream.connection)).body as { result: { subscription: string } };
  const first = await stream.next();
  assert.deepEqual(first.data, { jsonrpc: "2.0", method: RPC_METHODS.event, params: { subscription: subscribed.result.subscription, channel: "test.ticks", message: { tick: 0 } } });
  f.emitters.get("run-1")!({ tick: 1 });
  assert.deepEqual((await stream.next()).data, { jsonrpc: "2.0", method: RPC_METHODS.event, params: { subscription: subscribed.result.subscription, channel: "test.ticks", message: { tick: 1 } } });
  assert.equal((await f.post({ jsonrpc: "2.0", id: 2, method: RPC_METHODS.unsubscribe, params: { subscription: subscribed.result.subscription } }, stream.connection)).status, 200);
  assert.deepEqual(f.stopped, ["run-1"]);

  const callback = f.post({ jsonrpc: "2.0", id: 3, method: "test.callback", params: {} }, stream.connection);
  const request = await stream.next();
  const incoming = request.data as { id: number; method: string; params: { value: string } };
  assert.equal(incoming.method, "test.client.echo");
  assert.equal((await f.post({ jsonrpc: "2.0", id: incoming.id, result: { value: `${incoming.params.value}-pong` } }, stream.connection)).status, 202);
  assert.deepEqual((await callback).body, { jsonrpc: "2.0", id: 3, result: { value: "ping-pong" } });

  const foreign = await f.post({ jsonrpc: "2.0", id: 4, method: "test.greet", params: { name: "x" } }, "0".repeat(32));
  assert.equal(foreign.status, 404);
  stream.close();
  await new Promise((resolve) => setTimeout(resolve, 50));
  assert.equal(f.transport.connectionCount(), 0);
});

test("http: closing the request aborts the running method", async (t) => {
  const f = await httpFixture(t);
  const controller = new AbortController();
  const pending = fetch(`${f.base}/rpc`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "test.slow", params: {} }), signal: controller.signal });
  await new Promise((resolve) => setTimeout(resolve, 50));
  controller.abort();
  await assert.rejects(pending);
});

test("stdio: one JSON message per line in both directions, closing the input ends the connection", async () => {
  const f = fixture();
  const input = new PassThrough();
  const output = new PassThrough();
  const transport = startStdioTransport({ dispatcher: f.dispatcher, input, output });
  const lines: string[] = [];
  output.on("data", (chunk: Buffer) => lines.push(...chunk.toString("utf8").split("\n").filter(Boolean)));
  const nextLine = async (): Promise<RpcMessage> => {
    while (lines.length === 0) await new Promise((resolve) => setTimeout(resolve, 5));
    return JSON.parse(lines.shift()!) as RpcMessage;
  };
  input.write(`${JSON.stringify({ jsonrpc: "2.0", id: 1, method: "test.greet", params: { name: "stdio" } })}\n`);
  assert.deepEqual(await nextLine(), { jsonrpc: "2.0", id: 1, result: { text: "Hallo stdio" } });
  input.write(`${JSON.stringify({ jsonrpc: "2.0", id: 2, method: "test.secret", params: {} })}\n`);
  assert.deepEqual(await nextLine(), { jsonrpc: "2.0", id: 2, result: null });
  input.write(`${JSON.stringify({ jsonrpc: "2.0", id: 3, method: RPC_METHODS.subscribe, params: { channel: "test.ticks", params: { runId: "s" } } })}\n`);
  const subscribed = await nextLine() as { result: { subscription: string } };
  assert.deepEqual(await nextLine(), { jsonrpc: "2.0", method: RPC_METHODS.event, params: { subscription: subscribed.result.subscription, channel: "test.ticks", message: { tick: 0 } } });
  input.write("kein json\n");
  assert.equal(((await nextLine()) as { error: { code: number } }).error.code, RPC_ERROR_CODES.parse);
  input.end();
  await transport.closed;
  assert.deepEqual(f.stopped, ["s"]);
  assert.ok(transport.connection.closed);
});
