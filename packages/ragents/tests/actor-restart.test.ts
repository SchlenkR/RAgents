import assert from "node:assert/strict";
import test from "node:test";

import { TurnToolset } from "../src/agents/toolset.ts";
import { claimTurn } from "../src/agents/turn.ts";
import type { CapabilityGrant, RunView } from "../src/domain/model.ts";
import { addressedActorOf } from "../src/runtime/guards.ts";
import { Journal } from "../src/runtime/journal.ts";
import { Orchestration } from "../src/runtime/orchestration.ts";
import { catalog, manualExecution, setupRun, testServices } from "./support.ts";

test("a stopped agent can be restarted and takes inputs again", () => {
    const setup = setupRun();
    let view = setup.runtime.stopActor(
        { actorId: setup.view.ownerId, commandId: "stop-1" },
        setup.view.id,
        setup.agent.id,
        "Demo finished",
    );
    assert.equal(view.actors.flatMap((actor) => actor.kind === "agent" && actor.id === setup.agent.id ? [actor.lifecycle.kind] : [])[0], "stopped");

    view = setup.runtime.restartActor(
        { actorId: setup.view.ownerId, commandId: "restart-1" },
        setup.view.id,
        setup.agent.id,
        "Restarted by the operator",
    );
    assert.equal(view.actors.flatMap((actor) => actor.kind === "agent" && actor.id === setup.agent.id ? [actor.lifecycle.kind] : [])[0], "idle");

    view = setup.runtime.enqueueInput(
        { actorId: setup.view.ownerId, commandId: "input-1" },
        setup.view.id,
        { actorId: setup.agent.id, content: "Moving on." },
    );
    assert.ok(view.inputs.some((input) => input.actorId === setup.agent.id));
});

test("a stopped primary actor is remembered and becomes primary again when the owner restarts it", () => {
    const setup = setupRun();
    const owner = setup.view.ownerId;
    setup.runtime.selectPrimaryActor({ actorId: owner, commandId: "select" }, setup.view.id, setup.agent.id);
    let view = setup.runtime.stopActor({ actorId: owner, commandId: "stop-primary" }, setup.view.id, setup.agent.id, "Stopped by accident");
    assert.equal(view.primaryActorId, null);
    assert.equal(view.stoppedPrimaryActorId, setup.agent.id);

    view = setup.runtime.restartActor({ actorId: owner, commandId: "restart-primary" }, setup.view.id, setup.agent.id, "Restarted by the operator");
    assert.equal(view.primaryActorId, setup.agent.id);
    assert.equal(view.stoppedPrimaryActorId, null);
    assert.deepEqual(setup.runtime.events(setup.view.id).filter((event) => event.commandId === "restart-primary").map((event) => event.type),
        ["actor.restarted", "run.primary-actor-selected"]);
});

test("a stopped primary actor stays a plain actor on restart once another primary was chosen", () => {
    const setup = setupRun();
    const owner = setup.view.ownerId;
    setup.runtime.selectPrimaryActor({ actorId: owner, commandId: "select" }, setup.view.id, setup.agent.id);
    setup.runtime.stopActor({ actorId: owner, commandId: "stop-primary" }, setup.view.id, setup.agent.id, "Replaced");
    const successor = setup.runtime.spawnAgent({ actorId: owner, commandId: "spawn-successor" }, setup.view.id, {
        handle: "successor", displayName: "Successor", prompt: "", execution: setup.agent.execution, grants: [], toolNames: null,
    }).actors.find((actor) => actor.handle === "successor")!;
    setup.runtime.selectPrimaryActor({ actorId: owner, commandId: "select-successor" }, setup.view.id, successor.id);

    const view = setup.runtime.restartActor({ actorId: owner, commandId: "restart-old" }, setup.view.id, setup.agent.id, "Restarted");
    assert.equal(view.primaryActorId, successor.id);
    assert.equal(view.stoppedPrimaryActorId, null);
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
            prompt: "Second attempt.",
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
        "Make room",
    );
    view = setup.runtime.spawnAgent(
        { actorId: view.ownerId, commandId: "spawn-successor" },
        setup.view.id,
        {
            handle: "worker",
            displayName: "Worker",
            prompt: "Successor.",
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
        "Both shall live",
    );
    const activeHandles = view.actors
        .filter((actor) => actor.kind === "agent" && actor.lifecycle.kind !== "stopped")
        .map((actor) => actor.handle)
        .sort();

    assert.deepEqual(activeHandles, ["worker", "worker-1"]);
});

test("a handle names the stopped actor for a restart even after a successor was spawned under that name", () => {
    const setup = setupRun();
    setup.runtime.stopActor({ actorId: setup.view.ownerId, commandId: "stop-by-handle" }, setup.view.id, setup.agent.id, "Pause");
    setup.runtime.spawnAgent({ actorId: setup.view.ownerId, commandId: "spawn-by-handle" }, setup.view.id, {
        handle: "worker",
        displayName: "Worker",
        prompt: "Successor.",
        execution: setup.agent.execution,
        grants: [],
        toolNames: null,
    });
    const target = addressedActorOf(setup.runtime.state(setup.view.id).actors.values(), "@Worker");

    assert.equal(target.id, setup.agent.id);
    const view = setup.runtime.restartActor({ actorId: setup.view.ownerId, commandId: "restart-by-handle" }, setup.view.id, target.id, "Continue");
    assert.equal(view.actors.flatMap((actor) => actor.kind === "agent" && actor.id === setup.agent.id ? [actor.lifecycle.kind] : [])[0], "idle");
});

const grant = (capability: CapabilityGrant["capability"]): CapabilityGrant => ({ capability, scope: { kind: "run" }, delegable: true });

const spawnFor = (runtime: Orchestration, run: RunView, handle: string, creatorId: string, grants: readonly CapabilityGrant[], turnId?: string) => {
    const spawned = runtime.spawnAgent({ actorId: creatorId, commandId: `spawn-${handle}`, ...(turnId ? { turnId } : {}) }, run.id, {
        handle, displayName: handle, prompt: "Work.", execution: manualExecution(), grants: [...grants], toolNames: null,
    }).actors.find((actor) => actor.handle === handle);
    assert.ok(spawned);
    return spawned;
};

const turnOf = async (runtime: Orchestration, run: RunView, actorId: string) => {
    const queued = runtime.enqueueInput({ actorId: run.ownerId, commandId: `input-${actorId}` }, run.id, { actorId, content: "Go on." });
    const input = queued.inputs.find((entry) => entry.actorId === actorId && entry.lifecycle.kind === "pending");
    assert.ok(input);
    const turn = claimTurn(runtime, run.id, actorId, input.id, `turn-${actorId}`);
    return { turn, toolset: await TurnToolset.create({ runtime, turn, catalog }) };
};

/** A lead with the given capabilities in a running turn and a helper it spawned in that turn, stopped by the owner. */
const stoppedHelperOf = async (leadGrants: readonly CapabilityGrant[]) => {
    const services = testServices();
    const journal = new Journal(":memory:", services);
    const runtime = new Orchestration(journal, services);
    const run = runtime.createRun({ commandId: "create" }, { title: "Restart", ownerHandle: "owner", ownerDisplayName: "Owner" });
    const lead = spawnFor(runtime, run, "lead", run.ownerId, [grant("agent.spawn"), ...leadGrants]);
    const { turn, toolset } = await turnOf(runtime, run, lead.id);
    const helper = spawnFor(runtime, run, "helper", lead.id, [], turn.turnId);
    const stop = () => runtime.stopActor({ actorId: run.ownerId, commandId: "stop-helper" }, run.id, helper.id, "Pause");
    return { journal, runtime, run, lead, helper, toolset, stop };
};

const lifecycleOf = (runtime: Orchestration, runId: string, actorId: string) => {
    const actor = runtime.view(runId).actors.find((entry) => entry.id === actorId);
    return actor && actor.kind !== "human" ? actor.lifecycle.kind : undefined;
};

test("actor_restart restarts a stopped actor of the caller's branch in the caller's name", async () => {
    const f = await stoppedHelperOf([grant("execution.stopOwned")]);

    try {
        f.stop();
        const output = await f.toolset.invokeFunction("restart-call", "actor_restart", { actorId: "@helper", reason: "Continue the review." });

        assert.deepEqual(output, [{ type: "actor.restarted", payload: { actorId: f.helper.id } }]);
        assert.equal(lifecycleOf(f.runtime, f.run.id, f.helper.id), "idle");
        const restarted = f.runtime.events(f.run.id).findLast((event) => event.type === "actor.restarted");
        assert.equal(restarted?.actorId, f.lead.id);
        assert.deepEqual(restarted?.payload, { actorId: f.helper.id, reason: "Continue the review." });
        assert.ok(f.runtime.enqueueInput({ actorId: f.run.ownerId, commandId: "input-after-restart" }, f.run.id, { actorId: f.helper.id, content: "Next." })
            .inputs.some((input) => input.actorId === f.helper.id && input.lifecycle.kind === "pending"));
    } finally {
        f.journal.close();
    }
});

test("actor_restart refuses a human and an actor that is not stopped", async () => {
    const f = await stoppedHelperOf([grant("execution.stopOwned")]);

    try {
        await assert.rejects(
            f.toolset.invokeFunction("restart-owner", "actor_restart", { actorId: "@owner", reason: "Wake up." }),
            /@owner is not an executable actor/,
        );
        await assert.rejects(
            f.toolset.invokeFunction("restart-active", "actor_restart", { actorId: "@helper", reason: "Again." }),
            /is not stopped/,
        );
        assert.equal(f.runtime.events(f.run.id).filter((event) => event.type === "actor.restarted").length, 0);
    } finally {
        f.journal.close();
    }
});

test("actor_restart is not available without execution.stopOwned", async () => {
    const f = await stoppedHelperOf([]);

    try {
        f.stop();
        await assert.rejects(
            f.toolset.invokeFunction("restart-ungranted", "actor_restart", { actorId: "@helper", reason: "Continue." }),
            /Function actor_restart is not available to actor/,
        );
        assert.equal(lifecycleOf(f.runtime, f.run.id, f.helper.id), "stopped");
    } finally {
        f.journal.close();
    }
});

test("actor_restart refuses a stopped actor of a foreign branch", async () => {
    const f = await stoppedHelperOf([grant("execution.stopOwned")]);

    try {
        f.stop();
        const other = spawnFor(f.runtime, f.run, "other", f.run.ownerId, [grant("execution.stopOwned")]);
        const { toolset } = await turnOf(f.runtime, f.run, other.id);

        await assert.rejects(
            toolset.invokeFunction("restart-foreign", "actor_restart", { actorId: "@helper", reason: "Not mine." }),
            /may only restart actors in its own branch/,
        );
        assert.equal(lifecycleOf(f.runtime, f.run.id, f.helper.id), "stopped");
    } finally {
        f.journal.close();
    }
});

test("actor_restart makes a stopped primary actor primary again only for a caller with run.configure", async () => {
    for (const [configures, expected] of [[true, ["actor.restarted", "run.primary-actor-selected"]], [false, ["actor.restarted"]]] as const) {
        const f = await stoppedHelperOf([grant("execution.stopOwned"), ...(configures ? [grant("run.configure")] : [])]);

        try {
            f.runtime.selectPrimaryActor({ actorId: f.run.ownerId, commandId: "select-helper" }, f.run.id, f.helper.id);
            f.stop();
            assert.equal(f.runtime.view(f.run.id).stoppedPrimaryActorId, f.helper.id);

            const output = await f.toolset.invokeFunction("restart-primary", "actor_restart", { actorId: f.helper.id, reason: "Back to the chat." });

            assert.deepEqual((output as Array<{ type: string }>).map((event) => event.type), expected);
            assert.equal(f.runtime.view(f.run.id).primaryActorId, configures ? f.helper.id : null);
        } finally {
            f.journal.close();
        }
    }
});
