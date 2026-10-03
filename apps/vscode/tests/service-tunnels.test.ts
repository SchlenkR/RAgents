import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createServer as createHttpServer, type IncomingMessage, type ServerResponse } from "node:http";
import { connect, createServer, type AddressInfo, type Server } from "node:net";
import { tmpdir } from "node:os";
import test, { type TestContext } from "node:test";
import { WebSocketServer } from "ws";
import { DomainError } from "@ragents/engine";
import {
  PROCESS_OPERATIONS,
  WorkspaceOperationError,
  WorkspaceOperationExecutor,
  processModule,
  workspaceProcessContext,
  type ProcessTable,
} from "@ragents/workspace-executor";
import { processesContracts } from "../../../plugins/ragents.processes/contract";
import { ServerClient } from "../src/server-client";
import { ServiceTunnels, serviceOnThisMachine } from "../src/service-tunnels";
import { startStubServer, waitFor } from "./fixtures";

const RUN = "run-forwarded";

const LARGE = 20 * 1024 * 1024;

/** A port that is free on this machine right now. */
const freePort = (): Promise<number> => new Promise((resolve) => {
  const probe = createServer();
  probe.listen(0, "127.0.0.1", () => {
    const { port } = probe.address() as AddressInfo;
    probe.close(() => resolve(port));
  });
});

const occupied = async (t: TestContext, port: number): Promise<Server> => {
  const server = createServer((socket) => socket.end("someone else"));
  await new Promise<void>((resolve) => server.listen(port, "127.0.0.1", resolve));
  t.after(() => new Promise<void>((resolve) => server.close(() => resolve())));
  return server;
};

/** The run's processes as the test names them: per port the address it listens on. */
const runTable = (ports: ReadonlyMap<number, string>): ProcessTable => {
  const listeners = [...ports].map(([port, address], index) => ({ pid: 5100 + index, port, address }));
  return {
    list: async () => listeners.map(({ pid }) => ({ pid, ppid: 1, pgid: pid, uid: process.getuid?.() ?? 0, startKey: `start-${pid}`, command: "node service.js" })),
    runMarkers: async (pids) => new Map(listeners.filter(({ pid }) => pids.includes(pid)).map(({ pid }) => [pid, RUN])),
    listeningPorts: async (pids) => new Map(listeners.filter(({ pid }) => pids.includes(pid)).map(({ pid, port, address }) => [pid, [{ port, address }]])),
  };
};

const asDomainError = (error: unknown): unknown =>
  error instanceof WorkspaceOperationError ? new DomainError(error.code, error.message, error.status) : error;

/** The stub server pairs the legs with the real broker; the run's machine is a real executor of this process that dials back to it. */
const setup = async (t: TestContext, checkIntervalMs = 60_000) => {
  const ports = new Map<number, string>();
  const clock = { now: 0 };
  const address = { url: "" };
  const machine = new WorkspaceOperationExecutor({
    contextFor: (runId) => Promise.resolve(workspaceProcessContext({
      runId, cwd: tmpdir(), root: tmpdir(), home: { home: tmpdir() }, logDirectory: tmpdir(), hostRoot: undefined,
    })),
    modules: [processModule({ table: () => runTable(ports), serverAddress: () => address.url, now: () => clock.now })],
  });
  const asked: Array<{ port: number; stream: string | null }> = [];
  const dial = async (runId: string, port: number, stream: string | null, signal: AbortSignal): Promise<void> => {
    asked.push({ port, stream });
    await machine.execute(runId, PROCESS_OPERATIONS.dial, { port, stream }, { signal }).catch((error: unknown) => { throw asDomainError(error); });
  };
  const stub = await startStubServer({ tunnel: { check: (runId, port, signal) => dial(runId, port, null, signal), dial } });
  address.url = stub.url;
  const client = new ServerClient(stub.url, undefined, fetch);
  const log: string[] = [];
  const tunnels = new ServiceTunnels({ log: (line) => log.push(line), checkIntervalMs });
  t.after(async () => {
    await tunnels.dispose();
    await stub.close();
    await machine.shutdown();
  });
  /** The run listens on the port or no longer does; the next scan of the run's machine sees it. */
  const serve = (port: number): void => {
    ports.set(port, "127.0.0.1");
    clock.now += 60_000;
  };
  const forget = (port: number): void => {
    ports.delete(port);
    clock.now += 60_000;
  };
  return { serve, forget, asked, client, log, tunnels };
};

interface Events {
  release: () => void;
}

/** A service of the run on this machine: HTTP with cookies, uploads, downloads, server-sent events, and a WebSocket echo. */
const service = async (t: TestContext) => {
  const events: Events = { release: () => undefined };
  const server = createHttpServer((request: IncomingMessage, response: ServerResponse) => {
    const url = new URL(request.url ?? "/", "http://service");
    if (url.pathname === "/hello") {
      response.writeHead(201, ["Set-Cookie", "a=1", "Set-Cookie", "b=2", "X-Path", request.url ?? "", "X-Host", request.headers.host ?? ""]);
      response.end(Buffer.from([0, 255, 1, 254]));
      return;
    }
    if (url.pathname === "/upload") {
      const hash = createHash("sha256");
      request.on("data", (chunk: Buffer) => hash.update(chunk));
      request.on("end", () => response.end(hash.digest("hex")));
      return;
    }
    if (url.pathname === "/download") {
      response.writeHead(200, { "Content-Type": "application/octet-stream" });
      response.end(Buffer.alloc(LARGE, 9));
      return;
    }
    if (url.pathname === "/events") {
      response.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache" });
      response.write("data: one\n\n");
      events.release = () => response.end("data: two\n\n");
      return;
    }
    response.writeHead(404).end();
  });
  const sockets = new WebSocketServer({ server, path: "/socket" });
  sockets.on("connection", (socket) => socket.on("message", (data, binary) => socket.send(data, { binary })));
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(async () => {
    for (const client of sockets.clients) client.terminate();
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });
  return { port: (server.address() as AddressInfo).port, events };
};

const target = (port: number) => ({ runId: RUN, port, workstation: "client-0001", tunnel: processesContracts.tunnel.id });

const refused = async (port: number): Promise<boolean> => {
  try {
    await fetch(`http://127.0.0.1:${port}/`);
    return false;
  } catch {
    return true;
  }
};

test("a service on this window's workstation or on the extension's own host opens directly, every other one through a tunnel", () => {
  const onWorkstation = target(5173);
  const onServer = { ...onWorkstation, workstation: null };
  assert.equal(serviceOnThisMachine(onWorkstation, { ownHost: false, workstation: "client-0001" }), true);
  assert.equal(serviceOnThisMachine(onWorkstation, { ownHost: true, workstation: "client-0002" }), false, "another window's workstation is reached through the server");
  assert.equal(serviceOnThisMachine(onWorkstation, { ownHost: true, workstation: undefined }), false);
  assert.equal(serviceOnThisMachine(onServer, { ownHost: true, workstation: "client-0001" }), true, "the extension's own host runs on this machine");
  assert.equal(serviceOnThisMachine(onServer, { ownHost: false, workstation: "client-0001" }), false, "a server by address is another machine");
});

test("a tunnel keeps a free port number, is reused, and carries an HTTP exchange unchanged, one stream per connection", { timeout: 30_000 }, async (t) => {
  const { serve, asked, client, log, tunnels } = await setup(t);
  const unused = await freePort();
  serve(unused);
  assert.equal(await tunnels.open("stub", client, target(unused)), unused, "a free port keeps its number");
  assert.equal(await tunnels.open("stub", client, target(unused)), unused, "a second click reuses the tunnel");
  assert.deepEqual(asked, [{ port: unused, stream: null }], "the server confirmed the port once before the listener started");

  const own = await service(t);
  serve(own.port);
  const local = await tunnels.open("stub", client, target(own.port));
  assert.notEqual(local, own.port, "the service itself holds its number on this machine");
  const response = await fetch(`http://127.0.0.1:${local}/hello?name=a%20b`, { headers: { Connection: "close" } });
  assert.equal(response.status, 201);
  assert.deepEqual(response.headers.getSetCookie(), ["a=1", "b=2"]);
  assert.equal(response.headers.get("x-path"), "/hello?name=a%20b");
  assert.equal(response.headers.get("x-host"), `127.0.0.1:${local}`, "the bytes arrive unchanged, the Host header included");
  assert.deepEqual([...new Uint8Array(await response.arrayBuffer())], [0, 255, 1, 254]);
  assert.equal(asked.filter((entry) => entry.stream !== null).length, 1);
  assert.ok(log.includes(`== Forwarding localhost:${local} to port ${own.port} of run ${RUN} on stub`), log.join("\n"));
  await waitFor(() => log.some((line) => /^== Stream from local port \d+ to port \d+ of run run-forw closed: [\d.]+ KB sent, [\d.]+ KB received$/.test(line)));
  assert.ok(log.some((line) => /^== Stream from local port \d+ to port \d+ of run run-forw opened$/.test(line)), log.join("\n"));
});

test("a WebSocket and server-sent events pass through the tunnel", { timeout: 30_000 }, async (t) => {
  const { serve, client, tunnels } = await setup(t);
  const own = await service(t);
  serve(own.port);
  const local = await tunnels.open("stub", client, target(own.port));

  const socket = new WebSocket(`ws://127.0.0.1:${local}/socket`);
  socket.binaryType = "arraybuffer";
  const echoed: unknown[] = [];
  socket.addEventListener("message", (event) => echoed.push(event.data));
  await new Promise<void>((resolve, reject) => {
    socket.addEventListener("open", () => resolve());
    socket.addEventListener("error", () => reject(new Error("The WebSocket through the tunnel did not open")));
  });
  socket.send("live reload");
  socket.send(new Uint8Array([1, 2, 3]));
  await waitFor(() => echoed.length === 2);
  assert.equal(echoed[0], "live reload");
  assert.deepEqual([...new Uint8Array(echoed[1] as ArrayBuffer)], [1, 2, 3]);
  socket.close();

  const response = await fetch(`http://127.0.0.1:${local}/events`);
  assert.equal(response.headers.get("content-type"), "text/event-stream");
  const reader = response.body!.getReader();
  const first = await reader.read();
  assert.equal(new TextDecoder().decode(first.value), "data: one\n\n", "the first event arrives while the response is still open");
  own.events.release();
  const rest: string[] = [];
  for (let chunk = await reader.read(); !chunk.done; chunk = await reader.read()) rest.push(new TextDecoder().decode(chunk.value));
  assert.equal(rest.join(""), "data: two\n\n");
});

test("a service that speaks first reaches the caller with its greeting, and a half-closed request still gets its answer", { timeout: 30_000 }, async (t) => {
  const { serve, client, tunnels } = await setup(t);
  const greeting = createServer({ allowHalfOpen: true }, (socket) => {
    socket.write("220 ready\r\n");
    const chunks: Buffer[] = [];
    socket.on("data", (chunk: Buffer) => chunks.push(chunk));
    socket.on("end", () => socket.end(`got ${Buffer.concat(chunks).toString("utf8")}`));
  });
  await new Promise<void>((resolve) => greeting.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise<void>((resolve) => greeting.close(() => resolve())));
  const port = (greeting.address() as AddressInfo).port;
  serve(port);
  const local = await tunnels.open("stub", client, target(port));
  const answer = await new Promise<string>((resolve, reject) => {
    const socket = connect({ host: "127.0.0.1", port: local, allowHalfOpen: true });
    const chunks: Buffer[] = [];
    socket.on("data", (chunk: Buffer) => {
      chunks.push(chunk);
      if (Buffer.concat(chunks).toString("utf8") === "220 ready\r\n") socket.end("QUIT");
    });
    socket.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    socket.on("error", reject);
  });
  assert.equal(answer, "220 ready\r\ngot QUIT");
});

test("bodies far above 16 MiB cross in both directions", { timeout: 30_000 }, async (t) => {
  const { serve, client, tunnels } = await setup(t);
  const own = await service(t);
  serve(own.port);
  const local = await tunnels.open("stub", client, target(own.port));
  const upload = Buffer.alloc(LARGE, 5);
  const hashed = await fetch(`http://127.0.0.1:${local}/upload`, { method: "POST", body: upload });
  assert.equal(await hashed.text(), createHash("sha256").update(upload).digest("hex"));
  const download = Buffer.from(await (await fetch(`http://127.0.0.1:${local}/download`)).arrayBuffer());
  assert.equal(download.length, LARGE);
  assert.ok(download.equals(Buffer.alloc(LARGE, 9)));
});

test("a local service on an IPv6 wildcard keeps its port, so a tunnel on the same machine does not loop into itself", { timeout: 30_000 }, async (t) => {
  const { serve, client, tunnels } = await setup(t);
  const local = createHttpServer((_request: IncomingMessage, response: ServerResponse) => response.end("the service"));
  await new Promise<void>((resolve) => local.listen(0, "::", resolve));
  t.after(() => new Promise<void>((resolve) => local.close(() => resolve())));
  const { port } = local.address() as AddressInfo;
  serve(port);
  const tunnel = await tunnels.open("stub", client, target(port));
  assert.notEqual(tunnel, port);
  const response = await fetch(`http://127.0.0.1:${tunnel}/`, { headers: { Connection: "close" } });
  assert.equal(await response.text(), "the service");
});

test("a taken local port leads to a free one, a refused port opens nothing", async (t) => {
  const { serve, client, tunnels } = await setup(t);
  const port = await freePort();
  serve(port);
  await occupied(t, port);
  const local = await tunnels.open("stub", client, target(port));
  assert.notEqual(local, port);
  await assert.rejects(tunnels.open("stub", client, target(1)), /listens on port 1/);
});

test("a stream the server refuses closes its connection and ends the tunnel", { timeout: 30_000 }, async (t) => {
  const { serve, forget, client, log, tunnels } = await setup(t);
  const own = await service(t);
  serve(own.port);
  const local = await tunnels.open("stub", client, target(own.port));
  forget(own.port);
  await assert.rejects(fetch(`http://127.0.0.1:${local}/hello`), "the connection closes without an answer");
  await waitFor(() => log.some((line) => /^== Stream from local port \d+ to port \d+ of run run-forw failed: No process of run run-forwarded listens/.test(line)));
  await waitFor(() => log.some((line) => line.includes("ended: No process of run")));
  assert.equal(await refused(local), true, "the listener is gone");
});

test("the tunnel ends with its open streams when the check finds the port gone, when the connection ends, and when the extension ends", { timeout: 30_000 }, async (t) => {
  const { serve, forget, client, log, tunnels } = await setup(t, 30);
  const own = await service(t);
  serve(own.port);
  const first = await tunnels.open("stub", client, target(own.port));
  const socket = new WebSocket(`ws://127.0.0.1:${first}/socket`);
  const closed = new Promise<void>((resolve) => socket.addEventListener("close", () => resolve()));
  await new Promise<void>((resolve) => socket.addEventListener("open", () => resolve()));
  forget(own.port);
  await waitFor(() => log.some((line) => line.endsWith(`ended: No process of run ${RUN} listens on port ${own.port} on this machine`)));
  await closed;
  assert.equal(await refused(first), true);

  serve(own.port);
  const second = await tunnels.open("stub", client, target(own.port));
  tunnels.retain(() => client.rpc);
  assert.equal((await fetch(`http://127.0.0.1:${second}/hello`)).status, 201, "the same client keeps the tunnel");
  tunnels.retain(() => undefined);
  await waitFor(() => log.some((line) => line.endsWith("ended: the connection to stub ended")));
  assert.equal(await refused(second), true);

  const third = await tunnels.open("stub", client, target(own.port));
  await tunnels.dispose();
  await waitFor(() => log.some((line) => line.endsWith("ended: the extension ends")));
  assert.equal(await refused(third), true);
});
