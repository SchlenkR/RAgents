import assert from "node:assert/strict";
import test from "node:test";
import { Type } from "typebox";
import { DomainError } from "../src/runtime/domain-error.ts";
import { defineOperation } from "../src/rpc/contract.ts";
import { RpcPeer } from "../src/rpc/peer.ts";
import { RPC_ERROR_CODES, RPC_METHODS, RpcError, type RpcMessage } from "../src/rpc/protocol.ts";

/** Two peers that deliver to each other through microtasks; `dropped` holds messages back. */
const pair = () => {
  const sent: { left: RpcMessage[]; right: RpcMessage[] } = { left: [], right: [] };
  let dropped = false;
  const left: RpcPeer = new RpcPeer({ send: (message) => { sent.left.push(message); if (!dropped) queueMicrotask(() => right.receive(message)); } });
  const right: RpcPeer = new RpcPeer({ send: (message) => { sent.right.push(message); if (!dropped) queueMicrotask(() => left.receive(message)); } });
  return { left, right, sent, drop: () => { dropped = true; } };
};

const echo = defineOperation({
  id: "test.echo",
  description: "Returns the input",
  input: Type.Object({ text: Type.String() }),
  result: Type.Object({ text: Type.String() }),
});

test("requests travel both ways with typed contracts and failures keep their domain code", async () => {
  const { left, right } = pair();
  right.handle(echo, ({ text }) => ({ text: text.toUpperCase() }));
  left.onRequest("test.fail", () => { throw new DomainError("run-not-found", "No run", 404); });
  assert.deepEqual(await left.call(echo, { text: "hello" }), { text: "HELLO" });
  await assert.rejects(right.request("test.fail", {}), (error: unknown) =>
    error instanceof RpcError && error.code === RPC_ERROR_CODES.application && error.domainCode === "run-not-found" && error.status === 404);
  await assert.rejects(left.request("test.unknown", {}), (error: unknown) => error instanceof RpcError && error.code === RPC_ERROR_CODES.methodNotFound);
});

test("notifications, progress and cancellation reach the other side", async () => {
  const { left, right, sent } = pair();
  const seen: unknown[] = [];
  right.onNotification("test.note", (params) => seen.push(params));
  left.notify("test.note", { a: 1 });
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.deepEqual(seen, [{ a: 1 }]);

  let aborted = false;
  right.onRequest("test.slow", (_params, context) => new Promise((resolve) => {
    context.progress("one");
    context.progress("two");
    context.signal.addEventListener("abort", () => { aborted = true; resolve({ exitCode: null }); });
  }));
  const progress: unknown[] = [];
  const controller = new AbortController();
  const slow = left.request("test.slow", {}, { signal: controller.signal, onProgress: (value) => progress.push(value) });
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.deepEqual(progress, ["one", "two"]);
  controller.abort();
  assert.deepEqual(await slow, { exitCode: null });
  assert.ok(aborted);
  assert.ok(sent.left.some((message) => "method" in message && message.method === RPC_METHODS.cancel));
});

test("timeouts, dropped transports and closing settle pending calls", async () => {
  const { left, right, drop } = pair();
  right.onRequest("test.never", () => new Promise(() => undefined));
  await assert.rejects(left.request("test.never", {}, { timeoutMs: 20 }), (error: unknown) => error instanceof RpcError && error.code === RPC_ERROR_CODES.timeout);
  drop();
  const orphan = left.request("test.never", {});
  left.close("Connection closed");
  await assert.rejects(orphan, (error: unknown) => error instanceof RpcError && error.code === RPC_ERROR_CODES.connectionClosed && error.message === "Connection closed");
  await assert.rejects(left.request("test.echo", {}), (error: unknown) => error instanceof RpcError && error.code === RPC_ERROR_CODES.connectionClosed);
});

test("malformed messages are answered with an invalid-request failure and a fallback serves unknown methods", async () => {
  const { left, right, sent } = pair();
  right.fallback((method, params) => ({ method, params }));
  assert.deepEqual(await left.request("anything.goes", { x: 1 }), { method: "anything.goes", params: { x: 1 } });
  right.receive({ nonsense: true });
  await new Promise((resolve) => setTimeout(resolve, 0));
  const failure = sent.right.find((message) => "error" in message && message.id === null);
  assert.ok(failure && "error" in failure && failure.error.code === RPC_ERROR_CODES.invalidRequest);
});

test("ordinary calls have a deadline and explicit long-lived calls can opt out", async () => {
  const sent: RpcMessage[] = [];
  const peer = new RpcPeer({ send: (message) => { sent.push(message); }, requestTimeoutMs: 20 });
  await assert.rejects(peer.request("test.read", {}), (error: unknown) => error instanceof RpcError && error.code === RPC_ERROR_CODES.timeout);
  assert.ok(sent.some((message) => "method" in message && message.method === RPC_METHODS.cancel));
  const pending = peer.request("test.watch", {}, { timeoutMs: null });
  const rejected = assert.rejects(pending, (error: unknown) => error instanceof RpcError && error.code === RPC_ERROR_CODES.connectionClosed);
  await new Promise((resolve) => setTimeout(resolve, 40));
  assert.equal(sent.filter((message) => "method" in message && message.method === RPC_METHODS.cancel).length, 1);
  peer.close("Watch closed");
  await rejected;
});

test("contract deadlines override the peer default and caller options override the contract", async () => {
  const { left, right } = pair();
  const contract = defineOperation({ ...echo, timeoutMs: 10 });
  right.handle(contract, async ({ text }) => {
    await new Promise((resolve) => setTimeout(resolve, 30));
    return { text };
  });
  await assert.rejects(left.call(contract, { text: "timed out" }), (error: unknown) => error instanceof RpcError && error.code === RPC_ERROR_CODES.timeout);
  assert.deepEqual(await left.call(contract, { text: "extended" }, { timeoutMs: 100 }), { text: "extended" });
  assert.deepEqual(await left.call(contract, { text: "unbounded" }, { timeoutMs: null }), { text: "unbounded" });
  left.close("Done");
  right.close("Done");
});

test("invalid deadlines fail before any request is sent", async () => {
  assert.throws(() => defineOperation({ ...echo, timeoutMs: Infinity }), /timeoutMs/);
  assert.throws(() => new RpcPeer({ send: () => undefined, requestTimeoutMs: 0 }), /requestTimeoutMs/);
  const sent: RpcMessage[] = [];
  const peer = new RpcPeer({ send: (message) => { sent.push(message); } });
  await assert.rejects(peer.call(echo, { text: "invalid" }, { timeoutMs: -1 }), /timeoutMs/);
  assert.deepEqual(sent, []);
});

test("closing pending outgoing calls prevents unsent work and keeps later calls possible", async () => {
  const { left, right, sent } = pair();
  right.handle(echo, ({ text }) => ({ text }));
  const pending = left.call(echo, { text: "cancelled before sending" });
  left.cancelOutgoing("Client closed");
  await assert.rejects(pending, (error: unknown) => error instanceof RpcError && error.code === RPC_ERROR_CODES.connectionClosed);
  assert.equal(sent.left.filter((message) => "method" in message && message.method === echo.id).length, 0);
  assert.deepEqual(await left.call(echo, { text: "new call" }), { text: "new call" });
});

for (const rejects of [false, true]) {
  test(`late incoming ${rejects ? "errors" : "results"} cannot cross reconnect or remove the replacement handler`, async () => {
    const sent: RpcMessage[] = [];
    const handlers: Array<{ context: import("../src/rpc/peer.ts").RpcHandlerContext; finish: () => void }> = [];
    const peer = new RpcPeer({ send: (message) => { sent.push(message); } });
    peer.onRequest("test.work", (_params, context) => new Promise((resolve, reject) => {
      const old = handlers.length === 0;
      handlers.push({ context, finish: () => old && rejects ? reject(new Error("Old handler failed")) : resolve(old ? "old" : "replacement") });
    }));
    const request = { jsonrpc: "2.0", id: 1, method: "test.work", params: {} };
    peer.receive(request);
    handlers[0]!.context.progress("queued before reconnect");
    peer.cancelIncoming();
    peer.receive(request);
    handlers[0]!.context.progress("after reconnect");
    handlers[0]!.finish();
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.deepEqual(sent, [], "old progress, results and errors are discarded");
    assert.equal(handlers[0]!.context.signal.aborted, true);
    peer.receive({ jsonrpc: "2.0", method: RPC_METHODS.cancel, params: { id: 1 } });
    assert.equal(handlers[1]!.context.signal.aborted, true, "old cleanup keeps the new handler cancellable");
    handlers[1]!.finish();
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.deepEqual(sent, [{ jsonrpc: "2.0", id: 1, result: "replacement" }], "explicit cancellation may still return its result");
    peer.close("Done");
    peer.receive(request);
    assert.equal(handlers.length, 2, "a closed peer runs no later handlers");
  });
}

test("throwing and asynchronously rejected progress and notification callbacks stay isolated", async (t) => {
  const errors: string[] = [];
  t.mock.method(console, "error", (message: string) => errors.push(message));
  const peer = new RpcPeer({ send: () => undefined });
  let progressCount = 0;
  const pending = peer.request("test.work", {}, { timeoutMs: null, onProgress: () => {
    progressCount += 1;
    if (progressCount === 1) throw new Error("Synchronous progress failure");
    return Promise.reject(new Error("Asynchronous progress failure"));
  } });
  peer.onNotification("test.note", async () => { throw new Error("Asynchronous notification failure"); });
  assert.doesNotThrow(() => peer.receive({ jsonrpc: "2.0", method: RPC_METHODS.progress, params: { id: 1, value: "one" } }));
  peer.receive({ jsonrpc: "2.0", method: RPC_METHODS.progress, params: { id: 1, value: "two" } });
  peer.receive({ jsonrpc: "2.0", method: "test.note", params: {} });
  peer.receive({ jsonrpc: "2.0", id: 1, result: "completed" });
  assert.equal(await pending, "completed");
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(errors.length, 3);
  assert.ok(errors.some((message) => message.includes("request 1") && message.includes("Synchronous progress failure")));
  assert.ok(errors.some((message) => message.includes("request 1") && message.includes("Asynchronous progress failure")));
  assert.ok(errors.some((message) => message.includes("test.note") && message.includes("Asynchronous notification failure")));
});

test("aborting before dispatch settles immediately and never executes the unsent mutation", async () => {
  const { left, right, sent } = pair();
  let executed = 0;
  right.handle(echo, ({ text }) => { executed += 1; return { text }; });
  const controller = new AbortController();
  const pending = left.call(echo, { text: "unsent mutation" }, { signal: controller.signal, timeoutMs: null });
  controller.abort();
  await assert.rejects(pending, (error: unknown) => error instanceof RpcError && error.code === RPC_ERROR_CODES.cancelled);
  assert.equal(executed, 0);
  assert.deepEqual(sent.left, []);
  assert.deepEqual(await left.call(echo, { text: "later mutation" }), { text: "later mutation" });
  assert.equal(executed, 1);
  left.close("Done");
  right.close("Done");
});

test("a dispatched cancellation retains grace for its cooperative result", async () => {
  const { left, right } = pair();
  right.onRequest("test.cleanup", (_input, context) => new Promise((resolve) => {
    context.signal.addEventListener("abort", () => {
      setTimeout(() => resolve({ cleaned: true }), 30);
    });
  }));
  const controller = new AbortController();
  const pending = left.request("test.cleanup", {}, { signal: controller.signal, timeoutMs: null });
  await new Promise((resolve) => setTimeout(resolve, 0));
  controller.abort();
  assert.deepEqual(await pending, { cleaned: true });
  left.close("Done");
  right.close("Done");
});
