import assert from "node:assert/strict";
import test from "node:test";
import { TurnScheduler } from "../src/agents/scheduler.ts";
import { FakeDriver, catalog, deferred, executionFor, noUsage, postTo, registryOf, setupRun } from "./support.ts";

test("host availability skips pending turns at startup and later journal triggers without touching the blocked run", async () => {
    const setup = setupRun({ toolNames: ["missing_tool"] });
    const blockedId = setup.view.id;
    let healthy = setup.runtime.createRun({ commandId: "create-healthy" }, {
        title: "Healthy", ownerHandle: "owner", ownerDisplayName: "Owner",
    });
    healthy = setup.runtime.spawnAgent({ actorId: healthy.ownerId, commandId: "spawn-healthy" }, healthy.id, {
        handle: "worker", displayName: "Worker", prompt: "Complete the task.",
        execution: executionFor("worker", { profile: "agent", isolateWorkspace: false }), grants: [], toolNames: [],
    });
    const healthyActor = healthy.actors.find((actor) => actor.kind === "agent")!;
    const resolutions: string[] = [];
    const driver = new FakeDriver(async () => ({ failure: null, usage: noUsage() }));
    const scheduler = new TurnScheduler(setup.runtime, setup.journal, {
        drivers: registryOf(driver), catalog, runAvailable: (runId) => runId !== blockedId,
        registry: { resolve: async ({ runId }) => { resolutions.push(runId); return []; } },
    });
    try {
        postTo(setup.runtime, setup.view, setup.agent.id, "blocked-input", "Blocked task.");
        postTo(setup.runtime, healthy, healthyActor.id, "healthy-input", "Healthy task.");
        const before = setup.runtime.events(blockedId);
        scheduler.start();
        await scheduler.waitForIdle();
        assert.deepEqual(driver.requests.map((request) => request.runId), [healthy.id]);
        assert.deepEqual(setup.runtime.events(blockedId), before);
        assert.deepEqual(setup.runtime.view(blockedId).inputs.map((input) => input.lifecycle.kind), ["pending"]);
        assert.equal(resolutions.includes(blockedId), false);

        postTo(setup.runtime, setup.view, setup.agent.id, "blocked-later-input", "Later blocked task.");
        setup.runtime.spawnAgent({ actorId: setup.view.ownerId, commandId: "spawn-blocked" }, blockedId, {
            handle: "another", displayName: "Another", prompt: "Remain pending.",
            execution: setup.agent.execution, grants: [], toolNames: ["missing_tool"],
        });
        setup.runtime.stopActor({ actorId: setup.view.ownerId, commandId: "stop-blocked" }, blockedId, setup.agent.id, "Test stop.");
        setup.runtime.restartActor({ actorId: setup.view.ownerId, commandId: "restart-blocked" }, blockedId, setup.agent.id, "Test restart.");
        const afterTriggers = setup.runtime.events(blockedId);
        postTo(setup.runtime, healthy, healthyActor.id, "healthy-later-input", "Later healthy task.");
        await scheduler.waitForIdle();
        assert.deepEqual(driver.requests.map((request) => request.runId), [healthy.id, healthy.id]);
        assert.deepEqual(setup.runtime.events(blockedId), afterTriggers);
        assert.equal(setup.runtime.view(blockedId).turns.length, 0);
        assert.ok(setup.runtime.view(blockedId).inputs.every((input) => input.lifecycle.kind === "pending"));
        assert.equal(resolutions.includes(blockedId), false);
    } finally {
        await scheduler.stop();
        setup.journal.close();
    }
});

test("host availability is checked again after asynchronous turn preparation and before the driver", async () => {
    const setup = setupRun({ toolNames: [] });
    const preparing = deferred();
    const release = deferred();
    let available = true;
    const driver = new FakeDriver(async () => ({ failure: null, usage: noUsage() }));
    const scheduler = new TurnScheduler(setup.runtime, setup.journal, {
        drivers: registryOf(driver), catalog, runAvailable: () => available,
        registry: { resolve: async () => { preparing.resolve(); await release.promise; return []; } },
    });
    try {
        postTo(setup.runtime, setup.view, setup.agent.id, "input", "Prepare the task.");
        scheduler.start();
        await preparing.promise;
        available = false;
        release.resolve();
        await scheduler.waitForIdle();
        assert.equal(driver.requests.length, 0);
        assert.equal(setup.runtime.view(setup.view.id).turns[0]?.status, "interrupted");
    } finally {
        release.resolve();
        await scheduler.stop();
        setup.journal.close();
    }
});
