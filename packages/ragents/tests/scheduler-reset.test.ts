import assert from "node:assert/strict";
import test from "node:test";
import { TurnScheduler } from "../src/agents/scheduler.ts";
import { catalog, deferred, FakeDriver, noUsage, setupRun } from "./support.ts";

test("an active scheduler releases a removed run and schedules its recreated run", async () => {
    const setup = setupRun();
    const driver = new FakeDriver(async () => ({ failure: null, usage: noUsage() }));
    const errors: unknown[] = [];
    const scheduler = new TurnScheduler(setup.runtime, setup.journal, {
        drivers: { agent: driver }, catalog, onError: (error) => { errors.push(error); },
    });
    try {
        scheduler.start();
        await scheduler.haltRun(setup.view.id, async (stopped, settled) => {
            await stopped;
            await settled;
            setup.journal.forget(setup.view.id);
        });
        assert.equal(setup.journal.stateOf(setup.view.id), null);
        let view = setup.runtime.createRun({ commandId: "recreate-run" }, {
            runId: setup.view.id, title: "Fresh run", ownerHandle: "owner", ownerDisplayName: "Owner",
        });
        view = setup.runtime.spawnAgent({ actorId: view.ownerId, commandId: "recreate-worker" }, view.id, {
            handle: "worker", displayName: "Worker", prompt: "Fresh context", execution: setup.agent.execution, grants: [], toolNames: [],
        });
        const worker = view.actors.find((actor) => actor.kind === "agent")!;
        setup.runtime.enqueueInput({ actorId: view.ownerId, commandId: "fresh-input" }, view.id, { actorId: worker.id, content: "Fresh input" });
        await scheduler.waitForIdle();
        assert.deepEqual(driver.requests.map((request) => request.input.content), ["Fresh input"]);
        assert.deepEqual(setup.runtime.view(view.id).turns.map((turn) => turn.status), ["completed"]);
        assert.deepEqual(errors, []);
    } finally { await scheduler.stop(); setup.journal.close(); }
});

test("a later halt waits for earlier quarantined cleanup before replacing run data", async () => {
    const setup = setupRun();
    const release = deferred();
    const scheduler = new TurnScheduler(setup.runtime, setup.journal, { drivers: { agent: new FakeDriver(async () => ({ failure: null, usage: noUsage() })) }, catalog });
    let replaced = false;
    try {
        await scheduler.haltRun(setup.view.id, () => scheduler.quarantineRun(setup.view.id, release.promise));
        const reset = scheduler.haltRun(setup.view.id, async (stopped, settled) => {
            await stopped;
            await settled;
            replaced = true;
        });
        await new Promise<void>((resolve) => setImmediate(resolve));
        assert.equal(replaced, false);
        release.resolve();
        await reset;
        assert.equal(replaced, true);
    } finally { release.resolve(); await scheduler.stop(); setup.journal.close(); }
});

test("failed runtime stop does not authorize destructive cleanup in the halted boundary", async () => {
    const setup = setupRun();
    const driver = new FakeDriver(async () => ({ failure: null, usage: noUsage() }));
    const scheduler = new TurnScheduler(setup.runtime, setup.journal, { drivers: { agent: {
        kind: "agent", runTurn: (request, signal) => driver.runTurn(request, signal),
        haltRun: async () => { throw new Error("Runtime konnte nicht gestoppt werden"); },
    } }, catalog, onError: () => undefined });
    let removed = false;
    try {
        await assert.rejects(scheduler.haltRun(setup.view.id, async (stopped, settled) => {
            await stopped;
            await settled;
            removed = true;
        }), /nicht vollständig angehalten/);
        assert.equal(removed, false);
        assert.ok(setup.journal.stateOf(setup.view.id));
    } finally { await scheduler.stop(); setup.journal.close(); }
});
