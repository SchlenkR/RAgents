import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { agentTools, OperationContributionRegistry } from "@ragents/engine";
import { setupRun } from "../../../packages/ragents/tests/support.ts";
import type { AskService } from "../../../plugins/ragents.ask/server/contract.ts";
import { ActorProgramRuntime, type ActorProgramRuntimeOptions } from "../../../plugins/ragents.actor-programs/server/runtime.ts";
import { NodeTypeScriptExecutor } from "../src/plugin-support/native-typescript-executor.ts";

export const emptyStateSchema = {type: "object", properties: {}, additionalProperties: false} as const;
export const runtimeFor = (setup: ReturnType<typeof setupRun>, directory: string, operations = new OperationContributionRegistry(),
  askService: AskService = {ask: async () => { throw new Error("Unexpected operator question"); }, withdraw: () => undefined},
  scriptSources: ActorProgramRuntimeOptions["scriptSources"] = () => undefined) => {
  const serverProcessContextFor = async (runId: string) => ({runId, cwd: directory, root: directory, home: directory,
    logDirectory: directory, hostRoot: undefined, env: {PATH: process.env.PATH, HOME: directory, RAGENTS_RUN_ID: runId, NO_COLOR: "1"}});
  setup.services.nativeTypeScriptExecutor = new NodeTypeScriptExecutor({directoryFor: () => path.join(directory, "native-programs"), serverProcessContextFor});
  const runtime = new ActorProgramRuntime({
    runtime: () => setup.runtime,
    agentToolsFor: async (runId, actorId, provisionalActor) => {
      const view = setup.runtime.view(runId);
      const actor = provisionalActor ?? view.actors.find((candidate) => candidate.id === actorId);
      if (!actor) throw new Error(`Unknown test actor ${actorId}`);
      return agentTools.filter((tool) => tool.available(actor, view));
    },
    askService: () => askService, reservedToolNames: () => [], serverProcessContextFor,
    operations: {operation: (id) => operations.operation(id), invoke: (id, context, input) => operations.invoke(id, context, input), list: () => operations.describe()},
    directoryFor: () => directory,
    scriptSources,
  });
  setup.services.actorPrograms = runtime;
  return runtime;
};

export const writeAppFiles = async (directory: string, name: string, files: Record<string, string>) => {
  const programDirectory = path.join(directory, "actor-workspace", "actors", name);
  for (const [relative, content] of Object.entries(files)) {
    const file = path.join(programDirectory, relative);
    await mkdir(path.dirname(file), {recursive: true});
    await writeFile(file, content);
  }
  return programDirectory;
};

export const invocationResult = async (runtime: ActorProgramRuntime, runId: string, reference: string, invocationId: string) => {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    const invocation = runtime.invocation(runId, reference, invocationId);
    if (invocation.status === "succeeded" || invocation.status === "failed" || invocation.status === "cancelled") return invocation;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("The actor function invocation did not settle");
};
