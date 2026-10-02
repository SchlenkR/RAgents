import { nativeTestExecutor, scriptProgram } from "./native-executor.ts";
import assert from "node:assert/strict";
import test from "node:test";
import { agentTools } from "../src/agents/tools.ts";

import { TurnScheduler } from "../src/agents/scheduler.ts";
import type { JsonValue } from "../src/domain/json.ts";
import { Journal } from "../src/runtime/journal.ts";
import { Orchestration } from "../src/runtime/orchestration.ts";
import { ScriptDriver } from "../src/script/driver.ts";
import { actorStatePluginId } from "../src/domain/model.ts";
import { nativeActorPrograms } from "./actor-programs.ts";
import {
    FakeDriver,
    allGrants,
    catalog,
    executionFor,
    noUsage,
    postTo,
    testServices,
    textStep,
} from "./support.ts";

const scriptTestClock = "2026-01-01T00:00:00.000Z";

type Call = { readonly name: string; readonly input: JsonValue };

const mediatorSession = (source: string) => {
    const calls: Call[] = [];
    const logs: string[] = [];
    const signal = new AbortController().signal;
    let carried: unknown = undefined;
    const deliver = async (input: unknown) => {
        const outcome = await nativeTestExecutor.execute({
            program: scriptProgram(source), input, state: carried,
            context: { runId: "run-test", invocationId: "turn-test", invocationKind: "input", principal: { id: "relay", kind: "script" }, capabilities: agentTools.map(tool=>({id:tool.name,label:tool.label,description:tool.description,schema:tool.schema,resultSchema:tool.resultSchema})) },
            std: { now: scriptTestClock, idPrefix: "test:std" },
        }, {
            signal,
            log: (value) => logs.push(typeof value === "string" ? value : JSON.stringify(value)),
            call: async (name, input) => { calls.push({ name, input }); return []; },
        });
        carried = outcome.state;
    };

    return { deliver, calls, logs, state: () => carried };
};

const directInput = (content: string) => ({
    id: "input-direct",
    content,
    artifactIds: [],
    sourceEventIds: [],
    subscriptionId: null,
    event: null,
});

const memberInput = (actorId: string, handle: string, content: string) => ({
    id: `input-${actorId}`,
    content,
    artifactIds: [],
    sourceEventIds: [`event-${actorId}`],
    subscriptionId: "subscription-test",
    event: {
        type: "model.output.completed",
        eventId: `event-${actorId}`,
        sequence: 1,
        occurredAt: scriptTestClock,
        sourceActorId: actorId,
        sourceActorHandle: handle,
        payload: { text: content },
    },
});

const mediatorSource = (table: readonly string[], body: readonly string[]) => [
    "export const handle = (input, context) => context.std.mediators.route({",
    "  table: {",
    ...table,
    "  },",
    ...body,
    "})(input, context)",
].join("\n");

const ringTable = [
    "    'actor-red': ['actor-yellow'],",
    "    'actor-yellow': ['actor-blue'],",
    "    'actor-blue': ['actor-red'],",
];

const ringSource = (body: readonly string[]) => mediatorSource(ringTable, [
    "  start: { to: 'actor-red', text: 'Begin' },",
    ...body,
]);

const plainRing = ringSource([
    "  label: 'handle',",
    "  maxEntries: 12,",
    "  onDone: async () => undefined,",
]);

const routedContents = (calls: readonly Call[]) => calls
    .filter((entry) => entry.name === "actor_input")
    .map((entry) => entry.input as { to: string; message: string });

test("std.mediators.route subscribes to the senders of the table and delivers the start line", async () => {
    const session = mediatorSession(plainRing);

    await session.deliver(directInput("Get going."));

    assert.deepEqual(session.calls, [
        {
            name: "event_subscribe",
            input: {
                sourceActorIds: ["actor-red", "actor-yellow", "actor-blue"],
                eventTypes: ["model.output.completed"],
            },
        },
        { name: "actor_input", input: { to: "actor-red", message: "Begin" } },
    ]);
    assert.deepEqual(session.state(), { entries: [{ from: null, text: "Begin" }], done: false });
});

test("a ring topology falls out of a table where every sender points at the next one", async () => {
    const session = mediatorSession(plainRing);

    await session.deliver(directInput("Get going."));
    await session.deliver(memberInput("actor-red", "red", "Flower"));
    await session.deliver(memberInput("actor-yellow", "yellow", "Meadow"));
    await session.deliver(memberInput("actor-blue", "blue", "Sky"));

    assert.deepEqual(routedContents(session.calls), [
        { to: "actor-red", message: "Begin" },
        { to: "actor-yellow", message: "Begin\nred: Flower" },
        { to: "actor-blue", message: "Begin\nred: Flower\nyellow: Meadow" },
        { to: "actor-red", message: "Begin\nred: Flower\nyellow: Meadow\nblue: Sky" },
    ]);
});

test("a star topology falls out of a table where every sender points at all others", async () => {
    const session = mediatorSession(mediatorSource([
        "    'actor-anna': ['actor-ben', 'actor-cara'],",
        "    'actor-ben': ['actor-anna', 'actor-cara'],",
        "    'actor-cara': ['actor-anna', 'actor-ben'],",
    ], [
        "  start: { to: 'actor-anna', text: 'Introduce yourselves.' },",
        "  label: 'none',",
        "  maxEntries: 12,",
        "  onDone: async () => undefined,",
    ]));

    await session.deliver(directInput("Get going."));
    await session.deliver(memberInput("actor-ben", "ben", "I am Ben."));

    assert.deepEqual(routedContents(session.calls), [
        { to: "actor-anna", message: "Introduce yourselves." },
        { to: "actor-anna", message: "Introduce yourselves.\nI am Ben." },
        { to: "actor-cara", message: "Introduce yourselves.\nI am Ben." },
    ]);
});

test("a row with null is a silent listener and never gets subscribed", async () => {
    const session = mediatorSession(mediatorSource([
        "    'actor-red': ['actor-yellow'],",
        "    'actor-yellow': ['actor-listener'],",
        "    'actor-listener': null,",
    ], [
        "  start: { to: 'actor-red', text: 'Begin' },",
        "  label: 'handle',",
        "  maxEntries: 12,",
        "  onDone: async () => undefined,",
    ]));

    await session.deliver(directInput("Get going."));
    await session.deliver(memberInput("actor-red", "red", "Flower"));
    await session.deliver(memberInput("actor-yellow", "yellow", "Meadow"));

    assert.deepEqual(session.calls[0], {
        name: "event_subscribe",
        input: { sourceActorIds: ["actor-red", "actor-yellow"], eventTypes: ["model.output.completed"] },
    });
    assert.deepEqual(routedContents(session.calls), [
        { to: "actor-red", message: "Begin" },
        { to: "actor-yellow", message: "Begin\nred: Flower" },
        { to: "actor-listener", message: "Begin\nred: Flower\nyellow: Meadow" },
    ]);
});

test("a target function that returns an empty list accepts the entry without routing it", async () => {
    const session = mediatorSession(mediatorSource([
        "    'actor-red': (entry) => entry.text.includes('stop') ? [] : ['actor-yellow'],",
        "    'actor-yellow': ['actor-red'],",
    ], [
        "  start: { to: 'actor-red', text: 'Begin' },",
        "  label: 'handle',",
        "  maxEntries: 12,",
        "  onEntry: (entry) => context.log('entry ' + entry.text),",
        "  onDone: async () => undefined,",
    ]));

    await session.deliver(directInput("Get going."));
    await session.deliver(memberInput("actor-red", "red", "please stop"));

    assert.deepEqual(routedContents(session.calls), [{ to: "actor-red", message: "Begin" }]);
    assert.deepEqual(session.logs, ["entry please stop"]);
    assert.deepEqual(session.state(), {
        entries: [{ from: null, text: "Begin" }, { from: "red", text: "please stop" }],
        done: false,
    });
});

test("a target function routes by content", async () => {
    const session = mediatorSession(mediatorSource([
        "    'actor-red': (entry) => entry.text.includes('question') ? ['actor-blue'] : ['actor-yellow'],",
        "    'actor-yellow': ['actor-red'],",
        "    'actor-blue': ['actor-red'],",
    ], [
        "  start: { to: 'actor-red', text: 'Begin' },",
        "  label: 'handle',",
        "  maxEntries: 12,",
        "  onDone: async () => undefined,",
    ]));

    await session.deliver(directInput("Get going."));
    await session.deliver(memberInput("actor-red", "red", "a question"));

    assert.deepEqual(routedContents(session.calls).at(-1), {
        to: "actor-blue",
        message: "Begin\nred: a question",
    });
});

test("a target function that names an unknown actor aborts with the known ids", async () => {
    const session = mediatorSession(mediatorSource([
        "    'actor-red': () => ['actor-stranger'],",
        "    'actor-yellow': ['actor-red'],",
    ], [
        "  start: { to: 'actor-red', text: 'Begin' },",
        "  label: 'handle',",
        "  maxEntries: 12,",
        "  onDone: async () => undefined,",
    ]));

    await session.deliver(directInput("Get going."));
    await assert.rejects(
        session.deliver(memberInput("actor-red", "red", "Flower")),
        /The target function for actor-red names the unknown target actor-stranger\. The table knows: actor-red, actor-yellow\./,
    );
});

test("a throwing target function aborts the turn with a named error", async () => {
    const session = mediatorSession(mediatorSource([
        "    'actor-red': () => { throw new Error('No target found.') },",
        "    'actor-yellow': ['actor-red'],",
    ], [
        "  start: { to: 'actor-red', text: 'Begin' },",
        "  label: 'handle',",
        "  maxEntries: 12,",
        "  onDone: async () => undefined,",
    ]));

    await session.deliver(directInput("Get going."));
    await assert.rejects(
        session.deliver(memberInput("actor-red", "red", "Flower")),
        /The target function for actor-red failed: No target found\./,
    );
});

test("std.mediators.route takes only the last non-empty line of a multi-line answer", async () => {
    const session = mediatorSession(ringSource([
        "  label: 'none',",
        "  maxEntries: 12,",
        "  onDone: async () => undefined,",
    ]));

    await session.deliver(directInput("Get going."));
    await session.deliver(memberInput("actor-red", "red", "Sure thing!\n\n   Flower   \n\n"));

    assert.deepEqual(routedContents(session.calls).at(-1), {
        to: "actor-yellow",
        message: "Begin\nFlower",
    });
    assert.deepEqual(session.state(), {
        entries: [{ from: null, text: "Begin" }, { from: "red", text: "Flower" }],
        done: false,
    });
});

test("std.mediators.route stops at maxEntries and runs onDone exactly once", async () => {
    const session = mediatorSession(ringSource([
        "  label: 'handle',",
        "  maxEntries: 3,",
        "  onDone: async (entries) => {",
        "    await context.functions.artifact_publish({",
        "      title: 'Kreis',",
        "      mediaType: 'text/markdown',",
        "      content: entries.map((entry) => entry.from === null ? entry.text : entry.from + ': ' + entry.text).join('\\n'),",
        "    })",
        "  },",
    ]));

    await session.deliver(directInput("Get going."));
    await session.deliver(memberInput("actor-red", "red", "Flower"));
    await session.deliver(memberInput("actor-yellow", "yellow", "Meadow"));
    await session.deliver(memberInput("actor-blue", "blue", "Sky"));
    await session.deliver(memberInput("actor-red", "red", "Cloud"));

    const published = session.calls.filter((entry) => entry.name === "artifact_publish");
    assert.equal(published.length, 1);
    assert.deepEqual(published[0]?.input, {
        title: "Kreis",
        mediaType: "text/markdown",
        content: "Begin\nred: Flower\nyellow: Meadow",
    });
    assert.deepEqual(routedContents(session.calls), [
        { to: "actor-red", message: "Begin" },
        { to: "actor-yellow", message: "Begin\nred: Flower" },
    ]);
    assert.equal((session.state() as { done: boolean }).done, true);
});

test("std.mediators.route calls onEntry and onRoute with the accepted entry and the target", async () => {
    const session = mediatorSession(ringSource([
        "  label: 'handle',",
        "  maxEntries: 12,",
        "  onEntry: (entry) => context.log('entry ' + entry.from + ' ' + entry.text),",
        "  onRoute: (entry, targetActorId) => context.log('route ' + entry.text + ' -> ' + targetActorId),",
        "  onDone: async () => undefined,",
    ]));

    await session.deliver(directInput("Get going."));
    await session.deliver(memberInput("actor-red", "red", "Flower"));

    assert.deepEqual(session.logs, [
        "route Begin -> actor-red",
        "entry red Flower",
        "route Flower -> actor-yellow",
    ]);
});

test("a throwing hook aborts the turn with the hook name", async () => {
    const session = mediatorSession(ringSource([
        "  label: 'handle',",
        "  maxEntries: 12,",
        "  onEntry: () => { throw new Error('The entry does not fit.') },",
        "  onDone: async () => undefined,",
    ]));

    await session.deliver(directInput("Get going."));
    await assert.rejects(
        session.deliver(memberInput("actor-red", "red", "Flower")),
        /The hook onEntry of the mediator failed: The entry does not fit\./,
    );
});

test("std.mediators.route refuses a sender outside the table and a second setup", async () => {
    const session = mediatorSession(plainRing);

    await session.deliver(directInput("Get going."));
    await assert.rejects(
        session.deliver(memberInput("actor-stranger", "stranger", "Flower")),
        /The sender actor-stranger with the handle stranger does not appear in the table as a sender\. Senders are: actor-red, actor-yellow, actor-blue\. A key may be the actor ID, the handle or @handle\./,
    );
    await assert.rejects(session.deliver(directInput("Once more.")), /already set up/);
});

test("a table keyed by handles routes the events of the matching actors", async () => {
    const session = mediatorSession(mediatorSource([
        "    'red': ['yellow'],",
        "    'yellow': ['red'],",
    ], [
        "  start: { to: 'red', text: 'Begin' },",
        "  label: 'handle',",
        "  maxEntries: 12,",
        "  onDone: async () => undefined,",
    ]));

    await session.deliver(directInput("Get going."));
    await session.deliver(memberInput("actor-red", "red", "Flower"));
    await session.deliver(memberInput("actor-yellow", "yellow", "Meadow"));

    assert.deepEqual(session.calls[0], {
        name: "event_subscribe",
        input: { sourceActorIds: ["red", "yellow"], eventTypes: ["model.output.completed"] },
    });
    assert.deepEqual(routedContents(session.calls), [
        { to: "red", message: "Begin" },
        { to: "yellow", message: "Begin\nred: Flower" },
        { to: "red", message: "Begin\nred: Flower\nyellow: Meadow" },
    ]);
});

test("a table keyed by @handle matches the sender without regard to case", async () => {
    const session = mediatorSession(mediatorSource([
        "    '@Mira': ['@jon'],",
        "    '@jon': ['@Mira'],",
    ], [
        "  start: { to: '@mira', text: 'Topic' },",
        "  label: 'handle',",
        "  maxEntries: 12,",
        "  onDone: async () => undefined,",
    ]));

    await session.deliver(directInput("Get going."));
    await session.deliver(memberInput("actor-mira", "mira", "Hello"));

    assert.deepEqual(session.calls[0], {
        name: "event_subscribe",
        input: { sourceActorIds: ["Mira", "jon"], eventTypes: ["model.output.completed"] },
    });
    assert.deepEqual(routedContents(session.calls), [
        { to: "Mira", message: "Topic" },
        { to: "jon", message: "Topic\nmira: Hello" },
    ]);
});

test("a table mixes actor ids and handles as keys", async () => {
    const session = mediatorSession(mediatorSource([
        "    'actor-red': ['ada'],",
        "    'ada': ['actor-red'],",
    ], [
        "  start: { to: 'actor-red', text: 'Begin' },",
        "  label: 'handle',",
        "  maxEntries: 12,",
        "  onDone: async () => undefined,",
    ]));

    await session.deliver(directInput("Get going."));
    await session.deliver(memberInput("actor-red", "red", "Flower"));
    await session.deliver(memberInput("actor-ada", "ada", "Meadow"));

    assert.deepEqual(routedContents(session.calls), [
        { to: "actor-red", message: "Begin" },
        { to: "ada", message: "Begin\nred: Flower" },
        { to: "actor-red", message: "Begin\nred: Flower\nada: Meadow" },
    ]);
});

test("a target function of a handle table may name an actor id and the other way round", async () => {
    const session = mediatorSession(mediatorSource([
        "    'red': () => 'actor-yellow',",
        "    'actor-yellow': ['@red'],",
    ], [
        "  start: { to: 'red', text: 'Begin' },",
        "  label: 'handle',",
        "  maxEntries: 12,",
        "  onDone: async () => undefined,",
    ]));

    await session.deliver(directInput("Get going."));
    await session.deliver(memberInput("actor-red", "red", "Flower"));
    await session.deliver(memberInput("actor-yellow", "yellow", "Meadow"));

    assert.deepEqual(routedContents(session.calls), [
        { to: "red", message: "Begin" },
        { to: "actor-yellow", message: "Begin\nred: Flower" },
        { to: "red", message: "Begin\nred: Flower\nyellow: Meadow" },
    ]);
});

test("an unknown sender is reported with its id, its handle and the keys of the table", async () => {
    const session = mediatorSession(mediatorSource([
        "    'red': ['yellow'],",
        "    'yellow': ['red'],",
    ], [
        "  start: { to: 'red', text: 'Begin' },",
        "  label: 'handle',",
        "  maxEntries: 12,",
        "  onDone: async () => undefined,",
    ]));

    await session.deliver(directInput("Get going."));
    await assert.rejects(
        session.deliver(memberInput("actor-stranger", "stranger", "Flower")),
        /The sender actor-stranger with the handle stranger does not appear in the table as a sender\. Senders are: red, yellow\. A key may be the actor ID, the handle or @handle\./,
    );
});

test("native mediator configuration fails before producing effects", async () => {
    await assert.rejects(
        () => mediatorSession(mediatorSource([], [
            "  start: { to: 'actor-red', text: 'Begin' },",
            "  label: 'handle',",
            "  maxEntries: 12,",
            "  onDone: async () => undefined,",
        ])).deliver(directInput("Start")),
        /table must contain at least one sender/,
    );
    await assert.rejects(
        () => mediatorSession(mediatorSource([
            "    'actor-red': ['actor-yellow'],",
            "    'actor-yellow': null,",
        ], [
            "  start: { to: 'actor-blue', text: 'Begin' },",
            "  label: 'handle',",
            "  maxEntries: 12,",
            "  onDone: async () => undefined,",
        ])).deliver(directInput("Start")),
        /start\.to actor-blue is not a key in the table\. The table knows: actor-red, actor-yellow\. A pure recipient belongs in the table as "actor-blue": null\./,
    );
    await assert.rejects(
        () => mediatorSession(mediatorSource([
            "    'actor-red': ['actor-yellow'],",
        ], [
            "  start: { to: 'actor-red', text: 'Begin' },",
            "  label: 'handle',",
            "  maxEntries: 12,",
            "  onDone: async () => undefined,",
        ])).deliver(directInput("Start")),
        /the target actor-yellow of actor-red is not a key in the table\. The table knows: actor-red\. A pure recipient belongs in the table as "actor-yellow": null\./,
    );
    await assert.rejects(
        () => mediatorSession(mediatorSource([
            "    'actor-red': [''],",
        ], [
            "  start: { to: 'actor-red', text: 'Begin' },",
            "  label: 'handle',",
            "  maxEntries: 12,",
            "  onDone: async () => undefined,",
        ])).deliver(directInput("Start")),
        /a target of actor-red must be an actor ID or a handle as non-empty text/,
    );
    await assert.rejects(
        () => mediatorSession(mediatorSource([
            "    'mira': ['jon'],",
            "    '@Mira': null,",
            "    'jon': ['mira'],",
        ], [
            "  start: { to: 'mira', text: 'Begin' },",
            "  label: 'handle',",
            "  maxEntries: 12,",
            "  onDone: async () => undefined,",
        ])).deliver(directInput("Start")),
        /table names the same participant twice/,
    );
    await assert.rejects(
        () => mediatorSession(ringSource([
            "  label: 'handle',",
            "  maxEntries: 0,",
            "  onDone: async () => undefined,",
        ])).deliver(directInput("Start")),
        /maxEntries must be an integer of at least 1/,
    );
});

test("a route table takes its keys from constants", async () => {
    const session = mediatorSession([
        "const red = 'actor-red'",
        "const yellow = 'actor-yellow'",
            "export const handle = (input, context) => context.std.mediators.route({",
        "  table: {",
        "    [red]: [yellow],",
        "    [yellow]: [red],",
        "  },",
        "  start: { to: red, text: 'Begin' },",
        "  label: 'handle',",
        "  maxEntries: 12,",
        "  onDone: async () => undefined,",
        "})(input, context)",
    ].join("\n"));

    await session.deliver(directInput("Get going."));
    await session.deliver(memberInput("actor-red", "red", "Flower"));

    assert.deepEqual(session.calls[0], {
        name: "event_subscribe",
        input: { sourceActorIds: ["actor-red", "actor-yellow"], eventTypes: ["model.output.completed"] },
    });
    assert.deepEqual(routedContents(session.calls), [
        { to: "actor-red", message: "Begin" },
        { to: "actor-yellow", message: "Begin\nred: Flower" },
    ]);
});

test("two identical runs of a mediator produce the identical state and the identical calls", async () => {
    const source = ringSource([
        "  label: 'handle',",
        "  maxEntries: 4,",
        "  onDone: async () => undefined,",
    ]);
    const inputs = [
        directInput("Get going."),
        memberInput("actor-red", "red", "Flower"),
        memberInput("actor-yellow", "yellow", "Meadow"),
        memberInput("actor-blue", "blue", "Sky"),
    ];
    const played = async () => {
        const session = mediatorSession(source);

        for (const input of inputs) await session.deliver(input);

        return { state: session.state(), calls: session.calls };
    };

    assert.deepEqual(await played(), await played());
});

test("an installed mediator carries a real circle of agents to its artifact", async () => {
    const services = testServices();
    const journal = new Journal(":memory:", services);
    const runtime = new Orchestration(journal, services);
    let view = runtime.createRun(
        { commandId: "create" },
        { title: "Kreis", ownerHandle: "owner", ownerDisplayName: "Owner" },
    );

    for (const handle of ["red", "yellow", "blue"]) {
        view = runtime.spawnAgent({ actorId: view.ownerId, commandId: `spawn-${handle}` }, view.id, {
            handle,
            displayName: handle,
            prompt: "Answer with one word.",
            execution: executionFor(handle, { profile: "agent", isolateWorkspace: false }),
            grants: [],
            toolNames: [],
        });
    }

    const members = ["red", "yellow", "blue"].map((handle) => {
        const actor = view.actors.find((entry) => entry.handle === handle);

        assert.ok(actor);

        return actor;
    });
    const capabilityIds = ["actor_input", "artifact_publish", "event_subscribe"];
    const grants = allGrants();
    const ids = members.map((actor) => JSON.stringify(actor.id));
    const source = [
            "export const handle = (input, context) => context.std.mediators.route({",
        "  table: {",
        `    ${ids[0]}: [${ids[1]}],`,
        `    ${ids[1]}: [${ids[2]}],`,
        `    ${ids[2]}: [${ids[0]}],`,
        "  },",
        `  start: { to: ${ids[0]}, text: 'Begin' },`,
        "  label: 'handle',",
        "  maxEntries: 5,",
        "  onDone: async (entries) => {",
        "    await context.functions.artifact_publish({",
        "      title: 'Kreis',",
        "      mediaType: 'text/markdown',",
        "      content: entries.map((entry) => entry.from === null ? entry.text : entry.from + ': ' + entry.text).join('\\n'),",
        "    })",
        "  },",
        "})(input, context)",
    ].join("\n");

    view = runtime.createScriptActor({ actorId: view.ownerId, commandId: "install-relay" }, view.id, {
        handle: "relay",
        displayName: "Relay",
        grants,
        toolNames: null,
    });

    const relay = view.actors.find((entry) => entry.handle === "relay");

    assert.ok(relay);
    services.actorPrograms = nativeActorPrograms(runtime, new Map([[relay.id, scriptProgram(source)]]));

    const answers = new Map(members.map((actor, index) => [actor.id, ["Flower", "Meadow", "Sky"][index] as string]));
    const driver = new FakeDriver(async (request) => {
        request.recordContext({ kind: "step", step: textStep(`Sure!\n\n${answers.get(request.agentId) ?? "nothing"}`) });

        return { failure: null, usage: noUsage() };
    });
    const scheduler = new TurnScheduler(runtime, journal, {
        drivers: { agent: driver, script: new ScriptDriver({ runtime }) },
        catalog,
    });

    try {
        postTo(runtime, view, relay.id, "start-relay", "Go.");
        scheduler.start();
        await scheduler.waitForIdle();

        const finished = runtime.view(view.id);

        assert.equal(finished.turns.every((entry) => entry.status === "completed"), true, JSON.stringify(finished.turns));

        const artifact = finished.artifacts.at(-1);

        assert.ok(artifact);
        assert.equal(
            new TextDecoder().decode(runtime.artifactContent(view.id, artifact.id, relay.id).content),
            "Begin\nred: Flower\nyellow: Meadow\nblue: Sky\nred: Flower",
        );

        const state = finished.pluginStates.find(
            (entry) => entry.pluginId === actorStatePluginId
                && entry.scope.kind === "actor"
                && entry.scope.actorId === relay.id,
        );

        assert.deepEqual(state?.state, {
            entries: [
                { from: null, text: "Begin" },
                { from: "red", text: "Flower" },
                { from: "yellow", text: "Meadow" },
                { from: "blue", text: "Sky" },
                { from: "red", text: "Flower" },
            ],
            done: true,
        });
        assert.equal(finished.subscriptions.filter((entry) => entry.subscriberId === relay.id).length, 1);
    } finally {
        await scheduler.stop();
        journal.close();
    }
});
