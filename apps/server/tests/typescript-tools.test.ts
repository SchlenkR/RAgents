import assert from "node:assert/strict";
import { mkdir, mkdtemp, symlink, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test, { type TestContext } from "node:test";
import { Type } from "typebox";
import { claimTurn, defineRunFunction, ToolRegistry, TurnToolset, type JsonValue } from "@ragents/engine";

import { allGrants, catalog, postTo, setupRun } from "../../../packages/ragents/tests/support.ts";
import { WorkspaceOperationExecutor, fileModule, workspaceProcessContext } from "@ragents/workspace-executor";
import { createTypeScriptToolContributor } from "../src/ragents/typescript-tools.ts";
import { withDomainCause, type SandboxServices } from "../src/plugin-support/workspace-sandbox-host.ts";
import { nativeExecutorFixture } from "./native-executor-fixture.ts";

const fixture = async (t: TestContext, toolNames: string[] | null = null) => {
    const directory = await mkdtemp(path.join(tmpdir(), "ragents-typescript-tools-"));
    const workspace = path.join(directory, "workspace");
    const actors = path.join(directory, "actors");
    await mkdir(workspace);
    await mkdir(actors);
    const native = nativeExecutorFixture(directory);
    const contextFor = async (runId: string) => workspaceProcessContext({
        runId, cwd: workspace, root: workspace, home: { home: workspace }, logDirectory: workspace, hostRoot: undefined,
        additionalRoots: [{ directory: actors, alias: "@actors" }],
    });
    const files = new WorkspaceOperationExecutor({ contextFor, modules: [fileModule] });
    const execute: SandboxServices["execute"] = async (runId, operation, input, options) => {
        try {
            return await files.execute(runId, operation, input, options);
        } catch (error) {
            throw withDomainCause(error);
        }
    };
    const setup = setupRun({ grants: allGrants(), toolNames });
    setup.services.nativeTypeScriptExecutor = native.executor;
    let count = 0;
    const extension = defineRunFunction({
        name: "counter_update",
        label: "Update Counter",
        description: "Update the test extension counter.",
        longDescription: "Increment the counter by a positive amount and return the updated count and caller.",
        schema: Type.Object({ amount: Type.Number({ minimum: 1, description: "Positive increment." }) }, { additionalProperties: false }),
        resultSchema: Type.Object({ count: Type.Number(), caller: Type.String() }, { additionalProperties: false }),
        available: () => true,
        run: (scope, _id, input) => ({ count: count += input.amount, caller: scope.caller.actorId }),
    });
    const registry = new ToolRegistry().register({
        name: "test-extension", dynamic: true, descriptors: [], tools: () => [extension],
    }).register(createTypeScriptToolContributor({ serverProcessContextFor: contextFor, execute }));
    const queued = postTo(setup.runtime, setup.view, setup.agent.id, "snippet-input", "Evaluate TypeScript.");
    const input = queued.inputs.find((entry) => entry.actorId === setup.agent.id && entry.lifecycle.kind === "pending");
    assert.ok(input);
    const turn = claimTurn(setup.runtime, setup.view.id, setup.agent.id, input.id, "snippet-turn");
    const toolset = await TurnToolset.create({ runtime: setup.runtime, turn, catalog, registry, workspace,
        chapters: (names) => names.includes("counter_update") ? "Counter extension usage guide." : "",
    });
    t.after(async () => { await native.close(); setup.journal.close(); });
    const call = (id: string, name: string, input: JsonValue) => toolset.invoke(id, name, input).then((result) => result.output);
    return { directory, workspace, actors, setup, toolset, call, count: () => count };
};

test("TypeScript discovery exposes the same registered function with exact schemas, types and guidance", async (t) => {
    const run = await fixture(t, ["counter_update"]);
    assert.deepEqual(run.toolset.tools.map((entry) => entry.name), ["typescript_api", "typescript_eval"]);
    const listing = await run.call("api-list", "typescript_api", {});
    assert.deepEqual(listing, { functions: [{ name: "counter_update", label: "Update Counter", description: "Update the test extension counter." }] });
    const detail = await run.call("api-detail", "typescript_api", { names: ["counter_update"] });
    assert.ok(detail !== null && typeof detail === "object" && !Array.isArray(detail));
    assert.match(String(detail.declarations), /"counter_update"/);
    assert.match(String(detail.declarations), /"amount": number/);
    assert.match(String(detail.declarations), /readonly functions:/);
    assert.match(String(detail.guidance), /Counter extension usage guide/);
    assert.match(String(detail.declarations), /\/\*\* Positive increment\. \*\/ "amount": number/);
    assert.doesNotMatch(JSON.stringify(detail.functions), /inputSchema/);
    assert.match(JSON.stringify(detail.functions), /Increment the counter by a positive amount/);
    const schemas = await run.call("api-schemas", "typescript_api", { names: ["counter_update"], schemas: true });
    assert.ok(schemas !== null && typeof schemas === "object" && !Array.isArray(schemas));
    assert.match(JSON.stringify(schemas.functions), /"minimum":1/);
    assert.match(JSON.stringify(schemas.functions), /Positive increment/);
    await assert.rejects(run.call("api-schemas-all", "typescript_api", { schemas: true }), /nur zu ausgewählten names/);
    const search = await run.call("api-search", "typescript_api", { query: "counter" });
    assert.deepEqual(search, listing);
    await assert.rejects(run.call("api-missing", "typescript_api", { names: ["actor_stop"] }), /Nicht verfügbare TypeScript-Funktionen/);
});

test("a real snippet calls a plugin function under its caller identity without creating actors or programs", async (t) => {
    const run = await fixture(t, ["counter_update"]);
    const before = run.setup.runtime.view(run.setup.view.id).actors.length;
    const output = await run.call("eval-update", "typescript_eval", { code: `
const result = await context.functions.counter_update({ amount: 3 });
context.log("updated");
return { ...result, actor: context.actor.handle, principal: context.principal.id };
` });
    assert.deepEqual(output, {
        result: { count: 3, caller: run.setup.agent.id, actor: "worker", principal: run.setup.agent.id }, logs: ["updated"],
    });
    assert.equal(run.setup.runtime.view(run.setup.view.id).actors.length, before);
    const calls = run.setup.runtime.events(run.setup.view.id).filter((entry) => entry.type === "tool.call.started");
    assert.equal(calls.length, 2);
    assert.ok(calls.every((entry) => entry.actorId === run.setup.agent.id));
});

test("snippet files resolve workspace aliases and reject escaped paths and conflicting sources", async (t) => {
    const run = await fixture(t, ["counter_update"]);
    await writeFile(path.join(run.actors, "setup.ts"), 'return context.functions.counter_update({ amount: 2 });');
    assert.deepEqual(await run.call("eval-file", "typescript_eval", { path: "@actors/setup.ts" }), {
        result: { count: 2, caller: run.setup.agent.id }, logs: [],
    });
    await writeFile(path.join(run.directory, "outside.ts"), 'return 0;');
    await symlink(path.join(run.directory, "outside.ts"), path.join(run.workspace, "escape.ts"));
    await assert.rejects(run.call("eval-outside", "typescript_eval", { path: "../outside.ts" }), /Ungültiger Pfad: \.\.\/outside\.ts/);
    await assert.rejects(run.call("eval-symlink", "typescript_eval", { path: "escape.ts" }), /außerhalb des Arbeitsverzeichnisses/);
    await assert.rejects(run.call("eval-unknown-alias", "typescript_eval", { path: "@missing/setup.ts" }), /Unbekannter Arbeitsverzeichnis-Alias/);
    await assert.rejects(run.call("eval-both", "typescript_eval", { code: "return 0;", path: "@actors/setup.ts" }), /genau eines/);
    await assert.rejects(run.call("eval-neither", "typescript_eval", {}), /genau eines/);
    assert.equal(run.count(), 2);
});

test("the snippet host checks types before side effects and validates plugin function schema constraints at runtime", async (t) => {
    const run = await fixture(t, ["counter_update"]);
    await assert.rejects(run.call("eval-type-error", "typescript_eval", { code: `
await context.functions.counter_update({ amount: 1 });
return context.functions.counter_update({ amount: "bad" });
` }), /TypeScript-Snippet wurde nicht ausgeführt/);
    assert.equal(run.count(), 0);
    await assert.rejects(run.call("eval-value-error", "typescript_eval", { code: 'return context.functions.counter_update({ amount: -1 });' }), /counter_update/);
    assert.equal(run.count(), 0);
    await assert.rejects(run.call("eval-partial-error", "typescript_eval", { code: `
await context.functions.counter_update({ amount: 1 });
context.log("first operation completed");
throw new Error("second operation failed");
` }), /first operation completed/);
    assert.equal(run.count(), 1);
});

test("text-only actors receive no TypeScript execution or API tools", async (t) => {
    const run = await fixture(t, []);
    assert.deepEqual(run.toolset.tools, []);
    assert.deepEqual(run.toolset.functions, []);
});

test("the real snippet process rejects non-JSON results before IPC can coerce them", async (t) => {
    const run = await fixture(t, ["counter_update"]);
    for (const [index, value] of ["Infinity", "NaN", "new Date()", "[undefined]"].entries()) {
        await assert.rejects(run.call(`invalid-json-${index}`, "typescript_eval", { code: `return ${value};` }), /must be/);
    }
    assert.deepEqual(await run.call("absent-json", "typescript_eval", { code: "return { present: 1, missing: undefined };" }), { result: { present: 1 }, logs: [] });
    assert.equal(run.count(), 0);
});

test("snippets expose the same standard library as actor programs", async (t) => {
    const run = await fixture(t, ["counter_update"]);
    const result = await run.call("eval-std", "typescript_eval", { code: `
const now = context.std.now();
await context.functions.counter_update({ amount: 1 });
return { now, stable: now === context.std.now(), ids: [context.std.id(), context.std.id()], route: typeof context.std.mediators.route };
` });
    assert.ok(result !== null && typeof result === "object" && !Array.isArray(result));
    assert.ok(result.result !== null && typeof result.result === "object" && !Array.isArray(result.result));
    assert.match(String(result.result.now), /^\d{4}-\d{2}-\d{2}T/);
    assert.equal(result.result.stable, true);
    assert.deepEqual(result.result.ids, ["eval-std:1", "eval-std:2"]);
    assert.equal(result.result.route, "function");
    const api = await run.call("std-api", "typescript_api", { names: ["counter_update"] });
    assert.match(JSON.stringify(api), /readonly std: RAgentsStd/);
});

test("path executions preserve their exact historical source even after a compile error and later file deletion", async (t) => {
    const run = await fixture(t, ["counter_update"]);
    const filename = path.join(run.actors, "history.ts");
    const first = '  const answer: number = "Grüße";\r\nreturn answer;\n';
    await writeFile(filename, first);
    await assert.rejects(run.call("history-invalid", "typescript_eval", { path: "@actors/history.ts" }), /TypeScript-Snippet wurde nicht ausgeführt/);
    const second = 'return "updated";\n';
    await writeFile(filename, second);
    assert.deepEqual(await run.call("history-valid", "typescript_eval", { path: "@actors/history.ts" }), { result: "updated", logs: [] });
    await unlink(filename);
    const events = run.setup.runtime.events(run.setup.view.id);
    const snapshots = events.filter((event) => event.type === "tool.call.source");
    assert.deepEqual(snapshots.map((event) => ({ toolCallId: event.payload.toolCallId, code: event.payload.code, path: event.payload.path })), [
        { toolCallId: "history-invalid", code: first, path: "@actors/history.ts" },
        { toolCallId: "history-valid", code: second, path: "@actors/history.ts" },
    ]);
    assert.ok(snapshots.every((event) => event.actorId === run.setup.agent.id));
    const failed = events.find((event) => event.type === "tool.call.failed" && event.payload.toolCallId === "history-invalid");
    assert.ok(failed && snapshots[0]!.sequence < failed.sequence);
    assert.equal(run.count(), 0);
});

test("inline compile failures keep a source snapshot while unreadable paths fail without inventing source", async (t) => {
    const run = await fixture(t, ["counter_update"]);
    const code = 'return context.functions.missing({});';
    await assert.rejects(run.call("inline-invalid", "typescript_eval", { code }), /does not exist/);
    await assert.rejects(run.call("path-missing", "typescript_eval", { path: "@actors/missing.ts" }), /Nicht gefunden: missing\.ts/);
    const events = run.setup.runtime.events(run.setup.view.id);
    const snapshots = events.filter((event) => event.type === "tool.call.source");
    assert.equal(snapshots.length, 1);
    assert.deepEqual(snapshots[0]!.payload, { turnId: snapshots[0]!.payload.turnId, toolCallId: "inline-invalid", code, path: null });
    const missing = events.filter((event) => (event.type === "tool.call.started" || event.type === "tool.call.failed") && event.payload.toolCallId === "path-missing");
    assert.deepEqual(missing.map((event) => event.type), ["tool.call.started", "tool.call.failed"]);
});
