import assert from "node:assert/strict";
import test from "node:test";
import { schemaComplaints, type PluginContext, type ToolScope } from "@ragents/engine";
import { WORKSPACE_EXECUTOR_VERSION, type WorkspaceExecuteOptions, type WorkspaceExecutor } from "@ragents/workspace-executor";
import { bashTimeoutSetting } from "../../../plugins/ragents.workspace/server/config.ts";
import { WorkspaceSandboxHost } from "../src/plugin-support/workspace-sandbox-host.ts";

/** A workstation that only records what the server sends it for bash. */
const recordingWorkstation = () => {
  const calls: Array<{ input: unknown; durationMs: number | undefined }> = [];
  const executor: WorkspaceExecutor = {
    version: WORKSPACE_EXECUTOR_VERSION,
    execute: async (_runId, _operation, input, options: WorkspaceExecuteOptions = {}) => {
      calls.push({ input, durationMs: options.durationMs });
      return { content: [{ type: "text", text: "ok" }] };
    },
    stopRun: async () => undefined,
    shutdown: async () => undefined,
  };
  return { calls, executor };
};

const hostFor = (executor: WorkspaceExecutor, bashTimeoutSeconds?: number) => new WorkspaceSandboxHost({
  contributorName: "test.workspace", contributions: [],
  workspaceFor: async () => ({
    cwd: "/workstation/project",
    currentRoot: () => Promise.reject(new Error("The workspace lies on the workstation")),
    runOperation: (operation) => operation(),
  }),
  identFor: async () => undefined,
  homeFor: async () => ({ home: "/workstation/home" }),
  skillPaths: async () => [],
  executorFor: async () => executor,
  ...(bashTimeoutSeconds === undefined ? {} : { bashTimeoutSeconds }),
});

const bashOf = async (host: WorkspaceSandboxHost) => {
  const bash = (await host.workspaceTools().tools({ runId: "run-1" } as PluginContext)).find((tool) => tool.name === "bash");
  assert.ok(bash);
  return { bash, run: (input: unknown) => bash.run({ signal: new AbortController().signal } as ToolScope, "call-1", input as never) };
};

const withBashTimeoutVariable = <T>(value: string | undefined, read: () => T): T => {
  const previous = process.env.RAGENTS_BASH_TIMEOUT_SECONDS;
  if (value === undefined) delete process.env.RAGENTS_BASH_TIMEOUT_SECONDS;
  else process.env.RAGENTS_BASH_TIMEOUT_SECONDS = value;
  try {
    return read();
  } finally {
    if (previous === undefined) delete process.env.RAGENTS_BASH_TIMEOUT_SECONDS;
    else process.env.RAGENTS_BASH_TIMEOUT_SECONDS = previous;
  }
};

test("bash tells the model its default and maximum timeout, and the server sends the effective timeout to every machine", async () => {
  const { calls, executor } = recordingWorkstation();
  const { bash, run } = await bashOf(hostFor(executor));
  assert.match(bash.longDescription ?? "", /A command is stopped after 120 seconds unless you pass a larger timeout \(at most 600 seconds\); builds, test runs, installs and other long commands need one\./);
  assert.equal(schemaComplaints(bash.schema, { command: "dotnet build", timeout: 900 }), "timeout must be <= 600, got 900");
  await run({ command: "grep -r needle ." });
  await run({ command: "dotnet build", timeout: 600 });
  assert.deepEqual(calls, [
    { input: { command: "grep -r needle .", timeout: 120 }, durationMs: 120_000 },
    { input: { command: "dotnet build", timeout: 600 }, durationMs: 600_000 },
  ]);
});

test("RAGENTS_BASH_TIMEOUT_SECONDS sets the default for every run of the server and may not exceed the maximum", async () => {
  assert.equal(withBashTimeoutVariable(undefined, bashTimeoutSetting), undefined);
  assert.equal(withBashTimeoutVariable("", bashTimeoutSetting), undefined);
  assert.throws(() => withBashTimeoutVariable("zwei Minuten", bashTimeoutSetting), /RAGENTS_BASH_TIMEOUT_SECONDS muss eine positive Zahl sein/);
  const configured = withBashTimeoutVariable("300", bashTimeoutSetting);
  assert.equal(configured, 300);
  const { calls, executor } = recordingWorkstation();
  const { bash, run } = await bashOf(hostFor(executor, configured));
  assert.match(bash.longDescription ?? "", /stopped after 300 seconds unless you pass a larger timeout \(at most 600 seconds\)/);
  await run({ command: "git status" });
  assert.deepEqual(calls, [{ input: { command: "git status", timeout: 300 }, durationMs: 300_000 }]);
  assert.throws(() => hostFor(executor, withBashTimeoutVariable("900", bashTimeoutSetting)), /Invalid default timeout 900: the maximum is 600 seconds/);
});
