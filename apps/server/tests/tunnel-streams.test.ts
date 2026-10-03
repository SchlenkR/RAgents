import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import WebSocket from "ws";
import { DomainError } from "@ragents/engine";
import { bytesOf, openTunnelLeg, tunnelAddress } from "@ragents/workspace-executor";
import { PROCESS_TUNNEL_PATH } from "../../../plugins/ragents.processes/contract.ts";
import { TunnelStreams, type TunnelStreamsOptions } from "../../../plugins/ragents.processes/server/tunnel-streams.ts";
import { startRpcServer } from "./rpc-fixture.ts";

const until = async (condition: () => boolean, timeoutMs = 5000): Promise<void> => {
  const started = Date.now();
  while (!condition()) {
    if (Date.now() - started > timeoutMs) throw new Error("Condition was not met.");
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
};

interface Frame {
  readonly binary: boolean;
  readonly text: string;
}

/** What one leg receives until it closes. */
const watched = (leg: WebSocket) => {
  const state = { frames: [] as Frame[], closed: undefined as { code: number; reason: string } | undefined };
  leg.on("message", (data, binary) => state.frames.push({ binary, text: bytesOf(data).toString("utf8") }));
  leg.on("close", (code, reason) => { state.closed = { code, reason: reason.toString("utf8") }; });
  leg.resume();
  return state;
};

/** The broker on a real HTTP server; the test plays both the run's machine, which dials back during the opening, and the caller. */
const setup = async (t: TestContext, options: Partial<TunnelStreamsOptions> & { readonly silentMachine?: boolean } = {}) => {
  const address = { url: "" };
  const machines: WebSocket[] = [];
  const dials: Array<{ runId: string; port: number; path: string }> = [];
  const streams = new TunnelStreams({
    dial: async (runId, port, path, signal) => {
      dials.push({ runId, port, path });
      const leg = options.silentMachine
        ? await new Promise<WebSocket>((resolve, reject) => {
          const silent = new WebSocket(tunnelAddress(address.url, path), { autoPong: false });
          silent.once("open", () => {
            silent.pause();
            resolve(silent);
          });
          silent.once("error", reject);
        })
        : await openTunnelLeg(tunnelAddress(address.url, path), signal);
      leg.on("error", () => undefined);
      machines.push(leg);
    },
    ...options,
  });
  const server = await startRpcServer(t, { routes: [streams.route()] });
  address.url = server.url;
  t.after(() => streams.shutdown());
  const connect = async (path: string): Promise<WebSocket> => {
    const leg = await openTunnelLeg(tunnelAddress(server.url, path));
    leg.on("error", () => undefined);
    return leg;
  };
  return { streams, url: server.url, machines, dials, connect };
};

const signal = (): AbortSignal => new AbortController().signal;

test("the run's machine dials back during the opening, the caller's leg pairs with it, and frames pass both ways unchanged", async (t) => {
  const { streams, machines, dials, connect } = await setup(t);
  const { path } = await streams.open("run-a", 5173, signal());
  assert.match(path, new RegExp(`^${PROCESS_TUNNEL_PATH.replaceAll(".", "\\.")}\\?secret=[A-Za-z0-9_-]{43}$`));
  assert.equal(dials.length, 1);
  assert.equal(machines.length, 1, "the machine's leg is open when the caller learns its path");
  assert.notEqual(dials[0]!.path, path, "each leg has its own secret");
  assert.deepEqual([dials[0]!.runId, dials[0]!.port], ["run-a", 5173]);
  const machine = machines[0]!;
  const fromMachine = watched(machine);
  machine.send(Buffer.from("greeting before the caller is there"), { binary: true });

  const client = await connect(path);
  const fromClient = watched(client);
  await until(() => fromClient.frames.length === 1);
  assert.deepEqual(fromClient.frames, [{ binary: true, text: "greeting before the caller is there" }], "what the machine sent early waits for the caller");
  client.send(Buffer.from([0x68, 0x69]), { binary: true });
  client.send("end");
  machine.send("end");
  await until(() => fromMachine.frames.length === 2 && fromClient.frames.length === 2);
  assert.deepEqual(fromMachine.frames, [{ binary: true, text: "hi" }, { binary: false, text: "end" }], "binary and text frames keep their kind");
  assert.deepEqual(fromClient.frames[1], { binary: false, text: "end" });
  client.close(1000);
  await until(() => fromMachine.closed !== undefined && fromClient.closed !== undefined);
  assert.equal(fromMachine.closed?.code, 1000, "a normal end reaches the other leg as one");
});

test("a secret opens its leg once; a used, unknown, or foreign secret is refused, and a plain request learns it needs a WebSocket", async (t) => {
  const { streams, url, dials, connect } = await setup(t);
  const { path } = await streams.open("run-a", 5173, signal());
  await connect(path);
  for (const refused of [path, dials[0]!.path, `${PROCESS_TUNNEL_PATH}?secret=guessed`, PROCESS_TUNNEL_PATH]) {
    await assert.rejects(connect(refused), /refused the leg with 404: This tunnel stream is unknown, already connected, or expired/, refused);
  }
  const plain = await fetch(`${url}${path}`);
  assert.equal(plain.status, 426);
  assert.match(await plain.text(), /opens as a WebSocket/);
});

test("an unpaired stream expires: the machine's leg closes with the cause, and the caller's secret no longer opens", async (t) => {
  const { streams, machines, connect } = await setup(t, { pairingTimeoutMs: 100 });
  const { path } = await streams.open("run-a", 5173, signal());
  const machine = watched(machines[0]!);
  await until(() => machine.closed !== undefined);
  assert.deepEqual(machine.closed, { code: 1011, reason: "The other leg of the stream did not connect within 0.1 s" });
  await assert.rejects(connect(path), /404/);
});

test("a failed dial-back passes its cause and leaves no stream; a dial-back without a leg is an error", async (t) => {
  const refusing = new TunnelStreams({
    dial: async () => { throw new DomainError("tunnel-port-unknown", "No process of run run-a listens on port 5173 on this machine", 404); },
  });
  t.after(() => refusing.shutdown());
  await assert.rejects(refusing.open("run-a", 5173, signal()), (error: unknown) => error instanceof DomainError && error.code === "tunnel-port-unknown");
  const absent = new TunnelStreams({ dial: async () => undefined });
  t.after(() => absent.shutdown());
  await assert.rejects(absent.open("run-a", 5173, signal()), /its leg did not arrive/);
});

test("closing a run closes both legs of its streams and leaves other runs alone", async (t) => {
  const { streams, machines, connect } = await setup(t);
  const first = await streams.open("run-a", 5173, signal());
  const second = await streams.open("run-b", 5173, signal());
  const clients = [watched(await connect(first.path)), watched(await connect(second.path))];
  const sides = machines.map(watched);
  streams.closeRun("run-a", "The run stopped");
  await until(() => clients[0]!.closed !== undefined && sides[0]!.closed !== undefined);
  assert.deepEqual(clients[0]!.closed, { code: 1001, reason: "The run stopped" });
  assert.deepEqual(sides[0]!.closed, { code: 1001, reason: "The run stopped" });
  assert.equal(clients[1]!.closed, undefined);
  await streams.shutdown();
  await until(() => clients[1]!.closed !== undefined && sides[1]!.closed !== undefined);
  assert.deepEqual(clients[1]!.closed, { code: 1001, reason: "The server shuts down" });
});

test("a leg the server hears nothing from is cut, and its partner learns it", async (t) => {
  const { streams, machines, connect } = await setup(t, { silentMachine: true, pingIntervalMs: 20, silenceLimitMs: 120 });
  const { path } = await streams.open("run-a", 5173, signal());
  const client = watched(await connect(path));
  const machine = watched(machines[0]!);
  await until(() => client.closed !== undefined && machine.closed !== undefined);
  assert.deepEqual(client.closed, { code: 1011, reason: "The other leg was cut off" });
  assert.equal(machine.closed?.code, 1006, "the silent leg is cut without a closing handshake");
});
