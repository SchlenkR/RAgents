import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { TestContext } from "node:test";
import { allGrants, setupRun } from "../../../packages/ragents/tests/support.ts";
import type { ActorProgramsService } from "../src/plugin-support/actor-programs/service.ts";
import { runtimeFor, invocationResult } from "./actor-runtime-fixture.ts";

export const unavailableActorPrograms: ActorProgramsService = {
  async runInput() { throw new Error("Actor programs are not configured in this fixture."); },
  async workspaceDirectory() { throw new Error("Actor programs are not configured in this fixture."); },
  async importPackage() { throw new Error("Actor programs are not configured in this fixture."); },
};

export const actorProgramFixture = async (t: TestContext) => {
  const directory = await mkdtemp(path.join(tmpdir(), "ragents-actor-program-"));
  const setup = setupRun({grants: allGrants()});
  const runtime = runtimeFor(setup, directory);
  const runId = setup.view.id;
  t.after(async () => {
    await runtime.shutdown();
    await setup.services.nativeTypeScriptExecutor!.shutdown();
    setup.journal.close();
    await rm(directory, {recursive: true, force: true});
  });
  return {directory, setup, runtime, runId, context: {actorId: setup.view.ownerId, commandId: "activate"}};
};

export const counterFiles = (options: {input?: boolean; views?: boolean} = {}) => ({
  "package.json": JSON.stringify({name: "counter", private: true, type: "module", ragents: {
    title: "Counter", backend: "src/server.ts", ...(options.views ? {views: [
      {id: "main", title: "Main Counter", client: "src/client.tsx"},
      {id: "compact", title: "Compact Counter", client: "src/client.tsx"},
    ]} : {}),
  }}),
  "src/lib/increment.ts": "export const increment = (current: number, amount: number): number => current + amount;",
  "src/server.ts": `import {Type} from "typebox";
import {defineActor} from "@ragents/server";
import {increment} from "./lib/increment.js";
let calls = 0;
export default defineActor({
  state: Type.Object({count: Type.Optional(Type.Number())}),
  ${options.input ? "input: {capabilities: []}," : ""}
  functions: {
    add: {label: "Add", input: Type.Object({amount: Type.Number(), delay: Type.Optional(Type.Number())}),
      output: Type.Object({count: Type.Number(), pid: Type.Number(), calls: Type.Number(), actor: Type.String()}),
      capabilities: [], tool: {name: "counter_add"}},
  },
}, {
  ${options.input ? "onInput(input, context) { calls++; context.state.replace({count: increment(context.state.read().count ?? 0, Number(input.content))}); }," : ""}
  functions: {async add(input, context) {
    calls++;
    const before = context.state.read().count ?? 0;
    if (input.delay) await new Promise((resolve) => setTimeout(resolve, input.delay));
    const count = increment(before, input.amount);
    context.state.replace({count});
    return {count, pid: process.pid, calls, actor: context.actor.id};
  }},
});`,
  ...(options.views ? {"src/client.tsx": 'document.body.dataset.actorView = "ready"; export {};'} : {}),
  "tests/counter.test.ts": `import assert from "node:assert/strict";
import test from "node:test";
import {createTestContext} from "@ragents/server/testing";
import counter from "../src/server.js";
test("function changes the shared actor state", async () => {
  const context = createTestContext<{count?: number}>({state: {}});
  const result = await counter.functions.add({amount: 2}, context);
  assert.equal(result.count, 2);
  assert.deepEqual(context.state.read(), {count: 2});
});`,
});

export const invokeActorFunction = async (fixture: Awaited<ReturnType<typeof actorProgramFixture>>, name: string, input: unknown, requestId: string) => {
  const program = fixture.runtime.programs(fixture.runId).find((entry) => entry.name === name)!;
  const invocation = fixture.runtime.startFunctionInvocation(fixture.runId, program.actorHandle, program.revision, "add", requestId, input);
  return invocationResult(fixture.runtime, fixture.runId, program.actorHandle, invocation.id);
};

export const setupPackageFiles = (source?: string) => [
  {path: "package.json", content: JSON.stringify({name: "setup", private: true, type: "module", ragents: {title: "Setup", backend: "src/server.ts"}})},
  {path: "src/server.ts", content: source ?? `import {Type} from "typebox"; import {defineActor} from "@ragents/server";
export default defineActor({state: Type.Object({ready: Type.Optional(Type.Boolean())}), functions: {}, input: {capabilities: []}}, {
  functions: {}, onInput(_input, context) {context.state.replace({ready: true});},
});`},
];
