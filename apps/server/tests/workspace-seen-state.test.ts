import assert from "node:assert/strict";
import { mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import type { PluginContext, ToolScope } from "@ragents/engine";
import { WorkspaceSandboxHost } from "../src/plugin-support/workspace-sandbox-host.ts";

test("parallel first reads preserve seen state for every following write", async () => {
  const directory = await realpath(await mkdtemp(path.join(os.tmpdir(), "ragents-seen-state-")));
  const runId = "run-1";
  const sandbox = new WorkspaceSandboxHost({
    contributorName: "test", contributions: [], workspaceFor: async () => ({
      cwd: directory, currentRoot: async () => directory, runOperation: (operation) => operation(),
    }), identFor: async () => undefined, skillPaths: async () => [],
    homeFor: async () => ({ home: directory }),
  });
  const scope = {
    caller: { runId, actorId: "agent-1", turnId: "turn-1" },
    modelContext: "context-1",
    signal: undefined,
  } as ToolScope;
  const files = ["alpha.md", "beta.md", "gamma.md", "delta.md"];
  try {
    await Promise.all(files.map((file) => writeFile(path.join(directory, file), `Initial ${file}`)));
    const tools = await sandbox.workspaceTools().tools({ runId } as PluginContext);
    const read = tools.find((tool) => tool.name === "read");
    const write = tools.find((tool) => tool.name === "write");
    assert.ok(read);
    assert.ok(write);
    await Promise.all(files.map((file) => read.run(scope, `read-${file}`, { file_path: file } as never)));
    for (const file of files) {
      const content = `Updated ${file}`;
      await write.run(scope, `write-${file}`, { file_path: file, content } as never);
      assert.equal(await readFile(path.join(directory, file), "utf8"), content);
    }
  } finally { await sandbox.shutdownAll(); await rm(directory, { recursive: true, force: true }); }
});
