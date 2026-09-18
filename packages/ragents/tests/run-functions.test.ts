import assert from "node:assert/strict";
import test from "node:test";
import { Type } from "typebox";

import { ToolRegistry, type ToolContributor } from "../src/agents/plugins.ts";
import { TurnToolset } from "../src/agents/toolset.ts";
import { defineRunFunction, type RunFunction } from "../src/agents/tools.ts";
import { claimTurn } from "../src/agents/turn.ts";
import { PluginHost } from "../src/plugin-host.ts";
import { allGrants, catalog, postTo, setupRun } from "./support.ts";

const hostWith = (...functions: readonly (RunFunction | ToolContributor)[]) => {
    const host = new PluginHost({
        product: { id: "test", title: "Test" },
        dataDirectory: "/private/tmp/ragents-typescript-functions",
        storageModes: { sessionsRoot: 0o700, session: 0o700 },
    });
    host.register({
        manifest: { id: "test.functions" },
        register: (registration) => registration.functions(...functions),
    });
    return host;
};

const toolsetFor = async (setup: ReturnType<typeof setupRun>, host: PluginHost) => {
    const registry = new ToolRegistry();
    for (const contribution of host.tools.entries()) registry.register(contribution);
    const view = postTo(setup.runtime, setup.view, setup.agent.id, "function-input", "Los.");
    const input = view.inputs.find((entry) => entry.actorId === setup.agent.id && entry.lifecycle.kind === "pending");
    assert.ok(input);
    const turn = claimTurn(setup.runtime, setup.view.id, setup.agent.id, input.id, "function-turn");
    return TurnToolset.create({ runtime: setup.runtime, turn, catalog, registry });
};

const sum = (nativeTool = false) => defineRunFunction({
    name: "sum",
    label: "Sum",
    description: "Adds two numbers.",
    schema: Type.Object({ left: Type.Number(), right: Type.Number() }, { additionalProperties: false }),
    resultSchema: Type.Number(),
    available: () => true,
    nativeTool,
    run: (_scope, _id, input) => input.left + input.right,
});

test("a plugin registers one typed function with generated descriptors and no native tool by default", async () => {
    const host = hostWith(sum());
    const setup = setupRun({ grants: allGrants(), toolNames: ["sum"] });
    try {
        const toolset = await toolsetFor(setup, host);
        assert.deepEqual(toolset.functions.map((entry) => entry.name), ["sum"]);
        assert.deepEqual(toolset.tools, []);
        assert.equal(await toolset.invokeFunction("sum-once", "sum", { left: 2, right: 3 }), 5);
        await assert.rejects(toolset.invoke("native-denied", "sum", { left: 2, right: 3 }), /not available/);
        await assert.rejects(toolset.invokeFunction("invalid", "sum", { left: "two", right: 3 }), /does not match its schema/);
        const descriptor = host.tools.describe().find((entry) => entry.name === "sum");
        assert.equal(descriptor?.owner, "test.functions");
        assert.equal(descriptor?.nativeTool, false);
    } finally {
        setup.journal.close();
    }
});

test("an explicit native tool uses the same function implementation and journal replay", async () => {
    const setup = setupRun({ grants: allGrants(), toolNames: ["sum"] });
    try {
        const toolset = await toolsetFor(setup, hostWith(sum(true)));
        assert.deepEqual(toolset.tools.map((entry) => entry.name), ["sum"]);
        assert.deepEqual(await toolset.invoke("shared-call", "sum", { left: 4, right: 5 }), { output: 9, ignoredFields: [] });
        assert.equal(await toolset.invokeFunction("shared-call", "sum", { left: 4, right: 5 }), 9);
        const completed = setup.runtime.events(setup.view.id).filter((entry) => entry.type === "tool.call.completed");
        assert.equal(completed.length, 1);
    } finally {
        setup.journal.close();
    }
});

test("a native call drops unknown root fields, a function call and nested unknown fields stay hard errors", async () => {
    const context = defineRunFunction({
        name: "context",
        label: "Context",
        description: "Takes no input.",
        schema: Type.Object({}, { additionalProperties: false }),
        resultSchema: Type.String(),
        available: () => true,
        nativeTool: true,
        run: () => "Kontext.",
    });
    const nested = defineRunFunction({
        name: "nested",
        label: "Nested",
        description: "Takes options.",
        schema: Type.Object({ options: Type.Object({ depth: Type.Integer() }, { additionalProperties: false }) }, { additionalProperties: false }),
        resultSchema: Type.Integer(),
        available: () => true,
        nativeTool: true,
        run: (_scope, _id, input) => input.options.depth,
    });
    const setup = setupRun({ grants: allGrants(), toolNames: ["sum", "context", "nested"] });
    try {
        const toolset = await toolsetFor(setup, hostWith(sum(true), context, nested));
        assert.deepEqual(await toolset.invoke("tolerated", "context", { previous: "[]", __unused: "{}" }), { output: "Kontext.", ignoredFields: ["previous", "__unused"] });
        assert.deepEqual(await toolset.invoke("tolerated", "context", { previous: "[]", __unused: "{}" }), { output: "Kontext.", ignoredFields: ["previous", "__unused"] });
        const started = setup.runtime.events(setup.view.id).find((entry) => entry.type === "tool.call.started");
        assert.deepEqual(started?.type === "tool.call.started" ? { input: started.payload.input, ignoredFields: started.payload.ignoredFields } : null, { input: {}, ignoredFields: ["previous", "__unused"] });
        assert.deepEqual(await toolset.invoke("kept", "sum", { left: 1, right: 2 }), { output: 3, ignoredFields: [] });
        await assert.rejects(toolset.invokeFunction("function-strict", "context", { previous: "[]" }), /Tool context takes no input: input has unknown field previous\. Fix the named fields/);
        await assert.rejects(toolset.invoke("missing", "sum", { left: 1, extra: true }), /Tool sum received input that does not match its schema: input has unknown field extra; input is missing required field right\./);
        await assert.rejects(toolset.invoke("nested", "nested", { options: { depth: 1, colour: "red" } }), /options has unknown field colour/);
        assert.equal(setup.runtime.events(setup.view.id).filter((entry) => entry.type === "tool.call.failed").length, 0);
    } finally {
        setup.journal.close();
    }
});

test("native TypeScript infrastructure does not widen the selected function API", async () => {
    const evaluate = defineRunFunction({
        name: "typescript_eval",
        label: "Evaluate TypeScript",
        description: "Calls a selected function in the caller context.",
        schema: Type.Object({ name: Type.String() }, { additionalProperties: false }),
        resultSchema: Type.Number(),
        available: () => true,
        nativeTool: true,
        run: async (scope, id, input) => {
            assert.ok(scope.availableFunctions().some((fn) => fn.name === "sum"));
            assert.equal(scope.caller.actorId, setup.agent.id);
            return await scope.invokeFunction(`${id}:nested`, input.name, { left: 1, right: 2 }) as number;
        },
    });
    const setup = setupRun({ grants: allGrants(), toolNames: ["sum"] });
    try {
        const toolset = await toolsetFor(setup, hostWith(sum(), evaluate));
        assert.deepEqual(toolset.tools.map((entry) => entry.name), ["typescript_eval"]);
        assert.equal((await toolset.invoke("eval", "typescript_eval", { name: "sum" })).output, 3);
        await assert.rejects(toolset.invokeFunction("denied", "actor_list", {}), /not available/);
        await assert.rejects(toolset.invoke("nested-denied", "typescript_eval", { name: "actor_list" }), /not available/);
    } finally {
        setup.journal.close();
    }
});

test("an empty function selection remains a plain LLM without TypeScript infrastructure", async () => {
    const native = { ...sum(true), name: "typescript_eval" };
    const setup = setupRun({ grants: allGrants(), toolNames: [] });
    try {
        const toolset = await toolsetFor(setup, hostWith(native));
        assert.deepEqual(toolset.functions, []);
        assert.deepEqual(toolset.tools, []);
        await assert.rejects(toolset.invokeFunction("denied", "typescript_eval", { left: 1, right: 2 }), /not available/);
    } finally {
        setup.journal.close();
    }
});

test("availability is rechecked before TypeScript invocation", async () => {
    let available = true;
    const guarded = { ...sum(), available: () => available };
    const setup = setupRun({ grants: allGrants(), toolNames: ["sum"] });
    try {
        const toolset = await toolsetFor(setup, hostWith(guarded));
        assert.equal(await toolset.invokeFunction("before", "sum", { left: 2, right: 3 }), 5);
        available = false;
        await assert.rejects(toolset.invokeFunction("after", "sum", { left: 2, right: 3 }), /not available/);
        assert.deepEqual(toolset.functions, []);
    } finally {
        setup.journal.close();
    }
});

test("the same registration accepts simple functions and dynamic context contributions", async () => {
    let enabled = false;
    const host = hostWith(sum(), {
        name: "test.dynamic",
        dynamic: true,
        descriptors: [],
        tools: (context) => enabled ? [{ ...sum(), name: `sum_${context.actor.handle}` }] : [],
    });
    const setup = setupRun({ grants: allGrants(), toolNames: ["sum", "sum_worker"] });
    try {
        const toolset = await toolsetFor(setup, host);
        await assert.rejects(toolset.invokeFunction("before", "sum_worker", { left: 1, right: 2 }), /not available/);
        enabled = true;
        assert.equal(await toolset.invokeFunction("after", "sum_worker", { left: 1, right: 2 }), 3);
        assert.deepEqual(toolset.functions.map((entry) => entry.name), ["sum", "sum_worker"]);
        assert.deepEqual(toolset.tools, []);
    } finally {
        setup.journal.close();
    }
});
