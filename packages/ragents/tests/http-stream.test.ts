import assert from "node:assert/strict";
import { createServer } from "node:http";
import test from "node:test";

import { manualExecution } from "../src/domain/driver.ts";
import { runtimeRoutes, type RuntimeServerOptions } from "../src/http/server.ts";
import { DomainError } from "../src/runtime/domain-error.ts";
import { Journal } from "../src/runtime/journal.ts";
import { Orchestration } from "../src/runtime/orchestration.ts";
import { testServices } from "./support.ts";

const startRuntimeHttp = async (
    overrides: Pick<RuntimeServerOptions, "abortTurns" | "assertAvailable" | "assertRunUsable"> = {},
) => {
    const services = testServices();
    const journal = new Journal(":memory:", services);
    const runtime = new Orchestration(journal, services);
    const routes = runtimeRoutes({ runtime, ...overrides });
    const server = createServer((request, response) => {
        void routes(request, response);
    });

    await new Promise<void>((resolve, reject) => {
        server.once("error", reject);
        server.listen(0, "127.0.0.1", resolve);
    });
    const address = server.address();
    if (!address || typeof address === "string")
        assert.fail("The test server has no TCP address.");

    return {
        journal,
        runtime,
        server,
        origin: `http://${address.address}:${address.port}`,
        close: async () => {
            server.closeAllConnections();
            await new Promise<void>((resolve, reject) => {
                server.close((error) => error ? reject(error) : resolve());
            });
            journal.close();
        },
    };
};

const createRun = (fixture: Awaited<ReturnType<typeof startRuntimeHttp>>, title = "HTTP v3") =>
    fixture.runtime.createRun(
        { commandId: `create-${title}` },
        { title, ownerHandle: "owner", ownerDisplayName: "Owner" },
    );

const spawnWorker = (fixture: Awaited<ReturnType<typeof startRuntimeHttp>>, runId: string, handle: string) =>
    fixture.runtime.spawnAgent({ actorId: fixture.runtime.state(runId).ownerId, commandId: `spawn-${handle}` }, runId, {
        handle,
        displayName: handle,
        prompt: "",
        execution: manualExecution(),
        grants: [],
        toolNames: [],
    });

test("HTTP serves the run view and enqueues actor inputs", async () => {
    const fixture = await startRuntimeHttp();
    const run = createRun(fixture);

    try {
        const view = spawnWorker(fixture, run.id, "worker");
        const worker = view.actors.find((entry) => entry.handle === "worker");
        assert.ok(worker);

        const read = await fetch(`${fixture.origin}/api/runs/${run.id}`);
        assert.equal(read.status, 200);
        assert.equal((await read.json() as { id: string }).id, run.id);

        const input = await fetch(`${fixture.origin}/api/runs/${run.id}/actors/${worker.id}/inputs`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ commandId: "input", content: "Plain text" }),
        });
        assert.equal(input.status, 201);
        const inputView = await input.json() as {
            inputs: Array<{
                id: string;
                actorId: string;
                content: string;
                artifactIds: string[];
                sourceEventIds: string[];
                subscriptionId: string | null;
                enqueuedBy: string;
                enqueuedAt: string;
                sequence: number;
                turnId: string | null;
                discardedAt: string | null;
                discardReason: string | null;
            }>;
        };
        assert.deepEqual(inputView.inputs.at(-1), {
            id: inputView.inputs.at(-1)?.id,
            actorId: worker.id,
            content: "Plain text",
            artifactIds: [],
            sourceEventIds: [],
            subscriptionId: null,
            enqueuedBy: run.ownerId,
            enqueuedAt: inputView.inputs.at(-1)?.enqueuedAt,
            sequence: inputView.inputs.at(-1)?.sequence,
            lifecycle: { kind: "pending" },
        });
    } finally {
        await fixture.close();
    }
});

test("removed management, spawn, subscription and stream routes answer 404", async () => {
    const fixture = await startRuntimeHttp();
    const run = createRun(fixture, "Removed routes");
    const post = (path: string, body: Record<string, unknown>) =>
        fetch(`${fixture.origin}${path}`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ commandId: "removed", ...body }),
        });

    try {
        const responses = await Promise.all([
            post("/api/runs", { title: "New", ownerHandle: "r", ownerDisplayName: "R" }),
            post(`/api/runs/${run.id}/assistant`, { content: "Hello" }),
            post(`/api/runs/${run.id}/fork`, { sequence: 1 }),
            post(`/api/runs/${run.id}/agents`, { handle: "worker", displayName: "W", prompt: "" }),
            post(`/api/runs/${run.id}/primary-actor`, { actor: "@worker" }),
            post(`/api/runs/${run.id}/actors/any/subscriptions`, { eventTypes: ["model.output.completed"] }),
            post(`/api/runs/${run.id}/actions`, { title: "Ask" }),
            post(`/api/runs/${run.id}/artifacts`, { title: "A", mediaType: "text/plain", content: "" }),
            fetch(`${fixture.origin}/api/runs`),
            fetch(`${fixture.origin}/api/runs/stream`),
            fetch(`${fixture.origin}/api/runs/${run.id}/stream`),
            fetch(`${fixture.origin}/api/profiles`),
            post("/mcp/token", {}),
        ]);

        for (const response of responses)
            assert.equal(response.status, 404);
    } finally {
        await fixture.close();
    }
});

test("HTTP actor stop follows the createdBy branch", async () => {
    const fixture = await startRuntimeHttp();
    let run = createRun(fixture, "Actor stop");
    run = fixture.runtime.spawnAgent({ actorId: run.ownerId, commandId: "spawn-parent" }, run.id, {
        handle: "parent",
        displayName: "Parent",
        prompt: "",
        execution: manualExecution(),
        grants: [{ capability: "agent.spawn", scope: { kind: "run" }, delegable: true }],
        toolNames: [],
    });
    const parent = run.actors.find((entry) => entry.handle === "parent");
    assert.ok(parent?.kind === "agent");
    run = fixture.runtime.enqueueInput(
        { actorId: run.ownerId, commandId: "parent-input" },
        run.id,
        { actorId: parent.id, content: "Create a child." },
    );
    const input = run.inputs.at(-1);
    assert.ok(input);
    run = fixture.runtime.startTurn(
        { actorId: parent.id, commandId: "parent-turn" },
        run.id,
        parent.id,
        input.id,
    );
    const turn = run.turns.at(-1);
    assert.ok(turn);
    run = fixture.runtime.spawnAgent(
        { actorId: parent.id, commandId: "spawn-child", turnId: turn.id },
        run.id,
        {
            handle: "child",
            displayName: "Child",
            prompt: "",
            execution: manualExecution(),
            grants: [],
            toolNames: [],
        },
    );
    fixture.runtime.finishTurn(
        { actorId: parent.id, commandId: "finish-parent", turnId: turn.id },
        run.id,
        parent.id,
        { turnId: turn.id, outcome: "completed" },
    );

    try {
        const response = await fetch(`${fixture.origin}/api/runs/${run.id}/actors/${parent.id}/stop`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ commandId: "stop-parent", reason: "Done." }),
        });
        assert.equal(response.status, 200);
        const actors = (await response.json() as {
            actors: Array<{ handle: string; lifecycle: { kind: string } }>;
        }).actors;
        assert.equal(actors.find((entry) => entry.handle === "parent")?.lifecycle.kind, "stopped");
        assert.equal(actors.find((entry) => entry.handle === "child")?.lifecycle.kind, "stopped");
    } finally {
        await fixture.close();
    }
});

test("the HTTP API has no generic plugin-state write route", async () => {
    const fixture = await startRuntimeHttp();
    const run = createRun(fixture, "Plugin state");

    try {
        const response = await fetch(`${fixture.origin}/api/runs/${run.id}/plugin-state`, {
            method: "PUT",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ commandId: "inject", pluginId: "plugin", scope: { kind: "run" }, state: {} }),
        });
        assert.equal(response.status, 404);
        assert.deepEqual(fixture.runtime.view(run.id).pluginStates, []);
    } finally {
        await fixture.close();
    }
});

test("the run guard protects v3 reads and mutations", async () => {
    let blockedRunId: string | null = null;
    const fixture = await startRuntimeHttp({
        assertRunUsable: (runId) => {
            if (runId === blockedRunId)
                throw new DomainError("run-deleted", "The run has been deleted.", 410);
        },
    });
    const run = createRun(fixture, "Guarded");
    const view = spawnWorker(fixture, run.id, "worker");
    const worker = view.actors.find((entry) => entry.handle === "worker");
    assert.ok(worker);
    blockedRunId = run.id;

    try {
        const read = await fetch(`${fixture.origin}/api/runs/${run.id}`);
        assert.equal(read.status, 410);
        const mutation = await fetch(`${fixture.origin}/api/runs/${run.id}/actors/${worker.id}/inputs`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ commandId: "blocked", content: "Blocked" }),
        });
        assert.equal(mutation.status, 410);
        assert.equal(fixture.runtime.view(run.id).inputs.length, 0);
    } finally {
        await fixture.close();
    }
});

test("run stop preserves the primary actor and stops all other actors even when cleanup fails", async () => {
    const externallyStopped: string[] = [];
    const fixture = await startRuntimeHttp({
        abortTurns: async (runId) => {
            externallyStopped.push(runId);
            throw new DomainError("external-cleanup", "External cleanup failed.", 500);
        },
    });
    let run = createRun(fixture, "Stop");
    run = fixture.runtime.spawnAgent({ actorId: run.ownerId, commandId: "primary-agent" }, run.id, {
        handle: "primary",
        displayName: "Primary",
        prompt: "",
        execution: manualExecution(),
        grants: [],
        toolNames: [],
    });
    run = fixture.runtime.spawnAgent({ actorId: run.ownerId, commandId: "worker-agent" }, run.id, {
        handle: "worker",
        displayName: "Worker",
        prompt: "",
        execution: manualExecution(),
        grants: [],
        toolNames: [],
    });
    const primary = run.actors.find((entry) => entry.handle === "primary");
    assert.ok(primary);
    fixture.runtime.selectPrimaryActor({ actorId: run.ownerId, commandId: "select-primary" }, run.id, primary.id);

    try {
        const response = await fetch(`${fixture.origin}/api/runs/${run.id}/stop-all`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ commandId: "stop-all", reason: "Stop." }),
        });
        assert.equal(response.status, 500);
        assert.deepEqual(externallyStopped, [run.id]);
        const actors = fixture.runtime.view(run.id).actors.filter((entry) => entry.kind !== "human");
        assert.equal(actors.find((entry) => entry.id === primary.id)?.lifecycle.kind, "idle");
        assert.equal(actors.find((entry) => entry.handle === "worker")?.lifecycle.kind, "stopped");
    } finally {
        await fixture.close();
    }
});
