import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { homedir, tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import type { NativeTypeScriptRequest, PluginContext, ToolScope } from "@ragents/engine";
import { COMMAND_OPERATIONS, WORKSPACE_EXECUTOR_VERSION, type CommandResult, type WorkspaceExecutor } from "@ragents/workspace-executor";
import { scriptProgram } from "../../../packages/ragents/tests/native-executor.ts";
import { NodeTypeScriptExecutor } from "../src/plugin-support/native-typescript-executor.ts";
import { ServerProcessSandbox } from "../src/plugin-support/process-sandbox.ts";
import { WorkspaceSandboxHost } from "../src/plugin-support/workspace-sandbox-host.ts";
import type { SandboxFolder, SessionWorkspace } from "../src/ragents/workspace-runtime.ts";

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

test("git in a worktree whose common repository lies outside works in the sandbox only with the declared folder", { skip: !supported, timeout: 120_000 }, async () => {
  const base = await realpath(await mkdtemp(path.join(tmpdir(), "ragents-sandbox-worktree-")));
  const data = path.join(base, "data");
  const repository = path.join(base, "repository");
  const worktree = path.join(base, "worktree");
  const git = (cwd: string, ...args: string[]): string =>
    execFileSync("git", ["-c", "user.name=Example", "-c", "user.email=example@example.invalid", ...args], { cwd, encoding: "utf8" });
  await mkdir(repository, { recursive: true });
  git(repository, "init", "-q", "-b", "main");
  await writeFile(path.join(repository, "README.md"), "Hello\n");
  git(repository, "add", "README.md");
  git(repository, "commit", "-q", "-m", "Start");
  git(repository, "worktree", "add", "-q", "-b", "run/worktree", worktree);
  const common = path.resolve(worktree, git(worktree, "rev-parse", "--git-common-dir").trim());
  assert.equal(common, path.join(repository, ".git"));
  const storage = (runId: string): string => path.join(data, "sessions", runId);
  const processSandbox = new ServerProcessSandbox({ network: [], serverAddress: undefined, dataDirectory: data });
  await processSandbox.start();
  const folders: Readonly<Record<string, readonly SandboxFolder[]>> = { undeclared: [], declared: [{ directory: common, access: "write" }] };
  const host = new WorkspaceSandboxHost({
    contributorName: "test.workspace",
    workspaceFor: async (runId) => ({
      cwd: worktree, currentRoot: async () => worktree, runOperation: (operation) => operation(), sandboxFolders: folders[runId] ?? [],
    }),
    identFor: async () => undefined,
    homeFor: async (runId) => {
      await mkdir(path.join(storage(runId), "home"), { recursive: true });
      return { home: path.join(storage(runId), "home") };
    },
    skillPaths: async () => [],
    storageRootFor: storage,
    processSandbox,
  });
  const bash = async (runId: string, command: string): Promise<string> => {
    const result = await host.execute(runId, "bash", { command: `${command} 2>&1; echo "exit=$?"`, timeout: 60 }) as { content: Array<{ text?: string }> };
    return result.content.map((part) => part.text ?? "").join("\n");
  };
  const commit = 'echo new > new.txt && git add new.txt && git -c user.name=Example -c user.email=example@example.invalid commit -q -m "From the sandbox"';
  try {
    const denied = await bash("undeclared", "git status --short --branch");
    assert.match(denied, /not a git repository[\s\S]*exit=128/, denied);
    assert.doesNotMatch(await bash("undeclared", commit), /exit=0/);
    assert.doesNotMatch(git(repository, "log", "--format=%s", "run/worktree"), /From the sandbox/);
    assert.match(await bash("declared", "git status --short --branch"), /## run\/worktree[\s\S]*exit=0/);
    assert.match(await bash("declared", commit), /exit=0/);
    assert.match(git(repository, "log", "--format=%s", "run/worktree"), /^From the sandbox$/m);
  } finally {
    await host.shutdownAll();
    await processSandbox.stop();
    await rm(base, { recursive: true, force: true });
  }
});

test("a bash of a workstation run with an alias as cwd runs on the server in the sandbox of that run", { skip: !supported, timeout: 60_000 }, async () => {
  const data = await realpath(await mkdtemp(path.join(tmpdir(), "ragents-sandbox-server-roots-")));
  const foreignJournal = path.join(data, "runs", "foreign-run", "journal.jsonl");
  const actors = path.join(data, "sessions", "remote", "plugins", "ragents.actor-programs", "actors");
  const storage = (runId: string): string => path.join(data, "sessions", runId);
  await Promise.all([path.dirname(foreignJournal), actors, path.join(storage("remote"), "home"), path.join(storage("remote"), "server")]
    .map((directory) => mkdir(directory, { recursive: true })));
  await writeFile(foreignJournal, '{"secret":"foreign history"}\n');
  const workstationCalls: string[] = [];
  const workstation: WorkspaceExecutor = {
    version: WORKSPACE_EXECUTOR_VERSION,
    execute: async (_runId, operation) => {
      workstationCalls.push(operation);
      return { content: [{ type: "text", text: "on the workstation" }] };
    },
    stopRun: async () => undefined,
    shutdown: async () => undefined,
  };
  const processSandbox = new ServerProcessSandbox({ network: [], serverAddress: undefined, dataDirectory: data });
  await processSandbox.start();
  const remote = (): Promise<string> => Promise.reject(new Error("Der Arbeitsbereich liegt auf dem Arbeitsplatz"));
  const host = new WorkspaceSandboxHost({
    contributorName: "test.workspace",
    workspaceFor: async () => ({ cwd: "/workstation/project", currentRoot: remote, runOperation: (operation) => operation() }),
    identFor: async () => undefined,
    homeFor: async (runId) => ({ home: path.join(storage(runId), "home") }),
    skillPaths: async () => [],
    storageRootFor: storage,
    executorFor: async () => workstation,
    serverDirectoryFor: async (runId) => path.join(storage(runId), "server"),
    processSandbox,
  });
  host.registerWorkspaceRoot({ id: "actors", alias: "@actors", environmentVariable: "RAGENTS_ACTORS_DIR", directoryFor: () => actors });
  const bash = async (input: Record<string, unknown>): Promise<string> => {
    const result = await host.execute("remote", "bash", { timeout: 30, ...input }) as { content: Array<{ text?: string }> };
    return result.content.map((part) => part.text ?? "").join("\n");
  };
  try {
    assert.equal(await bash({ command: "pwd" }), "on the workstation");
    assert.deepEqual(workstationCalls, ["bash"]);
    const onServer = await bash({ command: `pwd; echo "[$RAGENTS_ACTORS_DIR]"; echo written > own.txt && echo own-ok; cat ${JSON.stringify(foreignJournal)} 2>&1`, cwd: "@actors" });
    const lines = onServer.split("\n");
    assert.equal(await realpath(lines[0]!), await realpath(actors));
    assert.equal(lines[1], `[${await realpath(actors)}]`);
    assert.equal(lines[2], "own-ok");
    assert.doesNotMatch(onServer, /foreign history/);
    assert.match(onServer, /Operation not permitted|No such file or directory/);
    assert.equal(await readFile(path.join(actors, "own.txt"), "utf8"), "written\n");
    assert.deepEqual(workstationCalls, ["bash"]);
  } finally {
    await host.shutdownAll();
    await processSandbox.stop();
    await rm(data, { recursive: true, force: true });
  }
});
