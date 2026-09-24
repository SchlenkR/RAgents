import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import test from "node:test";

import { TurnScheduler } from "../src/agents/scheduler.ts";
import { validatedEventPayloadOf } from "../src/domain/event-validation.ts";
import { Journal } from "../src/runtime/journal.ts";
import { Orchestration } from "../src/runtime/orchestration.ts";
import { FakeDriver, catalog, executionFor, noUsage, registryOf, testServices } from "./support.ts";

test("background inputs survive journal reload and reach the actor once with their full content", async (t) => {
    const directory = mkdtempSync("/private/tmp/ragents-background-input-");
    t.after(() => rmSync(directory, { recursive: true, force: true }));
    const services = testServices();
    const journal = new Journal(directory, services);
    const runtime = new Orchestration(journal, services);
    const run = runtime.createRun({ commandId: "create" }, {
        title: "Background delivery", ownerHandle: "user", ownerDisplayName: "User",
    });
    const owner = { actorId: run.ownerId, commandId: "spawn" };
    const spawned = runtime.spawnAgent(owner, run.id, {
        handle: "coordinator", displayName: "Coordinator", prompt: "Report progress.",
        execution: executionFor("coordinator", { profile: "agent", isolateWorkspace: false }),
        grants: [], toolNames: [],
    });
    const actor = spawned.actors.find((entry) => entry.kind === "agent")!;
    const content = "Prüfe den aktuellen Fortschritt und berichte nur Änderungen.";
    runtime.enqueueInput({ ...owner, commandId: "monitor" }, run.id, {
        actorId: actor.id, content, presentation: "background",
    });
    const events = runtime.events(run.id);
    journal.close();

    const restored = new Journal(directory, services);
    const resumed = new Orchestration(restored, services);
    const driver = new FakeDriver(async (request) => {
        request.emit({ kind: "assistant", text: "Die Implementierung läuft." });

        return { failure: null, usage: noUsage() };
    });
    const scheduler = new TurnScheduler(resumed, restored, { drivers: registryOf(driver), catalog });

    try {
        assert.deepEqual(resumed.events(run.id), events);
        const input = resumed.view(run.id).inputs[0]!;
        assert.equal(input.presentation, "background");
        assert.equal(input.content, content);
        assert.equal(input.lifecycle.kind, "pending");
        scheduler.start();
        await scheduler.waitForIdle();
        assert.equal(driver.requests.length, 1);
        assert.equal(driver.requests[0]!.input.content, content);
        assert.equal(driver.requests[0]!.input.id, input.id);
        assert.equal(resumed.view(run.id).turns[0]!.status, "completed");
        assert.equal(resumed.view(run.id).turns[0]!.outputs[0]!.text, "Die Implementierung läuft.");
    } finally {
        await scheduler.stop();
        restored.close();
    }
});

test("input event validation accepts an omitted presentation and rejects unknown presentation values", () => {
    const payload = {
        inputId: "input-1", actorId: "coordinator", content: "Nachricht",
        artifactIds: [], sourceEventIds: [], subscriptionId: null,
    };
    assert.doesNotThrow(() => validatedEventPayloadOf("actor.input.enqueued", payload, "input"));
    assert.doesNotThrow(() => validatedEventPayloadOf("actor.input.enqueued", { ...payload, presentation: "background" }, "input"));

    for (const presentation of ["hidden", "", false, null, 0, {}, []])
        assert.throws(() => validatedEventPayloadOf("actor.input.enqueued", { ...payload, presentation }, "input"), /presentation must be background/);
});
