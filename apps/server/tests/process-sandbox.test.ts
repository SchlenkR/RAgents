import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { homedir, tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import type { NativeTypeScriptRequest, PluginContext, ToolScope } from "@ragents/engine";
import { COMMAND_OPERATIONS, type CommandResult } from "@ragents/workspace-executor";
import { scriptProgram } from "../../../packages/ragents/tests/native-executor.ts";
import { NodeTypeScriptExecutor } from "../src/plugin-support/native-typescript-executor.ts";
import { ServerProcessSandbox } from "../src/plugin-support/process-sandbox.ts";
import { WorkspaceSandboxHost } from "../src/plugin-support/workspace-sandbox-host.ts";
import type { SessionWorkspace } from "../src/ragents/workspace-runtime.ts";

const supported = process.platform === "darwin" || process.platform === "linux";

const listening = async (text: string): Promise<{ server: Server; address: string }> => {
  const server = createServer((_request, response) => response.end(text));
  await new Promise<void>((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  return { server, address: `http://127.0.0.1:${address.port}` };
};

const closed = (server: Server): Promise<void> => new Promise((resolve) => {
  server.closeAllConnections();
  server.close(() => resolve());
});

/** Ein Datenordner wie der eines Servers mit Benutzern: der globale Koordinator eines Benutzers und das Journal eines fremden Runs. */
const coordinatorFixture = async () => {
  const data = await realpath(await mkdtemp(path.join(tmpdir(), "ragents-process-sandbox-")));
  const foreignJournal = path.join(data, "runs", "foreign-run", "journal.jsonl");
  await mkdir(path.dirname(foreignJournal), { recursive: true });
  await writeFile(foreignJournal, '{"secret":"foreign history"}\n');
  const storage = (runId: string): string => path.join(data, "sessions", runId);
  const cwd = path.join(storage("coordinator"), "plugins", "ragents.overseer", "workspace");
  await mkdir(cwd, { recursive: true });
  const allowed = await listening("own server");
  const forbidden = await listening("foreign service");
  const processSandbox = new ServerProcessSandbox({ network: [], serverAddress: allowed.address, dataDirectory: data });
  await processSandbox.start();
  const workspace: SessionWorkspace = {
    cwd,
    hostSandbox: { home: cwd, readOnlyRoots: [] },
    currentRoot: async () => cwd,
    runOperation: (operation) => operation(),
  };
  const unused = async (): Promise<never> => { throw new Error("Der Koordinator bestimmt seinen Arbeitsbereich selbst"); };
  const host = new WorkspaceSandboxHost({
    contributorName: "test.workspace",
    workspaceFor: async () => workspace,
    identFor: unused,
    homeFor: unused,
    skillPaths: unused,
    storageRootFor: storage,
    processSandbox,
  });
  const native = new NodeTypeScriptExecutor({
    directoryFor: (runId) => path.join(storage(runId), "native-programs"),
    serverProcessContextFor: (runId) => host.serverProcessContextFor(runId),
  });
  const tools = await host.workspaceTools().tools({ runId: "coordinator" } as PluginContext);
  const bash = async (command: string): Promise<string> => {
    const tool = tools.find((entry) => entry.name === "bash");
    assert.ok(tool);
    return String(await tool.run({ signal: new AbortController().signal } as ToolScope, "test-bash", { command, timeout: 30 } as never));
  };
  const snippet = async (source: string): Promise<unknown> => {
    const request: NativeTypeScriptRequest = {
      program: scriptProgram(source),
      input: {},
      context: { runId: "coordinator", invocationId: "sandbox", invocationKind: "tool", principal: { id: "coordinator", kind: "agent" }, capabilities: [] },
    };
    const outcome = await native.execute(request, { call: async () => { throw new Error("keine Capability"); }, log: () => undefined });
    return outcome.result;
  };
  return {
    data, cwd, foreignJournal, allowed, forbidden, host, bash, snippet,
    close: async () => {
      await native.shutdown();
      await host.shutdownAll();
      await processSandbox.stop();
      await Promise.all([closed(allowed.server), closed(forbidden.server)]);
      await rm(data, { recursive: true, force: true });
    },
  };
};

test("bash of the global coordinator cannot read a foreign journal but writes its own workspace", { skip: !supported, timeout: 60_000 }, async () => {
  const f = await coordinatorFixture();
  try {
    const denied = await f.bash(`cat ${JSON.stringify(f.foreignJournal)}`);
    assert.doesNotMatch(denied, /foreign history/);
    assert.match(denied, /Operation not permitted|No such file or directory/);
    assert.match(await f.bash(`ls ${JSON.stringify(path.join(f.data, "runs"))} 2>&1; echo listed`), /listed/);
    assert.doesNotMatch(await f.bash(`ls ${JSON.stringify(path.join(f.data, "runs"))} 2>&1`), /foreign-run/);
    assert.match(await f.bash(`ls ${JSON.stringify(homedir())} 2>&1`), /Operation not permitted|No such file or directory/);
    assert.match(await f.bash(`echo tampered > ${JSON.stringify(f.foreignJournal)} 2>&1; echo done`), /done/);
    assert.equal(await readFile(f.foreignJournal, "utf8"), '{"secret":"foreign history"}\n');
    assert.match(await f.bash("echo written > own.txt && cat own.txt && touch \"$TMPDIR/scratch\" && echo temp-ok"), /written\s+temp-ok/);
    assert.equal(await readFile(path.join(f.cwd, "own.txt"), "utf8"), "written\n");
    const result = await f.host.execute("coordinator", COMMAND_OPERATIONS.run, { program: "cat", args: [f.foreignJournal], timeoutMs: 10_000 }) as CommandResult;
    assert.notEqual(result.exitCode, 0);
    assert.doesNotMatch(result.stdout, /foreign history/);
  } finally { await f.close(); }
});

test("a TypeScript snippet of the global coordinator cannot read a foreign journal but writes its own workspace", { skip: !supported, timeout: 60_000 }, async () => {
  const f = await coordinatorFixture();
  try {
    const read = await f.snippet(`import { readFile } from "node:fs/promises";
export const handle = () => readFile(${JSON.stringify(f.foreignJournal)}, "utf8").then((text) => "gelesen: " + text, (error) => "verweigert: " + error.code);`);
    assert.match(String(read), /^verweigert: (EPERM|ENOENT)$/);
    const written = await f.snippet(`import { readFile, writeFile } from "node:fs/promises";
export const handle = async () => { await writeFile("snippet.txt", "from snippet"); return readFile("snippet.txt", "utf8"); };`);
    assert.equal(written, "from snippet");
    assert.equal(await readFile(path.join(f.cwd, "snippet.txt"), "utf8"), "from snippet");
  } finally { await f.close(); }
});

test("network calls outside the allowlist fail, the own server stays reachable", { skip: !supported, timeout: 60_000 }, async () => {
  const f = await coordinatorFixture();
  try {
    assert.match(await f.bash(`curl --silent --show-error --max-time 10 ${f.allowed.address}`), /own server/);
    const blocked = await f.bash(`curl --silent --show-error --max-time 10 ${f.forbidden.address}`);
    assert.doesNotMatch(blocked, /foreign service/);
    assert.match(blocked, /blocked by network allowlist/);
    const fetched = await f.snippet(`export const handle = async () => {
  const allowed = await fetch(${JSON.stringify(f.allowed.address)}).then((response) => response.text());
  const blocked = await fetch(${JSON.stringify(f.forbidden.address)}).then((response) => response.status === 200 ? "erreicht" : "abgelehnt " + response.status, () => "abgelehnt");
  return allowed + " / " + blocked;
};`);
    assert.match(String(fetched), /^own server \/ abgelehnt/);
  } finally { await f.close(); }
});
