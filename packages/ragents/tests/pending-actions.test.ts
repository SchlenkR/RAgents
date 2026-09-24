import assert from "node:assert/strict";
import test from "node:test";

import { validatedEventPayloadOf } from "../src/domain/event-validation.ts";
import { claimTurn } from "../src/agents/turn.ts";
import { postTo, setupRun } from "./support.ts";

const runningWorker = () => {
    const setup = setupRun();
    const queued = postTo(setup.runtime, setup.view, setup.agent.id, "pending-input", "Ask the operator.");
    const input = queued.inputs.find((entry) => entry.actorId === setup.agent.id && entry.lifecycle.kind === "pending");
    assert.ok(input);
    const turn = claimTurn(setup.runtime, setup.view.id, setup.agent.id, input.id, "pending-turn");

    return { ...setup, turn };
};

test("an owned action carries an opaque payload and needs no action.propose", () => {
    const setup = runningWorker();

    try {
        const view = setup.runtime.proposeAction(
            { actorId: setup.agent.id, commandId: "ask", turnId: setup.turn.turnId },
            setup.view.id,
            {
                owner: "ragents.ask",
                title: "Which option?",
                payload: { question: "Which option?", options: ["A", "B"], multi: false },
            },
        );

        assert.equal(view.actions[0]?.owner, "ragents.ask");
        assert.deepEqual(view.actions[0]?.payload, { question: "Which option?", options: ["A", "B"], multi: false });
        assert.equal(view.actions[0]?.status, "pending");
    } finally {
        setup.journal.close();
    }
});

test("resolving an action keeps the opaque result and emits no implicit actor input", () => {
    const setup = runningWorker();

    try {
        const proposed = setup.runtime.proposeAction(
            { actorId: setup.agent.id, commandId: "ask", turnId: setup.turn.turnId },
            setup.view.id,
            { owner: "ragents.ask", title: "Continue?", payload: { options: ["Yes", "No"] } },
        );
        const action = proposed.actions[0];
        assert.ok(action);
        const before = proposed.inputs.length;
        const resolved = setup.runtime.resolveAction(
            { actorId: setup.view.ownerId, commandId: "resolve" },
            setup.view.id,
            action.id,
            { decision: "approved", result: { answer: "Yes" } },
        );

        assert.equal(resolved.inputs.length, before);
        assert.deepEqual(resolved.actions[0]?.result, { answer: "Yes" });
        assert.equal(setup.runtime.events(setup.view.id).at(-1)?.type, "action.resolved");
    } finally {
        setup.journal.close();
    }
});

test("an action can only be resolved once", () => {
    const setup = runningWorker();

    try {
        const proposed = setup.runtime.proposeAction(
            { actorId: setup.agent.id, commandId: "ask", turnId: setup.turn.turnId },
            setup.view.id,
            { owner: "ragents.ask", title: "Continue?" },
        );
        const action = proposed.actions[0];
        assert.ok(action);
        setup.runtime.resolveAction(
            { actorId: setup.view.ownerId, commandId: "resolve" },
            setup.view.id,
            action.id,
            { decision: "dismissed" },
        );

        assert.throws(
            () => setup.runtime.resolveAction(
                { actorId: setup.view.ownerId, commandId: "resolve-again" },
                setup.view.id,
                action.id,
                { decision: "approved" },
            ),
            /already dismissed/,
        );
    } finally {
        setup.journal.close();
    }
});

test("an action without owner still needs action.propose", () => {
    const setup = runningWorker();

    try {
        assert.throws(
            () => setup.runtime.proposeAction(
                { actorId: setup.agent.id, commandId: "propose", turnId: setup.turn.turnId },
                setup.view.id,
                { title: "Deploy?" },
            ),
            /action\.propose/,
        );
    } finally {
        setup.journal.close();
    }
});

const proposed = (payload: Record<string, unknown>) =>
    () => validatedEventPayloadOf("action.proposed", payload, "payload");

test("a journal from before the opaque action is rejected with its cause", () => {
    assert.throws(
        proposed({
            actionId: "action-1",
            kind: "question",
            title: "Which option?",
            description: null,
            parameters: {},
            input: null,
            question: { options: ["A", "B"], multi: false },
        }),
        /kind belongs to a journal written before actions became opaque/,
    );
});

test("an action payload must be a JSON object", () => {
    assert.throws(
        proposed({
            actionId: "action-1",
            owner: "ragents.ask",
            title: "Which option?",
            description: null,
            parameters: {},
            input: null,
            payload: ["A", "B"],
        }),
        /payload must be an object/,
    );
});
