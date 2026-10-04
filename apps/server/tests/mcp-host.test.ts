import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test, { after, type TestContext } from "node:test";
import type { CallToolResult } from "@modelcontextprotocol/client";
import { fauxAssistantMessage, fauxToolCall, registerFauxProvider, type Context } from "@ragents/ai";
import { isNativeTool, type RunFunction, type ToolScope } from "@ragents/engine";
import type { WorkspaceExecuteOptions } from "@ragents/workspace-executor";
import { env, type RAgentsConfig } from "../src/config-definition.ts";
import { resolveStructuredConfig } from "../src/config-file.ts";
import type { SandboxServices } from "../src/plugin-support/workspace-sandbox-host.ts";
import { parseMcpServers, type McpServers } from "../../../plugins/ragents.mcp/config.ts";
import { MCP_OPERATIONS, type McpSnapshot, type McpToolDefinition } from "../../../plugins/ragents.mcp/executor/contract.ts";
import { mcpToolName } from "../../../plugins/ragents.mcp/server/naming.ts";
import { boundedMcpText, mapMcpResult, MCP_OUTPUT_LIMIT } from "../../../plugins/ragents.mcp/server/results.ts";
import { RunMcp } from "../../../plugins/ragents.mcp/server/runtime.ts";
import { mcpRunServersToken } from "../../../plugins/ragents.mcp/server/service.ts";
import { httpFixture } from "./fixtures/mcp/http.mjs";

const suiteDirectory = await mkdtemp(path.join(tmpdir(), "ragents-mcp-host-"));
const environment = {
  DATA_DIR: path.join(suiteDirectory, "data"),
  PRODUCT_PROFILE: "core",
  PRODUCT_ID: "test-mcp",
  PRODUCT_TITLE: "MCP host fixture",
  PROCESS_SANDBOX: "off",
  COMPACTION_MODEL: "",
  MODEL_ALIASES: undefined,
  MODEL_PROVIDERS: undefined,
  MCP_SERVERS: undefined,
  ACCESS_TOKEN: undefined,
};
const previousEnvironment = new Map(Object.keys(environment).map((key) => [key, process.env[key]]));
for (const [key, value] of Object.entries(environment)) {
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
}
after(async () => {
  for (const [key, value] of previousEnvironment) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  await rm(suiteDirectory, { recursive: true, force: true });
});

const textResult = (text: string): CallToolResult => ({ content: [{ type: "text", text }] });
const tool = (name: string, readOnly = false): McpToolDefinition => ({ name, title: `Tool ${name}`, description: "Fixture tool",
  inputSchema: { type: "object", properties: { text: { type: "string" } } }, annotations: { readOnlyHint: readOnly } });
const connected = (tools: readonly McpToolDefinition[] = [tool("echo", true)]): McpSnapshot => ({ servers: [{ name: "fixture", transport: "stdio", state: "connected",
  protocolVersion: "2026-07-28", instructions: "Use the fixture for native calls.", tools }] });
const scope = (signal?: AbortSignal, modelContext: string | undefined = "model-context"): ToolScope => ({
  caller: { runId: "one", actorId: "actor", turnId: "turn" }, signal, modelContext,
} as ToolScope);
const invoke = (fn: RunFunction, id: string, input: object = {}, caller = scope()) => fn.run(caller, id, input as never);
const until = async (condition: () => boolean, description: string): Promise<void> => {
  const deadline = Date.now() + 10_000;
  while (!condition()) {
    assert.ok(Date.now() < deadline, `Timed out waiting for ${description}`);
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
};

const runtimeFixture = async (t: TestContext, options: {
  servers?: McpServers;
  connect?: (runId: string, servers: McpServers) => Promise<McpSnapshot>;
  call?: (input: { server: string; tool: string; arguments: Record<string, unknown> }) => CallToolResult | Promise<CallToolResult>;
  close?: () => Promise<unknown>;
} = {}) => {
  const directory = await mkdtemp(path.join(suiteDirectory, "runtime-"));
  const requests: { runId: string; operation: string; input: unknown; options?: WorkspaceExecuteOptions }[] = [];
  const watches = new Map<string, { options: WorkspaceExecuteOptions; failed: (cause: unknown) => void }>();
  const execute: SandboxServices["execute"] = async (runId, operation, input, execution) => {
    requests.push({ runId, operation, input, options: execution });
    if (operation === MCP_OPERATIONS.connect) return options.connect?.(runId, (input as { servers: McpServers }).servers) ?? connected();
    if (operation === MCP_OPERATIONS.call) return options.call?.(input as { server: string; tool: string; arguments: Record<string, unknown> }) ?? textResult("Fixture reply");
    if (operation === MCP_OPERATIONS.close) return options.close?.() ?? {};
    if (operation === MCP_OPERATIONS.watch) return new Promise((resolve, reject) => {
      assert.ok(execution?.untilAborted);
      watches.set(runId, { options: execution, failed: reject });
      if (execution.signal?.aborted) resolve({});
      else execution.signal?.addEventListener("abort", () => resolve({}), { once: true });
    });
    throw new Error(`Unexpected executor operation ${operation}`);
  };
  const fileFor = (runId: string) => path.join(directory, runId, "plugins", "ragents.mcp", "servers.json");
  const mcp = new RunMcp({ servers: options.servers ?? { fixture: { command: "fixture-mcp" } }, execute, fileFor });
  t.after(async () => { await mcp.shutdown(); await rm(directory, { recursive: true, force: true }); });
  return { mcp, execute, fileFor, requests, watches };
};

test("MCP configuration accepts pasted stdio, HTTP and legacy SSE entries and keeps definitions immutable", () => {
  const source = {
    files: { command: "npx", args: ["-y", "example-mcp", "."], cwd: "tools/mcp", env: { MODE: "read-only" } },
    docs: { url: "https://mcp.example.com/mcp", headers: { Authorization: "Bearer fixture-auth" } },
    legacy: { type: "sse", url: "http://localhost:8931/sse" },
    remote: { type: "http", url: "https://mcp.example.com/mcp" },
    process: { type: "stdio", command: "node" },
  };
  assert.deepEqual(parseMcpServers(undefined), {});
  assert.deepEqual(parseMcpServers({}), {});
  const parsed = parseMcpServers(source);
  assert.deepEqual(parsed, source);
  source.files.args.push("mutated");
  source.files.env.MODE = "mutated";
  assert.deepEqual("command" in parsed.files! ? parsed.files.args : undefined, ["-y", "example-mcp", "."]);
  assert.deepEqual("command" in parsed.files! ? parsed.files.env : undefined, { MODE: "read-only" });
  assert.ok(Object.isFrozen(parsed.files));
});

test("MCP configuration rejects unknown fields, invalid names, unsafe cwd and malformed transport inputs", () => {
  for (const invalid of [null, [], "{}", { "server.name": { command: "node" } }, { ["a".repeat(41)]: { command: "node" } },
    { fixture: { command: "node", url: "https://mcp.example.com" } }, { fixture: { command: "node", disabled: true } },
    { fixture: { type: "stdio", command: " " } }, { fixture: { command: "node", type: "http" } },
    { fixture: { command: "node", args: [1] } }, { fixture: { command: "node", env: { INVALID: 1 } } },
    { fixture: { command: "node", env: { "invalid-name": "x" } } }, { fixture: { type: "websocket", url: "https://mcp.example.com" } },
    { fixture: { url: "file:///tmp/mcp" } }, { fixture: { url: "https://user:pass@mcp.example.com" } },
    { fixture: { url: "https://mcp.example.com/#fragment" } }, { fixture: { url: "https://mcp.example.com", headers: { "Bad Header": "x" } } },
    { fixture: { url: "https://mcp.example.com", headers: { Authorization: "value\r\nInjected: x" } } }]) {
    assert.throws(() => parseMcpServers(invalid), /MCP_SERVERS/);
  }
  for (const cwd of ["", "/outside", "../outside", "sub/../../outside", "sub\\..\\outside", "C:\\outside", "\\outside"]) {
    assert.throws(() => parseMcpServers({ fixture: { command: "node", cwd } }), /cwd must be relative to and within the workspace/);
  }
});

test("structured plugin values are typed and recursively resolve env references in objects and arrays", () => {
  const profile = {
    "ragents.mcp": { MCP_SERVERS: {
      docs: { url: "https://mcp.example.com/mcp", headers: { Authorization: env("DOCS_AUTHORIZATION") } },
      files: { command: "node", env: { EXAMPLE_TOKEN: env("EXAMPLE_TOKEN"), MODE: "read-only" } },
    } },
    "acme.structured": { SETTINGS: [{ enabled: true, count: 2, text: null, nested: { value: env("NESTED_VALUE") } }] },
  } satisfies RAgentsConfig;
  const environment = { DOCS_AUTHORIZATION: "Bearer fixture-only", EXAMPLE_TOKEN: "fixture-only-token", NESTED_VALUE: "resolved" };
  const resolved = resolveStructuredConfig("fixture.ts", "ragents.mcp", "MCP_SERVERS", profile["ragents.mcp"].MCP_SERVERS, undefined, environment);
  assert.deepEqual(resolved, {
    docs: { url: "https://mcp.example.com/mcp", headers: { Authorization: "Bearer fixture-only" } },
    files: { command: "node", env: { EXAMPLE_TOKEN: "fixture-only-token", MODE: "read-only" } },
  });
  assert.deepEqual(resolveStructuredConfig("fixture.ts", "acme.structured", "SETTINGS", profile["acme.structured"].SETTINGS, undefined, environment),
    [{ enabled: true, count: 2, text: null, nested: { value: "resolved" } }]);
  assert.deepEqual(profile["ragents.mcp"].MCP_SERVERS.files.env.EXAMPLE_TOKEN, env("EXAMPLE_TOKEN"));
  assert.doesNotThrow(() => parseMcpServers(resolved));
});

test("nested secret keys need env references even inside arrays and missing references remain hard errors", () => {
  for (const key of ["EXAMPLE_KEY", "EXAMPLE_TOKEN", "EXAMPLE_SECRET", "EXAMPLE_PASSWORD", "EXAMPLE_PAT"]) {
    assert.throws(() => resolveStructuredConfig("fixture.ts", "acme.config", "SETTINGS", [{ nested: { [key]: "plain-secret" } }]),
      new RegExp(`SETTINGS\\.0\\.nested\\.${key}.*secret.*env`));
    assert.throws(() => resolveStructuredConfig("fixture.ts", "acme.config", key, "plain-secret"), /secret.*env/);
    assert.deepEqual(resolveStructuredConfig("fixture.ts", "acme.config", "SETTINGS", [{ nested: { [key]: env("SAFE_VALUE") } }], undefined, { SAFE_VALUE: "resolved" }),
      [{ nested: { [key]: "resolved" } }]);
  }
  assert.throws(() => resolveStructuredConfig("fixture.ts", "ragents.mcp", "MCP_SERVERS", { docs: { headers: { Authorization: env("MISSING_AUTH") } } }, undefined, {}),
    /MCP_SERVERS\.docs\.headers\.Authorization.*unset.*MISSING_AUTH/);
  assert.throws(() => resolveStructuredConfig("fixture.ts", "acme.config", "SETTINGS", { value: "${EXAMPLE_VALUE}" }), /must use env/);
  for (const value of [undefined, Number.NaN, Number.POSITIVE_INFINITY, new Date(), () => "not JSON"]) {
    assert.throws(() => resolveStructuredConfig("fixture.ts", "acme.config", "SETTINGS", { value }), /must be a JSON value/);
  }
});

test("MCP tool names follow the convention with stable sanitization and bounded collision-resistant names", () => {
  assert.equal(mcpToolName("files", "read_file"), "mcp__files__read_file");
  const entries = [["files", "read.file"], ["files", "read/file"], ["files", "read_file"], ["a".repeat(40), "long".repeat(100)]] as const;
  const names = entries.map(([server, name]) => mcpToolName(server, name));
  assert.equal(new Set(names).size, entries.length);
  for (const [index, name] of names.entries()) {
    assert.match(name, /^[A-Za-z0-9_-]{1,64}$/);
    assert.equal(name, mcpToolName(...entries[index]!));
  }
});

test("MCP results join text, prefer text over structured content and summarize binary and resource content", () => {
  assert.deepEqual(mapMcpResult({ content: [{ type: "text", text: "first" }, { type: "text", text: "second" }], structuredContent: { ignored: true } }),
    { text: "first\nsecond", images: [] });
  assert.deepEqual(mapMcpResult({ content: [], structuredContent: { count: 3, values: ["ready"] } }),
    { text: '{"count":3,"values":["ready"]}', images: [] });
  const image = { type: "image" as const, data: "fixture-image-bytes", mimeType: "image/png" };
  const result = mapMcpResult({ content: [image, { type: "audio", data: "audio-bytes", mimeType: "audio/wav" },
    { type: "resource_link", name: "manual", uri: "https://mcp.example.com/manual", mimeType: "text/html" },
    { type: "resource", resource: { uri: "mcp://fixture/readme", mimeType: "text/plain", text: "Relevant excerpt" } },
    { type: "resource", resource: { uri: "mcp://fixture/binary", mimeType: "application/pdf", blob: "binary-bytes" } }] });
  assert.deepEqual(result.images, [image]);
  assert.match(result.text, /Image: image\/png\nAudio: audio\/wav/);
  assert.match(result.text, /Resource: https:\/\/mcp\.example\.com\/manual \(text\/html\)/);
  assert.match(result.text, /mcp:\/\/fixture\/readme \(text\/plain\)\nRelevant excerpt/);
  assert.match(result.text, /mcp:\/\/fixture\/binary \(application\/pdf\)/);
  assert.doesNotMatch(result.text, /fixture-image-bytes|audio-bytes|binary-bytes/);
});

test("MCP failures use the server text and open-ended output is bounded per line and in total", () => {
  assert.throws(() => mapMcpResult({ ...textResult("Server rejected the request"), isError: true }), /^Error: Server rejected the request$/);
  const oversized = Array.from({ length: 30 }, (_, index) => `${index}: ${"x".repeat(1500)}`).join("\n");
  const mapped = mapMcpResult(textResult(oversized));
  assert.ok(mapped.text.length <= MCP_OUTPUT_LIMIT);
  assert.match(mapped.text, /Output truncated.*filters or pagination/);
  assert.ok(mapped.text.split("\n").every((line) => line.length <= 1020));
  assert.equal(boundedMcpText("Small result."), "Small result.");
  assert.throws(() => mapMcpResult({ ...textResult(oversized), isError: true }), (error: unknown) => error instanceof Error
    && error.message.length <= MCP_OUTPUT_LIMIT && error.message.includes("Output truncated"));
});

test("run-scoped servers survive reload with restrictive storage and reach only connection operations", async (t) => {
  const profile: McpServers = { profile: { command: "profile-command" } };
  const fixture = await runtimeFixture(t, { servers: profile });
  const additional: McpServers = {
    editor: { command: "editor-command", env: { EDITOR_TOKEN: "per-run-private-token", MODE: "local" } },
    docs: { url: "https://mcp.example.com/mcp", headers: { Authorization: "Bearer per-run-private-header" } },
  };
  await fixture.mcp.setRunServers("one", additional);
  assert.deepEqual(JSON.parse(await readFile(fixture.fileFor("one"), "utf8")), additional);
  if (process.platform !== "win32") {
    assert.equal((await stat(fixture.fileFor("one"))).mode & 0o777, 0o600);
    assert.equal((await stat(path.dirname(fixture.fileFor("one")))).mode & 0o777, 0o700);
  }
  assert.equal(fixture.requests.length, 0);
  const restored = new RunMcp({ servers: profile, execute: fixture.execute, fileFor: fixture.fileFor });
  t.after(() => restored.shutdown());
  await restored.restore("one");
  assert.deepEqual(restored.snapshot("one").servers.map((server) => server.name), ["profile", "editor", "docs"]);
  const functions = await restored.tools("one");
  const connect = fixture.requests.find((request) => request.operation === MCP_OPERATIONS.connect);
  assert.deepEqual(connect?.input, { servers: { ...profile, ...additional } });
  assert.equal(await invoke(functions[0]!, "call-one", { text: "requested text" }), "Fixture reply");
  const calls = fixture.requests.filter((request) => request.operation === MCP_OPERATIONS.call);
  assert.deepEqual(calls.map((request) => request.input), [{ server: "fixture", tool: "echo", arguments: { text: "requested text" } }]);
  assert.doesNotMatch(JSON.stringify(calls), /per-run-private|editor-command|mcp\.example/);
  assert.doesNotMatch(JSON.stringify(functions), /per-run-private|editor-command|mcp\.example/);
  await assert.rejects(restored.setRunServers("one", {}), /before the run's first tool resolution/);
  await assert.rejects(fixture.mcp.setRunServers("two", { profile: { command: "shadow" } }), /already exists in the profile/);
});

test("the first concurrent tool resolutions wait together; later resolutions use a synchronous cache", async (t) => {
  const start = Promise.withResolvers<McpSnapshot>();
  const fixture = await runtimeFixture(t, { connect: () => start.promise });
  try {
    const first = fixture.mcp.tools("one");
    const second = fixture.mcp.tools("one");
    assert.ok(first instanceof Promise);
    assert.equal(second, first);
    start.resolve(connected([tool("echo", true), tool("change")]));
    const functions = await first;
    assert.deepEqual(functions.map((fn) => fn.name), ["mcp__fixture__echo", "mcp__fixture__change"]);
    assert.equal(fixture.mcp.tools("one"), functions);
    assert.equal(fixture.requests.filter((request) => request.operation === MCP_OPERATIONS.connect).length, 1);
    assert.equal(functions[0]!.executionMode, "parallel");
    assert.equal(functions[1]!.executionMode, "sequential");
    assert.ok(functions.every(isNativeTool));
    assert.deepEqual(functions[0]!.schema, tool("echo").inputSchema);
    assert.match(functions[0]!.description, /^\[MCP fixture\]/);
  } finally { start.resolve(connected()); }
});

test("idle replacement closes old connections, preserves private definitions, and makes close idempotent", async (t) => {
  const fixture = await runtimeFixture(t, { servers: { profile: { command: "profile-command" } } });
  await fixture.mcp.setRunServers("one", { editor: { command: "first-command", env: { EXAMPLE_TOKEN: "first-private" } } });
  await fixture.mcp.tools("one");
  await assert.rejects(fixture.mcp.replaceRunServers("one", { profile: { command: "shadow" } }), /already exists/);
  assert.equal(fixture.requests.filter(({ operation }) => operation === MCP_OPERATIONS.close).length, 0);
  await fixture.mcp.replaceRunServers("one", { editor: { command: "second-command", env: { EXAMPLE_TOKEN: "second-private" } } });
  assert.ok(fixture.watches.get("one")!.options.signal?.aborted);
  const stored = await readFile(fixture.fileFor("one"), "utf8");
  assert.match(stored, /second-private/);
  assert.doesNotMatch(stored, /first-private/);
  await fixture.mcp.tools("one");
  assert.deepEqual(fixture.requests.filter(({ operation }) => operation === MCP_OPERATIONS.connect).map(({ input }) => input), [
    { servers: { profile: { command: "profile-command" }, editor: { command: "first-command", env: { EXAMPLE_TOKEN: "first-private" } } } },
    { servers: { profile: { command: "profile-command" }, editor: { command: "second-command", env: { EXAMPLE_TOKEN: "second-private" } } } },
  ]);
  await fixture.mcp.close("one");
  await fixture.mcp.close("one");
  assert.equal(fixture.requests.filter(({ operation }) => operation === MCP_OPERATIONS.close).length, 2);
  assert.equal(await readFile(fixture.fileFor("one"), "utf8"), stored);
});

test("an empty MCP map starts no connections and contributes no prompt chapter", async (t) => {
  const fixture = await runtimeFixture(t, { servers: {} });
  assert.deepEqual(await fixture.mcp.tools("one"), []);
  assert.deepEqual(fixture.mcp.tools("one"), []);
  assert.equal(fixture.mcp.prompt("one"), "");
  assert.deepEqual(fixture.requests, []);
});

test("tool list notifications update the cache and failed observation retains tools with a visible redacted cause", async (t) => {
  const privateValue = "private-connection-value";
  const fixture = await runtimeFixture(t, { servers: { fixture: { command: "fixture-mcp", env: { EXAMPLE_TOKEN: privateValue } } } });
  await fixture.mcp.tools("one");
  const watch = fixture.watches.get("one")!;
  assert.ok(watch);
  await watch.options.onProgress?.(connected([tool("echo", true), tool("later")]));
  assert.deepEqual((fixture.mcp.tools("one") as readonly RunFunction[]).map((fn) => fn.name), ["mcp__fixture__echo", "mcp__fixture__later"]);
  watch.failed(new Error(`Executor connection lost: ${privateValue}`));
  await until(() => fixture.mcp.snapshot("one").servers[0]?.state === "failed", "failed MCP observation");
  assert.deepEqual((fixture.mcp.tools("one") as readonly RunFunction[]).map((fn) => fn.name), ["mcp__fixture__echo", "mcp__fixture__later"]);
  assert.match(fixture.mcp.prompt("one"), /MCP fixture: failed: Executor connection lost/);
  assert.doesNotMatch(fixture.mcp.prompt("one"), /private-connection-value/);
  await fixture.mcp.close("one");
  assert.ok(watch.options.signal?.aborted);
  assert.equal(fixture.mcp.snapshot("one").servers[0]?.state, "closed");
});

test("ambiguous MCP name separators stay collision-free and stable when server lists reorder", async (t) => {
  const definitions: McpServers = { a: { command: "first" }, a__b: { command: "second" } };
  const snapshot: McpSnapshot = { servers: [
    { name: "a", transport: "stdio", state: "connected", tools: [tool("b__c")] },
    { name: "a__b", transport: "stdio", state: "connected", tools: [tool("c")] },
  ] };
  const fixture = await runtimeFixture(t, { servers: definitions, connect: async () => snapshot });
  const first = await fixture.mcp.tools("one");
  assert.equal(new Set(first.map((fn) => fn.name)).size, 2);
  await fixture.watches.get("one")!.options.onProgress?.({ servers: [...snapshot.servers].reverse() });
  const second = fixture.mcp.tools("one") as readonly RunFunction[];
  assert.deepEqual(Object.fromEntries(first.map((fn) => [fn.description, fn.name])), Object.fromEntries(second.map((fn) => [fn.description, fn.name])));
});

test("parallel native calls keep separate image results and forward the turn's cancellation signal", async (t) => {
  const fixture = await runtimeFixture(t, { call: ({ arguments: input }) => ({ content: [
    { type: "text", text: `Capture ${input.text}` }, { type: "image", data: String(input.text), mimeType: "image/png" },
  ] }) });
  const fn = (await fixture.mcp.tools("one"))[0]!;
  const cancellation = new AbortController();
  await Promise.all([invoke(fn, "image-one", { text: "first" }, scope(cancellation.signal)), invoke(fn, "image-two", { text: "second" }, scope(cancellation.signal))]);
  assert.ok(fixture.requests.filter((request) => request.operation === MCP_OPERATIONS.call).every((request) => request.options?.signal === cancellation.signal));
  const contribution = fixture.mcp.images();
  const agent = { runId: "one", agentId: "actor", audience: "agent" as const, workspace: "/unused" };
  const display = (toolCallId: string, modelReadsImages = true, isError = false) => contribution.afterToolCall!(agent,
    { toolName: fn.name, toolCallId, isError }, { signal: undefined, modelReadsImages });
  assert.deepEqual((await display("image-two"))?.content, [{ type: "text", text: "Capture second\nImage: image/png" }, { type: "image", data: "second", mimeType: "image/png" }]);
  assert.deepEqual((await display("image-one"))?.content, [{ type: "text", text: "Capture first\nImage: image/png" }, { type: "image", data: "first", mimeType: "image/png" }]);
  assert.equal(await display("image-one"), undefined);
  await invoke(fn, "image-unsupported", { text: "third" });
  const unsupported = await display("image-unsupported", false);
  assert.ok(unsupported?.content.every((part) => part.type === "text"));
  assert.match(JSON.stringify(unsupported?.content), /cannot read the returned images/);
  await invoke(fn, "image-error", { text: "error" });
  assert.equal(await display("image-error", true, true), undefined);
  assert.equal(await display("image-error"), undefined);
  await invoke(fn, "snippet-image", { text: "snippet" }, { ...scope(), modelContext: undefined });
  assert.equal(await display("snippet-image"), undefined);
});

test("deleting a run closes only its observation and removes its private definitions", async (t) => {
  const fixture = await runtimeFixture(t, { servers: {} });
  await fixture.mcp.setRunServers("one", { fixture: { command: "fixture-mcp", env: { EXAMPLE_TOKEN: "first-private" } } });
  await fixture.mcp.setRunServers("two", { fixture: { command: "fixture-mcp", env: { EXAMPLE_TOKEN: "second-private" } } });
  await Promise.all([fixture.mcp.tools("one"), fixture.mcp.tools("two")]);
  await fixture.mcp.delete("one");
  await assert.rejects(readFile(fixture.fileFor("one")), { code: "ENOENT" });
  assert.ok(fixture.watches.get("one")!.options.signal?.aborted);
  assert.equal(fixture.watches.get("two")!.options.signal?.aborted, false);
  assert.match(await readFile(fixture.fileFor("two"), "utf8"), /second-private/);
});

test("failed cleanup publishes a closed status with a redacted cause", async (t) => {
  let failed = false;
  const fixture = await runtimeFixture(t, {
    servers: { fixture: { command: "fixture-mcp", env: { EXAMPLE_TOKEN: "private-cleanup-marker" } } },
    close: async () => {
      if (failed) return {};
      failed = true;
      throw new Error("Session termination failed: private-cleanup-marker");
    },
  });
  const snapshots: McpSnapshot[] = [];
  const unsubscribe = fixture.mcp.subscribe("one", (snapshot) => snapshots.push(snapshot));
  t.after(unsubscribe);
  await fixture.mcp.tools("one");
  await assert.rejects(fixture.mcp.close("one"), /Session termination failed: \[redacted\]/);
  const last = snapshots.at(-1)!.servers[0]!;
  assert.equal(last.state, "closed");
  assert.match(last.error!, /Session termination failed: \[redacted\]/);
  assert.equal(last.tools.length, 1);
  assert.ok(fixture.watches.get("one")!.options.signal?.aborted);
  assert.doesNotMatch(fixture.mcp.prompt("one"), /private-cleanup-marker/);
});

test("a composed server offers native MCP tools, journals calls and reports a failed server in the model prompt", { timeout: 30_000 }, async (t) => {
  const fixture = await httpFixture("modern");
  const failed = await httpFixture("modern", { rejectStatus: 503 });
  const faux = registerFauxProvider({ models: [{ id: "mcp-model", reasoning: false }], tokensPerSecond: 100000 });
  const model = faux.getModel();
  const profileServers: McpServers = {
    fixture: { type: "http", url: fixture.url, headers: { Authorization: "Bearer private-header-marker" } },
    unavailable: { type: "http", url: failed.url },
  };
  process.env.MCP_SERVERS = JSON.stringify(profileServers);
  const { RunSessionProvider } = await import("../src/provider.ts");
  const { composeProfile } = await import("../src/profile/compose.ts");
  const { registerPluginFolder } = await import("../src/plugin-support/plugins-root.ts");
  const { productRuntimeToken } = await import("../src/ragents/product-runtime.ts");
  const { runManagementToken } = await import("../src/ragents/global-chat.ts");
  const { plugin: workspacePlugin } = await import("../../../plugins/ragents.workspace/server/index.ts");
  const { plugin: mcpPlugin } = await import("../../../plugins/ragents.mcp/server/index.ts");
  const { executor: mcpExecutor } = await import("../../../plugins/ragents.mcp/executor.ts");
  const productDirectory = path.join(suiteDirectory, "test.product");
  await mkdir(productDirectory);
  registerPluginFolder("test.product", productDirectory);
  const hookCallIds: (string | undefined)[] = [];
  const product = { create: () => ({ manifest: { id: "test.product" }, register: (host: import("@ragents/engine").PluginRegistration) => {
    host.provide(productRuntimeToken, {
      coordinator: { handle: "coordinator", displayName: "Coordinator", profile: "coordinator", runTitle: "New", ownerHandle: "owner", ownerDisplayName: "Owner" },
      roleFor: (view, actor) => view.primaryActorId === actor.id ? "primary" : "worker", contract: () => "", promptComposition: "test",
      systemPrompts: () => ({ mode: "fixed", options: [], defaultIds: [], shareDefault: false }),
    });
    host.profiles({ id: "test.models", models: () => [{ driver: "agent", provider: model.provider, model: model.id, label: "MCP fixture model", thinking: ["off"] }],
      providers: () => [{ id: model.provider, config: { api: faux.api, baseUrl: model.baseUrl, apiKey: "faux-only-key", models: faux.models } }],
      profiles: () => [{ name: "coordinator", description: "Coordinator", driver: "agent", provider: model.provider, model: model.id, thinking: "off", turnTimeoutMs: null, isolateWorkspace: false }] });
    host.agentRuntime({ id: "test.tool-calls", afterToolCall: (_actor, outcome) => {
      if (outcome.toolName.startsWith("mcp__")) hookCallIds.push(outcome.toolCallId);
      return undefined;
    } });
  } }) };
  const modules = new Map<string, import("../src/plugin-support/plugin-module.ts").PluginModule>([
    ["ragents.workspace", workspacePlugin], ["test.product", product], ["ragents.mcp", mcpPlugin],
  ]);
  const provider = new RunSessionProvider((bridges) => composeProfile({ product: { id: "test-mcp", title: "MCP host fixture" },
    pluginIds: [...modules.keys()], modules, web: new Map(), executor: [{ plugin: "ragents.mcp", revision: "0".repeat(64), contribution: mcpExecutor }] }, bridges), undefined);
  t.after(async () => {
    try { await provider.shutdown(); }
    finally {
      faux.unregister();
      await Promise.all([fixture.close(), failed.close()]);
      delete process.env.MCP_SERVERS;
    }
  });
  const contexts: Context[] = [];
  faux.setResponses([
    (context) => {
      contexts.push({ systemPrompt: context.systemPrompt, messages: structuredClone(context.messages) });
      assert.ok(context.tools?.some((entry) => entry.name === "mcp__fixture__echo"));
      assert.match(context.systemPrompt ?? "", /MCP fixture: connected \(http, 2026-07-28\)/);
      assert.match(context.systemPrompt ?? "", /Use the fixture tools for protocol checks/);
      assert.match(context.systemPrompt ?? "", /MCP unavailable: failed:.*503/);
      assert.doesNotMatch(context.systemPrompt ?? "", /private-header-marker/);
      return fauxAssistantMessage([fauxToolCall("mcp__fixture__echo", { text: "Native MCP response" }, { id: "native-mcp-call" })], { stopReason: "toolUse" });
    },
    (context) => {
      contexts.push({ systemPrompt: context.systemPrompt, messages: structuredClone(context.messages) });
      const result = context.messages.find((message) => message.role === "toolResult" && message.toolName === "mcp__fixture__echo");
      assert.ok(result && result.role === "toolResult");
      assert.equal(result.isError, false);
      assert.deepEqual(result.content, [{ type: "text", text: "Native MCP response" }]);
      return fauxAssistantMessage("MCP tool completed.");
    },
  ]);
  await provider.init();
  assert.ok(provider.plugins.service(mcpRunServersToken));
  const management = provider.plugins.service(runManagementToken)();
  const runId = await management.create({ title: "MCP native integration", user: null, kind: "message", message: "Call the MCP fixture." });
  await until(() => management.view(runId).turns[0]?.status !== "running", "native MCP turn completion");
  assert.equal(management.view(runId).turns[0]?.status, "completed", JSON.stringify(management.view(runId).turns));
  assert.equal(faux.state.callCount, 2);
  assert.equal(contexts.length, 2);
  assert.deepEqual(hookCallIds, ["native-mcp-call"]);
  const events = management.events(runId);
  const toolEvents = events.filter((event) => event.type.startsWith("tool.call."));
  assert.deepEqual(toolEvents.map((event) => event.type), ["tool.call.started", "tool.call.completed"]);
  assert.match(JSON.stringify(toolEvents), /mcp__fixture__echo.*Native MCP response/);
  assert.doesNotMatch(JSON.stringify(events), /private-header-marker|Authorization|mcpServers|MCP_SERVERS/);
  assert.doesNotMatch(JSON.stringify(toolEvents), new RegExp(fixture.url.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.ok(fixture.log.some((entry: { type: string; tool?: string }) => entry.type === "tool.called" && entry.tool === "echo"));
  await management.stop(runId);
  await provider.delete(runId);
  await provider.deletion(runId);
});
