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
            context: { runId: "run-test", invocationId: "turn-test", invocationKind: "input", principal: { id: "staffel", kind: "script" }, capabilities: agentTools.map(tool=>({id:tool.name,label:tool.label,description:tool.description,schema:tool.schema,resultSchema:tool.resultSchema})) },
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
    "    'actor-rot': ['actor-gelb'],",
    "    'actor-gelb': ['actor-blau'],",
    "    'actor-blau': ['actor-rot'],",
];

const ringSource = (body: readonly string[]) => mediatorSource(ringTable, [
    "  start: { to: 'actor-rot', text: 'Anfang' },",
    ...body,
]);

const plainRing = ringSource([
    "  label: 'handle',",
    "  maxEntries: 12,",
    "  onDone: async () => undefined,",
]);

const routedContents = (calls: readonly Call[]) => calls
    .filter((entry) => entry.name === "actor_input")
    .map((entry) => entry.input as { actor: string; content: string });

test("std.mediators.route subscribes to the senders of the table and delivers the start line", async () => {
    const session = mediatorSession(plainRing);

    await session.deliver(directInput("Leg los."));

    assert.deepEqual(session.calls, [
        {
            name: "event_subscribe",
            input: {
                sourceActorIds: ["actor-rot", "actor-gelb", "actor-blau"],
                eventTypes: ["model.output.completed"],
            },
        },
        { name: "actor_input", input: { actor: "actor-rot", content: "Anfang" } },
    ]);
    assert.deepEqual(session.state(), { entries: [{ from: null, text: "Anfang" }], done: false });
});

test("a ring topology falls out of a table where every sender points at the next one", async () => {
    const session = mediatorSession(plainRing);

    await session.deliver(directInput("Leg los."));
    await session.deliver(memberInput("actor-rot", "rot", "Blume"));
    await session.deliver(memberInput("actor-gelb", "gelb", "Wiese"));
    await session.deliver(memberInput("actor-blau", "blau", "Himmel"));

    assert.deepEqual(routedContents(session.calls), [
        { actor: "actor-rot", content: "Anfang" },
        { actor: "actor-gelb", content: "Anfang\nrot: Blume" },
        { actor: "actor-blau", content: "Anfang\nrot: Blume\ngelb: Wiese" },
        { actor: "actor-rot", content: "Anfang\nrot: Blume\ngelb: Wiese\nblau: Himmel" },
    ]);
});

test("a star topology falls out of a table where every sender points at all others", async () => {
    const session = mediatorSession(mediatorSource([
        "    'actor-anna': ['actor-ben', 'actor-cara'],",
        "    'actor-ben': ['actor-anna', 'actor-cara'],",
        "    'actor-cara': ['actor-anna', 'actor-ben'],",
    ], [
        "  start: { to: 'actor-anna', text: 'Stellt euch vor.' },",
        "  label: 'none',",
        "  maxEntries: 12,",
        "  onDone: async () => undefined,",
    ]));

    await session.deliver(directInput("Leg los."));
    await session.deliver(memberInput("actor-ben", "ben", "Ich bin Ben."));

    assert.deepEqual(routedContents(session.calls), [
        { actor: "actor-anna", content: "Stellt euch vor." },
        { actor: "actor-anna", content: "Stellt euch vor.\nIch bin Ben." },
        { actor: "actor-cara", content: "Stellt euch vor.\nIch bin Ben." },
    ]);
});

test("a row with null is a silent listener and never gets subscribed", async () => {
    const session = mediatorSession(mediatorSource([
        "    'actor-rot': ['actor-gelb'],",
        "    'actor-gelb': ['actor-mithoerer'],",
        "    'actor-mithoerer': null,",
    ], [
        "  start: { to: 'actor-rot', text: 'Anfang' },",
        "  label: 'handle',",
        "  maxEntries: 12,",
        "  onDone: async () => undefined,",
    ]));

    await session.deliver(directInput("Leg los."));
    await session.deliver(memberInput("actor-rot", "rot", "Blume"));
    await session.deliver(memberInput("actor-gelb", "gelb", "Wiese"));

    assert.deepEqual(session.calls[0], {
        name: "event_subscribe",
        input: { sourceActorIds: ["actor-rot", "actor-gelb"], eventTypes: ["model.output.completed"] },
    });
    assert.deepEqual(routedContents(session.calls), [
        { actor: "actor-rot", content: "Anfang" },
        { actor: "actor-gelb", content: "Anfang\nrot: Blume" },
        { actor: "actor-mithoerer", content: "Anfang\nrot: Blume\ngelb: Wiese" },
    ]);
});

test("a target function that returns an empty list accepts the entry without routing it", async () => {
    const session = mediatorSession(mediatorSource([
        "    'actor-rot': (entry) => entry.text.includes('stopp') ? [] : ['actor-gelb'],",
        "    'actor-gelb': ['actor-rot'],",
    ], [
        "  start: { to: 'actor-rot', text: 'Anfang' },",
        "  label: 'handle',",
        "  maxEntries: 12,",
        "  onEntry: (entry) => context.log('entry ' + entry.text),",
        "  onDone: async () => undefined,",
    ]));

    await session.deliver(directInput("Leg los."));
    await session.deliver(memberInput("actor-rot", "rot", "bitte stopp"));

    assert.deepEqual(routedContents(session.calls), [{ actor: "actor-rot", content: "Anfang" }]);
    assert.deepEqual(session.logs, ["entry bitte stopp"]);
    assert.deepEqual(session.state(), {
        entries: [{ from: null, text: "Anfang" }, { from: "rot", text: "bitte stopp" }],
        done: false,
    });
});

test("a target function routes by content", async () => {
    const session = mediatorSession(mediatorSource([
        "    'actor-rot': (entry) => entry.text.includes('Frage') ? ['actor-blau'] : ['actor-gelb'],",
        "    'actor-gelb': ['actor-rot'],",
        "    'actor-blau': ['actor-rot'],",
    ], [
        "  start: { to: 'actor-rot', text: 'Anfang' },",
        "  label: 'handle',",
        "  maxEntries: 12,",
        "  onDone: async () => undefined,",
    ]));

    await session.deliver(directInput("Leg los."));
    await session.deliver(memberInput("actor-rot", "rot", "eine Frage"));

    assert.deepEqual(routedContents(session.calls).at(-1), {
        actor: "actor-blau",
        content: "Anfang\nrot: eine Frage",
    });
});

test("a target function that names an unknown actor aborts with the known ids", async () => {
    const session = mediatorSession(mediatorSource([
        "    'actor-rot': () => ['actor-fremd'],",
        "    'actor-gelb': ['actor-rot'],",
    ], [
        "  start: { to: 'actor-rot', text: 'Anfang' },",
        "  label: 'handle',",
        "  maxEntries: 12,",
        "  onDone: async () => undefined,",
    ]));

    await session.deliver(directInput("Leg los."));
    await assert.rejects(
        session.deliver(memberInput("actor-rot", "rot", "Blume")),
        /Die Zielfunktion für actor-rot nennt das unbekannte Ziel actor-fremd\. Die Tabelle kennt: actor-rot, actor-gelb\./,
    );
});

test("a throwing target function aborts the turn with a named error", async () => {
    const session = mediatorSession(mediatorSource([
        "    'actor-rot': () => { throw new Error('Kein Ziel gefunden.') },",
        "    'actor-gelb': ['actor-rot'],",
    ], [
        "  start: { to: 'actor-rot', text: 'Anfang' },",
        "  label: 'handle',",
        "  maxEntries: 12,",
        "  onDone: async () => undefined,",
    ]));

    await session.deliver(directInput("Leg los."));
    await assert.rejects(
        session.deliver(memberInput("actor-rot", "rot", "Blume")),
        /Die Zielfunktion für actor-rot ist gescheitert: Kein Ziel gefunden\./,
    );
});

test("std.mediators.route takes only the last non-empty line of a multi-line answer", async () => {
    const session = mediatorSession(ringSource([
        "  label: 'none',",
        "  maxEntries: 12,",
        "  onDone: async () => undefined,",
    ]));

    await session.deliver(directInput("Leg los."));
    await session.deliver(memberInput("actor-rot", "rot", "Gerne doch!\n\n   Blume   \n\n"));

    assert.deepEqual(routedContents(session.calls).at(-1), {
        actor: "actor-gelb",
        content: "Anfang\nBlume",
    });
    assert.deepEqual(session.state(), {
        entries: [{ from: null, text: "Anfang" }, { from: "rot", text: "Blume" }],
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

    await session.deliver(directInput("Leg los."));
    await session.deliver(memberInput("actor-rot", "rot", "Blume"));
    await session.deliver(memberInput("actor-gelb", "gelb", "Wiese"));
    await session.deliver(memberInput("actor-blau", "blau", "Himmel"));
    await session.deliver(memberInput("actor-rot", "rot", "Wolke"));

    const published = session.calls.filter((entry) => entry.name === "artifact_publish");
    assert.equal(published.length, 1);
    assert.deepEqual(published[0]?.input, {
        title: "Kreis",
        mediaType: "text/markdown",
        content: "Anfang\nrot: Blume\ngelb: Wiese",
    });
    assert.deepEqual(routedContents(session.calls), [
        { actor: "actor-rot", content: "Anfang" },
        { actor: "actor-gelb", content: "Anfang\nrot: Blume" },
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

    await session.deliver(directInput("Leg los."));
    await session.deliver(memberInput("actor-rot", "rot", "Blume"));

    assert.deepEqual(session.logs, [
        "route Anfang -> actor-rot",
        "entry rot Blume",
        "route Blume -> actor-gelb",
    ]);
});

test("a throwing hook aborts the turn with the hook name", async () => {
    const session = mediatorSession(ringSource([
        "  label: 'handle',",
        "  maxEntries: 12,",
        "  onEntry: () => { throw new Error('Der Beitrag passt nicht.') },",
        "  onDone: async () => undefined,",
    ]));

    await session.deliver(directInput("Leg los."));
    await assert.rejects(
        session.deliver(memberInput("actor-rot", "rot", "Blume")),
        /Der Hook onEntry des Vermittlers ist gescheitert: Der Beitrag passt nicht\./,
    );
});

test("std.mediators.route refuses a sender outside the table and a second setup", async () => {
    const session = mediatorSession(plainRing);

    await session.deliver(directInput("Leg los."));
    await assert.rejects(
        session.deliver(memberInput("actor-fremd", "fremd", "Blume")),
        /Der Absender actor-fremd mit dem Handle fremd kommt in der Tabelle nicht als Absender vor\. Absender sind: actor-rot, actor-gelb, actor-blau\. Ein Schlüssel darf die Actor-ID, der Handle oder @handle sein\./,
    );
    await assert.rejects(session.deliver(directInput("Nochmal.")), /bereits eingerichtet/);
});

test("a table keyed by handles routes the events of the matching actors", async () => {
    const session = mediatorSession(mediatorSource([
        "    'rot': ['gelb'],",
        "    'gelb': ['rot'],",
    ], [
        "  start: { to: 'rot', text: 'Anfang' },",
        "  label: 'handle',",
        "  maxEntries: 12,",
        "  onDone: async () => undefined,",
    ]));

    await session.deliver(directInput("Leg los."));
    await session.deliver(memberInput("actor-rot", "rot", "Blume"));
    await session.deliver(memberInput("actor-gelb", "gelb", "Wiese"));

    assert.deepEqual(session.calls[0], {
        name: "event_subscribe",
        input: { sourceActorIds: ["rot", "gelb"], eventTypes: ["model.output.completed"] },
    });
    assert.deepEqual(routedContents(session.calls), [
        { actor: "rot", content: "Anfang" },
        { actor: "gelb", content: "Anfang\nrot: Blume" },
        { actor: "rot", content: "Anfang\nrot: Blume\ngelb: Wiese" },
    ]);
});

test("a table keyed by @handle matches the sender without regard to case", async () => {
    const session = mediatorSession(mediatorSource([
        "    '@Mira': ['@jon'],",
        "    '@jon': ['@Mira'],",
    ], [
        "  start: { to: '@mira', text: 'Thema' },",
        "  label: 'handle',",
        "  maxEntries: 12,",
        "  onDone: async () => undefined,",
    ]));

    await session.deliver(directInput("Leg los."));
    await session.deliver(memberInput("actor-mira", "mira", "Hallo"));

    assert.deepEqual(session.calls[0], {
        name: "event_subscribe",
        input: { sourceActorIds: ["Mira", "jon"], eventTypes: ["model.output.completed"] },
    });
    assert.deepEqual(routedContents(session.calls), [
        { actor: "Mira", content: "Thema" },
        { actor: "jon", content: "Thema\nmira: Hallo" },
    ]);
});

test("a table mixes actor ids and handles as keys", async () => {
    const session = mediatorSession(mediatorSource([
        "    'actor-rot': ['ada'],",
        "    'ada': ['actor-rot'],",
    ], [
        "  start: { to: 'actor-rot', text: 'Anfang' },",
        "  label: 'handle',",
        "  maxEntries: 12,",
        "  onDone: async () => undefined,",
    ]));

    await session.deliver(directInput("Leg los."));
    await session.deliver(memberInput("actor-rot", "rot", "Blume"));
    await session.deliver(memberInput("actor-ada", "ada", "Wiese"));

    assert.deepEqual(routedContents(session.calls), [
        { actor: "actor-rot", content: "Anfang" },
        { actor: "ada", content: "Anfang\nrot: Blume" },
        { actor: "actor-rot", content: "Anfang\nrot: Blume\nada: Wiese" },
    ]);
});

test("a target function of a handle table may name an actor id and the other way round", async () => {
    const session = mediatorSession(mediatorSource([
        "    'rot': () => 'actor-gelb',",
        "    'actor-gelb': ['@rot'],",
    ], [
        "  start: { to: 'rot', text: 'Anfang' },",
        "  label: 'handle',",
        "  maxEntries: 12,",
        "  onDone: async () => undefined,",
    ]));

    await session.deliver(directInput("Leg los."));
    await session.deliver(memberInput("actor-rot", "rot", "Blume"));
    await session.deliver(memberInput("actor-gelb", "gelb", "Wiese"));

    assert.deepEqual(routedContents(session.calls), [
        { actor: "rot", content: "Anfang" },
        { actor: "actor-gelb", content: "Anfang\nrot: Blume" },
        { actor: "rot", content: "Anfang\nrot: Blume\ngelb: Wiese" },
    ]);
});

test("an unknown sender is reported with its id, its handle and the keys of the table", async () => {
    const session = mediatorSession(mediatorSource([
        "    'rot': ['gelb'],",
        "    'gelb': ['rot'],",
    ], [
        "  start: { to: 'rot', text: 'Anfang' },",
        "  label: 'handle',",
        "  maxEntries: 12,",
        "  onDone: async () => undefined,",
    ]));

    await session.deliver(directInput("Leg los."));
    await assert.rejects(
        session.deliver(memberInput("actor-fremd", "fremd", "Blume")),
        /Der Absender actor-fremd mit dem Handle fremd kommt in der Tabelle nicht als Absender vor\. Absender sind: rot, gelb\. Ein Schlüssel darf die Actor-ID, der Handle oder @handle sein\./,
    );
});

test("native mediator configuration fails before producing effects", async () => {
    await assert.rejects(
        () => mediatorSession(mediatorSource([], [
            "  start: { to: 'actor-rot', text: 'Anfang' },",
            "  label: 'handle',",
            "  maxEntries: 12,",
            "  onDone: async () => undefined,",
        ])).deliver(directInput("Start")),
        /table muss mindestens einen Absender enthalten/,
    );
    await assert.rejects(
        () => mediatorSession(mediatorSource([
            "    'actor-rot': ['actor-gelb'],",
            "    'actor-gelb': null,",
        ], [
            "  start: { to: 'actor-blau', text: 'Anfang' },",
            "  label: 'handle',",
            "  maxEntries: 12,",
            "  onDone: async () => undefined,",
        ])).deliver(directInput("Start")),
        /start\.to actor-blau steht nicht als Schlüssel in der Tabelle\. Die Tabelle kennt: actor-rot, actor-gelb\. Ein reiner Empfänger gehört als "actor-blau": null in die Tabelle\./,
    );
    await assert.rejects(
        () => mediatorSession(mediatorSource([
            "    'actor-rot': ['actor-gelb'],",
        ], [
            "  start: { to: 'actor-rot', text: 'Anfang' },",
            "  label: 'handle',",
            "  maxEntries: 12,",
            "  onDone: async () => undefined,",
        ])).deliver(directInput("Start")),
        /das Ziel actor-gelb von actor-rot steht nicht als Schlüssel in der Tabelle\. Die Tabelle kennt: actor-rot\. Ein reiner Empfänger gehört als "actor-gelb": null in die Tabelle\./,
    );
    await assert.rejects(
        () => mediatorSession(mediatorSource([
            "    'actor-rot': [''],",
        ], [
            "  start: { to: 'actor-rot', text: 'Anfang' },",
            "  label: 'handle',",
            "  maxEntries: 12,",
            "  onDone: async () => undefined,",
        ])).deliver(directInput("Start")),
        /ein Ziel von actor-rot muss eine Actor-ID oder ein Handle als nicht leerer Text sein/,
    );
    await assert.rejects(
        () => mediatorSession(mediatorSource([
            "    'mira': ['jon'],",
            "    '@Mira': null,",
            "    'jon': ['mira'],",
        ], [
            "  start: { to: 'mira', text: 'Anfang' },",
            "  label: 'handle',",
            "  maxEntries: 12,",
            "  onDone: async () => undefined,",
        ])).deliver(directInput("Start")),
        /table nennt denselben Beteiligten doppelt/,
    );
    await assert.rejects(
        () => mediatorSession(ringSource([
            "  label: 'handle',",
            "  maxEntries: 0,",
            "  onDone: async () => undefined,",
        ])).deliver(directInput("Start")),
        /maxEntries muss eine ganze Zahl ab 1 sein/,
    );
});

test("a route table takes its keys from constants", async () => {
    const session = mediatorSession([
        "const rot = 'actor-rot'",
        "const gelb = 'actor-gelb'",
            "export const handle = (input, context) => context.std.mediators.route({",
        "  table: {",
        "    [rot]: [gelb],",
        "    [gelb]: [rot],",
        "  },",
        "  start: { to: rot, text: 'Anfang' },",
        "  label: 'handle',",
        "  maxEntries: 12,",
        "  onDone: async () => undefined,",
        "})(input, context)",
    ].join("\n"));

    await session.deliver(directInput("Leg los."));
    await session.deliver(memberInput("actor-rot", "rot", "Blume"));

    assert.deepEqual(session.calls[0], {
        name: "event_subscribe",
        input: { sourceActorIds: ["actor-rot", "actor-gelb"], eventTypes: ["model.output.completed"] },
    });
    assert.deepEqual(routedContents(session.calls), [
        { actor: "actor-rot", content: "Anfang" },
        { actor: "actor-gelb", content: "Anfang\nrot: Blume" },
    ]);
});

test("two identical runs of a mediator produce the identical state and the identical calls", async () => {
    const source = ringSource([
        "  label: 'handle',",
        "  maxEntries: 4,",
        "  onDone: async () => undefined,",
    ]);
    const inputs = [
        directInput("Leg los."),
        memberInput("actor-rot", "rot", "Blume"),
        memberInput("actor-gelb", "gelb", "Wiese"),
        memberInput("actor-blau", "blau", "Himmel"),
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

    for (const handle of ["rot", "gelb", "blau"]) {
        view = runtime.spawnAgent({ actorId: view.ownerId, commandId: `spawn-${handle}` }, view.id, {
            handle,
            displayName: handle,
            prompt: "Antworte mit einem Wort.",
            execution: executionFor(handle, { profile: "agent", isolateWorkspace: false }),
            grants: [],
            toolNames: [],
        });
    }

    const members = ["rot", "gelb", "blau"].map((handle) => {
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
        `  start: { to: ${ids[0]}, text: 'Anfang' },`,
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

    view = runtime.createScriptActor({ actorId: view.ownerId, commandId: "install-staffel" }, view.id, {
        handle: "staffel",
        displayName: "Staffel",
        grants,
        toolNames: null,
    });

    const staffel = view.actors.find((entry) => entry.handle === "staffel");

    assert.ok(staffel);
    services.actorPrograms = nativeActorPrograms(runtime, new Map([[staffel.id, scriptProgram(source)]]));

    const answers = new Map(members.map((actor, index) => [actor.id, ["Blume", "Wiese", "Himmel"][index] as string]));
    const driver = new FakeDriver(async (request) => {
        request.emit({ kind: "assistant", text: `Gerne!\n\n${answers.get(request.agentId) ?? "nichts"}` });

        return { failure: null, usage: noUsage() };
    });
    const scheduler = new TurnScheduler(runtime, journal, {
        drivers: { agent: driver, script: new ScriptDriver({ runtime }) },
        catalog,
    });

    try {
        postTo(runtime, view, staffel.id, "start-staffel", "Los.");
        scheduler.start();
        await scheduler.waitForIdle();

        const finished = runtime.view(view.id);

        assert.equal(finished.turns.every((entry) => entry.status === "completed"), true, JSON.stringify(finished.turns));

        const artifact = finished.artifacts.at(-1);

        assert.ok(artifact);
        assert.equal(
            new TextDecoder().decode(runtime.artifactContent(view.id, artifact.id, staffel.id).content),
            "Anfang\nrot: Blume\ngelb: Wiese\nblau: Himmel\nrot: Blume",
        );

        const state = finished.pluginStates.find(
            (entry) => entry.pluginId === actorStatePluginId
                && entry.scope.kind === "actor"
                && entry.scope.actorId === staffel.id,
        );

        assert.deepEqual(state?.state, {
            entries: [
                { from: null, text: "Anfang" },
                { from: "rot", text: "Blume" },
                { from: "gelb", text: "Wiese" },
                { from: "blau", text: "Himmel" },
                { from: "rot", text: "Blume" },
            ],
            done: true,
        });
        assert.equal(finished.subscriptions.filter((entry) => entry.subscriberId === staffel.id).length, 1);
    } finally {
        await scheduler.stop();
        journal.close();
    }
});
