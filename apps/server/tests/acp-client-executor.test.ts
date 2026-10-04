import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test, { type TestContext } from "node:test";
import type { PromptResponse } from "@agentclientprotocol/sdk";
import { WorkspaceOperationExecutor, executorMachine, fileModule, sandboxToolsModule, workspaceProcessContext, type ProcessLaunch } from "@ragents/workspace-executor";
import { processExists } from "../../../packages/workspace-executor/src/managed-process.ts";
import { parseAcpAgents, type AcpAgentDefinition } from "../../../plugins/ragents.acp/config.ts";
import { ACP_OPERATIONS, type AcpOpened, type AcpProgress } from "../../../plugins/ragents.acp/executor/contract.ts";
import { acpModule } from "../../../plugins/ragents.acp/executor/module.ts";

const adapter = path.resolve(import.meta.dirname, "fixtures/acp/agent.mjs");
const until = async (condition: () => boolean | Promise<boolean>, label: string): Promise<void> => {
  const deadline = Date.now() + 10_000;
  while (!await condition()) {
    assert.ok(Date.now() < deadline, `Timed out waiting for ${label}`);
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
};
const eventsOf = async (file: string): Promise<Record<string, any>[]> => (await readFile(file, "utf8").catch((cause: NodeJS.ErrnoException) => {
  if (cause.code === "ENOENT") return "";
  throw cause;
})).split("\n").filter(Boolean).map((line) => JSON.parse(line));

const fixture = async (t: TestContext, env: Record<string, string> = {}) => {
  const directory = await realpath(await mkdtemp(path.join(tmpdir(), "ragents-acp-executor-")));
  const workspace = path.join(directory, "workspace");
  const home = path.join(directory, "home");
  const logs = path.join(directory, "logs");
  await Promise.all([mkdir(workspace), mkdir(home), mkdir(logs)]);
  const logFile = path.join(workspace, "fixture.jsonl");
  const launches: ProcessLaunch[] = [];
  const machine = executorMachine(directory);
  const executor = new WorkspaceOperationExecutor({ contextFor: async (runId) => workspaceProcessContext({ runId, cwd: workspace, root: workspace,
    home: { home }, logDirectory: logs, hostRoot: undefined, sandbox: { wrap: async (launch) => { launches.push(launch); return launch; } },
  }), modules: [fileModule, sandboxToolsModule, acpModule(machine)] });
  t.after(async () => { try { await executor.shutdown(); } finally { await rm(directory, { recursive: true, force: true }); } });
  const definition: AcpAgentDefinition = { command: process.execPath, args: [adapter], env: { ACP_FIXTURE_LOG: logFile, ACP_FIXTURE_EXTRA: "configured-environment", ...env } };
  const open = (extra: object = {}, actorId = "coder") => executor.execute("run-one", ACP_OPERATIONS.open, { actorId, definition, ...extra }) as Promise<AcpOpened & { notices: string[] }>;
  const prompt = (text: string, progress: AcpProgress[], signal = new AbortController().signal) => executor.execute("run-one", ACP_OPERATIONS.prompt,
    { actorId: "coder", prompt: [{ type: "text", text }] }, { signal, untilAborted: true, onProgress: (value) => progress.push(value as AcpProgress) }) as Promise<PromptResponse>;
  const answer = (permission: Extract<AcpProgress, { kind: "permission" }>, label?: string) => executor.execute("run-one", ACP_OPERATIONS.permission, { actorId: "coder", request: permission.request, label });
  const close = () => executor.execute("run-one", ACP_OPERATIONS.close, { actorId: "coder" });
  return { directory, workspace, logFile, executor, launches, open, prompt, answer, close, events: () => eventsOf(logFile) };
};

test("ACP agent server configuration validates editor entries and copies their environment and arguments", () => {
  assert.deepEqual(parseAcpAgents(undefined), {});
  const source = { coder: { title: "Example coder", command: "node", args: ["adapter.mjs"], env: { EXAMPLE_TOKEN: "fixture-only" } } };
  const parsed = parseAcpAgents(source);
  source.coder.args.push("changed");
  source.coder.env.EXAMPLE_TOKEN = "changed";
  assert.deepEqual(parsed.coder?.args, ["adapter.mjs"]);
  assert.equal(parsed.coder?.env?.EXAMPLE_TOKEN, "fixture-only");
  for (const invalid of [null, [], { "invalid.name": { command: "node" } }, { coder: { command: " " } }, { coder: { command: "node", args: [1] } },
    { coder: { command: "node", env: { "invalid-name": "value" } } }, { coder: { command: "node", cwd: "." } }]) assert.throws(() => parseAcpAgents(invalid), /ACP_AGENTS/);
});

test("an ACP child uses sandboxed callbacks, streams updates, answers permissions and executes confined files and terminals", { timeout: 20_000 }, async (t) => {
  const host = await fixture(t, { ACP_FIXTURE_SSE: "off" });
  const opened = await host.open({ mcpServers: { files: { command: "fixture-mcp", args: ["--read"], env: { EXAMPLE_TOKEN: "private-mcp-token" } },
    docs: { url: "https://mcp.example.com/mcp", headers: { Authorization: "Bearer private-http-token" } }, legacy: { type: "sse", url: "https://mcp.example.com/sse" } } });
  assert.equal(opened.capabilities.loadSession, true);
  assert.match(opened.notices.join("\n"), /legacy.*sse.*not advertised/);
  const log = await host.events();
  const capabilities = log.find((event) => event.type === "initialize")?.request.clientCapabilities;
  assert.deepEqual(capabilities.fs, { readTextFile: true, writeTextFile: true });
  assert.equal(capabilities.terminal, true);
  assert.equal(log[0]?.cwd, host.workspace);
  assert.equal(log[0]?.marker, "run-one");
  assert.equal(log[0]?.extra, "configured-environment");
  assert.deepEqual(log.find((event) => event.type === "new")?.request.mcpServers.map((server: any) => server.name), ["files", "docs"]);
  const progress: AcpProgress[] = [];
  const pending = host.prompt("First task", progress);
  await until(() => progress.some((entry) => entry.kind === "permission"), "permission");
  const permission = progress.find((entry): entry is Extract<AcpProgress, { kind: "permission" }> => entry.kind === "permission")!;
  assert.equal(permission.toolCall.toolCallId, "opaque-tool-call");
  assert.deepEqual(permission.toolCall.rawInput, { path: "result.txt", content: "first\nsecond\nthird\n" });
  assert.doesNotMatch(JSON.stringify(permission), /opaque-allow-option|opaque-reject-option/);
  await assert.rejects(host.answer(permission, "Invalid option"), /does not match/);
  await host.answer(permission, permission.options[0]!.label);
  const response = await pending;
  assert.equal(response.stopReason, "end_turn");
  assert.equal(response.usage?.inputTokens, 10);
  assert.equal(await readFile(path.join(host.workspace, "result.txt"), "utf8"), "first\nsecond\nthird\n");
  const callbacks = await host.events();
  assert.equal(callbacks.find((event) => event.type === "read")?.content, "second");
  assert.equal(callbacks.find((event) => event.type === "terminal-output")?.output.output, "Terminal output");
  assert.ok(progress.some((entry) => entry.kind === "update" && entry.update.sessionUpdate === "plan"));
  assert.ok(JSON.stringify(progress).length < 15_000);
  assert.equal(host.launches.length, 2, "adapter and terminal both use the process sandbox");
  const pid = log[0]!.pid;
  await host.close();
  assert.equal(processExists(pid), false);
});

test("session loading suppresses replay, unsupported restoration and interactive authentication fail with their causes", { timeout: 20_000 }, async (t) => {
  const host = await fixture(t);
  const opened = await host.open();
  await host.close();
  const loaded = await host.open({ sessionId: opened.sessionId });
  assert.equal(loaded.sessionId, opened.sessionId);
  const progress: AcpProgress[] = [];
  await host.prompt("second task", progress);
  assert.doesNotMatch(JSON.stringify(progress), /Replayed/);
  assert.ok((await host.events()).some((event) => event.type === "load"));
  const noLoad = await fixture(t, { ACP_FIXTURE_LOAD: "off" });
  await assert.rejects(noLoad.open({ sessionId: "saved-session" }), /blocked.*loadSession/);
  const auth = await fixture(t, { ACP_FIXTURE_AUTH: "required" });
  await assert.rejects(auth.open(), /prior sign-in.*Fixture login \(fixture-login\)/);
});

test("ACP callbacks refuse parent paths and symlink escapes, and stopping a run cleans up terminals and adapters", { timeout: 20_000 }, async (t) => {
  const host = await fixture(t);
  await writeFile(path.join(host.directory, "outside.txt"), "Outside");
  await symlink(host.directory, path.join(host.workspace, "escape"), "dir");
  await host.open();
  await host.prompt("deny outside workspace", []);
  assert.equal((await host.events()).filter((event) => event.type === "escape-refused").length, 4);
  assert.equal(await readFile(path.join(host.directory, "outside.txt"), "utf8"), "Outside");
  await host.prompt("keep terminal", []);
  const log = await host.events();
  const pids = log.filter((event) => event.type === "start" || event.type === "terminal").map((event) => event.pid);
  assert.equal(pids.length, 2);
  assert.ok(pids.every(processExists));
  await host.executor.stopRun("run-one");
  assert.ok(pids.every((pid) => !processExists(pid)));
});

test("cancellation sends session/cancel, cancels pending permissions and kills an unresponsive adapter", { timeout: 20_000 }, async (t) => {
  const host = await fixture(t);
  await host.open();
  const abort = new AbortController();
  const progress: AcpProgress[] = [];
  const pending = host.prompt("wait for cancellation", progress, abort.signal);
  await until(() => progress.length > 0, "partial response");
  abort.abort();
  assert.equal((await pending).stopReason, "cancelled");
  assert.ok((await host.events()).some((event) => event.type === "cancel"));
  const permissionAbort = new AbortController();
  const questions: AcpProgress[] = [];
  const asking = host.prompt("Permission task", questions, permissionAbort.signal);
  await until(() => questions.some((entry) => entry.kind === "permission"), "permission to cancel");
  permissionAbort.abort();
  await asking;
  assert.equal((await host.events()).findLast((event) => event.type === "permission")?.outcome.outcome.outcome, "cancelled");
  const forceAbort = new AbortController();
  const ignored: AcpProgress[] = [];
  const stuck = host.prompt("ignore cancellation", ignored, forceAbort.signal);
  const rejected = assert.rejects(stuck, /closed|exited/);
  await until(() => ignored.length > 0, "unresponsive prompt");
  forceAbort.abort();
  await rejected;
  assert.equal(processExists((await host.events())[0]!.pid), false);
});
