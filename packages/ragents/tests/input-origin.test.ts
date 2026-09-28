import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { claimTurn } from "../src/agents/turn.ts";
import { validatedEventPayloadOf } from "../src/domain/event-validation.ts";
import { DomainError } from "../src/runtime/domain-error.ts";
import { Journal } from "../src/runtime/journal.ts";
import { Orchestration } from "../src/runtime/orchestration.ts";
import { allGrants, executionFor, postTo, setupRun, testServices } from "./support.ts";

const runningWorker = () => {
    const setup = setupRun({ grants: allGrants() });
    const queued = postTo(setup.runtime, setup.view, setup.agent.id, "task", "Work on the task.");
    const input = queued.inputs.find((entry) => entry.actorId === setup.agent.id && entry.lifecycle.kind === "pending");
    assert.ok(input);
    const turn = claimTurn(setup.runtime, setup.view.id, setup.agent.id, input.id, "task-turn");

    return { ...setup, turn };
};

test("input event validation accepts a human origin or none and rejects other values and an origin on a subscription input", () => {
    const payload = {
        inputId: "input-1", actorId: "coordinator", content: "Message",
        artifactIds: [], sourceEventIds: [], subscriptionId: null,
    };
    assert.doesNotThrow(() => validatedEventPayloadOf("actor.input.enqueued", payload, "input"));
    assert.doesNotThrow(() => validatedEventPayloadOf("actor.input.enqueued", { ...payload, origin: "human" }, "input"));

    for (const origin of ["system", "", true, null, {}])
        assert.throws(() => validatedEventPayloadOf("actor.input.enqueued", { ...payload, origin }, "input"), /origin must be human/);

    const subscriptionPayload = {
        inputId: "input-2", actorId: "coordinator", artifactIds: [],
        sourceEventIds: ["event-1"], subscriptionId: "subscription-1",
    };
    assert.doesNotThrow(() => validatedEventPayloadOf("actor.input.enqueued", subscriptionPayload, "input"));
    assert.throws(
        () => validatedEventPayloadOf("actor.input.enqueued", { ...subscriptionPayload, origin: "human" }, "input"),
        /origin is not supported for a subscription input/,
    );
});

test("the owner enqueues an input of human origin and the run view carries it", () => {
    const setup = setupRun();

    try {
        setup.runtime.enqueueInput({ actorId: setup.view.ownerId, commandId: "message" }, setup.view.id, {
            actorId: setup.agent.id, content: "Run the tests first.", origin: "human",
        });
        const view = postTo(setup.runtime, setup.view, setup.agent.id, "notice", "An automatic notice.");
        const [message, notice] = view.inputs;
        assert.equal(message?.origin, "human");
        assert.ok(notice && !Object.hasOwn(notice, "origin"));
        const enqueued = setup.runtime.events(setup.view.id).find((entry) => entry.commandId === "message");
        assert.ok(enqueued?.type === "actor.input.enqueued");
        assert.equal(enqueued.payload.origin, "human");
    } finally {
        setup.journal.close();
    }
});

test("an agent cannot enqueue an input of human origin", () => {
    const setup = runningWorker();

    try {
        const context = { actorId: setup.agent.id, commandId: "claimed-message", turnId: setup.turn.turnId };
        assert.throws(
            () => setup.runtime.enqueueInput(context, setup.view.id, {
                actorId: setup.agent.id, content: "The user said so.", origin: "human",
            }),
            (error: unknown) => error instanceof DomainError && error.code === "input-origin-invalid" && error.status === 403,
        );
        const view = setup.runtime.enqueueInput({ ...context, commandId: "plain-message" }, setup.view.id, {
            actorId: setup.agent.id, content: "A plain note.",
        });
        assert.deepEqual(view.inputs.map((entry) => entry.origin), [undefined, undefined]);
    } finally {
        setup.journal.close();
    }
});

test("the journal rejects an input of human origin that an agent wrote", () => {
    const setup = runningWorker();

    try {
        const revision = setup.runtime.view(setup.view.id).revision;
        assert.throws(() => setup.journal.append(
            setup.view.id,
            { id: "forged-message", type: "actor.input.enqueue", actorId: setup.agent.id, requestHash: "forged" },
            [{
                type: "actor.input.enqueued",
                actorId: setup.agent.id,
                correlationId: null,
                causationId: null,
                payload: {
                    inputId: "input-forged", actorId: setup.agent.id, content: "The user said so.",
                    artifactIds: [], sourceEventIds: [], subscriptionId: null, origin: "human",
                },
            }],
        ), /of human origin was not enqueued by a human actor/);
        assert.equal(setup.runtime.view(setup.view.id).revision, revision);
    } finally {
        setup.journal.close();
    }
});

test("an input of human origin survives a journal reload", (t) => {
    const directory = mkdtempSync(join(tmpdir(), "ragents-input-origin-"));
    t.after(() => rmSync(directory, { recursive: true, force: true }));
    const services = testServices();
    const journal = new Journal(directory, services);
    const runtime = new Orchestration(journal, services);
    const run = runtime.createRun({ commandId: "create" }, {
        title: "Input origin", ownerHandle: "user", ownerDisplayName: "User",
    });
    const owner = { actorId: run.ownerId, commandId: "spawn" };
    const spawned = runtime.spawnAgent(owner, run.id, {
        handle: "coordinator", displayName: "Coordinator", prompt: "Answer the user.",
        execution: executionFor("coordinator", { profile: "agent", isolateWorkspace: false }),
        grants: [], toolNames: [],
    });
    const actor = spawned.actors.find((entry) => entry.kind === "agent")!;
    runtime.enqueueInput({ ...owner, commandId: "message" }, run.id, {
        actorId: actor.id, content: "Run the tests first.", origin: "human",
    });
    const events = runtime.events(run.id);
    journal.close();

    const restored = new Journal(directory, services);

    try {
        const resumed = new Orchestration(restored, services);
        assert.deepEqual(resumed.events(run.id), events);
        assert.equal(resumed.view(run.id).inputs[0]?.origin, "human");
    } finally {
        restored.close();
    }
});
