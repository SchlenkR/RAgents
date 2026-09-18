import assert from "node:assert/strict";
import test from "node:test";
import { Type } from "typebox";

import { ToolRegistry } from "../src/agents/plugins.ts";
import { TurnToolset } from "../src/agents/toolset.ts";
import { claimTurn } from "../src/agents/turn.ts";
import { defineRunFunction } from "../src/agents/tools.ts";
import { uncommittedEventOf } from "../src/domain/event-validation.ts";
import { assertJsonValue } from "../src/domain/json.ts";
import type { JsonValue } from "../src/domain/json.ts";
import { isPortableId, isRunId } from "../src/domain/portable-id.ts";
import { OperationContributionRegistry } from "../src/plugin-host.ts";
import type { OperationContribution } from "../src/plugin-types.ts";
import { journalCommand } from "../src/runtime/command.ts";
import { allGrants, catalog, postTo, setupRun } from "./support.ts";

const invalidValues = (): Array<[string, unknown]> => {
    const sparse = new Array<unknown>(1);
    const named: unknown[] = [];
    Object.assign(named, { extra: true });

    return [
        ["undefined", undefined],
        ["bigint", 1n],
        ["negative-zero", -0],
        ["non-plain", new Date("2026-08-27T00:00:00.000Z")],
        ["sparse", sparse],
        ["named", named],
    ];
};

const compileTimeJsonContracts = () => {
    defineRunFunction({
        name: "undefined_result",
        label: "Undefined result",
        description: "Compile-time contract only.",
        schema: Type.Object({}, { additionalProperties: false }),
        resultSchema: Type.Undefined(),
        available: () => true,
        // @ts-expect-error Tool results must be JSON values.
        run: () => undefined,
    });
    const operation: OperationContribution = {
        id: "example.undefined",
        label: "Undefined result",
        description: "Compile-time contract only.",
        schema: Type.Object({}, { additionalProperties: false }),
        resultSchema: Type.Undefined(),
        operator: "direct",
        // @ts-expect-error Operation results must be JSON values.
        execute: () => undefined,
    };

    return operation;
};

void compileTimeJsonContracts;

const toolsetFor = async (registry: ToolRegistry) => {
    const setup = setupRun();
    const view = postTo(setup.runtime, setup.view, setup.agent.id, "input-json-boundary", "Check JSON.");
    const input = view.inputs.find((entry) => entry.actorId === setup.agent.id && entry.lifecycle.kind === "pending");
    assert.ok(input);
    const turn = claimTurn(setup.runtime, view.id, setup.agent.id, input.id, "turn-json-boundary");
    const toolset = await TurnToolset.create({ runtime: setup.runtime, turn, catalog, registry });

    return { setup, toolset };
};

test("JSON values reject unstable JavaScript representations", () => {
    invalidValues().forEach(([name, value]) => {
        assert.throws(() => assertJsonValue(value, name));
    });

    const shared = { value: 1 };
    assert.doesNotThrow(() => assertJsonValue({ left: shared, right: shared }));
    assert.doesNotThrow(() => assertJsonValue({ present: 1, absent: undefined }), "undefined properties are absent, as in JSON serialisation");
    assert.throws(() => assertJsonValue([undefined]));
    assert.doesNotThrow(() => assertJsonValue(Object.assign(Object.create(null), { value: [null, true, 1] })));
});

test("journal command hashes use a total order for distinct Unicode keys", () => {
    const nfc = "\u00e9";
    const nfd = "e\u0301";
    const left = Object.fromEntries([[nfc, 1], [nfd, 2]]);
    const right = Object.fromEntries([[nfd, 2], [nfc, 1]]);

    assert.notEqual(nfc, nfd);
    assert.equal(
        journalCommand("left", "example", "agent-1", left).requestHash,
        journalCommand("right", "example", "agent-1", right).requestHash,
    );
});

test("portable IDs have one cross-platform grammar", () => {
    for (const value of ["a", "run-1", "agent_1", "r".repeat(64)]) {
        assert.equal(isPortableId(value), true);
        assert.equal(isRunId(value), true);
    }

    for (const value of ["", "Run", "-run", "run-", ".run", "run.", "con", "nul", "com1", "a".repeat(65)]) {
        assert.equal(isPortableId(value), false);
        assert.equal(isRunId(value), false);
    }
});

test("subscription inputs require one source reference and reject copied content", () => {
    const input = {
        type: "actor.input.enqueued",
        payload: {
            inputId: "input-1",
            actorId: "agent-1",
            artifactIds: [],
            sourceEventIds: ["event-1"],
            subscriptionId: "subscription-1",
        },
        actorId: "agent-1",
        correlationId: null,
        causationId: null,
    };
    assert.deepEqual(uncommittedEventOf(input, "subscription input"), input);
    for (const sourceEventIds of [[], ["event-1", "event-2"]])
        assert.throws(() => uncommittedEventOf({ ...input, payload: { ...input.payload, sourceEventIds } }, "subscription input"), /exactly one source event/);
    assert.throws(() => uncommittedEventOf({ ...input, payload: { ...input.payload, content: "duplicate" } }, "subscription input"), /content/);
});

test("complete event envelopes reject unstable JSON representations", () => {
    const actorInputEvent = () => ({
        type: "actor.input.enqueued",
        payload: {
            inputId: "input-1",
            actorId: "agent-1",
            content: "Hello",
            artifactIds: [] as unknown[],
            sourceEventIds: [] as unknown[],
            subscriptionId: null,
        },
        actorId: "agent-1",
        correlationId: null,
        causationId: null,
    });
    const sparseArtifacts = actorInputEvent();
    sparseArtifacts.payload.artifactIds = new Array(1);
    assert.throws(() => uncommittedEventOf(sparseArtifacts, "sparse artifact event"), /holes/);

    const namedArtifacts = actorInputEvent();
    Object.assign(namedArtifacts.payload.artifactIds, { extra: true });
    assert.throws(() => uncommittedEventOf(namedArtifacts, "named artifact event"), /named properties/);

    const sparseEventTypes = {
        type: "subscription.created",
        payload: {
            subscriptionId: "subscription-1",
            subscriberId: "agent-1",
            sourceActorIds: null,
            sourceActorKinds: null,
            eventTypes: new Array(1),
            includeSelf: false,
        },
        actorId: "agent-1",
        correlationId: null,
        causationId: null,
    };
    assert.throws(() => uncommittedEventOf(sparseEventTypes, "sparse subscription event"), /holes/);

    const accessorEvent = actorInputEvent();
    Object.defineProperty(accessorEvent.payload, "content", {
        enumerable: true,
        get: () => "hidden",
    });
    assert.throws(() => uncommittedEventOf(accessorEvent, "accessor event"), /enumerable JSON value/);

    const symbolEvent = actorInputEvent();
    Object.assign(symbolEvent, { [Symbol("hidden")]: true });
    assert.throws(() => uncommittedEventOf(symbolEvent, "symbol event"), /symbol properties/);

    const negativeZeroEvent = {
        type: "turn.finished",
        payload: {
            turnId: "turn-1",
            outcome: "completed",
            usage: {
                inputTokens: 0,
                outputTokens: 0,
                cacheReadTokens: 0,
                cacheWriteTokens: 0,
                costUsd: -0,
            },
        },
        actorId: "agent-1",
        correlationId: null,
        causationId: null,
    };
    assert.throws(() => uncommittedEventOf(negativeZeroEvent, "negative zero event"), /finite JSON number/);
});

test("Type.Unknown tool input is a JSON value before tool execution", async () => {
    let executions = 0;
    const unknownTool = defineRunFunction({
        name: "unknown_input",
        label: "Unknown input",
        description: "Accept an unknown input schema.",
        schema: Type.Unknown(),
        resultSchema: Type.Unknown(),
        available: () => true,
        run: () => ({ executions: ++executions }),
    });
    const registry = new ToolRegistry().register({
        name: "unknown-input",
        descriptors: [],
        dynamic: true,
        tools: () => [unknownTool],
    });
    const { setup, toolset } = await toolsetFor(registry);

    try {
        for (const [name, value] of invalidValues()) {
            await assert.rejects(
                toolset.invokeFunction(`input-${name}`, unknownTool.name, value as JsonValue),
                /Tool unknown_input input/,
            );
        }

        assert.equal(executions, 0);
        assert.equal(setup.runtime.events(setup.view.id).some((event) => event.type === "tool.call.started"), false);
    } finally {
        setup.journal.close();
    }
});

test("Type.Unknown tool output fails at the tool boundary", async () => {
    const outputs = invalidValues();
    let execution = 0;
    const unknownTool = defineRunFunction({
        name: "unknown_output",
        label: "Unknown output",
        description: "Return an unknown output schema.",
        schema: Type.Object({}, { additionalProperties: false }),
        resultSchema: Type.Unknown(),
        available: () => true,
        run: () => outputs[execution++]![1] as JsonValue,
    });
    const registry = new ToolRegistry().register({
        name: "unknown-output",
        descriptors: [],
        dynamic: true,
        tools: () => [unknownTool],
    });
    const { setup, toolset } = await toolsetFor(registry);

    try {
        for (const [name] of outputs) {
            await assert.rejects(
                toolset.invokeFunction(`output-${name}`, unknownTool.name, {}),
                /Tool unknown_output output/,
            );
        }

        const events = setup.runtime.events(setup.view.id);
        assert.equal(execution, outputs.length);
        assert.equal(events.filter((event) => event.type === "tool.call.started").length, outputs.length);
        assert.equal(events.filter((event) => event.type === "tool.call.failed").length, outputs.length);
        assert.equal(events.some((event) => event.type === "tool.call.completed"), false);
    } finally {
        setup.journal.close();
    }
});

test("Type.Unknown plugin operation values use the JSON boundary", async () => {
    for (const [name, value] of invalidValues()) {
        let executions = 0;
        const operations = new OperationContributionRegistry();
        operations.register("plugin", [{
            id: `example.input-${name}`,
            label: "Unknown input",
            description: "Accept an unknown input schema.",
            schema: Type.Unknown(),
            resultSchema: Type.Null(),
            operator: "direct",
            execute: () => {
                executions++;
                return null;
            },
        }]);
        const context = {
            runId: "run-1",
            invocationId: `input-${name}`,
            principal: { kind: "agent", actorId: "agent-1", turnId: "turn-1" } as const,
            signal: new AbortController().signal,
        };

        await assert.rejects(operations.invoke(`example.input-${name}`, context, value), /Operation .* input/);
        assert.equal(executions, 0);
    }

    for (const [name, value] of invalidValues()) {
        const operations = new OperationContributionRegistry();
        operations.register("plugin", [{
            id: `example.output-${name}`,
            label: "Unknown output",
            description: "Return an unknown output schema.",
            schema: Type.Object({}, { additionalProperties: false }),
            resultSchema: Type.Unknown(),
            operator: "direct",
            execute: () => value as JsonValue,
        }]);
        const context = {
            runId: "run-1",
            invocationId: `output-${name}`,
            principal: { kind: "agent", actorId: "agent-1", turnId: "turn-1" } as const,
            signal: new AbortController().signal,
        };

        await assert.rejects(operations.invoke(`example.output-${name}`, context, {}), /Operation .* output/);
    }
});

test("plugin state rejects non-JSON values before creating a command", () => {
    const setup = setupRun({ grants: allGrants() });
    const before = setup.runtime.events(setup.view.id).length;

    try {
        invalidValues().forEach(([name, state]) => {
            assert.throws(() => setup.runtime.replacePluginState(
                { actorId: setup.view.ownerId, commandId: `plugin-state-${name}` },
                setup.view.id,
                { pluginId: "example", scope: { kind: "run" }, state: state as JsonValue },
            ), /plugin state/);
        });

        assert.equal(setup.runtime.events(setup.view.id).length, before);
        assert.equal(setup.runtime.view(setup.view.id).pluginStates.length, 0);
    } finally {
        setup.journal.close();
    }
});
