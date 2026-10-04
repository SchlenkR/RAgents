import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, realpath, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test, { type TestContext } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import type { CallToolResult } from "@modelcontextprotocol/client";
import { WorkspaceOperationExecutor, executorMachine, workspaceProcessContext, type ProcessLaunch } from "@ragents/workspace-executor";
import { processExists } from "../../../packages/workspace-executor/src/managed-process.ts";
import type { McpServerDefinition, McpServers } from "../../../plugins/ragents.mcp/config.ts";
import { MCP_OPERATIONS, type McpServerSnapshot, type McpSnapshot } from "../../../plugins/ragents.mcp/executor/contract.ts";
import { mcpModule, type McpModuleOptions } from "../../../plugins/ragents.mcp/executor/module.ts";
import { httpFixture } from "./fixtures/mcp/http.mjs";

const stdioFile = fileURLToPath(new URL("./fixtures/mcp/stdio.mjs", import.meta.url));
const fixtureInstructions = "Use the fixture tools for protocol checks.";
const pause = (duration = 20): Promise<void> => new Promise((resolve) => setTimeout(resolve, duration));

const until = async (condition: () => boolean | Promise<boolean>, description: string, timeoutMs = 5_000): Promise<void> => {
  const deadline = Date.now() + timeoutMs;
  while (!await condition()) {
    if (Date.now() > deadline) throw new Error(`Timed out waiting for ${description}`);
    await pause();
  }
};

const withDeadline = async <T>(pending: Promise<T>, description: string, timeoutMs = 1_000): Promise<T> => {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      pending,
      new Promise<never>((_resolve, reject) => { timer = setTimeout(() => reject(new Error(`Timed out waiting for ${description}`)), timeoutMs); }),
    ]);
  } finally { clearTimeout(timer); }
};

interface FixtureEvent {
  readonly type: string;
  readonly pid?: number;
  readonly method?: string;
  readonly tool?: string;
  readonly capabilities?: Record<string, unknown>;
}

const readEvents = async (file: string): Promise<readonly FixtureEvent[]> => {
  const text = await readFile(file, "utf8").catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return "";
    throw error;
  });
  return text.split("\n").filter(Boolean).map((line) => JSON.parse(line) as FixtureEvent);
};

const executorFixture = async (t: TestContext, options: McpModuleOptions = {}) => {
  const directory = await realpath(await mkdtemp(path.join(tmpdir(), "ragents-mcp-executor-")));
  const workspace = path.join(directory, "workspace");
  const home = path.join(directory, "home");
  const logs = path.join(directory, "logs");
  await Promise.all([mkdir(path.join(workspace, "sub"), { recursive: true }), mkdir(home), mkdir(logs)]);
  const launches: ProcessLaunch[] = [];
  const machine = executorMachine(directory);
  const executor = new WorkspaceOperationExecutor({
    contextFor: async (runId) => workspaceProcessContext({
      runId,
      cwd: workspace,
      root: workspace,
      home: { home },
      logDirectory: logs,
      hostRoot: undefined,
      sandbox: { wrap: async (launch) => { launches.push(launch); return launch; } },
    }),
    modules: [mcpModule({ ...machine, processEnvironment: (runId) => ({ ...machine.processEnvironment(runId), MCP_TEST_MACHINE: "executor-environment", MCP_TEST_VALUE: "machine-default" }) }, { connectTimeoutMs: 5_000, requestTimeoutMs: 2_000, ...options })],
  });
  t.after(async () => {
    try { await executor.shutdown(); }
    finally { await rm(directory, { recursive: true, force: true }); }
  });
  const stdio = (mode: string, name = mode): { definition: McpServerDefinition; logFile: string } => {
    const logFile = path.join(logs, `${name}.jsonl`);
    return { definition: { command: process.execPath, args: [stdioFile, mode, logFile], cwd: "sub", env: { MCP_TEST_VALUE: "configured-value" } }, logFile };
  };
  const connect = (servers: McpServers, runId = "run-one") => executor.execute(runId, MCP_OPERATIONS.connect, { servers }) as Promise<McpSnapshot>;
  const call = (tool: string, args: Record<string, unknown> = {}, runId = "run-one", signal?: AbortSignal) =>
    executor.execute(runId, MCP_OPERATIONS.call, { server: "fixture", tool, arguments: args }, { signal }) as Promise<CallToolResult>;
  const watch = (runId = "run-one") => {
    const snapshots: McpSnapshot[] = [];
    const abort = new AbortController();
    const finished = executor.execute(runId, MCP_OPERATIONS.watch, {}, { untilAborted: true, signal: abort.signal, onProgress: (value) => snapshots.push(value as McpSnapshot) });
    t.after(async () => { abort.abort(); await finished; });
    return { snapshots, abort, finished };
  };
  return { executor, stdio, launches, workspace, connect, call, watch };
};

const serverOf = (snapshot: McpSnapshot, name = "fixture"): McpServerSnapshot => {
  const server = snapshot.servers.find((entry) => entry.name === name);
  assert.ok(server, `Missing server ${name}`);
  return server;
};

const resultText = (result: CallToolResult): string => result.content.filter((block) => block.type === "text").map((block) => block.text).join("\n");

for (const transport of ["modern-http", "modern-stdio", "legacy-sse", "legacy-stdio", "legacy-http"] as const) {
  test(`${transport} negotiates, lists, calls, notifies, cancels and releases a run`, async (t) => {
    const fixture = await executorFixture(t);
    const stdio = transport.endsWith("stdio") ? fixture.stdio(transport === "modern-stdio" ? "modern" : "legacy-strict") : undefined;
    const http = stdio ? undefined : await httpFixture(transport === "legacy-sse" ? "sse" : transport === "legacy-http" ? "streamable-legacy" : "modern");
    if (http) t.after(() => http.close());
    const definition = stdio?.definition ?? { url: http!.url, type: transport === "legacy-sse" ? "sse" as const : "http" as const };
    const snapshot = await fixture.connect({ fixture: definition });
    const server = serverOf(snapshot);
    assert.equal(server.state, "connected", server.error);
    assert.equal(server.transport, stdio ? "stdio" : transport === "legacy-sse" ? "sse" : "http");
    assert.equal(server.protocolVersion, transport.startsWith("modern") ? "2026-07-28" : transport === "legacy-http" ? "2025-03-26" : "2024-11-05");
    assert.equal(server.instructions, fixtureInstructions);
    assert.deepEqual(server.tools.map((tool) => tool.name), ["echo", "failure", "expand", "wait", "progress", "environment", "roots"]);
    assert.equal(server.tools[0].annotations?.readOnlyHint, true);
    assert.deepEqual(server.tools[0].inputSchema, { type: "object", properties: { text: { type: "string" } }, required: ["text"] });
    assert.equal(resultText(await fixture.call("echo", { text: "native tool response" })), "native tool response");
    const failure = await fixture.call("failure");
    assert.equal(failure.isError, true);
    assert.equal(resultText(failure), "Intentional MCP tool failure");

    const observed = fixture.watch();
    await fixture.call("expand");
    await until(() => observed.snapshots.some((state) => serverOf(state).tools.some((tool) => tool.name === "later")), `${transport} tool-list notification`);
    assert.equal(resultText(await fixture.call("later")), "New tool reached");

    const roots = JSON.parse(resultText(await fixture.call("roots"))) as { roots: { uri: string; name: string }[] };
    assert.deepEqual(roots.roots, [{ uri: pathToFileURL(fixture.workspace).href, name: path.basename(fixture.workspace) }]);
    const abort = new AbortController();
    const pending = fixture.call("wait", {}, "run-one", abort.signal);
    const rejected = assert.rejects(pending, /abort|cancel/i);
    await until(async () => stdio ? (await readEvents(stdio.logFile)).some((entry) => entry.type === "wait.started") : http!.log.some((entry: FixtureEvent) => entry.type === "wait.started"), `${transport} pending request`);
    abort.abort(new Error("Turn aborted"));
    await rejected;
    await until(async () => stdio ? (await readEvents(stdio.logFile)).some((entry) => entry.type === "wait.cancelled") : http!.log.some((entry: FixtureEvent) => entry.type === "wait.cancelled"), `${transport} server cancellation`);
    assert.equal(serverOf(observed.snapshots.at(-1)!).state, "connected", "cancelling one request must leave the server connected");
    assert.equal(resultText(await fixture.call("echo", { text: "after cancellation" })), "after cancellation");

    if (stdio) {
      const environment = JSON.parse(resultText(await fixture.call("environment"))) as { pid: number; cwd: string; value: string; machine: string; marker: string };
      assert.equal(environment.cwd, path.join(fixture.workspace, "sub"));
      assert.equal(environment.value, "configured-value");
      assert.equal(environment.machine, "executor-environment");
      assert.equal(environment.marker, "run-one");
      const entries = await readEvents(stdio.logFile);
      const started = entries.filter((entry) => entry.type === "process.started");
      if (transport === "legacy-stdio") {
        assert.equal(started.length, 2, "strict legacy stdio must restart after the modern discovery probe exits");
        assert.ok(entries.some((entry) => entry.pid === started[0].pid && entry.method === "server/discover"));
        assert.ok(entries.some((entry) => entry.pid === started[1].pid && entry.method === "initialize"));
        assert.equal(processExists(started[0].pid!), false);
        const capabilities = entries.find((entry) => entry.method === "initialize")!.capabilities!;
        assert.ok(capabilities.roots);
        assert.equal(capabilities.sampling, undefined);
        assert.equal(capabilities.elicitation, undefined);
      } else {
        assert.equal(started.length, 1);
        assert.ok(entries.some((entry) => entry.method === "server/discover"));
        assert.equal(entries.some((entry) => entry.method === "initialize"), false);
      }
      assert.equal(fixture.launches.length, started.length, "every process launch passes through the run sandbox");
      await fixture.executor.stopRun("run-one");
      assert.equal(processExists(environment.pid), false, "run stop must await process exit");
      assert.ok(started.every((entry) => !processExists(entry.pid!)));
    } else {
      await fixture.executor.stopRun("run-one");
      await until(() => transport === "modern-http" ? http!.subscriptions() === 0 : http!.sessionCount() === 0, `${transport} transport cleanup`);
    }
    await withDeadline(observed.finished, `${transport} status watch release on run stop`);
  });
}

for (const status of [400, 404, 405]) {
  test(`a URL without a transport falls back to legacy SSE after initialize HTTP ${status}`, async (t) => {
    const http = await httpFixture("sse", { rejectPost: status });
    t.after(() => http.close());
    const fixture = await executorFixture(t);
    const connected = serverOf(await fixture.connect({ fixture: { url: http.url } }));
    assert.equal(connected.state, "connected", connected.error);
    assert.equal(connected.transport, "sse");
    assert.equal(connected.protocolVersion, "2024-11-05");
    assert.ok(http.log.some((entry: { method?: string; rpc?: string }) => entry.method === "POST" && entry.rpc === "initialize"));
    assert.equal(resultText(await fixture.call("echo", { text: "fallback works" })), "fallback works");
    await fixture.executor.stopRun("run-one");
    await until(() => http.sessionCount() === 0, "fallback SSE session cleanup");
  });
}

test("the oldest supported legacy protocol remains usable over stdio", async (t) => {
  const fixture = await executorFixture(t);
  const child = fixture.stdio("legacy-strict");
  assert.ok("command" in child.definition);
  const connected = serverOf(await fixture.connect({ fixture: { ...child.definition, args: [...child.definition.args!, "2024-10-07"] } }));
  assert.equal(connected.state, "connected", connected.error);
  assert.equal(connected.protocolVersion, "2024-10-07");
  assert.equal(resultText(await fixture.call("echo", { text: "oldest protocol" })), "oldest protocol");
});

for (const version of ["2025-06-18", "2025-11-25"]) {
  test(`Streamable HTTP negotiates legacy protocol ${version}`, async (t) => {
    const fixture = await executorFixture(t);
    const http = await httpFixture("streamable-legacy", { protocolVersion: version });
    t.after(() => http.close());
    const connected = serverOf(await fixture.connect({ fixture: { url: http.url, type: "http" } }));
    assert.equal(connected.state, "connected", connected.error);
    assert.equal(connected.protocolVersion, version);
    assert.equal(resultText(await fixture.call("echo", { text: "negotiated protocol" })), "negotiated protocol");
  });
}

for (const status of [401, 403, 408, 429, 500]) {
  test(`HTTP ${status} is reported without a silent SSE fallback`, async (t) => {
    const http = await httpFixture("modern", { rejectStatus: status });
    t.after(() => http.close());
    const fixture = await executorFixture(t);
    const failed = serverOf(await fixture.connect({ fixture: { url: http.url } }));
    assert.equal(failed.state, "failed");
    assert.equal(failed.transport, "http");
    assert.ok(failed.error);
    assert.equal(http.log.some((entry: { method?: string; pathname?: string }) => entry.method === "GET" && entry.pathname === "/mcp"), false);
  });
}

test("an explicit HTTP transport never falls back to SSE", async (t) => {
  const http = await httpFixture("sse");
  t.after(() => http.close());
  const fixture = await executorFixture(t);
  const failed = serverOf(await fixture.connect({ fixture: { url: http.url, type: "http" } }));
  assert.equal(failed.state, "failed");
  assert.equal(failed.transport, "http");
  assert.ok(failed.error);
  assert.equal(http.log.some((entry: { method?: string }) => entry.method === "GET"), false);
});

test("network connection failures remain visible as HTTP failures", async (t) => {
  const http = await httpFixture("modern");
  await http.close();
  const fixture = await executorFixture(t);
  const failed = serverOf(await fixture.connect({ fixture: { url: http.url } }));
  assert.equal(failed.state, "failed");
  assert.equal(failed.transport, "http");
  assert.match(failed.error!, /fetch|connect|refused|network/i);
});

for (const transport of ["http", "sse"] as const) {
  test(`${transport} passes static headers on connection, calls and tool-list updates`, async (t) => {
    const authorization = "Bearer fixture-authorization";
    const http = await httpFixture(transport === "http" ? "modern" : "sse", { authorization });
    t.after(() => http.close());
    const fixture = await executorFixture(t);
    const connected = serverOf(await fixture.connect({ fixture: { url: http.url, type: transport, headers: { Authorization: authorization } } }));
    assert.equal(connected.state, "connected", connected.error);
    assert.equal(resultText(await fixture.call("echo", { text: "authorized" })), "authorized");
    const observed = fixture.watch();
    await fixture.call("expand");
    await until(() => observed.snapshots.some((snapshot) => serverOf(snapshot).tools.some((tool) => tool.name === "later")), "authorized tool-list update");
  });
}

test("progress notifications reset the request timeout", async (t) => {
  const fixture = await executorFixture(t, { requestTimeoutMs: 100 });
  const child = fixture.stdio("modern");
  assert.equal(serverOf(await fixture.connect({ fixture: child.definition })).state, "connected");
  assert.equal(resultText(await fixture.call("progress")), "Progress completed");
});

test("a pre-aborted tool call never reaches the server", async (t) => {
  const fixture = await executorFixture(t);
  const child = fixture.stdio("modern");
  assert.equal(serverOf(await fixture.connect({ fixture: child.definition })).state, "connected");
  const abort = new AbortController();
  abort.abort(new Error("Turn already aborted"));
  await assert.rejects(fixture.call("echo", { text: "must not run" }, "run-one", abort.signal), /abort/i);
  assert.equal((await readEvents(child.logFile)).some((entry) => entry.type === "tool.called"), false);
});

test("disconnection keeps the last tools and a call fails clearly while triggering reconnection", async (t) => {
  const fixture = await executorFixture(t);
  const child = fixture.stdio("modern");
  const initial = serverOf(await fixture.connect({ fixture: child.definition }));
  assert.equal(initial.state, "connected", initial.error);
  const observed = fixture.watch();
  const environment = JSON.parse(resultText(await fixture.call("environment"))) as { pid: number };
  process.kill(environment.pid, "SIGTERM");
  await until(() => observed.snapshots.some((snapshot) => serverOf(snapshot).state === "failed"), "disconnect status");
  const failed = serverOf(observed.snapshots.at(-1)!);
  assert.equal(failed.state, "failed");
  assert.match(failed.error!, /disconnect|exit|close/i);
  assert.deepEqual(failed.tools, initial.tools);
  await assert.rejects(fixture.call("echo", { text: "while disconnected" }), /unavailable.*reconnect/i);
  await until(() => observed.snapshots.at(-1)?.servers[0].state === "connected", "stdio reconnect");
  assert.equal(resultText(await fixture.call("echo", { text: "reconnected" })), "reconnected");
  assert.equal((await readEvents(child.logFile)).filter((entry) => entry.type === "process.started").length, 2);
  await fixture.executor.stopRun("run-one");
  assert.ok((await readEvents(child.logFile)).filter((entry) => entry.type === "process.started").every((entry) => !processExists(entry.pid!)));
});

test("servers connect in parallel with a bounded timeout and their child processes are cleaned up", async (t) => {
  const fixture = await executorFixture(t, { connectTimeoutMs: 1_000 });
  const first = fixture.stdio("hang", "first");
  const second = fixture.stdio("hang", "second");
  const started = Date.now();
  const connected = await fixture.connect({ first: first.definition, second: second.definition });
  assert.ok(Date.now() - started < 1_800, "two independent one-second connection limits must run concurrently");
  assert.equal(connected.servers.length, 2);
  assert.ok(connected.servers.every((server) => server.state === "failed" && /timeout|timed out|abort/i.test(server.error ?? "")));
  await fixture.executor.stopRun("run-one");
  for (const child of [first, second]) {
    assert.ok((await readEvents(child.logFile)).filter((entry) => entry.type === "process.started").every((entry) => !processExists(entry.pid!)));
  }
});

for (const transport of ["http", "sse"] as const) {
  test(`${transport} opening has an absolute deadline even when the server never answers`, { timeout: 5_000 }, async (t) => {
    const http = await httpFixture(`${transport}-hang`);
    const fixture = await executorFixture(t, { connectTimeoutMs: 120 });
    try {
      const snapshot = await withDeadline(fixture.connect({ fixture: { url: http.url, type: transport } }), "MCP opening deadline");
      const failed = serverOf(snapshot);
      assert.equal(failed.state, "failed");
      assert.match(failed.error!, /timed out|timeout|abort/i);
      assert.ok(http.log.length > 0, "the connection deadline must include transport startup");
    } finally {
      await http.close();
      await fixture.executor.stopRun("run-one");
    }
  });
  test(`stopping a run releases a pending ${transport} opening immediately`, { timeout: 5_000 }, async (t) => {
    const http = await httpFixture(`${transport}-hang`);
    const fixture = await executorFixture(t);
    try {
      const connecting = fixture.connect({ fixture: { url: http.url, type: transport } });
      await until(() => http.log.length > 0, `${transport} opening`);
      await withDeadline(fixture.executor.stopRun("run-one"), `${transport} run stop`);
      await withDeadline(connecting, `${transport} cancelled opening`);
    } finally { await http.close(); }
  });
}

test("stopping a run during initialization ends its in-flight child process", async (t) => {
  const fixture = await executorFixture(t);
  const child = fixture.stdio("hang");
  const connecting = fixture.connect({ fixture: child.definition });
  await until(async () => (await readEvents(child.logFile)).some((entry) => entry.type === "process.started"), "initializing child process");
  await fixture.executor.stopRun("run-one");
  await connecting;
  const started = (await readEvents(child.logFile)).filter((entry) => entry.type === "process.started");
  assert.ok(started.length > 0);
  assert.ok(started.every((entry) => !processExists(entry.pid!)));
});

test("a configured cwd cannot escape the workspace through a symlink", async (t) => {
  const fixture = await executorFixture(t);
  await symlink(path.join(path.dirname(fixture.workspace), "home"), path.join(fixture.workspace, "escape"));
  const child = fixture.stdio("modern");
  const failed = serverOf(await fixture.connect({ fixture: { ...child.definition, cwd: "escape" } }));
  assert.equal(failed.state, "failed");
  assert.match(failed.error!, /outside the working directory/i);
  assert.deepEqual(await readEvents(child.logFile), []);
});

test("stderr diagnostics are bounded and retain the final process cause", async (t) => {
  const fixture = await executorFixture(t);
  const child = fixture.stdio("stderr-failure");
  const failed = serverOf(await fixture.connect({ fixture: child.definition }));
  assert.equal(failed.state, "failed");
  assert.ok(failed.error!.length <= 2_048);
  assert.match(failed.error!, /Final fixture cause/);
  assert.equal(failed.error!.includes("configured-value"), false, "configured environment values are redacted from diagnostics");
});

test("close, run stop and shutdown independently release every run's child process", async (t) => {
  const fixture = await executorFixture(t);
  const children = ["one", "two", "three"].map((name) => fixture.stdio("modern", name));
  await Promise.all(children.map((child, index) => fixture.connect({ fixture: child.definition }, `run-${index}`)));
  const pids = await Promise.all(children.map(async (child) => (await readEvents(child.logFile)).find((entry) => entry.type === "process.started")!.pid!));
  assert.ok(pids.every(processExists));
  await fixture.executor.execute("run-0", MCP_OPERATIONS.close, {});
  assert.equal(processExists(pids[0]), false);
  assert.ok(processExists(pids[1]));
  await fixture.executor.stopRun("run-1");
  assert.equal(processExists(pids[1]), false);
  assert.ok(processExists(pids[2]));
  await fixture.executor.shutdown();
  assert.equal(processExists(pids[2]), false);
});

test("an unresponsive HTTP session termination fails within its limit and still closes local connections", { timeout: 10_000 }, async (t) => {
  const http = await httpFixture("streamable-legacy", { stallTermination: true });
  t.after(() => http.close());
  const fixture = await executorFixture(t);
  const connected = serverOf(await fixture.connect({ fixture: { url: http.url, type: "http" } }));
  assert.equal(connected.state, "connected", connected.error);
  const observed = fixture.watch();
  await until(() => http.openStreams() > 0, "the legacy HTTP change stream");
  assert.equal(resultText(await fixture.call("echo", { text: "before stopping" })), "before stopping");
  const started = Date.now();
  await assert.rejects(withDeadline(fixture.executor.stopRun("run-one"), "bounded HTTP termination", 4_000), /time|abort/i);
  assert.ok(Date.now() - started < 3_500, "the termination deadline must not wait for the remote server");
  assert.ok(http.log.some((entry: { method?: string }) => entry.method === "DELETE"));
  await until(() => http.openStreams() === 0, "local connection cleanup after failed DELETE");
  await withDeadline(observed.finished, "status watch cleanup after failed DELETE");
  await assert.rejects(fixture.call("echo", { text: "after failed termination" }), /not connected|not.*connected/i);
});

test("aborting a partial connection awaits failed HTTP cleanup and closes the pending process and watch", { timeout: 10_000 }, async (t) => {
  const fixture = await executorFixture(t);
  const http = await httpFixture("streamable-legacy", { stallTermination: true });
  t.after(() => http.close());
  const child = fixture.stdio("hang");
  const abort = new AbortController();
  const opening = fixture.executor.execute("run-one", MCP_OPERATIONS.connect, {
    servers: { fixture: { url: http.url, type: "http" }, hanging: child.definition },
  }, { signal: abort.signal });
  const observed = fixture.watch();
  await until(() => observed.snapshots.some((snapshot) => serverOf(snapshot).state === "connected") && http.openStreams() > 0, "the HTTP connection while another server is opening");
  await until(async () => (await readEvents(child.logFile)).some((entry) => entry.type === "process.started"), "the hanging initialization process");
  assert.equal(serverOf(observed.snapshots.at(-1)!, "hanging").state, "connecting");
  assert.equal(resultText(await fixture.call("echo", { text: "partially connected" })), "partially connected");
  const settled = assert.rejects(withDeadline(opening, "aborted multi-server opening", 4_000), /time|abort/i);
  const started = Date.now();
  abort.abort(new Error("Opening cancelled by the turn"));
  await settled;
  assert.ok(Date.now() - started < 3_500, "abort must await bounded cleanup without an unhandled rejection");
  assert.ok(http.log.some((entry: { method?: string }) => entry.method === "DELETE"));
  await until(() => http.openStreams() === 0, "HTTP connection cleanup after aborted opening");
  await withDeadline(observed.finished, "watch cleanup after aborted opening");
  const startedProcesses = (await readEvents(child.logFile)).filter((entry) => entry.type === "process.started");
  assert.ok(startedProcesses.length > 0);
  assert.ok(startedProcesses.every((entry) => !processExists(entry.pid!)));
  await assert.rejects(fixture.call("echo", { text: "after aborted opening" }), /not connected|not.*connected/i);
});
