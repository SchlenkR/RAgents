import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, readdir, realpath, rm } from "node:fs/promises";
import { createServer, type Server } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { PluginHost } from "@ragents/engine";
import { COMMAND_OPERATIONS, type CommandResult, type ProcessSandbox, type WorkspaceProcessSnapshot } from "@ragents/workspace-executor";
import { ServerProcessSandbox } from "../src/plugin-support/process-sandbox.ts";
import { publishLoopbackPorts } from "../src/plugin-support/process-sandbox-ports.ts";
import { sandboxServicesToken, WorkspaceSandboxHost } from "../src/plugin-support/workspace-sandbox-host.ts";

const closeServer = (server: Server): Promise<void> => new Promise((resolve) => server.close(() => resolve()));

const freePort = async (): Promise<number> => {
  const server = createServer();
  await new Promise<void>((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  await closeServer(server);
  return address.port;
};

const reachable = async (port: number): Promise<boolean> => {
  try {
    const response = await fetch(`http://127.0.0.1:${port}/`, { signal: AbortSignal.timeout(500) });
    return await response.text() === "acme";
  } catch { return false; }
};

const untilReachable = async (port: number): Promise<void> => {
  const deadline = Date.now() + 10000;
  while (!await reachable(port)) {
    if (Date.now() > deadline) throw new Error(`Published port ${port} did not become reachable`);
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
};

const listener = (ports: readonly number[], exitAfterMs?: number): string => `
const http = require("node:http");
for (const port of ${JSON.stringify(ports)}) http.createServer((request, response) => response.end("acme")).listen(port, "127.0.0.1");
${exitAfterMs === undefined ? "" : `setTimeout(() => process.exit(0), ${exitAfterMs});`}
`;

const fixture = async (isolated = false) => {
  const directory = await realpath(await mkdtemp(path.join(tmpdir(), "ragents-port-contract-")));
  const processSandbox = isolated ? new ServerProcessSandbox({
    network: [], serverAddress: undefined, dataDirectory: directory, disableSetting: 'SANDBOX: "off"',
  }) : undefined;
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
    identFor: async () => undefined,
    skillPaths: async () => [], storageRootFor: storage,
    ...(processSandbox ? { processSandbox } : {}),
  });
  const pluginHost = new PluginHost({ product: { id: "acme", title: "Acme" }, dataDirectory: directory,
    storageModes: { session: 0o700, sessionsRoot: 0o700 } });
  pluginHost.register({ manifest: { id: "acme.workspace" }, register: (registration) => registration.provide(sandboxServicesToken, host) });
  const services = pluginHost.service(sandboxServicesToken);
  return {
    host, directory, processSandbox,
    run: (runId: string, ports: readonly number[], publishPorts: unknown = ports, signal?: AbortSignal, exitAfterMs?: number) =>
      services.execute(runId, COMMAND_OPERATIONS.run, {
        program: process.execPath, args: ["-e", listener(ports, exitAfterMs)], publishPorts, timeoutMs: 30000,
      }, { signal }) as Promise<CommandResult>,
    close: async () => { await host.shutdownAll(); await processSandbox?.stop(); await rm(directory, { recursive: true, force: true }); },
  };
};

test("plugins publish through the sandbox service token; validation and conflicts fail before launch", async () => {
  const f = await fixture();
  const occupied = createServer();
  try {
    for (const ports of [null, "12000", [0], [65536], [1.5], ["12000"], [12000, 12000]]) {
      await assert.rejects(f.run(randomUUID(), [], ports), { code: "process-port-invalid" });
    }
    await new Promise<void>((resolve) => occupied.listen(0, "127.0.0.1", resolve));
    const address = occupied.address();
    assert.ok(address && typeof address !== "string");
    await assert.rejects(f.run(randomUUID(), [address.port]), (error: unknown) =>
      error instanceof Error && error.message.includes(String(address.port)) && (error as { code?: string }).code === "process-port-in-use");
  } finally { await closeServer(occupied); await f.close(); }
});

test("publication without a network namespace reaches loopback, stops with the run and reuses the same port", { timeout: 60000 }, async () => {
  const f = await fixture();
  const port = await freePort();
  const first = randomUUID();
  const finished = f.run(first, [port]);
  const stopped = assert.rejects(finished, /ended with its run/);
  try {
    await untilReachable(port);
    await f.host.shutdown(first);
    await stopped;
    assert.equal(await reachable(port), false);
    const reused = f.run(randomUUID(), [port], [port], undefined, 800);
    await untilReachable(port);
    assert.equal((await reused).exitCode, 0);
    assert.equal(await reachable(port), false);
  } finally { await f.close(); await stopped; }
});

test("publication cleanup runs when cancellation arrives after preparation", async () => {
  const f = await fixture();
  const controller = new AbortController();
  let closed = false;
  const context = await f.host.serverProcessContextFor(randomUUID());
  const sandbox: ProcessSandbox = {
    wrap: async (launch) => launch,
    publishPorts: async (launch) => {
      controller.abort(new Error("Cancelled during preparation"));
      return { launch, close: async () => { closed = true; } };
    },
  };
  const original = f.host.serverProcessContextFor.bind(f.host);
  f.host.serverProcessContextFor = async () => ({ ...context, sandbox });
  try {
    await assert.rejects(f.run(randomUUID(), [12000], [12000], controller.signal), /Cancelled during preparation/);
    assert.equal(closed, true);
  } finally { f.host.serverProcessContextFor = original; await f.close(); }
});

test("macOS publication grants only named loopback bindings and starts no transport bridge", { skip: process.platform !== "darwin" }, async () => {
  const directory = await realpath(await mkdtemp(path.join(tmpdir(), "ragents-port-profile-")));
  const sandbox = new ServerProcessSandbox({ network: [], serverAddress: undefined, dataDirectory: directory, disableSetting: 'SANDBOX: "off"', platform: "darwin" });
  const port = await freePort();
  try {
    const published = await sandbox.forRun({ isolated: true, writable: [directory], readable: [], temporary: directory })
      .publishPorts!({ command: process.execPath, args: ["-e", "process.exit(0)"] }, [port]);
    assert.match(published.launch.args.join(" "), new RegExp(`allow network-bind network-inbound \\(local ip "localhost:${port}"\\)`));
    assert.doesNotMatch(published.launch.args.join(" "), /local ip "\*:\*"|allow network-outbound|encodedPorts/);
    assert.deepEqual(await readdir(directory), []);
    await published.close();
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("macOS sandboxed publication reaches the named loopback port and releases it on exit", { skip: process.platform !== "darwin", timeout: 30000 }, async () => {
  const f = await fixture(true);
  const port = await freePort();
  const running = f.run(randomUUID(), [port], [port], undefined, 1500);
  try {
    await untilReachable(port);
    assert.equal((await running).exitCode, 0);
    assert.equal(await reachable(port), false);
  } finally { await f.close(); await running; }
});

const linuxNamespaceSkip = (() => {
  if (process.platform !== "linux") return "Linux network namespace check requires bubblewrap; this machine uses a different platform";
  try { execFileSync("bwrap", ["--version"], { stdio: "ignore" }); return false; }
  catch { return "Linux network namespace check requires bubblewrap, which is unavailable"; }
})();

test("Linux publication reaches only named namespace ports and ends on process stop, run stop and normal exit", { skip: linuxNamespaceSkip, timeout: 120000 }, async () => {
  const f = await fixture(true);
  const ports = await Promise.all([freePort(), freePort(), freePort()]);
  const [port, other, unpublished] = ports as [number, number, number];
  const first = randomUUID();
  const second = randomUUID();
  const controller = new AbortController();
  const running = f.run(first, [port, unpublished], [port], controller.signal);
  const ended = running.then((result) => result, (error: unknown) => error);
  const concurrent = f.run(second, [other]);
  const concurrentEnded = assert.rejects(concurrent, /ended with its run/);
  try {
    await Promise.all([untilReachable(port), untilReachable(other)]);
    assert.equal(await reachable(unpublished), false);
    await assert.rejects(f.run(randomUUID(), [port]), new RegExp(`port ${port}`));
    const snapshot = await f.host.execute(first, "processes.snapshot", {}) as WorkspaceProcessSnapshot;
    const listenerProcess = snapshot.processes.find((entry) => entry.command.includes(listener([port, unpublished]).trim()) && !entry.command.includes("encodedPorts"));
    assert.ok(listenerProcess, "The run's listener must be visible to process stop");
    await f.host.execute(first, "processes.stop", { processId: listenerProcess.id });
    await ended;
    assert.equal(await reachable(port), false);
    assert.equal(await reachable(other), true);
    await f.host.shutdown(second);
    await concurrentEnded;
    assert.equal(await reachable(other), false);
    const reused = f.run(randomUUID(), [port], [port], undefined, 1500);
    await untilReachable(port);
    assert.equal((await reused).exitCode, 0);
    assert.equal(await reachable(port), false);
    const packageDirectory = path.join(f.directory, randomUUID(), "package");
    await mkdir(packageDirectory, { recursive: true });
    const context = await f.host.isolatedProcessContextFor(randomUUID(), [packageDirectory], []);
    const { withSandboxedLaunch } = await import("@ragents/workspace-executor/src/process-sandbox.ts");
    const { runManagedProcess } = await import("@ragents/workspace-executor");
    const isolated = withSandboxedLaunch(context, { command: process.execPath, args: ["-e", listener([port], 1500)] }, [port],
      (launch) => runManagedProcess({ ...launch, args: [...launch.args], env: context.env, cwd: context.cwd, label: "acme", timeoutMs: 10000 }));
    await untilReachable(port);
    assert.equal((await isolated).code, 0);
    assert.equal(await reachable(port), false);
  } finally { controller.abort(); await f.close(); await ended; await concurrentEnded; }
});

test("Linux bridge setup releases earlier ports if a later bind or wrapping fails", { skip: process.platform !== "linux" }, async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "ragents-port-rollback-"));
  const first = await freePort();
  const occupied = createServer();
  await new Promise<void>((resolve) => occupied.listen(0, "127.0.0.1", resolve));
  const address = occupied.address();
  assert.ok(address && typeof address !== "string");
  try {
    await assert.rejects(publishLoopbackPorts(directory, { command: "acme", args: [] }, [first, address.port], async (launch) => launch), new RegExp(`port ${address.port}`));
    await assert.rejects(publishLoopbackPorts(directory, { command: "acme", args: [] }, [first], async () => { throw new Error("Wrapping failed"); }), /Wrapping failed/);
    const released = createServer();
    await new Promise<void>((resolve, reject) => { released.once("error", reject); released.listen(first, "127.0.0.1", resolve); });
    await closeServer(released);
    assert.deepEqual(await readdir(directory), []);
  } finally { await closeServer(occupied); await rm(directory, { recursive: true, force: true }); }
});
