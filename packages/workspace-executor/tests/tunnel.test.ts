import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createServer as createHttpServer } from "node:http";
import { createServer, type AddressInfo, type Server, type Socket } from "node:net";
import { tmpdir } from "node:os";
import test, { type TestContext } from "node:test";
import WebSocket, { WebSocketServer } from "ws";
import {
  PROCESS_OPERATIONS,
  SERVICE_PORTS_TTL_MS,
  TUNNEL_END,
  WorkspaceOperationError,
  WorkspaceOperationExecutor,
  bytesOf,
  processModule,
  serviceTargets,
  tunnelAddress,
  workspaceProcessContext,
  type ProcessRecord,
  type ProcessTable,
} from "../src/index.ts";

const coded = (code: string, status?: number) => (error: unknown): boolean =>
  error instanceof WorkspaceOperationError && error.code === code && (status === undefined || error.status === status);

const until = async (condition: () => boolean, timeoutMs = 5000): Promise<void> => {
  const started = Date.now();
  while (!condition()) {
    if (Date.now() - started > timeoutMs) throw new Error("Condition was not met.");
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
};

const record = (pid: number): ProcessRecord => ({ pid, ppid: 1, pgid: pid, uid: process.getuid?.() ?? 0, startKey: `start-${pid}`, command: "node service.js" });

interface Listener {
  pid: number;
  runId: string;
  port: number;
  address: string;
}

/** A process table in which the test names which run listens where; the services themselves run in the test process. */
const table = (listeners: readonly Listener[] | (() => readonly Listener[])) => {
  const current = typeof listeners === "function" ? listeners : () => listeners;
  const scans = { count: 0 };
  const processes: ProcessTable = {
    list: async () => {
      scans.count += 1;
      return current().map((listener) => record(listener.pid));
    },
    runMarkers: async (pids) => new Map(current().filter((listener) => pids.includes(listener.pid)).map((listener) => [listener.pid, listener.runId])),
    listeningPorts: async (pids) => new Map(current().filter((listener) => pids.includes(listener.pid))
      .map((listener) => [listener.pid, [{ port: listener.port, address: listener.address }]])),
  };
  return { processes, scans };
};

/** A TCP service of the test process; `serve` decides what it does with each connection. */
const service = async (t: TestContext, serve: (socket: Socket) => void, host = "127.0.0.1") => {
  const sockets: Socket[] = [];
  const server: Server = createServer({ allowHalfOpen: true }, (socket) => {
    sockets.push(socket);
    socket.on("error", () => undefined);
    serve(socket);
  });
  await new Promise<void>((resolve, reject) => { server.once("error", reject); server.listen(0, host, resolve); });
  t.after(async () => {
    for (const socket of sockets) socket.destroy();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });
  return { port: (server.address() as AddressInfo).port, sockets };
};

const echo = (socket: Socket): void => { socket.pipe(socket); };

/** Reads and drops what arrives, sends nothing, and closes when the other side does. */
const hold = (socket: Socket): void => {
  socket.resume();
  socket.on("end", () => socket.end());
};

/** Reads the whole request up to its end, then answers in upper case: works only if the stream keeps the other direction open. */
const shout = (socket: Socket): void => {
  const chunks: Buffer[] = [];
  socket.on("data", (chunk: Buffer) => chunks.push(chunk));
  socket.on("end", () => socket.end(Buffer.concat(chunks).toString("utf8").toUpperCase()));
};

interface ArrivedLeg {
  readonly leg: WebSocket;
  readonly path: string;
}

/** The server side of the legs: it accepts every path under /tunnel and refuses everything else with 404. */
const legServer = async (t: TestContext) => {
  const arrived: ArrivedLeg[] = [];
  const sockets = new WebSocketServer({ noServer: true, perMessageDeflate: false });
  const server = createHttpServer((_request, response) => response.writeHead(426).end());
  server.on("upgrade", (request, socket, head) => {
    const path = request.url ?? "/";
    if (!path.startsWith("/tunnel")) {
      socket.end("HTTP/1.1 404 Not Found\r\nConnection: close\r\nContent-Type: text/plain\r\n\r\nUnknown stream\n");
      return;
    }
    sockets.handleUpgrade(request, socket, head, (leg) => {
      leg.on("error", () => undefined);
      leg.pause();
      arrived.push({ leg, path });
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(async () => {
    for (const { leg } of arrived) leg.terminate();
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });
  return { url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, arrived };
};

/** What one leg receives until it closes. */
const received = (leg: WebSocket) => {
  const state = { bytes: [] as Buffer[], texts: [] as string[], closed: undefined as { code: number; reason: string } | undefined };
  leg.on("message", (data, binary) => {
    if (binary) state.bytes.push(bytesOf(data));
    else state.texts.push(bytesOf(data).toString("utf8"));
  });
  leg.on("close", (code, reason) => { state.closed = { code, reason: reason.toString("utf8") }; });
  leg.resume();
  return { state, data: () => Buffer.concat(state.bytes) };
};

const executorWith = (processes: ProcessTable, serverAddress?: () => string | undefined, now?: () => number) => new WorkspaceOperationExecutor({
  contextFor: (runId) => Promise.resolve(workspaceProcessContext({
    runId, cwd: tmpdir(), root: tmpdir(), home: { home: tmpdir() }, logDirectory: tmpdir(), hostRoot: undefined,
  })),
  modules: [processModule({ table: () => processes, ...(serverAddress ? { serverAddress } : {}), ...(now ? { now } : {}) })],
});

const dial = (executor: WorkspaceOperationExecutor, runId: string, port: number, stream: unknown) =>
  executor.execute(runId, PROCESS_OPERATIONS.dial, { port, stream });

test("the dial-back connects to the run's own port, opens its leg on the server, and pipes bytes both ways until both ends close", async (t) => {
  const legs = await legServer(t);
  const own = await service(t, echo);
  const executor = executorWith(table([{ pid: 4301, runId: "run-a", port: own.port, address: "127.0.0.1" }]).processes, () => legs.url);
  t.after(() => executor.shutdown());
  assert.equal(await dial(executor, "run-a", own.port, null), null, "without a stream the call only checks the port");
  assert.equal(legs.arrived.length, 0);

  assert.equal(await dial(executor, "run-a", own.port, "/tunnel?secret=s3cret"), null);
  assert.equal(legs.arrived.length, 1, "the leg is open when the operation returns");
  const { leg, path } = legs.arrived[0]!;
  assert.equal(path, "/tunnel?secret=s3cret");
  const seen = received(leg);
  const bytes = Buffer.from([0, 255, 1, 254, 13, 10]);
  leg.send(bytes, { binary: true });
  await until(() => seen.data().length === bytes.length);
  assert.deepEqual(seen.data(), bytes, "binary bytes come back unchanged");
  leg.send(TUNNEL_END);
  await until(() => seen.state.closed !== undefined);
  assert.deepEqual(seen.state.texts, [TUNNEL_END], "the end of the service's direction arrives as a text frame");
  assert.equal(seen.state.closed?.code, 1000, "both directions ended, so the stream closes normally");
  await until(() => own.sockets[0]?.closed === true);
});

test("a half-closed connection keeps its other direction: the service answers after the end of the request", async (t) => {
  const legs = await legServer(t);
  const own = await service(t, shout);
  const executor = executorWith(table([{ pid: 4302, runId: "run-a", port: own.port, address: "127.0.0.1" }]).processes, () => legs.url);
  t.after(() => executor.shutdown());
  await dial(executor, "run-a", own.port, "/tunnel");
  const { leg } = legs.arrived[0]!;
  const seen = received(leg);
  leg.send(Buffer.from("hello "), { binary: true });
  leg.send(Buffer.from("tunnel"), { binary: true });
  leg.send(TUNNEL_END);
  await until(() => seen.state.closed !== undefined);
  assert.equal(seen.data().toString("utf8"), "HELLO TUNNEL");
  assert.equal(seen.state.closed?.code, 1000);
});

test("many megabytes cross in both directions intact", async (t) => {
  const legs = await legServer(t);
  const size = 20 * 1024 * 1024;
  const download = Buffer.alloc(size, 7);
  const own = await service(t, (socket) => {
    const hash = createHash("sha256");
    socket.on("data", (chunk: Buffer) => hash.update(chunk));
    socket.on("end", () => socket.end(hash.digest("hex")));
    socket.write(download);
  });
  const executor = executorWith(table([{ pid: 4303, runId: "run-a", port: own.port, address: "127.0.0.1" }]).processes, () => legs.url);
  t.after(() => executor.shutdown());
  await dial(executor, "run-a", own.port, "/tunnel");
  const { leg } = legs.arrived[0]!;
  const seen = received(leg);
  const upload = Buffer.alloc(size, 3);
  for (let offset = 0; offset < size; offset += 256 * 1024) leg.send(upload.subarray(offset, offset + 256 * 1024), { binary: true });
  leg.send(TUNNEL_END);
  await until(() => seen.state.closed !== undefined, 30_000);
  const all = seen.data();
  assert.equal(all.length, size + 64);
  assert.ok(all.subarray(0, size).equals(download), "the service's bytes arrive complete and in order");
  assert.equal(all.subarray(size).toString("utf8"), createHash("sha256").update(upload).digest("hex"), "the upload reaches the service complete");
});

test("a reset of the service and a close of the leg reach the other side", async (t) => {
  const legs = await legServer(t);
  const resetting = await service(t, (socket) => { socket.once("data", () => socket.resetAndDestroy()); });
  const holding = await service(t, hold);
  const executor = executorWith(table([
    { pid: 4304, runId: "run-a", port: resetting.port, address: "127.0.0.1" },
    { pid: 4305, runId: "run-a", port: holding.port, address: "127.0.0.1" },
  ]).processes, () => legs.url);
  t.after(() => executor.shutdown());

  await dial(executor, "run-a", resetting.port, "/tunnel");
  const first = received(legs.arrived[0]!.leg);
  legs.arrived[0]!.leg.send(Buffer.from("x"), { binary: true });
  await until(() => first.state.closed !== undefined);
  assert.equal(first.state.closed?.code, 1011, "a reset is an error, not a normal end");
  assert.match(first.state.closed?.reason ?? "", /ECONNRESET|reset/i);

  await dial(executor, "run-a", holding.port, "/tunnel");
  await until(() => holding.sockets.length === 1);
  received(legs.arrived[1]!.leg);
  legs.arrived[1]!.leg.close(1001, "The run stopped");
  await until(() => holding.sockets[0]!.closed);
});

test("a port of another run or of no process is refused before anything connects", async (t) => {
  const legs = await legServer(t);
  const foreign = await service(t, echo);
  const executor = executorWith(table([{ pid: 4306, runId: "run-b", port: foreign.port, address: "127.0.0.1" }]).processes, () => legs.url);
  t.after(() => executor.shutdown());
  for (const stream of [null, "/tunnel"]) {
    await assert.rejects(dial(executor, "run-a", foreign.port, stream), coded("tunnel-port-unknown", 404));
  }
  assert.deepEqual(foreign.sockets, [], "the foreign service received no connection");
  assert.deepEqual(legs.arrived, [], "no leg was opened");
});

test("invalid input, a missing server address, and a path off the server fail with their cause", async (t) => {
  const own = await service(t, echo);
  const listeners = table([{ pid: 4307, runId: "run-a", port: own.port, address: "127.0.0.1" }]).processes;
  const executor = executorWith(listeners, () => "http://127.0.0.1:9");
  t.after(() => executor.shutdown());
  for (const input of [{ port: 0, stream: null }, { port: own.port, stream: "tunnel" }, { port: own.port, stream: 5 }, { port: own.port }]) {
    await assert.rejects(executor.execute("run-a", PROCESS_OPERATIONS.dial, input), coded("tunnel-invalid", 400), JSON.stringify(input));
  }
  for (const stream of ["//elsewhere.example/tunnel", "/\\elsewhere.example/tunnel"]) {
    await assert.rejects(dial(executor, "run-a", own.port, stream), coded("tunnel-invalid", 400), stream);
  }
  const without = executorWith(listeners);
  t.after(() => without.shutdown());
  await assert.rejects(dial(without, "run-a", own.port, "/tunnel"), coded("tunnel-server-unknown", 503));
  assert.deepEqual(own.sockets, [], "nothing connected to the service");
  assert.equal(tunnelAddress("https://ragents.example.com/", "/tunnel?secret=a"), "wss://ragents.example.com/tunnel?secret=a");
  assert.equal(tunnelAddress("http://127.0.0.1:4710", "/tunnel"), "ws://127.0.0.1:4710/tunnel");
});

test("a refused leg closes the connection to the service again, an unused port is unreachable", async (t) => {
  const legs = await legServer(t);
  const own = await service(t, hold);
  const unused = await new Promise<number>((resolve) => {
    const probe = createServer();
    probe.listen(0, "127.0.0.1", () => {
      const { port } = probe.address() as AddressInfo;
      probe.close(() => resolve(port));
    });
  });
  const executor = executorWith(table([
    { pid: 4308, runId: "run-a", port: own.port, address: "127.0.0.1" },
    { pid: 4309, runId: "run-a", port: unused, address: "127.0.0.1" },
  ]).processes, () => legs.url);
  t.after(() => executor.shutdown());
  await assert.rejects(dial(executor, "run-a", own.port, "/elsewhere"),
    (error: unknown) => coded("tunnel-failed", 502)(error) && /refused the leg with 404: Unknown stream/.test((error as Error).message));
  await until(() => own.sockets.length === 1 && own.sockets[0]!.closed);
  await assert.rejects(dial(executor, "run-a", unused, "/tunnel"),
    (error: unknown) => coded("tunnel-unreachable", 502)(error) && new RegExp(`port ${unused} at 127\\.0\\.0\\.1`).test((error as Error).message));
});

test("a wildcard listener is reached on loopback, IPv4 first, and an IPv6-only listener on ::1", async (t) => {
  assert.deepEqual(serviceTargets(["*"]), ["127.0.0.1", "::1"]);
  assert.deepEqual(serviceTargets(["*", "::1", "127.0.0.1"]), ["127.0.0.1", "::1"]);
  assert.deepEqual(serviceTargets(["::1"]), ["::1"]);
  assert.deepEqual(serviceTargets(["192.0.2.10"]), ["192.0.2.10"]);
  const ipv6 = await service(t, (socket) => socket.end("v6"), "::1").catch(() => undefined);
  if (!ipv6) {
    t.diagnostic("This machine has no IPv6 loopback; the IPv6 case is skipped");
    return;
  }
  const legs = await legServer(t);
  const executor = executorWith(table([{ pid: 4310, runId: "run-a", port: ipv6.port, address: "*" }]).processes, () => legs.url);
  t.after(() => executor.shutdown());
  await dial(executor, "run-a", ipv6.port, "/tunnel");
  const seen = received(legs.arrived[0]!.leg);
  await until(() => seen.state.texts.length === 1);
  assert.equal(seen.data().toString("utf8"), "v6");
});

test("stopping a run closes its streams, ending the executor closes all", async (t) => {
  const legs = await legServer(t);
  const own = await service(t, hold);
  const listening: Listener[] = [
    { pid: 4311, runId: "run-a", port: own.port, address: "127.0.0.1" },
    { pid: 4312, runId: "run-b", port: own.port, address: "127.0.0.1" },
  ];
  const executor = executorWith(table(() => listening).processes, () => legs.url);
  await dial(executor, "run-a", own.port, "/tunnel");
  await dial(executor, "run-b", own.port, "/tunnel");
  const [a, b] = legs.arrived.map(({ leg }) => received(leg));
  // The listeners are gone before the stop, so the stop finds no process of the test table to signal.
  listening.length = 0;
  await executor.stopRun("run-a");
  await until(() => a!.state.closed !== undefined);
  assert.deepEqual(a!.state.closed, { code: 1001, reason: "The run stopped" });
  assert.equal(b!.state.closed, undefined, "the other run keeps its stream");
  await executor.shutdown();
  await until(() => b!.state.closed !== undefined);
  assert.deepEqual(b!.state.closed, { code: 1001, reason: "The executor ends" });
  await until(() => own.sockets.length === 2 && own.sockets.every((socket) => socket.closed));
});

test("which ports belong to a run is scanned once per tick, and the stop of the run forgets it", async (t) => {
  const own = await service(t, echo);
  const listening: Listener[] = [{ pid: 4313, runId: "run-a", port: own.port, address: "127.0.0.1" }];
  const { processes, scans } = table(() => listening);
  let clock = 0;
  const executor = executorWith(processes, undefined, () => clock);
  t.after(() => executor.shutdown());
  await Promise.all([1, 2, 3].map(() => dial(executor, "run-a", own.port, null)));
  await dial(executor, "run-a", own.port, null);
  assert.equal(scans.count, 1);
  clock = SERVICE_PORTS_TTL_MS;
  await dial(executor, "run-a", own.port, null);
  assert.equal(scans.count, 2);
  // The listener is gone before the stop, so the stop finds no process of the test table to signal.
  listening.length = 0;
  await executor.stopRun("run-a");
  await assert.rejects(dial(executor, "run-a", own.port, null), coded("tunnel-port-unknown", 404));
});
