import assert from "node:assert/strict";
import { PassThrough } from "node:stream";
import test from "node:test";
import { Type } from "typebox";
import { ChannelContributionRegistry, createAccessContext, defineChannel, defineOperation, DomainError, implement, implementChannel, MethodContributionRegistry, RPC_ERROR_CODES, RPC_METHODS, RpcError, RpcPeer, unrestrictedAccess } from "@ragents/engine";
import { RpcConnection, RpcDispatcher } from "../src/rpc/dispatcher.ts";
import { startStdioTransport } from "../src/rpc/stdio-transport.ts";

const localMethod = defineOperation({ id: "acme.local", description: "Local operation", scope: "local", rights: ["runs.write"], input: Type.Object({ value: Type.String() }), result: Type.String() });
const localChannel = defineChannel({ id: "acme.changes", description: "Local changes", scope: "local", params: Type.Object({}), message: Type.String() });

const fixture = () => {
  const executed: string[] = [];
  const opened: string[] = [];
  const methods = new MethodContributionRegistry();
  const channels = new ChannelContributionRegistry();
  methods.register("acme", [implement(localMethod, ({ value }) => { executed.push(value); return value; })]);
  channels.register("acme", [implementChannel(localChannel, () => { opened.push("changes"); return () => undefined; })]);
  const dispatcher = new RpcDispatcher({ methods, channels });
  const connect = (local: boolean, access = unrestrictedAccess) => {
    const caller: RpcPeer = new RpcPeer({ send: (message) => connection.peer.receive(message) });
    const connection = new RpcConnection({ id: "acme", access, local, peer: new RpcPeer({ send: (message) => caller.receive(message) }) }, dispatcher);
    return { caller, connection };
  };
  return { dispatcher, connect, executed, opened };
};

test("remote calls and subscriptions fail with local-only before validation or handlers", async () => {
  const f = fixture();
  const remote = f.connect(false);
  const denied = (error: unknown) => error instanceof RpcError && error.code === RPC_ERROR_CODES.application && error.domainCode === "local-only" && error.status === 403 && /stdio or loopback/.test(error.message);
  await assert.rejects(remote.caller.call(localMethod, { value: "denied" }), denied);
  await assert.rejects(remote.caller.request(localMethod.id, { value: 5 }), denied);
  await assert.rejects(remote.caller.request(RPC_METHODS.subscribe, { channel: localChannel.id, params: {} }), denied);
  assert.deepEqual(f.executed, []);
  assert.deepEqual(f.opened, []);
  assert.equal(remote.connection.subscriptions.size, 0);
  remote.connection.close("done");
});

test("loopback operations and channels work and retain their independent rights checks", async () => {
  const f = fixture();
  const local = f.connect(true);
  assert.equal(await local.caller.call(localMethod, { value: "accepted" }), "accepted");
  const result = await local.caller.request(RPC_METHODS.subscribe, { channel: localChannel.id, params: {} }) as { subscription: string };
  assert.equal(typeof result.subscription, "string");
  assert.deepEqual(f.executed, ["accepted"]);
  assert.deepEqual(f.opened, ["changes"]);
  const restricted = f.connect(true, createAccessContext({ enabled: true, user: { id: "alice", label: "Alice", rights: [] } }));
  await assert.rejects(restricted.caller.call(localMethod, { value: "denied" }), (error: unknown) => error instanceof RpcError && error.domainCode === "access-denied");
  local.connection.close("done");
  restricted.connection.close("done");
});

test("stdio counts as local and local client callbacks cannot cross the network", async () => {
  const f = fixture();
  const input = new PassThrough();
  const output = new PassThrough();
  const transport = startStdioTransport({ dispatcher: f.dispatcher, input, output });
  const result = new Promise<string>((resolve) => output.once("data", (chunk: Buffer) => resolve(chunk.toString("utf8"))));
  input.write(`${JSON.stringify({ jsonrpc: "2.0", id: 1, method: localMethod.id, params: { value: "stdio" } })}\n`);
  assert.deepEqual(JSON.parse(await result), { jsonrpc: "2.0", id: 1, result: "stdio" });
  input.end();
  await transport.closed;
  const remote = f.connect(false);
  await assert.rejects(remote.connection.call(defineOperation({ ...localMethod, implementedBy: "client" }), { value: "callback" }), (error: unknown) => error instanceof DomainError && error.code === "local-only" && error.status === 403);
  remote.connection.close("done");
});
