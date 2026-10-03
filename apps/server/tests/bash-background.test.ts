import assert from "node:assert/strict";
import { mkdir, mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test, { type TestContext } from "node:test";
import { claimTurn, DomainError, ToolRegistry, TurnToolset, type PluginContext, type ToolScope } from "@ragents/engine";
import { WORKSPACE_EXECUTOR_VERSION, type WorkspaceExecutor } from "@ragents/workspace-executor";
import { allGrants, catalog, postTo, setupRun } from "../../../packages/ragents/tests/support.ts";
import { WorkspaceSandboxHost } from "../src/plugin-support/workspace-sandbox-host.ts";

const onWindows = process.platform === "win32";

const until = async (condition: () => boolean, timeoutMs = 10_000): Promise<void> => {
  const started = Date.now();
  while (!condition()) {
    if (Date.now() - started > timeoutMs) throw new Error("Condition was not met.");
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
};

const alive = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

const node = (source: string): string => `${JSON.stringify(process.execPath)} -e ${JSON.stringify(source)}`;

/** A run on the server with its real executor and an agent whose turn calls the workspace tools. */
const serverRun = async (t: TestContext) => {
  const directory = await realpath(await mkdtemp(path.join(tmpdir(), "ragents-bash-background-")));
  const workspace = path.join(directory, "workspace");
  await mkdir(workspace, { recursive: true });
  const host = new WorkspaceSandboxHost({
    contributorName: "test.workspace",
    contributions: [],
    workspaceFor: async () => ({ cwd: workspace, currentRoot: async () => workspace, runOperation: (operation) => operation() }),
    identFor: async () => undefined,
    homeFor: async () => ({ home: path.join(directory, "home") }),
    skillPaths: async () => [],
  });
  const setup = setupRun({ grants: allGrants(), toolNames: null });
  t.after(async () => {
    await host.shutdownAll();
    setup.journal.close();
    await rm(directory, { recursive: true, force: true });
  });
  const registry = new ToolRegistry().register(host.workspaceTools());
  const queued = postTo(setup.runtime, setup.view, setup.agent.id, "work-input", "Start the preview.");
  const input = queued.inputs.find((entry) => entry.actorId === setup.agent.id && entry.lifecycle.kind === "pending");
  assert.ok(input);
  const turn = claimTurn(setup.runtime, setup.view.id, setup.agent.id, input.id, "work-turn");
  const toolset = await TurnToolset.create({ runtime: setup.runtime, turn, catalog, registry, workspace });
  const call = async (id: string, name: string, value: Record<string, unknown>): Promise<string> =>
    String((await toolset.invoke(id, name, value as never)).output);
  const start = async (id: string, command: string): Promise<string> => {
    const text = await call(id, "bash", { command, run_in_background: true });
    const task = /with ID: (b[0-9a-f]{6})\./.exec(text)?.[1];
    assert.ok(task, text);
    return task;
  };
  const notices = () => setup.runtime.view(setup.view.id).inputs
    .filter((entry) => entry.actorId === setup.agent.id && entry.presentation === "background")
    .map((entry) => entry.content);
  return { host, setup, workspace, call, start, notices, runId: setup.view.id };
};

const pidOf = async (f: Awaited<ReturnType<typeof serverRun>>, id: string): Promise<number> => {
  for (let attempt = 0; attempt < 400; attempt++) {
    const pid = Number(/pid (\d+)/.exec(await f.call(`poll-${id}-${attempt}`, "task_output", { task_id: id }))?.[1] ?? 0);
    if (pid > 0) return pid;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`Background command ${id} reported no PID`);
};

test("the end of a background command reaches the actor that started it as a background input with the ID and the exit code", { skip: onWindows }, async (t) => {
  const f = await serverRun(t);
  const id = await f.start("start", "sleep 0.2; echo built; exit 4");
  await until(() => f.notices().length > 0);
  assert.deepEqual(f.notices(), [`Background command ${id} exited with code 4. task_output reads what it wrote last.`]);
  assert.equal(await f.call("read-output", "task_output", { task_id: id }), "built\n\nStatus: exited with code 4");
  const stopped = await f.start("start-service", node("setInterval(() => {}, 1000)"));
  assert.equal(await f.call("stop", "task_stop", { task_id: stopped }), `Stopped background command ${stopped}.`);
  await new Promise((resolve) => setTimeout(resolve, 200));
  assert.equal(f.notices().length, 1, "an end that task_stop caused is no news to the actor");
});

test("the stop of a run ends its background commands without a notice, and their IDs are unknown afterwards", { skip: onWindows }, async (t) => {
  const f = await serverRun(t);
  const id = await f.start("start", node("console.log('pid ' + process.pid); setInterval(() => {}, 1000)"));
  const pid = await pidOf(f, id);
  assert.equal(alive(pid), true);
  await f.host.shutdown(f.runId);
  await until(() => !alive(pid));
  await new Promise((resolve) => setTimeout(resolve, 200));
  assert.deepEqual(f.notices(), []);
  await assert.rejects(f.call("after-stop", "task_output", { task_id: id }), /There is no background command with ID/);
});

test("run_in_background needs task_output and task_stop for the calling actor and names what is missing", async () => {
  const executor: WorkspaceExecutor = {
    version: WORKSPACE_EXECUTOR_VERSION,
    execute: async () => { throw new Error("Nothing may start"); },
    stopRun: async () => undefined,
    shutdown: async () => undefined,
  };
  const host = new WorkspaceSandboxHost({
    contributorName: "test.workspace", contributions: [],
    workspaceFor: async () => ({ cwd: "/workstation/project", currentRoot: () => Promise.reject(new Error("remote")), runOperation: (operation) => operation() }),
    identFor: async () => undefined,
    homeFor: async () => ({ home: "/workstation/home" }),
    skillPaths: async () => [],
    executorFor: async () => executor,
  });
  const tools = await host.workspaceTools().tools({ runId: "run-1" } as PluginContext);
  assert.deepEqual(tools.map((tool) => [tool.name, tool.executionMode]), [
    ["read", "parallel"], ["edit", "parallel"], ["write", "parallel"], ["bash", "sequential"], ["task_output", "parallel"], ["task_stop", "sequential"],
  ]);
  const bash = tools.find((tool) => tool.name === "bash")!;
  const scope = { signal: undefined, availableFunctions: () => tools.filter((tool) => tool.name === "bash" || tool.name === "task_output") } as unknown as ToolScope;
  await assert.rejects(bash.run(scope, "call-1", { command: "npm run dev", run_in_background: true } as never), (error: unknown) =>
    error instanceof DomainError && error.code === "background-tools-missing"
      && error.message.startsWith("run_in_background needs task_stop to read and stop the command, and this actor does not have it."));
});
