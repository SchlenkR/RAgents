import assert from "node:assert/strict";
import test from "node:test";
import { Type } from "typebox";

import { ToolRegistry } from "../src/agents/plugins.ts";
import { TurnToolset } from "../src/agents/toolset.ts";
import { claimTurn } from "../src/agents/turn.ts";
import { defineRunFunction } from "../src/agents/tools.ts";
import type { CapabilityGrant } from "../src/domain/model.ts";
import { allGrants, catalog, postTo, setupRun } from "./support.ts";

const turnToolset = async (
    setup: ReturnType<typeof setupRun>,
    content: string,
    registry?: ToolRegistry,
) => {
    const queued = postTo(setup.runtime, setup.view, setup.agent.id, `input-${content}`, content);
    const input = queued.inputs.find((entry) => entry.actorId === setup.agent.id && entry.lifecycle.kind === "pending");
    assert.ok(input);
    const turn = claimTurn(
        setup.runtime,
        setup.view.id,
        setup.agent.id,
        input.id,
        `turn-${content}`,
    );
    const toolset = await TurnToolset.create({
        runtime: setup.runtime,
        turn,
        catalog,
        registry,
    });

    return { turn, toolset };
};

test("tool selection is the intersection of capabilities and toolNames", async () => {
    const setup = setupRun({ grants: allGrants(), toolNames: ["actor_list"] });

    try {
        const { toolset } = await turnToolset(setup, "selected");
        assert.deepEqual(toolset.functions.map((entry) => entry.name), ["actor_list"]);
        assert.deepEqual(toolset.tools, []);
        await assert.rejects(toolset.invoke("native-call", "actor_list", {}), /is not available/);
        await assert.rejects(toolset.invokeFunction("unavailable", "actor_input", {
            actor: setup.agent.id,
            content: "Not available.",
        }), /is not available/);
    } finally {
        setup.journal.close();
    }
});

test("tools empty exposes no runtime tools", async () => {
    const setup = setupRun({ grants: allGrants(), toolNames: [] });

    try {
        const { toolset } = await turnToolset(setup, "plain");
        assert.deepEqual(toolset.tools, []);
    } finally {
        setup.journal.close();
    }
});

test("a completed tool call replays within the same turn without acting twice", async () => {
    let calls = 0;
    const countingTool = defineRunFunction({
        name: "count_once",
        label: "Count once",
        description: "Count executions.",
        schema: Type.Object({ value: Type.String() }, { additionalProperties: false }),
        resultSchema: Type.Object({ calls: Type.Integer() }, { additionalProperties: false }),
        available: () => true,
        run: () => ({ calls: ++calls }),
    });
    const registry = new ToolRegistry().register({
        name: "counting",
        descriptors: [],
        dynamic: true,
        tools: () => [countingTool],
    });
    const setup = setupRun();

    try {
        const { toolset } = await turnToolset(setup, "replay", registry);
        assert.deepEqual(await toolset.invokeFunction("same-call", "count_once", { value: "one" }), { calls: 1 });
        assert.deepEqual(await toolset.invokeFunction("same-call", "count_once", { value: "one" }), { calls: 1 });
        assert.equal(calls, 1);
        assert.deepEqual(
            setup.runtime.events(setup.view.id)
                .filter((entry) => entry.type.startsWith("tool.call."))
                .map((entry) => entry.type),
            ["tool.call.started", "tool.call.completed"],
        );
    } finally {
        setup.journal.close();
    }
});

test("journal replay happens before the current tool input schema is checked", async () => {
    let calls = 0;
    const changingTool = defineRunFunction({
        name: "changing_contract",
        label: "Changing contract",
        description: "Simulate an evolved schema.",
        schema: Type.Object({ legacy: Type.String() }, { additionalProperties: false }),
        resultSchema: Type.Object({ calls: Type.Integer() }, { additionalProperties: false }),
        available: () => true,
        run: () => ({ calls: ++calls }),
    });
    const registry = new ToolRegistry().register({
        name: "changing",
        descriptors: [],
        dynamic: true,
        tools: () => [changingTool],
    });
    const setup = setupRun();

    try {
        const { toolset } = await turnToolset(setup, "historical", registry);
        const historical = { legacy: "accepted then" };
        assert.deepEqual(await toolset.invokeFunction("historical-call", changingTool.name, historical), { calls: 1 });
        changingTool.schema = Type.Object({ current: Type.Number() }, { additionalProperties: false });

        assert.deepEqual(await toolset.invokeFunction("historical-call", changingTool.name, historical), { calls: 1 });
        assert.equal(calls, 1);
    } finally {
        setup.journal.close();
    }
});

test("agent_spawn inherits delegable capabilities with an explicit tool selection", async () => {
    const grants: CapabilityGrant[] = [
        { capability: "agent.spawn", scope: { kind: "run" }, delegable: true },
        { capability: "plugin.state.write", scope: { kind: "run" }, delegable: true },
        {
            capability: "workspace.use",
            scope: { kind: "workspace", path: "/workspace/project" },
            delegable: true,
            usable: false,
        },
        { capability: "artifact.publish", scope: { kind: "run" }, delegable: false },
    ];
    const setup = setupRun({ grants, toolNames: ["agent_spawn"] });

    try {
        const { toolset } = await turnToolset(setup, "spawn inherited");
        const spawned = await toolset.invokeFunction("spawn-child", "agent_spawn", {
            handle: "child",
            displayName: "Child",
            prompt: "Handle the child task.",
            profile: "agent",
            tools: ["model_list"],
        });
        const spawnedText = JSON.stringify(spawned);
        assert.match(spawnedText, /"handle":"child"/);
        assert.doesNotMatch(spawnedText, /Handle the child task|"execution"/);
        const child = setup.runtime.view(setup.view.id).actors.find((entry) => entry.handle === "child");
        assert.ok(child?.kind === "agent");
        assert.deepEqual(spawned, { id: child.id, handle: child.handle });
        assert.deepEqual(child.toolNames, ["model_list"]);
        assert.deepEqual(child.grants, [
            { capability: "agent.spawn", scope: { kind: "run" }, delegable: true },
            { capability: "plugin.state.write", scope: { kind: "run" }, delegable: true },
            {
                capability: "workspace.use",
                scope: { kind: "workspace", path: "/workspace/project" },
                delegable: true,
            },
        ]);
    } finally {
        setup.journal.close();
    }
});

test("agent_spawn rejects missing and unknown tool selections before creating an actor", async () => {
    const setup = setupRun({ grants: allGrants(), toolNames: ["agent_spawn"] });
    try {
        const { toolset } = await turnToolset(setup, "invalid tools");
        const before = setup.runtime.view(setup.view.id).actors;
        const input = { handle: "child", prompt: "Talk normally.", profile: "agent" };
        await assert.rejects(toolset.invokeFunction("missing-tools", "agent_spawn", input), /does not match its schema/);
        await assert.rejects(toolset.invokeFunction("unknown-tools", "agent_spawn", { ...input, tools: ["not_a_real_tool"] }), /Unknown agent tools: not_a_real_tool.*Existing names:.*actor_list/);
        await assert.rejects(toolset.invokeFunction("future-tools", "agent_spawn", { ...input, tools: ["future_actor_function"] }), /future actor functions/);
        assert.deepEqual(setup.runtime.view(setup.view.id).actors, before);
    } finally {
        setup.journal.close();
    }
});

test("agent_spawn returns the created actor reference when an existing handle requires a suffix", async () => {
    const setup = setupRun({ grants: allGrants(), toolNames: ["agent_spawn", "actor_input"] });
    try {
        const { toolset } = await turnToolset(setup, "spawn duplicate handle");
        const input = { handle: "child", prompt: "Answer the assigned question.", profile: "agent", tools: [] };
        const first = await toolset.invokeFunction("first-child", "agent_spawn", input) as { id: string; handle: string };
        const second = await toolset.invokeFunction("second-child", "agent_spawn", input) as { id: string; handle: string };
        assert.notEqual(first.id, second.id);
        assert.notEqual(first.handle, second.handle);
        await toolset.invokeFunction("address-child", "actor_input", { actor: second.id, content: "Your task." });
        const view = setup.runtime.view(setup.view.id);
        assert.equal(view.actors.find((entry) => entry.id === second.id)?.handle, second.handle);
        assert.equal(view.inputs.filter((entry) => entry.actorId === second.id).length, 1);
        assert.equal(view.inputs.filter((entry) => entry.actorId === first.id).length, 0);
    } finally {
        setup.journal.close();
    }
});

test("agent_spawn with explicit null resolves a dynamic toolset without copying its caller", async () => {
    let enabled = false;
    const dynamicTool = defineRunFunction({
        name: "later_function", label: "Later function", description: "A function activated after spawning.",
        schema: Type.Object({}), resultSchema: Type.String(), available: () => true, run: () => "ready",
    });
    const registry = new ToolRegistry().register({ name: "later", descriptors: [], dynamic: true, tools: () => enabled ? [dynamicTool] : [] });
    const setup = setupRun({ grants: allGrants(), toolNames: ["agent_spawn"] });
    try {
        const { toolset } = await turnToolset(setup, "dynamic parent", registry);
        await toolset.invokeFunction("spawn-dynamic", "agent_spawn", { handle: "dynamic", prompt: "Use the activated function.", profile: "agent", tools: null });
        const view = setup.runtime.view(setup.view.id);
        const child = view.actors.find((entry) => entry.handle === "dynamic");
        assert.ok(child?.kind === "agent");
        assert.equal(child.toolNames, null);
        enabled = true;
        const childTurn = await turnToolset({ ...setup, view, agent: child }, "dynamic child", registry);
        assert.equal(await childTurn.toolset.invokeFunction("call-later", "later_function", {}), "ready");
        assert.ok(childTurn.toolset.functions.some((entry) => entry.name === "actor_list"));
    } finally {
        setup.journal.close();
    }
});

test("agent_spawn validates existing dynamic names even when they belong to another actor", async () => {
    const dynamicTool = defineRunFunction({
        name: "bound_function", label: "Bound function", description: "An existing actor function.",
        schema: Type.Object({}), resultSchema: Type.String(), available: () => true, run: () => "ready",
    });
    const registry = new ToolRegistry().register({ name: "bound", descriptors: [], dynamic: true, tools: (context) => context.actor.handle === "bound" ? [dynamicTool] : [] });
    const setup = setupRun({ grants: allGrants(), toolNames: ["agent_spawn"] });
    try {
        setup.runtime.spawnAgent({ actorId: setup.view.ownerId, commandId: "create-bound" }, setup.view.id, {
            handle: "bound", displayName: "Bound", prompt: "Existing function owner.",
            execution: setup.agent.execution, grants: allGrants(), toolNames: ["bound_function"],
        });
        const { toolset } = await turnToolset(setup, "known function", registry);
        await toolset.invokeFunction("spawn-known", "agent_spawn", { handle: "child", prompt: "Use an existing function when targeted.", profile: "agent", tools: ["bound_function"] });
        const child = setup.runtime.view(setup.view.id).actors.find((entry) => entry.handle === "child");
        assert.ok(child?.kind === "agent");
        assert.deepEqual(child.toolNames, ["bound_function"]);
    } finally {
        setup.journal.close();
    }
});

test("agent_spawn supports capability opt-out and a plain tools selection", async () => {
    const setup = setupRun({ grants: allGrants(), toolNames: ["agent_spawn"] });

    try {
        const { toolset } = await turnToolset(setup, "spawn plain");
        await toolset.invokeFunction("spawn-plain", "agent_spawn", {
            handle: "plain",
            displayName: "Plain",
            prompt: "Talk normally.",
            profile: "agent",
            tools: [],
            withoutCapabilities: ["plugin.state.write"],
        });
        const child = setup.runtime.view(setup.view.id).actors.find((entry) => entry.handle === "plain");
        assert.ok(child?.kind === "agent");
        assert.deepEqual(child.toolNames, []);
        assert.equal(child.grants.some((entry) => entry.capability === "plugin.state.write"), false);
    } finally {
        setup.journal.close();
    }
});

test("agent_spawn rejects the removed explicit grant list", async () => {
    const setup = setupRun({ grants: allGrants(), toolNames: ["agent_spawn"] });

    try {
        const { toolset } = await turnToolset(setup, "old grants");
        await assert.rejects(toolset.invokeFunction("spawn-old", "agent_spawn", {
            handle: "old",
            displayName: "Old",
            prompt: "Old contract.",
            profile: "agent",
            tools: [],
            grants: [],
        }), /does not match its schema/);
        assert.equal(setup.runtime.view(setup.view.id).actors.some((entry) => entry.handle === "old"), false);
    } finally {
        setup.journal.close();
    }
});

test("event tools expose subscriptions and journal queries", async () => {
    const setup = setupRun({
        grants: [{ capability: "event.subscribe", scope: { kind: "run" }, delegable: true }],
        toolNames: ["event_subscribe", "event_subscription_list", "event_query"],
    });

    try {
        const { toolset } = await turnToolset(setup, "observe");
        const subscription = await toolset.invokeFunction("subscribe", "event_subscribe", {
            sourceActorKinds: ["agent"],
            eventTypes: ["model.output.completed"],
        }) as { subscriptionId: string };
        const listed = await toolset.invokeFunction("list", "event_subscription_list", {}) as Array<{ subscriptionId: string }>;
        const queried = await toolset.invokeFunction("query", "event_query", {
            eventTypes: ["subscription.created"],
        }) as Array<{ type: string }>;

        const byHandle = await toolset.invokeFunction("subscribe-handle", "event_subscribe", {
            sourceActorIds: ["@worker"],
            eventTypes: ["model.output.completed"],
            includeSelf: true,
        }) as { sourceActorIds: string[]; sources: string[] };

        assert.equal(listed[0]?.subscriptionId, subscription.subscriptionId);
        assert.deepEqual(byHandle.sourceActorIds, [setup.agent.id]);
        assert.deepEqual(byHandle.sources, ["@worker"]);
        assert.deepEqual(queried.map((entry) => entry.type), ["subscription.created"]);
    } finally {
        setup.journal.close();
    }
});
