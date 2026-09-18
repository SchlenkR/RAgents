import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test, { type TestContext } from "node:test";
import { Type } from "typebox";
import {
    claimTurn, defineRunFunction, FixedWorkspaces, ScriptDriver, ToolRegistry, TurnScheduler, TurnToolset, type JsonValue,
} from "@aicontainer/ragents";
import { allGrants, catalog, postTo, setupRun } from "../../../packages/ragents/tests/support.ts";
import { ActorProgramRuntime } from "../../../plugins/ragents.actor-programs/server/runtime.ts";
import { createActorProgramToolContributors } from "../../../plugins/ragents.actor-programs/server/tool-contributor.ts";
import { createTypeScriptToolContributor } from "../src/ragents/typescript-tools.ts";
import { NodeTypeScriptExecutor } from "../src/plugin-support/native-typescript-executor.ts";
import { WorkspaceSandboxHost } from "../src/plugin-support/workspace-sandbox-host.ts";

const workflow = async (t: TestContext) => {
    const directory = await mkdtemp(path.join(tmpdir(), "ragents-typescript-workflow-"));
    const setup = setupRun({ grants: allGrants() });
    const registry = new ToolRegistry();
    const calls: { text: string; actor: string }[] = [];
    registry.register({ name: "test-extension", dynamic: true, descriptors: [], tools: () => [defineRunFunction({
        name: "extension_echo", label: "Echo text", description: "Return text and the identity invoking this extension.",
        schema: Type.Object({ text: Type.String() }, { additionalProperties: false }),
        resultSchema: Type.Object({ text: Type.String(), actor: Type.String() }, { additionalProperties: false }),
        available: () => true,
        run: (scope, _id, input) => {
            const output = { text: input.text, actor: scope.caller.actorId };
            calls.push(output);
            return output;
        },
    })] });
    const sandbox = new WorkspaceSandboxHost({
        contributorName: "test-workspace",
        workspaceFor: async () => ({ cwd: directory, currentRoot: async () => directory, ensureWritable: async () => directory, runOperation: async (operation) => operation() }),
        identFor: async () => undefined,
        skillPaths: async () => [],
        homeFor: async () => ({ home: directory }),
        filesFor: async () => undefined,
    });
    const processContextFor = (runId: string) => sandbox.processContextFor(runId);
    const executor = new NodeTypeScriptExecutor({ directoryFor: () => path.join(directory, "native-programs"), processContextFor });
    setup.services.nativeTypeScriptExecutor = executor;
    const runtime = new ActorProgramRuntime({
        runtime: () => setup.runtime,
        agentToolsFor: async (runId, actorId, provisional) => {
            const view = setup.runtime.view(runId);
            const actor = provisional ?? view.actors.find((candidate) => candidate.id === actorId);
            if (!actor) throw new Error(`Missing actor ${actorId}`);
            return registry.resolve({ runId, actorId, actor, turnId: null,
                view: provisional ? { ...view, actors: [...view.actors, provisional] } : view, workspace: directory,
            });
        },
        askService: () => ({ ask: async () => { throw new Error("Unexpected operator question."); } }),
        reservedToolNames: () => [], processContextFor,
        operations: { operation: () => { throw new Error("No operations registered."); }, invoke: async () => { throw new Error("No operations registered."); }, list: () => [] },
        directoryFor: () => directory,
        scriptSources: () => undefined,
    });
    setup.services.actorPrograms = runtime;
    sandbox.registerWorkspaceRoot({ id: "actor-programs", alias: "@actors", directoryFor: (runId) => runtime.workspaceDirectory(runId) });
    registry.register(sandbox.workspaceTools());
    registry.register(createTypeScriptToolContributor({ processContextFor }));
    for (const contributor of createActorProgramToolContributors(runtime, { latest: () => "" })) registry.register(contributor);
    const queued = postTo(setup.runtime, setup.view, setup.agent.id, "setup-input", "Build a program.");
    const input = queued.inputs.find((entry) => entry.actorId === setup.agent.id && entry.lifecycle.kind === "pending");
    assert.ok(input);
    const turn = claimTurn(setup.runtime, setup.view.id, setup.agent.id, input.id, "setup-turn");
    const toolset = await TurnToolset.create({ runtime: setup.runtime, turn, catalog, registry, workspace: directory });
    t.after(async () => { await runtime.shutdown(); await sandbox.shutdownAll(); await executor.shutdown(); setup.journal.close(); await rm(directory, { recursive: true, force: true }); });
    const call = (id: string, name: string, input: JsonValue) => toolset.invoke(id, name, input).then((result) => result.output);
    return { setup, runtime, directory, registry, toolset, call, turn, calls };
};

const functionFiles = (numeric: boolean) => ({
    "package.json": JSON.stringify({ name: "formatter", type: "module", private: true, ragents: { title: "Formatter", backend: "src/server.ts" } }),
    "src/server.ts": `import { Type } from "typebox";
import { defineActor } from "@ragents/server";
export default defineActor({ state: Type.Object({}), functions: {
  transform: { label: "Transform", input: Type.Object({ value: Type.${numeric ? "Number" : "String"}() }),
    output: Type.${numeric ? "Number" : "String"}(), tool: { name: "dynamic_transform" } },
} }, { functions: { transform: (input) => ${numeric ? "input.value * 2" : "input.value.toUpperCase()"} } });`,
    "tests/transform.test.ts": `import assert from "node:assert/strict";
import test from "node:test";
import { createTestContext } from "@ragents/server/testing";
import program from "../src/server.ts";
test("transform preserves its public result", async () => {
  assert.equal(await program.functions.transform({ value: ${numeric ? "3" : '"hello"'} }, createTestContext({state:{}})), ${numeric ? "6" : '"HELLO"'});
});`,
});

const writeSources = (name: string, files: Readonly<Record<string, string>>) => Object.entries(files).map(([filename, content]) =>
    `await context.functions.write({ path: ${JSON.stringify(`@actors/${name}/${filename}`)}, content: ${JSON.stringify(content)} });`,
).join("\n");

test("new, revised and removed actor functions are discovered and called within one coordinator turn", async (t) => {
    const run = await workflow(t);
    const before = await run.call("before", "typescript_api", { query: "dynamic_transform" });
    assert.deepEqual(before, { functions: [] });
    assert.deepEqual(run.toolset.tools.map((entry) => entry.name), ["read", "edit", "write", "bash", "typescript_api", "typescript_eval"]);
    await run.call("build", "typescript_eval", { code: `
await context.functions.actor_program_create({ name: "formatter", template: "blank" });
${writeSources("formatter", functionFiles(false))}
return context.functions.actor_program_activate({ name: "formatter" });
` });
    const first = await run.call("first-api", "typescript_api", { names: ["dynamic_transform"] });
    assert.match(JSON.stringify(first), /value.*string/s);
    assert.deepEqual(await run.call("first-call", "typescript_eval", { code: 'return context.functions.dynamic_transform({ value: "hello" });' }), { result: "HELLO", logs: [] });

    await run.call("rebuild", "typescript_eval", { code: `${writeSources("formatter", functionFiles(true))}
return context.functions.actor_program_activate({ name: "formatter" });` });
    const revised = await run.call("revised-api", "typescript_api", { names: ["dynamic_transform"] });
    assert.match(JSON.stringify(revised), /value.*number/s);
    await assert.rejects(run.call("old-schema", "typescript_eval", { code: 'return context.functions.dynamic_transform({ value: "hello" });' }), /TypeScript-Snippet wurde nicht ausgeführt/);
    assert.deepEqual(await run.call("revised-call", "typescript_eval", { code: 'return context.functions.dynamic_transform({ value: 4 });' }), { result: 8, logs: [] });

    await run.call("remove", "typescript_eval", { code: 'return context.functions.actor_program_remove({ name: "formatter" });' });
    assert.deepEqual(await run.call("removed-api", "typescript_api", { query: "dynamic_transform" }), { functions: [] });
    await assert.rejects(run.call("removed-detail", "typescript_api", { names: ["dynamic_transform"] }), /Nicht verfügbare TypeScript-Funktionen/);
    await assert.rejects(run.call("removed-call", "typescript_eval", { code: 'return context.functions.dynamic_transform({ value: 4 });' }), /does not exist/);
    assert.deepEqual(run.toolset.tools.map((entry) => entry.name), ["read", "edit", "write", "bash", "typescript_api", "typescript_eval"]);
    assert.equal(run.setup.runtime.view(run.setup.view.id).turns.length, 1);
});

test("snippets and real script inputs call the same extension and input subscriptions belong to the script actor", async (t) => {
    const run = await workflow(t);
    const server = `import { Type } from "typebox";
import { defineActor } from "@ragents/server";
export default defineActor({
  state: Type.Object({ text: Type.Optional(Type.String()), actor: Type.Optional(Type.String()), subscription: Type.Optional(Type.String()) }),
  functions: {}, input: { capabilities: ["extension_echo", "event_subscribe"] },
}, { functions: {}, async onInput(input, context) {
  const response = await context.functions.extension_echo({ text: input.content });
  const subscription = await context.functions.event_subscribe({ eventTypes: ["artifact.published"] });
  context.state.replace({ ...response, subscription: subscription.subscriptionId });
} });`;
    await run.call("build-input-handler", "typescript_eval", { code: `
await context.functions.extension_echo({ text: "from snippet" });
await context.functions.actor_program_create({ name: "collector", template: "blank" });
${writeSources("collector", {
        "package.json": JSON.stringify({ name: "collector", private: true, type: "module", ragents: { title: "Collector", backend: "src/server.ts" } }),
        "src/server.ts": server,
    })}
const program = await context.functions.actor_program_activate({ name: "collector" });
return context.functions.actor_input({ actor: program.actor, content: "from input" });
` });
    const program = run.runtime.programs(run.setup.view.id).find((entry) => entry.name === "collector");
    assert.ok(program);
    run.setup.runtime.finishTurn({ actorId: run.setup.agent.id, turnId: run.turn.turnId, commandId: "finish-setup" }, run.setup.view.id, run.setup.agent.id, { turnId: run.turn.turnId, outcome: "completed" });
    const scheduler = new TurnScheduler(run.setup.runtime, run.setup.journal, {
        catalog, registry: run.registry, workspaces: new FixedWorkspaces(run.directory),
        drivers: { script: new ScriptDriver({ runtime: run.setup.runtime }) },
    });
    try {
        scheduler.start();
        await scheduler.waitForIdle();
        const view = run.setup.runtime.view(run.setup.view.id);
        const scriptTurn = view.turns.find((entry) => entry.actorId === program.actorId);
        assert.equal(scriptTurn?.status, "completed", scriptTurn?.reason ?? "Missing script turn");
        assert.deepEqual(run.calls, [{ text: "from snippet", actor: run.setup.agent.id }, { text: "from input", actor: program.actorId }]);
        assert.equal(view.subscriptions.length, 1);
        assert.equal(view.subscriptions[0]?.subscriberId, program.actorId);
        assert.deepEqual(run.runtime.data(run.setup.view.id, program.actorId).values, {
            text: "from input", actor: program.actorId, subscription: view.subscriptions[0]!.id,
        });
    } finally { await scheduler.stop(); }
});

test("activating a backend always checks its source even when an existing tsconfig excludes it", async (t) => {
    const run = await workflow(t);
    const before = run.setup.runtime.view(run.setup.view.id).actors.length;
    await assert.rejects(run.call("excluded-backend", "typescript_eval", { code: `
await context.functions.actor_program_create({ name: "excluded", template: "blank" });
${writeSources("excluded", {
        "package.json": JSON.stringify({ name: "excluded", type: "module", private: true, ragents: { title: "Excluded backend", backend: "src/server.ts" } }),
        "tsconfig.server.json": JSON.stringify({ compilerOptions: {
            target: "ES2022", module: "ESNext", moduleResolution: "Bundler", strict: true, noEmit: true,
            skipLibCheck: true, allowImportingTsExtensions: true,
        }, include: ["placeholder.ts"] }),
        "placeholder.ts": "export {};",
        "src/server.ts": `import { Type } from "typebox";
import { defineActor } from "@ragents/server";
const invalid: number = "must be rejected";
export default defineActor({ state: Type.Object({}), functions: {} }, { functions: {} });`,
    })}
return context.functions.actor_program_activate({ name: "excluded" });
` }), /src\/server\.ts.*TS2322/);
    assert.equal(run.setup.runtime.view(run.setup.view.id).actors.length, before);
    assert.deepEqual(run.runtime.programs(run.setup.view.id), []);
    assert.deepEqual(run.calls, []);
});


test("workspace tools are directly callable with the same scoped file operations and journal", async (t) => {
    const f = await workflow(t);
    assert.deepEqual(f.toolset.tools.filter((tool) => ["read", "write", "edit", "bash"].includes(tool.name)).map((tool) => tool.name).sort(), ["bash", "edit", "read", "write"]);
    await f.call("direct-write", "write", { path: "direct.txt", content: "before" });
    await f.call("direct-edit", "edit", { path: "direct.txt", edits: [{ oldText: "before", newText: "after" }] });
    assert.match(String(await f.call("direct-read", "read", { path: "direct.txt" })), /after/);
    assert.match(String(await f.call("direct-bash", "bash", { command: "cat direct.txt" })), /after/);
    await assert.rejects(f.call("direct-outside", "write", { path: "../forbidden.txt", content: "denied" }), /außerhalb/);
    const calls = f.setup.runtime.events(f.setup.view.id).filter((event) => event.type === "tool.call.started");
    assert.deepEqual(calls.map((event) => event.payload.name), ["write", "edit", "read", "bash", "write"]);
    assert.ok(calls.every((event) => event.actorId === f.setup.agent.id));
});
