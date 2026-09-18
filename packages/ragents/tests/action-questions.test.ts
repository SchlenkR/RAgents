import assert from "node:assert/strict";
import test from "node:test";

import { claimTurn } from "../src/agents/turn.ts";
import { postTo, setupRun } from "./support.ts";

const runningWorker = () => {
    const setup = setupRun();
    const queued = postTo(setup.runtime, setup.view, setup.agent.id, "question-input", "Ask the operator.");
    const input = queued.inputs.find((entry) => entry.actorId === setup.agent.id && entry.lifecycle.kind === "pending");
    assert.ok(input);
    const turn = claimTurn(setup.runtime, setup.view.id, setup.agent.id, input.id, "question-turn");

    return { ...setup, turn };
};

test("an actor may ask a question without action.propose", () => {
    const setup = runningWorker();

    try {
        const view = setup.runtime.proposeAction(
            { actorId: setup.agent.id, commandId: "ask", turnId: setup.turn.turnId },
            setup.view.id,
            {
                kind: "question",
                title: "Which option?",
                question: { options: ["A", "B"], multi: false },
            },
        );

        assert.equal(view.actions[0]?.kind, "question");
        assert.deepEqual(view.actions[0]?.question, { options: ["A", "B"], multi: false });
    } finally {
        setup.journal.close();
    }
});

test("resolving a question emits no implicit actor input", () => {
    const setup = runningWorker();

    try {
        const proposed = setup.runtime.proposeAction(
            { actorId: setup.agent.id, commandId: "ask", turnId: setup.turn.turnId },
            setup.view.id,
            { kind: "question", title: "Continue?", question: { options: ["Yes", "No"] } },
        );
        const action = proposed.actions[0];
        assert.ok(action);
        const before = proposed.inputs.length;
        const resolved = setup.runtime.resolveAction(
            { actorId: setup.view.ownerId, commandId: "resolve" },
            setup.view.id,
            action.id,
            { decision: "approved", response: "Yes" },
        );

        assert.equal(resolved.inputs.length, before);
        assert.equal(setup.runtime.events(setup.view.id).at(-1)?.type, "action.resolved");
    } finally {
        setup.journal.close();
    }
});

test("a question can only be resolved once", () => {
    const setup = runningWorker();

    try {
        const proposed = setup.runtime.proposeAction(
            { actorId: setup.agent.id, commandId: "ask", turnId: setup.turn.turnId },
            setup.view.id,
            { kind: "question", title: "Continue?" },
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
