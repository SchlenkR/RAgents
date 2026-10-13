import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, readdir, realpath, rm } from "node:fs/promises";
import { connect, createServer, type Server, type Socket } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { PluginHost } from "@ragents/engine";
import { COMMAND_OPERATIONS, runManagedProcess, type CommandResult, type TcpEndpoint, type TcpForward } from "@ragents/workspace-executor";
import { withSandboxedLaunch } from "@ragents/workspace-executor/src/process-sandbox.ts";
import { ServerProcessSandbox } from "../src/plugin-support/process-sandbox.ts";
import { forwardLoopbackTargets, publishLoopbackPorts } from "../src/plugin-support/process-sandbox-ports.ts";
import { sandboxServicesToken, WorkspaceSandboxHost } from "../src/plugin-support/workspace-sandbox-host.ts";

const closeServer = (server: Server): Promise<void> => new Promise((resolve) => server.close(() => resolve()));
const listen = (server: Server): Promise<number> => new Promise((resolve, reject) => {
  server.once("error", reject);
  server.listen(0, "127.0.0.1", () => {
    const address = server.address();
    assert.ok(address && typeof address !== "string");
    resolve(address.port);
  });
});
const freePort = async (): Promise<number> => {
  const server = createServer();
  const port = await listen(server);
  await closeServer(server);
  return port;
};

const fixture = async (network?: readonly string[]) => {
  const directory = await realpath(await mkdtemp(path.join(tmpdir(), "ragents-tcp-contract-")));
  const processSandbox = network ? new ServerProcessSandbox({ network, serverAddress: undefined, dataDirectory: directory, disableSetting: 'SANDBOX: "off"' }) : undefined;
  try { await processSandbox?.start(); }
  catch (error) { await rm(directory, { recursive: true, force: true }); throw error; }
  const storage = (runId: string): string => path.join(directory, runId);
  const host = new WorkspaceSandboxHost({
    contributorName: "acme.workspace", contributions: [],
    workspaceFor: async (runId) => {
      const cwd = path.join(storage(runId), "workspace");
      await mkdir(cwd, { recursive: true });
      return { cwd, currentRoot: async () => cwd, runOperation: (work) => work() };
    },
    homeFor: async (runId) => {
      const home = path.join(storage(runId), "home");
      await mkdir(home, { recursive: true });
      return { home };
    },
    identFor: async () => undefined, skillPaths: async () => [], storageRootFor: storage,
    ...(processSandbox ? { processSandbox } : {}),
  });
  const pluginHost = new PluginHost({ product: { id: "acme", title: "Acme" }, dataDirectory: directory,
    storageModes: { session: 0o700, sessionsRoot: 0o700 } });
  pluginHost.register({ manifest: { id: "acme.workspace" }, register: (registration) => registration.provide(sandboxServicesToken, host) });
  const services = pluginHost.service(sandboxServicesToken);
  return {
    directory, host,
    endpoints: (runId: string, forwardTcp: unknown) => services.execute(runId, COMMAND_OPERATIONS.tcpEndpoints, { forwardTcp }) as Promise<readonly TcpEndpoint[]>,
    run: (runId: string, forwardTcp: unknown, script: string, options: { signal?: AbortSignal; timeoutMs?: number; publishPorts?: readonly number[] } = {}) =>
      services.execute(runId, COMMAND_OPERATIONS.run, { program: process.execPath, args: ["-e", script], forwardTcp,
        publishPorts: options.publishPorts, timeoutMs: options.timeoutMs ?? 30000 }, { signal: options.signal }) as Promise<CommandResult>,
    close: async () => { await host.shutdownAll(); await processSandbox?.stop(); await rm(directory, { recursive: true, force: true }); },
  };
};

const echoTarget = async () => {
  const sockets = new Set<Socket>();
  const server = createServer({ allowHalfOpen: true }, (socket) => {
    sockets.add(socket);
    socket.once("close", () => sockets.delete(socket));
    socket.on("error", () => socket.destroy());
    const chunks: Buffer[] = [];
    socket.on("data", (chunk: Buffer) => chunks.push(chunk));
    socket.once("end", () => socket.end(Buffer.concat(chunks)));
  });
  const port = await listen(server);
  return { port, close: async () => { for (const socket of sockets) socket.destroy(); await closeServer(server); } };
};

const echoClient = (endpoint: TcpEndpoint, linger = false): string => `
const net = require("node:net");
const payload = Buffer.alloc(256 * 1024, 37);
const chunks = [];
const socket = net.connect(${JSON.stringify(endpoint)});
socket.once("error", (error) => { console.error(error.message); process.exit(1); });
socket.once("connect", () => socket.end(payload));
socket.on("data", (chunk) => chunks.push(chunk));
socket.once("end", () => {
  if (!Buffer.concat(chunks).equals(payload)) process.exit(2);
  console.log("echo complete");
  ${linger ? "setInterval(() => {}, 1000);" : ""}
});
`;

test("plugin TCP endpoint and command operations validate requests and keep direct workstation targets", async () => {
  const f = await fixture();
  const target = await echoTarget();
  const forwardTcp = [{ host: "127.0.0.1", port: target.port, insidePort: await freePort() }];
  try {
    for (const value of [null, undefined, "db.example.test:1433", [{}], [{ host: "db.example.test", port: 0, insidePort: 11433 }]]) {
      await assert.rejects(f.endpoints(randomUUID(), value), { code: "process-tcp-invalid" });
      if (value !== undefined) await assert.rejects(f.run(randomUUID(), value, "process.exit(0)"), { code: "process-tcp-invalid" });
    }
    const [endpoint] = await f.endpoints(randomUUID(), forwardTcp);
    assert.deepEqual(endpoint, { host: "127.0.0.1", port: target.port });
    const occupied = createServer();
    await new Promise<void>((resolve) => occupied.listen(forwardTcp[0]!.insidePort, "127.0.0.1", resolve));
    try {
      const result = await f.run(randomUUID(), forwardTcp, echoClient(endpoint!));
      assert.equal(result.exitCode, 0, result.stderr);
      assert.match(result.stdout, /echo complete/);
      await assert.rejects(f.run(randomUUID(), forwardTcp, "process.exit(0)", { publishPorts: [forwardTcp[0]!.insidePort] }), { code: "process-tcp-invalid" });
    } finally { await closeServer(occupied); }
  } finally { await target.close(); await f.close(); }
});

test("TCP grants are server-specific and preserve exact host, subdomain and port restrictions", () => {
  const folders = { writable: [], readable: [], temporary: tmpdir() };
  const sandbox = (network: readonly string[]) => new ServerProcessSandbox({ network, serverAddress: "http://127.0.0.1:4710",
    dataDirectory: tmpdir(), platform: "linux", disableSetting: 'SANDBOX: "off"' }).forRun(folders);
  const forward = (host: string, port = 1433): TcpForward[] => [{ host, port, insidePort: 11433 }];
  return (async () => {
    const allowed = sandbox(["db.example.test:1433", "*.data.example.test:1433", "cache.example.test", "[::1]:1433"]);
    for (const [host, port] of [["db.example.test", 1433], ["DB.EXAMPLE.TEST", 1433], ["one.data.example.test", 1433], ["cache.example.test", 6379], ["::1", 1433]] as const) {
      assert.deepEqual(await allowed.tcpEndpoints!(forward(host, port)), [{ host: "127.0.0.1", port: 11433 }]);
    }
    for (const [host, port] of [["db.example.test", 1434], ["evil-db.example.test", 1433], ["data.example.test", 1433], ["other.example.test", 1433], ["127.0.0.1", 4710]] as const) {
      await assert.rejects(allowed.tcpEndpoints!(forward(host, port)), (error: unknown) =>
        error instanceof Error && error.message.includes(`${host}:${port}`) && (error as { code?: string }).code === "process-tcp-denied");
      await assert.rejects(allowed.forwardTcp!({ command: "acme", args: [] }, forward(host, port), []), { code: "process-tcp-denied" });
    }
    for (const network of [[], ["*"], ["other.example.test:1433"]]) {
      await assert.rejects(sandbox(network).tcpEndpoints!(forward("db.example.test")), { code: "process-tcp-denied" });
    }
  })();
});

test("macOS forwards grant only named loopback TCP destinations and allocate no Unix socket folder", { skip: process.platform !== "darwin" }, async () => {
  const directory = await realpath(await mkdtemp(path.join(tmpdir(), "ragents-tcp-profile-")));
  const sandbox = new ServerProcessSandbox({ network: ["127.0.0.1:1433"], serverAddress: undefined, dataDirectory: directory, disableSetting: 'SANDBOX: "off"' });
  const insidePort = await freePort();
  const forwardTcp = [{ host: "127.0.0.1", port: 1433, insidePort }];
  try {
    const run = sandbox.forRun({ isolated: true, writable: [directory], readable: [], temporary: directory });
    assert.deepEqual(await run.tcpEndpoints!(forwardTcp), [{ host: "127.0.0.1", port: insidePort }]);
    const prepared = await run.forwardTcp!({ command: process.execPath, args: ["-e", "process.exit(0)"] }, forwardTcp, []);
    assert.match(prepared.launch.args.join(" "), new RegExp(`allow network-outbound \\(remote tcp "localhost:${insidePort}"\\)`));
    assert.doesNotMatch(prepared.launch.args.join(" "), /localhost:\*|encodedPorts/);
    assert.deepEqual(await readdir(directory), []);
    await prepared.close();
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("macOS sandboxed raw TCP reaches only its granted target through loopback and releases it on exit", { skip: process.platform !== "darwin", timeout: 30000 }, async () => {
  const target = await echoTarget();
  try {
    const f = await fixture([`127.0.0.1:${target.port}`]);
    try {
      const forwards = [{ host: "127.0.0.1", port: target.port, insidePort: await freePort() }];
      const [endpoint] = await f.endpoints(randomUUID(), forwards);
      const result = await f.run(randomUUID(), forwards, echoClient(endpoint!));
      assert.equal(result.exitCode, 0, result.stderr);
      assert.match(result.stdout, /echo complete/);
      const released = createServer();
      await new Promise<void>((resolve, reject) => { released.once("error", reject); released.listen(forwards[0]!.insidePort, "127.0.0.1", resolve); });
      await closeServer(released);
      const direct = await f.run(randomUUID(), [], echoClient({ host: "127.0.0.1", port: target.port }));
      assert.equal(direct.exitCode, 1, "The command must not gain direct target access");
    } finally { await f.close(); }
  } finally { await target.close(); }
});

const linuxNamespaceSkip = (() => {
  if (process.platform !== "linux") return "Linux TCP namespace check requires bubblewrap; this machine uses a different platform";
  try { execFileSync("bwrap", ["--version"], { stdio: "ignore" }); return false; }
  catch { return "Linux TCP namespace check requires bubblewrap, which is unavailable"; }
})();

test("Linux TCP forwarding preserves binary half-close, shares publication and ends with each launch", { skip: linuxNamespaceSkip, timeout: 90000 }, async () => {
  const target = await echoTarget();
  const f = await fixture([`127.0.0.1:${target.port}`]).catch(async (error: unknown) => { await target.close(); throw error; });
  const insidePort = await freePort();
  const publishedPort = await freePort();
  const forwardTcp = [{ host: "127.0.0.1", port: target.port, insidePort }];
  try {
    const [endpoint] = await f.endpoints(randomUUID(), forwardTcp);
    assert.deepEqual(endpoint, { host: "127.0.0.1", port: insidePort });
    const finished = await f.run(randomUUID(), forwardTcp, echoClient(endpoint!));
    assert.equal(finished.exitCode, 0, finished.stderr);
    assert.match(finished.stdout, /echo complete/);
    const failedRun = randomUUID();
    assert.equal((await f.run(failedRun, forwardTcp, "process.exit(9)")).exitCode, 9);
    assert.deepEqual(await readdir(path.join(f.directory, failedRun, "tmp")), []);
    for (const mode of ["cancel", "stop", "timeout"]) {
      const runId = randomUUID();
      const controller = new AbortController();
      const script = `require("node:net").createServer((socket) => socket.end("ready")).listen(${publishedPort}, "127.0.0.1");\n` + echoClient(endpoint!, true);
      const running = f.run(runId, forwardTcp, script, { signal: controller.signal, publishPorts: [publishedPort], timeoutMs: mode === "timeout" ? 4000 : 30000 });
      const ended = assert.rejects(running, mode === "cancel" ? /cancelled/ : mode === "stop" ? /ended with its run/ : /exceeded the timeout/);
      const deadline = Date.now() + 10000;
      while (true) {
        const ready = await new Promise<boolean>((resolve) => {
          const socket = connect({ host: "127.0.0.1", port: publishedPort });
          socket.setTimeout(300, () => socket.destroy());
          socket.once("data", () => { socket.destroy(); resolve(true); });
          socket.once("error", () => resolve(false));
          socket.once("close", () => resolve(false));
        });
        if (ready) break;
        if (Date.now() > deadline) throw new Error("The combined launch did not become ready");
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
      if (mode === "cancel") controller.abort(new Error("cancelled"));
      if (mode === "stop") await f.host.shutdown(runId);
      await ended;
      assert.deepEqual(await readdir(path.join(f.directory, runId, "tmp")), []);
    }
    const simultaneous = await Promise.all([1, 2].map(async () => {
      const runId = randomUUID();
      return f.run(runId, forwardTcp, echoClient((await f.endpoints(runId, forwardTcp))[0]!));
    }));
    for (const result of simultaneous) assert.equal(result.exitCode, 0, result.stderr);
    const packageDirectory = path.join(f.directory, "package");
    await mkdir(packageDirectory);
    const isolated = await f.host.isolatedProcessContextFor(randomUUID(), [packageDirectory], []);
    const isolatedResult = await withSandboxedLaunch(isolated, { command: process.execPath, args: ["-e", echoClient(endpoint!)] }, [],
      (launch) => runManagedProcess({ ...launch, args: [...launch.args], env: isolated.env, cwd: isolated.cwd, label: "acme", timeoutMs: 10000 }), forwardTcp);
    assert.equal(isolatedResult.code, 0);
    const denied = [{ ...forwardTcp[0]!, port: await freePort() }];
    await assert.rejects(f.endpoints(randomUUID(), denied), { code: "process-tcp-denied" });
    await assert.rejects(f.run(randomUUID(), denied, "process.exit(0)"), { code: "process-tcp-denied" });
    const direct = await f.run(randomUUID(), [], echoClient({ host: "127.0.0.1", port: target.port }));
    assert.equal(direct.exitCode, 1, "The host target must stay unreachable without its bridge");
  } finally { await f.close(); await target.close(); }
});

test("Linux TCP preparation removes its socket folder if wrapping fails", { skip: process.platform !== "linux" }, async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "ragents-tcp-rollback-"));
  try {
    await assert.rejects(publishLoopbackPorts(directory, { command: "acme", args: [] }, [], async () => {
      throw new Error("Wrapping failed");
    }, [{ host: "db.example.test", port: 1433, insidePort: 11433 }]), /Wrapping failed/);
    assert.deepEqual(await readdir(directory), []);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("loopback target preparation rolls back earlier binds on conflict or wrapping failure", async () => {
  const occupied = createServer();
  const occupiedPort = await listen(occupied);
  const insidePort = await freePort();
  const first = { host: "db.example.test", port: 1433, insidePort };
  try {
    await assert.rejects(forwardLoopbackTargets({ command: "acme", args: [] }, [first, { ...first, insidePort: occupiedPort }], async (launch) => launch),
      (error: unknown) => error instanceof Error && error.message.includes("db.example.test:1433") && (error as { code?: string }).code === "process-tcp-unavailable");
    await assert.rejects(forwardLoopbackTargets({ command: "acme", args: [] }, [first], async () => { throw new Error("Wrapping failed"); }), /Wrapping failed/);
    const released = createServer();
    await new Promise<void>((resolve, reject) => { released.once("error", reject); released.listen(insidePort, "127.0.0.1", resolve); });
    await closeServer(released);
  } finally { await closeServer(occupied); }
});
