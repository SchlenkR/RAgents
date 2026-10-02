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
        assert.deepEqual(toolset.tools.map((entry) => entry.name), ["actor_list"]);
        await assert.rejects(toolset.invoke("native-call", "actor_input", {
            to: setup.agent.id,
            message: "Not available.",
        }), /is not available/);
        await assert.rejects(toolset.invokeFunction("unavailable", "actor_input", {
            to: setup.agent.id,
            message: "Not available.",
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
            description: "handles the child task",
            name: "child",
            displayName: "Child",
            instructions: "Handle the child task.",
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
        const input = { description: "talks normally", name: "child", instructions: "Talk normally.", profile: "agent" };
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
        const input = { description: "answers a question", name: "child", instructions: "Answer the assigned question.", profile: "agent", tools: [] };
        const first = await toolset.invokeFunction("first-child", "agent_spawn", input) as { id: string; handle: string };
        const second = await toolset.invokeFunction("second-child", "agent_spawn", input) as { id: string; handle: string };
        assert.notEqual(first.id, second.id);
        assert.notEqual(first.handle, second.handle);
        await toolset.invokeFunction("address-child", "actor_input", { to: second.id, message: "Your task." });
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
        await toolset.invokeFunction("spawn-dynamic", "agent_spawn", { description: "uses a later function", name: "dynamic", instructions: "Use the activated function.", profile: "agent", tools: null });
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
        await toolset.invokeFunction("spawn-known", "agent_spawn", { description: "uses a bound function", name: "child", instructions: "Use an existing function when targeted.", profile: "agent", tools: ["bound_function"] });
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
            description: "talks normally",
            name: "plain",
            displayName: "Plain",
            instructions: "Talk normally.",
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

test("agent_spawn rejects the removed explicit grant list and the former field names", async () => {
    const setup = setupRun({ grants: allGrants(), toolNames: ["agent_spawn", "actor_input"] });

    try {
        const { toolset } = await turnToolset(setup, "old grants");
        await assert.rejects(toolset.invokeFunction("spawn-old", "agent_spawn", {
            description: "keeps the old contract",
            name: "old",
            displayName: "Old",
            instructions: "Old contract.",
            profile: "agent",
            tools: [],
            grants: [],
        }), /does not match its schema/);
        await assert.rejects(toolset.invokeFunction("spawn-handle", "agent_spawn", {
            handle: "old", prompt: "Old contract.", profile: "agent", tools: [],
        }), /does not match its schema/);
        await assert.rejects(toolset.invokeFunction("old-input", "actor_input", { actor: setup.agent.id, content: "Old contract." }), /does not match its schema/);
        assert.equal(setup.runtime.view(setup.view.id).actors.some((entry) => entry.handle === "old"), false);
    } finally {
        setup.journal.close();
    }
});

test("agent_spawn enqueues its prompt as the first input in the same command and keeps the instructions as system prompt", async () => {
    const setup = setupRun({ grants: allGrants(), toolNames: ["agent_spawn", "actor_input"] });

    try {
        const { toolset } = await turnToolset(setup, "spawn with task");
        const spawned = await toolset.invokeFunction("spawn-task", "agent_spawn", {
            description: "checks the comment rule",
            prompt: "Check the comment rule in src/app.ts and report every violation.",
            name: "checker",
            instructions: "Report findings as a list.",
            profile: "agent",
            tools: [],
        }) as { id: string; handle: string };
        assert.deepEqual(Object.keys(spawned).sort(), ["handle", "id"]);
        const events = setup.runtime.events(setup.view.id);
        const spawnedEvent = events.find((event) => event.type === "agent.spawned" && event.payload.agentId === spawned.id)!;
        const enqueued = events.filter((event) => event.type === "actor.input.enqueued" && event.payload.actorId === spawned.id);
        assert.equal(enqueued.length, 1);
        assert.equal(enqueued[0]!.commandId, spawnedEvent.commandId);
        assert.equal(enqueued[0]!.sequence, spawnedEvent.sequence + 1);
        const view = setup.runtime.view(setup.view.id);
        const child = view.actors.find((entry) => entry.id === spawned.id);
        assert.ok(child?.kind === "agent");
        assert.equal(child.prompt, "Report findings as a list.");
        assert.equal(child.description, "checks the comment rule");
        assert.deepEqual(view.inputs.filter((entry) => entry.actorId === spawned.id).map((entry) => entry.content), ["Check the comment rule in src/app.ts and report every violation."]);

        const idle = await toolset.invokeFunction("spawn-idle", "agent_spawn", { description: "waits for a task", name: "idle", profile: "agent", tools: [] }) as { id: string };
        const idleView = setup.runtime.view(setup.view.id);
        assert.equal(idleView.inputs.some((entry) => entry.actorId === idle.id), false);
        const idleActor = idleView.actors.find((entry) => entry.id === idle.id);
        assert.ok(idleActor?.kind === "agent");
        assert.equal(idleActor.prompt, "");
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
        }) as { subscriptionId: string; sources: string[] };

        assert.equal(listed[0]?.subscriptionId, subscription.subscriptionId);
        assert.deepEqual(Object.keys(byHandle).sort(), ["sources", "subscriptionId"]);
        assert.deepEqual(byHandle.sources, ["@worker"]);
        assert.deepEqual(queried.map((entry) => entry.type), ["subscription.created"]);
    } finally {
        setup.journal.close();
    }
});

type Published = Array<{ type: string; payload: { artifact: { id: string } } }>;
type ReadArtifact = { artifact: { id: string; title: string; mediaType: string; size: number; previousVersionId: string | null; createdBy: string }; encoding: string; content: string };

test("artifact_publish returns the new ID, and artifact_read returns content and metadata including versions", async () => {
    const setup = setupRun({ grants: allGrants(), toolNames: ["artifact_publish", "artifact_read"] });

    try {
        const { toolset } = await turnToolset(setup, "publish");
        const first = await toolset.invokeFunction("publish-plan", "artifact_publish", { title: "Plan", mediaType: "text/markdown", content: "# Plan\nStep one." }) as Published;
        const id = first[0]!.payload.artifact.id;
        assert.deepEqual(first, [{ type: "artifact.published", payload: { artifact: { id } } }]);

        const second = await toolset.invokeFunction("publish-plan-2", "artifact_publish", { title: "Plan", mediaType: "text/markdown", content: "# Plan\nStep two.", previousVersionId: id }) as Published;
        const read = await toolset.invokeFunction("read-plan-2", "artifact_read", { artifactId: second[0]!.payload.artifact.id }) as ReadArtifact;
        const earlier = await toolset.invokeFunction("read-plan", "artifact_read", { artifactId: id }) as ReadArtifact;
        const raw = await toolset.invokeFunction("publish-raw", "artifact_publish", { title: "Raw", mediaType: "application/octet-stream", content: "abc" }) as Published;
        const binary = await toolset.invokeFunction("read-raw", "artifact_read", { artifactId: raw[0]!.payload.artifact.id }) as ReadArtifact;

        assert.deepEqual({ ...read.artifact, createdAt: undefined }, {
            id: second[0]!.payload.artifact.id, title: "Plan", mediaType: "text/markdown", size: 16, previousVersionId: id, createdBy: setup.agent.id, createdAt: undefined,
        });
        assert.deepEqual([read.encoding, read.content], ["utf8", "# Plan\nStep two."]);
        assert.deepEqual([earlier.content, earlier.artifact.previousVersionId], ["# Plan\nStep one.", null]);
        assert.deepEqual([binary.encoding, binary.content], ["base64", Buffer.from("abc").toString("base64")]);
        const recorded = setup.runtime.events(setup.view.id).find((event) => event.type === "tool.call.completed" && event.payload.toolCallId === "read-plan-2");
        assert.doesNotMatch(JSON.stringify(recorded?.payload), /Step two/);
    } finally {
        setup.journal.close();
    }
});

test("artifact_read is refused to another actor until the artifact is attached to one of its inputs", async () => {
    const setup = setupRun({ grants: allGrants(), toolNames: ["artifact_publish", "artifact_read", "actor_input"] });

    try {
        const { toolset } = await turnToolset(setup, "author");
        const published = await toolset.invokeFunction("publish-note", "artifact_publish", { title: "Note", mediaType: "text/plain", content: "For the reader." }) as Published;
        const artifactId = published[0]!.payload.artifact.id;
        const view = setup.runtime.spawnAgent({ actorId: setup.view.ownerId, commandId: "spawn-reader" }, setup.view.id, {
            handle: "reader", displayName: "Reader", prompt: "Read.", execution: setup.agent.execution, grants: allGrants(), toolNames: ["artifact_read"],
        });
        const reader = view.actors.find((entry) => entry.handle === "reader");
        assert.ok(reader?.kind === "agent");
        const readerTurn = await turnToolset({ ...setup, view, agent: reader }, "reader");

        await assert.rejects(readerTurn.toolset.invokeFunction("read-early", "artifact_read", { artifactId }), /may not read artifact/);
        await toolset.invokeFunction("attach-note", "actor_input", { to: "@reader", message: "See the note.", artifactIds: [artifactId] });
        const read = await readerTurn.toolset.invokeFunction("read-attached", "artifact_read", { artifactId }) as ReadArtifact;
        assert.equal(read.content, "For the reader.");
    } finally {
        setup.journal.close();
    }
});
