import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import test, { type TestContext } from "node:test";
import {
  FORWARD_BODY_LIMIT,
  PROCESS_OPERATIONS,
  SERVICE_PORTS_TTL_MS,
  WorkspaceOperationError,
  WorkspaceOperationExecutor,
  forwardTargets,
  processModule,
  workspaceProcessContext,
  type ForwardedResponse,
  type ProcessRecord,
  type ProcessTable,
} from "../src/index.ts";
import { forwardRequest } from "../src/processes/forward.ts";

interface Seen {
  method: string;
  url: string;
  headers: readonly string[];
  body: Buffer;
}

const coded = (code: string, status?: number) => (error: unknown): boolean =>
  error instanceof WorkspaceOperationError && error.code === code && (status === undefined || error.status === status);

const bodyOf = (request: IncomingMessage): Promise<Buffer> => new Promise((resolve, reject) => {
  const chunks: Buffer[] = [];
  request.on("data", (chunk: Buffer) => chunks.push(chunk));
  request.on("end", () => resolve(Buffer.concat(chunks)));
  request.on("error", reject);
});

/** A service of the test process; what it answers decides the test. */
const service = async (t: TestContext, answer: (request: IncomingMessage, response: ServerResponse, body: Buffer) => void, host = "127.0.0.1") => {
  const seen: Seen[] = [];
  const server: Server = createServer((request, response) => {
    void bodyOf(request).then((body) => {
      seen.push({ method: request.method ?? "", url: request.url ?? "", headers: request.rawHeaders, body });
      answer(request, response, body);
    });
  });
  await new Promise<void>((resolve, reject) => { server.once("error", reject); server.listen(0, host, resolve); });
  t.after(async () => {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });
  return { port: (server.address() as AddressInfo).port, seen };
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

const executorWith = (processes: ProcessTable, now?: () => number) => new WorkspaceOperationExecutor({
  contextFor: (runId) => Promise.resolve(workspaceProcessContext({
    runId, cwd: tmpdir(), root: tmpdir(), home: { home: tmpdir() }, logDirectory: tmpdir(), hostRoot: undefined,
  })),
  modules: [processModule({ table: () => processes, ...(now ? { now } : {}) })],
});

const forward = (executor: WorkspaceOperationExecutor, runId: string, port: number, request: unknown) =>
  executor.execute(runId, PROCESS_OPERATIONS.forward, { port, request }) as Promise<ForwardedResponse | null>;

const header = (headers: readonly (readonly [string, string])[], name: string): string[] =>
  headers.filter(([key]) => key.toLowerCase() === name.toLowerCase()).map(([, value]) => value);

const rawHeader = (raw: readonly string[], name: string): string[] =>
  raw.flatMap((value, index) => index % 2 === 0 && value.toLowerCase() === name.toLowerCase() ? [raw[index + 1]!] : []);

test("forwarding reaches a port of the run's own process with its headers and binary body, and answers with the service's response", async (t) => {
  const bytes = Buffer.from(Array.from({ length: 256 }, (_, index) => index));
  const own = await service(t, (_request, response, body) => {
    response.writeHead(201, ["Set-Cookie", "a=1", "Set-Cookie", "b=2", "Content-Type", "application/octet-stream", "X-Echo-Hash", createHash("sha256").update(body).digest("hex")]);
    response.end(bytes);
  });
  const executor = executorWith(table([{ pid: 4201, runId: "run-a", port: own.port, address: "127.0.0.1" }]).processes);
  const sent = Buffer.from([0, 255, 1, 254, 13, 10]);
  const result = await forward(executor, "run-a", own.port, {
    method: "POST",
    path: "/upload?name=a%20b",
    headers: [["X-Test", "1"], ["X-Test", "2"], ["Connection", "keep-alive, X-Hop"], ["X-Hop", "drop"], ["Keep-Alive", "timeout=5"], ["Host", "example.invalid:9"], ["Content-Length", "999"]],
    body: sent.toString("base64"),
  });
  assert.ok(result);
  assert.equal(result.status, 201);
  assert.deepEqual(header(result.headers, "set-cookie"), ["a=1", "b=2"], "repeated headers stay pairs");
  assert.deepEqual(header(result.headers, "connection"), [], "hop-by-hop headers of the response are dropped");
  assert.deepEqual(Buffer.from(result.body, "base64"), bytes);
  assert.equal(header(result.headers, "x-echo-hash")[0], createHash("sha256").update(sent).digest("hex"), "the binary request body arrives unchanged");
  const [request] = own.seen;
  assert.ok(request);
  assert.equal(request.method, "POST");
  assert.equal(request.url, "/upload?name=a%20b");
  assert.deepEqual(rawHeader(request.headers, "host"), [`localhost:${own.port}`], "the service sees itself addressed as on its own machine");
  assert.deepEqual(rawHeader(request.headers, "x-test"), ["1", "2"]);
  assert.deepEqual(rawHeader(request.headers, "x-hop"), [], "a header that Connection names is hop-by-hop");
  assert.deepEqual(rawHeader(request.headers, "keep-alive"), []);
  assert.deepEqual(rawHeader(request.headers, "content-length"), [String(sent.length)]);
  assert.equal(await forward(executor, "run-a", own.port, null), null, "without a request the call only checks the port");
});

test("a port of another run or of no process is refused before anything is sent", async (t) => {
  const foreign = await service(t, (_request, response) => response.end("foreign"));
  const executor = executorWith(table([{ pid: 4202, runId: "run-b", port: foreign.port, address: "127.0.0.1" }]).processes);
  for (const request of [null, { method: "GET", path: "/", headers: [], body: "" }]) {
    await assert.rejects(forward(executor, "run-a", foreign.port, request), coded("forward-port-unknown", 404));
  }
  assert.deepEqual(foreign.seen, [], "the foreign service received nothing");
  assert.equal((await forward(executor, "run-b", foreign.port, { method: "GET", path: "/", headers: [], body: "" }))?.status, 200);
});

test("a redirect is answered, not followed", async (t) => {
  const own = await service(t, (_request, response) => {
    response.writeHead(302, { Location: "/elsewhere" });
    response.end();
  });
  const executor = executorWith(table([{ pid: 4203, runId: "run-a", port: own.port, address: "127.0.0.1" }]).processes);
  const result = await forward(executor, "run-a", own.port, { method: "GET", path: "/start", headers: [], body: "" });
  assert.equal(result?.status, 302);
  assert.deepEqual(header(result.headers, "location"), ["/elsewhere"]);
  assert.deepEqual(own.seen.map((entry) => entry.url), ["/start"]);
});

test("request and response bodies above the limit fail with a cause", async (t) => {
  const own = await service(t, (_request, response) => response.end(Buffer.alloc(FORWARD_BODY_LIMIT + 1)));
  const executor = executorWith(table([{ pid: 4204, runId: "run-a", port: own.port, address: "127.0.0.1" }]).processes);
  await assert.rejects(forward(executor, "run-a", own.port, { method: "GET", path: "/", headers: [], body: "" }),
    (error: unknown) => coded("forward-response-too-large", 502)(error) && /exceeds 16 MiB/.test((error as Error).message));
  await assert.rejects(forward(executor, "run-a", own.port, { method: "POST", path: "/", headers: [], body: Buffer.alloc(FORWARD_BODY_LIMIT + 1).toString("base64") }),
    coded("forward-request-too-large", 413));
  assert.equal(own.seen.length, 1, "the oversized request never left");
});

test("invalid requests are refused with a cause", async (t) => {
  const own = await service(t, (_request, response) => response.end());
  const executor = executorWith(table([{ pid: 4205, runId: "run-a", port: own.port, address: "127.0.0.1" }]).processes);
  const base = { method: "GET", path: "/", headers: [], body: "" };
  for (const request of [
    { ...base, method: "CONNECT" },
    { ...base, method: "GE T" },
    { ...base, path: "http://elsewhere/" },
    { ...base, body: "not base64!" },
    { ...base, headers: [["Bad Name", "x"]] },
    { ...base, headers: [["X-Value", "a\r\nInjected: yes"]] },
  ]) {
    await assert.rejects(forward(executor, "run-a", own.port, request), coded("forward-invalid", 400), JSON.stringify(request));
  }
  await assert.rejects(forward(executor, "run-a", 0, null), coded("forward-invalid", 400));
  assert.deepEqual(own.seen, []);
});

test("a wildcard listener is reached on loopback, IPv4 first, and an IPv6-only listener on ::1", async (t) => {
  assert.deepEqual(forwardTargets(["*"]), ["127.0.0.1", "::1"]);
  assert.deepEqual(forwardTargets(["*", "::1", "127.0.0.1"]), ["127.0.0.1", "::1"]);
  assert.deepEqual(forwardTargets(["::1"]), ["::1"]);
  assert.deepEqual(forwardTargets(["192.0.2.10"]), ["192.0.2.10"]);
  const ipv6 = await service(t, (_request, response) => response.end("v6"), "::1").catch(() => undefined);
  if (!ipv6) {
    t.diagnostic("This machine has no IPv6 loopback; the IPv6 case is skipped");
    return;
  }
  const executor = executorWith(table([{ pid: 4206, runId: "run-a", port: ipv6.port, address: "*" }]).processes);
  const result = await forward(executor, "run-a", ipv6.port, { method: "GET", path: "/", headers: [], body: "" });
  assert.equal(Buffer.from(result?.body ?? "", "base64").toString(), "v6");
});

test("a listener that accepts nothing and a service that does not answer fail with their cause", async (t) => {
  const silent = await service(t, () => undefined);
  const unused = await new Promise<number>((resolve) => {
    const probe = createServer();
    probe.listen(0, "127.0.0.1", () => {
      const { port } = probe.address() as AddressInfo;
      probe.close(() => resolve(port));
    });
  });
  const executor = executorWith(table([{ pid: 4207, runId: "run-a", port: unused, address: "127.0.0.1" }]).processes);
  await assert.rejects(forward(executor, "run-a", unused, { method: "GET", path: "/", headers: [], body: "" }),
    (error: unknown) => coded("forward-unreachable", 502)(error) && new RegExp(`port ${unused} at 127\\.0\\.0\\.1`).test((error as Error).message));
  await assert.rejects(forwardRequest({ port: silent.port, addresses: ["127.0.0.1"], request: { method: "GET", path: "/", headers: [], body: "" }, signal: undefined, timeoutMs: 100 }),
    (error: unknown) => coded("forward-timeout", 504)(error) && /within 0\.1 s/.test((error as Error).message));
});

test("which ports belong to a run is scanned once per tick, and the stop of the run forgets it", async (t) => {
  const own = await service(t, (_request, response) => response.end());
  const listening: Listener[] = [{ pid: 4208, runId: "run-a", port: own.port, address: "127.0.0.1" }];
  const { processes, scans } = table(() => listening);
  let clock = 0;
  const executor = executorWith(processes, () => clock);
  await Promise.all([1, 2, 3].map(() => forward(executor, "run-a", own.port, null)));
  await forward(executor, "run-a", own.port, null);
  assert.equal(scans.count, 1);
  clock = SERVICE_PORTS_TTL_MS;
  await forward(executor, "run-a", own.port, null);
  assert.equal(scans.count, 2);
  // The listener is gone before the stop, so the stop finds no process of the test table to signal.
  listening.length = 0;
  await executor.stopRun("run-a");
  await assert.rejects(forward(executor, "run-a", own.port, null), coded("forward-port-unknown", 404));
});
