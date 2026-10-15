import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test, { type TestContext } from "node:test";
import { PluginHost, ScriptDriver, ToolRegistry, TurnScheduler, type AgentDriver } from "@ragents/engine";
import { allGrants, catalog, postTo, setupRun } from "../../../packages/ragents/tests/support.ts";
import { agentToolsFrom } from "../../../plugins/ragents.actor-programs/server/agent-tools.ts";
import { runtimeProviderToken, runWorkspaceProviderToken } from "../src/ragents/host-services.ts";
import { runtimeFor } from "./actor-runtime-fixture.ts";

const driver: AgentDriver<"external"> = { kind: "external", runTurn: async () => { throw new Error("This test runs no external turn"); } };
const acmeRuntime = { id: "acme.coder", title: "Example coder", driver };
const setupName = "spawner.spawner";
const spawnerFiles = [
  { path: "package.json", content: JSON.stringify({ name: "spawner", private: true, type: "module", ragents: { title: "Spawner", backend: "src/server.ts" } }) },
  { path: "src/server.ts", content: `import { Type } from "typebox"; import { defineActor } from "@ragents/server";
export default defineActor({ state: Type.Object({ seen: Type.Optional(Type.Number()) }), functions: {}, input: { capabilities: ["agent_spawn"] }, parameters: Type.Object({}) }, {
  functions: {}, onInput(_input, context) { context.state.replace({ seen: (context.state.read().seen ?? 0) + 1 }); },
});` },
];

const fixture = async (t: TestContext) => {
  const directory = await mkdtemp(path.join(tmpdir(), "ragents-external-runtime-"));
  const setup = setupRun({ runId: path.basename(directory).toLowerCase(), grants: allGrants() });
  const runId = setup.view.id;
  const host = new PluginHost({ product: { id: "acme", title: "Acme" }, dataDirectory: directory, storageModes: { session: 0o700, sessionsRoot: 0o700 } });
  host.provideHost(runtimeProviderToken, () => setup.runtime);
  host.provideHost(runWorkspaceProviderToken, async () => ({ cwd: directory, currentRoot: async () => directory, runOperation: (operation) => operation() }));
  const programs = runtimeFor(setup, directory, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, agentToolsFrom(host));
  const registry = host.tools.entries().reduce((current, contributor) => current.register(contributor), new ToolRegistry(() => host.actorRuntimes.describe()));
  const scheduler = new TurnScheduler(setup.runtime, setup.journal, { catalog, registry, drivers: { script: new ScriptDriver({ runtime: setup.runtime }) } });
  t.after(async () => {
    await scheduler.stop();
    await programs.shutdown();
    await setup.services.nativeTypeScriptExecutor!.shutdown();
    setup.journal.close();
    await rm(directory, { recursive: true, force: true });
  });
  const install = async () => {
    await programs.installScript({ actorId: setup.view.ownerId, commandId: "install" }, runId, { entryId: "acme.spawner", handle: "spawner", files: spawnerFiles, programs: [], sharedPrograms: [] }, null);
    return programs.programs(runId).find((program) => program.name === setupName)!;
  };
  let deliveries = 0;
  const deliver = async (actorId: string) => {
    postTo(setup.runtime, setup.view, actorId, `input-${++deliveries}`, "hello");
    scheduler.start();
    await scheduler.waitForIdle();
  };
  const failedTurns = () => setup.runtime.view(runId).turns.filter((turn) => turn.status !== "completed");
  return { host, setup, runId, programs, install, deliver, failedTurns };
};

test("a run script that declares agent_spawn stays bound when a plugin contributes an external actor runtime", async (t) => {
  const f = await fixture(t);
  f.host.actorRuntimes.register("acme.runtimes", [acmeRuntime]);
  const program = await f.install();
  const built = (await agentToolsFrom(f.host)(f.runId, program.actorId)).find((tool) => tool.name === "agent_spawn")!;
  assert.deepEqual((built.schema as unknown as { properties: { runtime: { enum: string[] } } }).properties.runtime.enum, ["acme.coder"], "the build sees the runtimes the running actor sees");
  await f.deliver(program.actorId);
  assert.deepEqual(f.failedTurns(), []);
  assert.deepEqual(f.programs.data(f.runId, program.actorId).values, { seen: 1 });
});

test("a runtime that registers after the run script was built reactivates it instead of failing the capability contract", async (t) => {
  const f = await fixture(t);
  const program = await f.install();
  await f.deliver(program.actorId);
  assert.deepEqual(f.failedTurns(), []);
  f.host.actorRuntimes.register("acme.runtimes", [acmeRuntime]);
  await f.deliver(program.actorId);
  assert.deepEqual(f.failedTurns(), []);
  assert.deepEqual(f.programs.data(f.runId, program.actorId).values, { seen: 2 });
  const reactivated = f.programs.programs(f.runId).find((entry) => entry.name === setupName)!;
  assert.notEqual(reactivated.input!.capabilityContractHash, program.input!.capabilityContractHash, "the package was bound to the new contract");
  await f.deliver(program.actorId);
  assert.deepEqual(f.failedTurns(), []);
  assert.equal(f.programs.programs(f.runId).find((entry) => entry.name === setupName)!.input!.capabilityContractHash, reactivated.input!.capabilityContractHash, "the contract stays settled");
});
