import assert from "node:assert/strict";
import test from "node:test";
import { Type } from "typebox";
import { DomainError } from "../src/runtime/domain-error.ts";
import { defineOperation } from "../src/rpc/contract.ts";
import { RpcPeer } from "../src/rpc/peer.ts";
import { RPC_ERROR_CODES, RPC_METHODS, RpcError, type RpcMessage } from "../src/rpc/protocol.ts";

/** Zwei Peers, die sich gegenseitig über Microtasks zustellen; `dropped` hält Nachrichten zurück. */
const pair = () => {
  const sent: { left: RpcMessage[]; right: RpcMessage[] } = { left: [], right: [] };
  let dropped = false;
  const left: RpcPeer = new RpcPeer({ send: (message) => { sent.left.push(message); if (!dropped) queueMicrotask(() => right.receive(message)); } });
  const right: RpcPeer = new RpcPeer({ send: (message) => { sent.right.push(message); if (!dropped) queueMicrotask(() => left.receive(message)); } });
  return { left, right, sent, drop: () => { dropped = true; } };
};

const echo = defineOperation({
  id: "test.echo",
  description: "Gibt die Eingabe zurück",
  input: Type.Object({ text: Type.String() }),
  result: Type.Object({ text: Type.String() }),
});

test("requests travel both ways with typed contracts and failures keep their domain code", async () => {
  const { left, right } = pair();
  right.handle(echo, ({ text }) => ({ text: text.toUpperCase() }));
  left.onRequest("test.fail", () => { throw new DomainError("run-not-found", "Kein Run", 404); });
  assert.deepEqual(await left.call(echo, { text: "hallo" }), { text: "HALLO" });
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
    context.progress("eins");
    context.progress("zwei");
    context.signal.addEventListener("abort", () => { aborted = true; resolve({ exitCode: null }); });
  }));
  const progress: unknown[] = [];
  const controller = new AbortController();
  const slow = left.request("test.slow", {}, { signal: controller.signal, onProgress: (value) => progress.push(value) });
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.deepEqual(progress, ["eins", "zwei"]);
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
  left.close("Verbindung beendet");
  await assert.rejects(orphan, (error: unknown) => error instanceof RpcError && error.code === RPC_ERROR_CODES.connectionClosed && error.message === "Verbindung beendet");
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
