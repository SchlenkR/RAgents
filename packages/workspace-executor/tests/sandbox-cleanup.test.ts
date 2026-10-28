import assert from "node:assert/strict";
import test from "node:test";
import { WorkspaceOperationExecutor } from "../src/executor.js";
import { workspaceProcessContext } from "../src/context.js";

const context = (runId: string, cleanup: () => Promise<void>) => workspaceProcessContext({
  runId,
  cwd: "/project",
  root: "/project",
  home: { home: "/home/run" },
  logDirectory: "/home/run/logs",
  hostRoot: undefined,
  sandbox: { wrap: async (launch) => launch, cleanup },
});

test("run cleanup releases every sandbox context after its operations and processes finish", async () => {
  const order: string[] = [];
  let opened = 0;
  const executor = new WorkspaceOperationExecutor({
    contextFor: async (runId) => {
      const revision = ++opened;
      return context(runId, async () => { order.push(`cleanup-${revision}`); });
    },
    modules: [(host) => ({
      operations: { open: async ({ runId }) => { await host.contextFor(runId); } },
      stopRun: async () => { order.push("processes-ended"); },
    })],
  });
  await executor.execute("own", "open", {});
  await executor.execute("own", "open", {});
  await executor.stopRun("own");
  assert.deepEqual(order, ["processes-ended", "cleanup-1", "cleanup-2"]);
  await executor.stopRun("own");
  assert.deepEqual(order, ["processes-ended", "cleanup-1", "cleanup-2", "processes-ended"]);
});

test("a failed sandbox cleanup keeps new operations blocked until successful cleanup retry", async () => {
  let fail = true;
  let cleaned = 0;
  const executor = new WorkspaceOperationExecutor({
    contextFor: async (runId) => context(runId, async () => {
      if (fail) throw new Error("Sandbox profile is still held");
      cleaned++;
    }),
    modules: [(host) => ({ operations: { open: async ({ runId }) => { await host.contextFor(runId); } } })],
  });
  await executor.execute("own", "open", {});
  await assert.rejects(executor.stopRun("own"), /still held/);
  await assert.rejects(executor.execute("own", "open", {}), /still held/);
  assert.equal(cleaned, 0);
  fail = false;
  await executor.stopRun("own");
  assert.equal(cleaned, 1);
  await executor.execute("own", "open", {});
  await executor.shutdown();
  assert.equal(cleaned, 2);
});

test("process cleanup failure retains sandbox mounts and shutdown releases them after processes end", async () => {
  let fail = true;
  let cleaned = false;
  const executor = new WorkspaceOperationExecutor({
    contextFor: async (runId) => context(runId, async () => { cleaned = true; }),
    modules: [(host) => ({
      operations: { open: async ({ runId }) => { await host.contextFor(runId); } },
      stopRun: async () => { if (fail) throw new Error("Process is still alive"); },
      shutdown: async () => { if (fail) throw new Error("Process is still alive"); },
    })],
  });
  await executor.execute("own", "open", {});
  await assert.rejects(executor.stopRun("own"), /still alive/);
  await assert.rejects(executor.shutdown(), /still alive/);
  assert.equal(cleaned, false);
  fail = false;
  await executor.shutdown();
  assert.equal(cleaned, true);
});
