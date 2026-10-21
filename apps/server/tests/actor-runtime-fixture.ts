import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { Type } from "typebox";
import { agentTools, createAccessContext, OperationContributionRegistry, type RunFunction } from "@ragents/engine";
import { setupRun } from "../../../packages/ragents/tests/support.ts";
import type { AskService } from "../../../plugins/ragents.ask/server/contract.ts";
import { ActorProgramRuntime, type ActorProgramRuntimeOptions } from "../../../plugins/ragents.actor-programs/server/runtime.ts";
import { NodeTypeScriptExecutor } from "../src/plugin-support/native-typescript-executor.ts";

export const emptyStateSchema = {type: "object", properties: {}, additionalProperties: false} as const;
export const runtimeFor = (setup: ReturnType<typeof setupRun>, directory: string, operations = new OperationContributionRegistry(),
  askService: AskService = {pose: () => { throw new Error("Unexpected question"); }, ask: async () => { throw new Error("Unexpected operator question"); }, withdraw: () => undefined},
  scriptSources: ActorProgramRuntimeOptions["scriptSources"] = () => undefined,
  hostTools: () => readonly RunFunction[] = () => [],
  sharedPackage: ActorProgramRuntimeOptions["sharedPackage"] = () => undefined,
  directoryFor: (runId: string) => string = () => directory,
  triggers: ActorProgramRuntimeOptions["triggers"] = { prepareRun: async () => undefined, interrupt: async () => { throw new Error("Unexpected trigger interrupt"); } },
  ownerAccess: ActorProgramRuntimeOptions["ownerAccess"] = () => createAccessContext({enabled: false, user: null}),
  agentToolsFor: ActorProgramRuntimeOptions["agentToolsFor"] = async (runId, actorId, provisionalActor) => {
    const view = setup.runtime.view(runId);
    const actor = provisionalActor ?? view.actors.find((candidate) => candidate.id === actorId);
    if (!actor) throw new Error(`Unknown test actor ${actorId}`);
    return [...agentTools, ...hostTools()].filter((tool) => tool.available(actor, view));
  },
  extra: Partial<ActorProgramRuntimeOptions> = {}) => {
  const serverProcessContextFor = async (runId: string) => ({runId, cwd: directoryFor(runId), root: directoryFor(runId), home: directoryFor(runId),
    logDirectory: directoryFor(runId), hostRoot: undefined, env: {PATH: process.env.PATH, HOME: directoryFor(runId), RAGENTS_RUN_ID: runId, NO_COLOR: "1"}});
  setup.services.nativeTypeScriptExecutor = new NodeTypeScriptExecutor({directoryFor: (runId) => path.join(directoryFor(runId), "native-programs"), serverProcessContextFor, isolatedProcessContextFor: serverProcessContextFor});
  const runtime = new ActorProgramRuntime({
    runtime: () => setup.runtime,
    agentToolsFor,
    askService: () => askService, reservedToolNames: () => [], serverProcessContextFor, isolatedProcessContextFor: serverProcessContextFor, isolatedSandbox: async () => undefined,
    operations: {operation: (id) => operations.operation(id), invoke: (id, context, input) => operations.invoke(id, context, input), list: () => operations.describe()},
    directoryFor,
    scriptSources,
    sharedPackage,
    ownerAccess,
    workspaceRoots: async (runId) => ({read: [directoryFor(runId)], write: [directoryFor(runId)]}),
    triggers,
    ...extra,
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

export const pingOperations = () => {
  const calls: unknown[] = [];
  const operation = { id: "native_ping", label: "Ping", description: "Test operation", schema: Type.Object({value: Type.String()}), resultSchema: Type.String(), operator: "direct" as const,
    execute: (_context: unknown, input: unknown) => { calls.push(input); return "pong"; } };
  const operations = new OperationContributionRegistry();
  operations.register("test", [operation]);
  const widenInput = () => { operation.schema = Type.Object({value: Type.String(), verbose: Type.Optional(Type.Boolean())}) as never; };
  const breakResult = () => { operation.resultSchema = Type.Integer() as never; };
  return { operations, calls, widenInput, breakResult };
};
export const appFiles = (body: string) => ({
  "package.json": JSON.stringify({ name: "rpc", private: true, type: "module", ragents: { title: "Rpc", views: [{id: "main", client: "src/client.tsx"}], backend: "src/server.ts" } }),
  "src/client.tsx": 'document.body.dataset.ready = "true"; export {};',
  "src/server.ts": `import {Type} from "typebox"; import {defineActor} from "@ragents/server";
export default defineActor({state: Type.Object({}, {additionalProperties: false}), functions: {run: {label: "Run", input: Type.Object({}), output: Type.String(), capabilities: ["native_ping"]}}}, {functions: {
run: async (_input, context) => {${body}}
}});`,
});
export const sourcesOf = (files: Record<string, string>) => Object.entries(files).map(([file, content]) => ({path: file, content}));
