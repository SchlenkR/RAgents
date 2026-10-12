import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { NodeTypeScriptExecutor } from "../src/plugin-support/native-typescript-executor.ts";
import { workspaceProcessContext } from "@ragents/workspace-executor";

export const nativeExecutorFixture = (directory = mkdtempSync(path.join(tmpdir(), "ragents-native-host-test-"))) => {
  const executor = new NodeTypeScriptExecutor({
    directoryFor: (runId) => path.join(directory, "native-programs", runId),
    serverProcessContextFor: async (runId) => workspaceProcessContext({ runId, cwd: directory, root: directory, home: { home: directory }, logDirectory: directory, hostRoot: undefined }),
  });
  return {
    executor,
    close: async () => {
      await executor.shutdown();
      rmSync(directory, { recursive: true, force: true });
    },
  };
};
