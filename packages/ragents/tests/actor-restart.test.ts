import assert from "node:assert/strict";
import test from "node:test";

import { setupRun } from "./support.ts";

test("a stopped agent can be restarted and takes inputs again", () => {
    const setup = setupRun();
    let view = setup.runtime.stopActor(
        { actorId: setup.view.ownerId, commandId: "stop-1" },
        setup.view.id,
        setup.agent.id,
        "Vorführung beendet",
    );
    assert.equal(view.actors.flatMap((actor) => actor.kind === "agent" && actor.id === setup.agent.id ? [actor.lifecycle.kind] : [])[0], "stopped");

    view = setup.runtime.restartActor(
        { actorId: setup.view.ownerId, commandId: "restart-1" },
        setup.view.id,
        setup.agent.id,
        "Vom Bediener neu gestartet",
    );
    assert.equal(view.actors.flatMap((actor) => actor.kind === "agent" && actor.id === setup.agent.id ? [actor.lifecycle.kind] : [])[0], "idle");

    view = setup.runtime.enqueueInput(
        { actorId: setup.view.ownerId, commandId: "input-1" },
        setup.view.id,
        { actorId: setup.agent.id, content: "Weiter geht es." },
    );
    assert.ok(view.inputs.some((input) => input.actorId === setup.agent.id));
});

test("restarting an actor that is not stopped is refused", () => {
    const setup = setupRun();

    assert.throws(
        () => setup.runtime.restartActor(
            { actorId: setup.view.ownerId, commandId: "restart-2" },
            setup.view.id,
            setup.agent.id,
            "Grund",
        ),
        /is not stopped/,
    );
});

test("a second spawn with a taken handle gets the -1 suffix instead of a duplicate", () => {
    const setup = setupRun();
    const view = setup.runtime.spawnAgent(
        { actorId: setup.view.ownerId, commandId: "spawn-twin" },
        setup.view.id,
        {
            handle: "worker",
            displayName: "Worker",
            prompt: "Zweiter Versuch.",
            execution: setup.agent.execution,
            grants: [],
            toolNames: null,
        },
    );
    const twin = view.actors.flatMap((actor) => actor.kind === "agent" && actor.id !== setup.agent.id ? [actor] : [])[0];

    assert.equal(twin?.handle, "worker-1");
    assert.equal(twin?.displayName, "Worker 1");
});

test("stop, respawn and restart never produce two actors with the same handle", () => {
    const setup = setupRun();
    let view = setup.runtime.stopActor(
        { actorId: setup.view.ownerId, commandId: "stop-twin" },
        setup.view.id,
        setup.agent.id,
        "Platz machen",
    );
    view = setup.runtime.spawnAgent(
        { actorId: view.ownerId, commandId: "spawn-successor" },
        setup.view.id,
        {
            handle: "worker",
            displayName: "Worker",
            prompt: "Nachfolger.",
            execution: setup.agent.execution,
            grants: [],
            toolNames: null,
        },
    );
    const successor = view.actors.flatMap((actor) => actor.kind === "agent" && actor.id !== setup.agent.id ? [actor] : [])[0];

    assert.equal(successor?.handle, "worker-1");

    view = setup.runtime.restartActor(
        { actorId: setup.view.ownerId, commandId: "restart-first" },
        setup.view.id,
        setup.agent.id,
        "Beide sollen leben",
    );
    const activeHandles = view.actors
        .filter((actor) => actor.kind === "agent" && actor.lifecycle.kind !== "stopped")
        .map((actor) => actor.handle)
        .sort();

    assert.deepEqual(activeHandles, ["worker", "worker-1"]);
});
