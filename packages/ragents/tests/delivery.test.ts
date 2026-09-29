import assert from "node:assert/strict";
import test from "node:test";

import { TurnScheduler } from "../src/agents/scheduler.ts";
import { Journal } from "../src/runtime/journal.ts";
import { Orchestration } from "../src/runtime/orchestration.ts";
import {
    FakeDriver,
    allGrants,
    catalog,
    executionFor,
    noUsage,
    postTo,
    setupRun,
    testServices,
    textStep,
} from "./support.ts";

test("a subscription delivery reaches an agent as a readable header with its own text", async () => {
    const services = testServices();
    const journal = new Journal(":memory:", services);
    const runtime = new Orchestration(journal, services);
    let view = runtime.createRun(
        { commandId: "create" },
        { title: "Delivery", ownerHandle: "owner", ownerDisplayName: "Owner" },
    );
    view = runtime.spawnAgent({ actorId: view.ownerId, commandId: "spawn-red" }, view.id, {
        handle: "red",
        displayName: "Red",
        prompt: "Answer.",
        execution: executionFor("red", { profile: "agent", isolateWorkspace: false }),
        grants: [],
        toolNames: [],
    });
    view = runtime.spawnAgent({ actorId: view.ownerId, commandId: "spawn-yellow" }, view.id, {
        handle: "yellow",
        displayName: "Yellow",
        prompt: "Answer.",
        execution: executionFor("yellow", { profile: "agent", isolateWorkspace: false }),
        grants: allGrants(),
        toolNames: [],
    });
    const red = view.actors.find((entry) => entry.handle === "red");
    const yellow = view.actors.find((entry) => entry.handle === "yellow");
    assert.ok(red && yellow);
    runtime.createSubscription({ actorId: view.ownerId, commandId: "subscribe-red" }, view.id, {
        subscriberId: yellow.id,
        sourceActorIds: [red.id],
        sourceActorKinds: null,
        eventTypes: ["model.output.completed"],
        includeSelf: false,
    });
    const driver = new FakeDriver(async (request) => {
        if (request.agentId === red.id)
            request.recordContext({ kind: "step", step: textStep("red: Begin") });

        return { failure: null, usage: noUsage() };
    });
    const scheduler = new TurnScheduler(runtime, journal, { drivers: { agent: driver }, catalog });

    try {
        postTo(runtime, view, red.id, "start-red", "Begin");
        scheduler.start();
        await scheduler.waitForIdle();

        const delivered = driver.requests.find((request) => request.agentId === yellow.id);
        assert.ok(delivered);
        assert.equal(delivered.input.event?.type, "model.output.completed");
        assert.equal(delivered.input.event?.sourceActorHandle, "red");
        assert.equal(delivered.input.content, "red: Begin");
        assert.match(delivered.prompt, /^\[Event model\.output\.completed from @red, sequence \d+\]/);
        assert.match(delivered.prompt, /\[Active subscriptions\] subscription-\d+: sources @red; events model\.output\.completed/);
        assert.match(delivered.prompt, /\n\nred: Begin$/);
    } finally {
        await scheduler.stop();
        journal.close();
    }
});

test("an agent without a subscription keeps its plain input text", async () => {
    const setup = setupRun({ grants: allGrants() });
    const driver = new FakeDriver(async () => ({ failure: null, usage: noUsage() }));
    const scheduler = new TurnScheduler(setup.runtime, setup.journal, { drivers: { agent: driver }, catalog });

    try {
        postTo(setup.runtime, setup.view, setup.agent.id, "plain", "Please check.");
        scheduler.start();
        await scheduler.waitForIdle();

        assert.equal(driver.requests[0]?.prompt, "Please check.");
        assert.equal(driver.requests[0]?.input.event, null);
    } finally {
        await scheduler.stop();
        setup.journal.close();
    }
});

test("an orchestrator sees existing participants from another creator and refreshes their state each turn", async () => {
    const setup = setupRun({ grants: allGrants(), toolNames: ["actor_list", "actor_input"] });
    const spawnGuest = (handle: string) => setup.runtime.spawnAgent(
        { actorId: setup.view.ownerId, commandId: `spawn-${handle}` }, setup.view.id, {
            handle, displayName: handle, prompt: "Private role instructions.",
            execution: executionFor(handle, { profile: "agent", isolateWorkspace: false }),
            grants: [], toolNames: [],
        });
    const guests = spawnGuest("kai");
    const kai = guests.actors.find((actor) => actor.handle === "kai");
    assert.ok(kai);
    spawnGuest("lena");
    const driver = new FakeDriver(async () => ({ failure: null, usage: noUsage() }));
    const scheduler = new TurnScheduler(setup.runtime, setup.journal, { drivers: { agent: driver }, catalog });

    try {
        postTo(setup.runtime, setup.view, setup.agent.id, "first", "Moderate the existing guests.");
        scheduler.start();
        await scheduler.waitForIdle();
        const first = driver.requests[0]?.systemPrompt ?? "";
        assert.match(first, /Actors in the run, as of turn start/);
        assert.match(first, /@kai: "kai", agent, idle/);
        assert.match(first, /@lena: "lena", agent, idle/);
        assert.match(first, /@worker: "Worker", agent, running \(you\)/);
        assert.doesNotMatch(first, /Private role instructions/);

        setup.runtime.stopActor({ actorId: setup.view.ownerId, commandId: "stop-kai" }, setup.view.id, kai.id, "Done.");
        spawnGuest("reviewer");
        postTo(setup.runtime, setup.view, setup.agent.id, "second", "Continue with the current team.");
        await scheduler.waitForIdle();
        const second = driver.requests[1]?.systemPrompt ?? "";
        assert.match(second, /@kai: "kai", agent, stopped/);
        assert.match(second, /@reviewer: "reviewer", agent, idle/);
        assert.doesNotMatch(first, /@reviewer/);
    } finally {
        await scheduler.stop();
        setup.journal.close();
    }
});

test("the actor roster is absent without an allowed actor_list tool, including plain models", async () => {
    for (const options of [
        { grants: allGrants(), toolNames: [] },
        { grants: allGrants(), toolNames: ["model_list"] },
        { grants: [], toolNames: null },
    ]) {
        const setup = setupRun(options);
        const driver = new FakeDriver(async () => ({ failure: null, usage: noUsage() }));
        const scheduler = new TurnScheduler(setup.runtime, setup.journal, { drivers: { agent: driver }, catalog });

        try {
            postTo(setup.runtime, setup.view, setup.agent.id, "isolated", "Answer normally.");
            scheduler.start();
            await scheduler.waitForIdle();
            assert.equal(driver.requests.length, 1);
            assert.doesNotMatch(driver.requests[0]?.systemPrompt ?? "", /Actors in the run|@owner|@worker/);
            assert.equal(driver.requests[0]?.prompt, "Answer normally.");
        } finally {
            await scheduler.stop();
            setup.journal.close();
        }
    }
});
