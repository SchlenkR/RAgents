import assert from "node:assert/strict";
import test from "node:test";
import { Type } from "typebox";

import {
    LifecycleContributionRegistry,
    OperationContributionRegistry,
    StartOptionContributionRegistry,
} from "../src/plugin-host.ts";
import { canonicalHash } from "../src/runtime/canonical-hash.ts";

const operationContext = (
    kind: "agent" | "operator",
    confirmation?: { operationId: string; input: unknown; invocationId?: string },
) => {
    const base = {
        runId: "run-1",
        invocationId: "invocation-1",
        signal: new AbortController().signal,
    };

    if (kind === "agent")
        return { ...base, principal: { kind, actorId: "agent-1", turnId: "turn-1" } as const };

    return {
        ...base,
        principal: { kind, actorId: "owner-1" } as const,
        ...(confirmation ? {
            operatorConfirmation: {
                operationId: confirmation.operationId,
                invocationId: confirmation.invocationId ?? "invocation-1",
                inputHash: canonicalHash(confirmation.input),
            },
        } : {}),
    };
};

test("operations are globally unique and validate input", async () => {
    const operations = new OperationContributionRegistry();
    operations.register("first-plugin", [{
        id: "example.echo",
        label: "Echo",
        description: "Returns the given value.",
        schema: Type.Object({ value: Type.String() }),
        resultSchema: Type.String(),
        operator: "direct",
        execute: (_context, input) => (input as { value: string }).value,
    }]);

    assert.equal(operations.operation("example.echo")?.owner, "first-plugin");
    assert.equal(operations.operation("missing"), undefined);
    assert.equal(await operations.invoke("example.echo", operationContext("operator"), { value: "Hallo" }), "Hallo");
    await assert.rejects(
        operations.invoke("example.echo", operationContext("operator"), { value: 42 }),
        /Ungültige Eingabe/,
    );
    assert.throws(() => operations.register("second-plugin", [{
        id: "example.echo",
        label: "Echo again",
        description: "Conflicting operation.",
        schema: Type.Object({}),
        resultSchema: Type.Unknown(),
        operator: "direct",
        execute: () => null,
    }]), /bereits von first-plugin bereitgestellt/);
});

test("operator policies distinguish agent calls from operator-mediated app calls", async () => {
    const operations = new OperationContributionRegistry();
    operations.register("plugin", [
        {
            id: "example.confirmed",
            label: "Confirmed",
            description: "Requires confirmation for an operator.",
            schema: Type.Object({}),
            resultSchema: Type.String(),
            operator: "confirm",
            execute: ({ principal }) => principal.kind,
        },
        {
            id: "example.internal",
            label: "Internal",
            description: "Cannot be called by an operator.",
            schema: Type.Object({}),
            resultSchema: Type.String(),
            operator: "unavailable",
            execute: ({ principal }) => principal.kind,
        },
    ]);

    await assert.rejects(
        operations.invoke("example.confirmed", operationContext("operator"), {}),
        /gebundene Bestätigung/,
    );
    assert.equal(
        await operations.invoke(
            "example.confirmed",
            operationContext("operator", { operationId: "example.confirmed", input: {} }),
            {},
        ),
        "operator",
    );
    await assert.rejects(
        operations.invoke(
            "example.confirmed",
            operationContext("operator", { operationId: "example.confirmed", input: { other: true } }),
            {},
        ),
        /gebundene Bestätigung/,
    );
    await assert.rejects(
        operations.invoke(
            "example.confirmed",
            operationContext("operator", {
                operationId: "example.confirmed",
                invocationId: "another-invocation",
                input: {},
            }),
            {},
        ),
        /gebundene Bestätigung/,
    );
    await assert.rejects(
        operations.invoke(
            "example.internal",
            operationContext("operator", { operationId: "example.internal", input: {} }),
            {},
        ),
        /nicht verfügbar/,
    );
    assert.equal(await operations.invoke("example.confirmed", operationContext("agent"), {}), "agent");
    assert.equal(await operations.invoke("example.internal", operationContext("agent"), {}), "agent");
    assert.equal(
        await operations.invoke(
            "example.confirmed",
            operationContext("agent", { operationId: "another-operation", input: { wrong: true } }),
            {},
        ),
        "agent",
    );
    assert.equal(
        await operations.invoke(
            "example.internal",
            operationContext("agent", { operationId: "example.confirmed", input: {} }),
            {},
        ),
        "agent",
    );
});

test("operation results are validated at the host boundary", async () => {
    const operations = new OperationContributionRegistry();
    operations.register("plugin", [{
        id: "example.invalid-result",
        label: "Invalid result",
        description: "Returns a value outside its result contract.",
        schema: Type.Object({}),
        resultSchema: Type.Object({ ok: Type.Boolean() }, { additionalProperties: false }),
        operator: "direct",
        execute: () => ({ ok: "not-a-boolean" }),
    }]);

    await assert.rejects(
        operations.invoke("example.invalid-result", operationContext("agent"), {}),
        /Ungültiges Ergebnis von Operation example\.invalid-result/,
    );
});

test("session stop starts every plugin in reverse registration order and aggregates failures", async () => {
    const calls: string[] = [];
    const lifecycle = new LifecycleContributionRegistry();
    lifecycle.register("first-plugin", [{
        id: "first.lifecycle",
        stopSession: async ({ runId }) => {
            calls.push(`first:${runId}`);
            throw new Error("First plugin failed.");
        },
    }]);
    lifecycle.register("second-plugin", [{
        id: "second.lifecycle",
        stopSession: ({ runId }) => {
            calls.push(`second:${runId}`);
        },
    }]);

    await assert.rejects(lifecycle.stopSession("run-1"), /Plugin-Stopp ist in 1 Plugin/);
    assert.deepEqual(calls, ["second:run-1", "first:run-1"]);
});

test("session stop provides an active abort signal to every plugin", async () => {
    const signals: AbortSignal[] = [];
    const lifecycle = new LifecycleContributionRegistry();
    lifecycle.register("plugin", [{
        id: "plugin.lifecycle",
        stopSession: ({ signal }) => {
            signals.push(signal);
            assert.equal(signal.aborted, false);
        },
    }]);

    await lifecycle.stopSession("run-1");

    assert.equal(signals.length, 1);
    assert.ok(signals[0] instanceof AbortSignal);
});

test("final stop hooks have separate attempts and retain late cleanup until released", async () => {
    const lifecycle = new LifecycleContributionRegistry({ stopTimeoutMs: 20 });
    const calls: string[] = [];
    let release = () => {};
    const gate = new Promise<void>((resolve) => { release = resolve; });
    let signal: AbortSignal | undefined;
    lifecycle.register("plugin", [{
        id: "plugin.lifecycle",
        stopSession: () => { calls.push("stop"); },
        afterStopSession: async (context) => {
            signal = context.signal;
            calls.push("final-start");
            await gate;
            calls.push("final-end");
        },
        deleteSession: () => { calls.push("delete"); },
    }]);
    const first = lifecycle.beginStopSession("run-1");
    await first.bounded;
    assert.deepEqual(calls, ["stop"]);
    const final = lifecycle.beginAfterStopSession("run-1");
    await assert.rejects(final.bounded, /Plugin-Stopp/);
    assert.equal(signal?.aborted, true);
    assert.throws(final.release, /vor dem Ende/);
    const repeated = lifecycle.beginAfterStopSession("run-1");
    await assert.rejects(repeated.bounded, /Plugin-Stopp/);
    const deletion = lifecycle.deleteSession("run-1");
    assert.deepEqual(calls, ["stop", "final-start"]);
    release();
    await Promise.all([final.settled, repeated.settled, deletion]);
    first.release();
    final.release();
    assert.deepEqual(calls, ["stop", "final-start", "final-end", "delete"]);
});

test("session stop aborts and bounds a plugin that ignores its signal", async () => {
    let signal: AbortSignal | undefined;
    let peerStopped = false;
    const lifecycle = new LifecycleContributionRegistry({ stopTimeoutMs: 20 });
    lifecycle.register("peer-plugin", [{
        id: "peer.lifecycle",
        stopSession: () => {
            peerStopped = true;
            throw new Error("Peer plugin failed.");
        },
    }]);
    lifecycle.register("hanging-plugin", [{
        id: "hanging.lifecycle",
        stopSession: (context) => {
            signal = context.signal;
            return new Promise<void>(() => {});
        },
    }]);

    const startedAt = Date.now();
    const stopping = assert.rejects(
        lifecycle.stopSession("run-1"),
        (error: unknown) => {
            assert.ok(error instanceof AggregateError);
            assert.equal(error.errors.length, 2);
            assert.match(String(error.errors[0]), /hanging\.lifecycle.*20 ms überschritten/);
            assert.match(String(error.errors[1]), /Peer plugin failed/);
            return true;
        },
    );
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.equal(peerStopped, true);
    await stopping;

    assert.equal(signal?.aborted, true);
    assert.ok(signal?.reason instanceof Error);
    assert.ok(Date.now() - startedAt < 1_000);
});

test("a timed-out session stopper exposes its late settlement and remains coalesced until release", async () => {
    let release = () => {};
    const gate = new Promise<void>((resolve) => { release = resolve; });
    let calls = 0;
    const mutations: string[] = [];
    const lifecycle = new LifecycleContributionRegistry({ stopTimeoutMs: 20 });
    lifecycle.register("late-plugin", [{
        id: "late.lifecycle",
        stopSession: async () => {
            calls += 1;
            await gate;
            mutations.push("late descendant created");
        },
    }]);
    const isTimeout = (error: unknown): boolean => {
        assert.ok(error instanceof AggregateError);
        assert.equal(error.errors.length, 1);
        assert.match(String(error.errors[0]), /late\.lifecycle.*20 ms überschritten/);
        return true;
    };

    const first = lifecycle.beginStopSession("run-1");
    let actuallySettled = false;
    void first.settled.then(() => { actuallySettled = true; });
    await assert.rejects(first.bounded, isTimeout);
    assert.equal(actuallySettled, false);
    assert.deepEqual(mutations, []);
    assert.throws(first.release, /vor dem Ende aller Beiträge/);

    const coalesced = lifecycle.beginStopSession("run-1");
    await assert.rejects(coalesced.bounded, isTimeout);
    assert.equal(calls, 1);

    release();
    await Promise.all([first.settled, coalesced.settled]);
    assert.equal(actuallySettled, true);
    assert.deepEqual(mutations, ["late descendant created"]);
    first.release();

    const nextGeneration = lifecycle.beginStopSession("run-1");
    await Promise.all([nextGeneration.bounded, nextGeneration.settled]);
    nextGeneration.release();
    assert.equal(calls, 2);
    assert.deepEqual(mutations, ["late descendant created", "late descendant created"]);
});

test("a timed-out session stop is released after settlement and deletion waits for it", async () => {
    let release = () => {};
    const gate = new Promise<void>((resolve) => { release = resolve; });
    let stopCalls = 0;
    let deleted = false;
    const lifecycle = new LifecycleContributionRegistry({ stopTimeoutMs: 20 });
    lifecycle.register("late-plugin", [{
        id: "late-delete.lifecycle",
        stopSession: async () => {
            stopCalls++;
            await gate;
        },
        deleteSession: () => {
            deleted = true;
        },
    }]);

    await assert.rejects(
        lifecycle.stopSession("run-1"),
        (error: unknown) => error instanceof AggregateError
            && error.errors.some((entry) => /20 ms überschritten/.test(String(entry))),
    );
    const deletion = lifecycle.deleteSession("run-1");
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.equal(deleted, false);

    release();
    await deletion;
    assert.equal(deleted, true);
    await lifecycle.stopSession("run-1");
    assert.equal(stopCalls, 2);
});

test("plugin shutdown waits for a timed-out session stop to settle", async () => {
    let release = () => {};
    const gate = new Promise<void>((resolve) => { release = resolve; });
    let shutdownSettled = false;
    const lifecycle = new LifecycleContributionRegistry({ stopTimeoutMs: 20 });
    lifecycle.register("late-plugin", [{
        id: "late-shutdown.lifecycle",
        stopSession: async () => {
            await gate;
        },
    }]);

    await assert.rejects(
        lifecycle.stopSession("run-1"),
        (error: unknown) => error instanceof AggregateError
            && error.errors.some((entry) => /20 ms überschritten/.test(String(entry))),
    );
    const shutdown = lifecycle.shutdown().then(() => {
        shutdownSettled = true;
    });
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.equal(shutdownSettled, false);

    release();
    await shutdown;
    assert.equal(shutdownSettled, true);
});

test("session deletion settles every plugin after a failure", async () => {
    const calls: string[] = [];
    const lifecycle = new LifecycleContributionRegistry();
    lifecycle.register("first-plugin", [{
        id: "first.lifecycle",
        deleteSession: () => {
            calls.push("first");
        },
    }]);
    lifecycle.register("second-plugin", [{
        id: "second.lifecycle",
        deleteSession: async () => {
            calls.push("second");
            throw new Error("Second plugin failed.");
        },
    }]);

    await assert.rejects(lifecycle.deleteSession("run-1"), /Plugin-Löschung ist in 1 Plugin/);
    assert.deepEqual(calls, ["second", "first"]);
});

test("start options validate their contribution, defaults and accepted values against the schema", () => {
    const registry = new StartOptionContributionRegistry();
    const option = {
        id: "example.source",
        schema: Type.Union([Type.Literal("empty"), Type.Literal("clone")]),
        selectable: () => true,
        defaultValue: () => "empty",
        accept: (value: unknown) => value === "clone" ? "clone" : "empty",
        describe: () => ({ kind: "choice", label: "Quelle", options: [] }),
    };
    registry.register("first-plugin", [option]);

    assert.deepEqual(registry.describe(), [{ id: "example.source", owner: "first-plugin" }]);
    assert.equal(registry.entry("example.source")?.owner, "first-plugin");
    assert.equal(registry.defaultValue("example.source", { runId: "run-1" }), "empty");
    assert.equal(registry.accept("example.source", "clone", { runId: "run-1" }), "clone");
    assert.throws(() => registry.accept("example.source", "other", { runId: "run-1" }), /Ungültiger Wert für Startoption example\.source/);
    assert.throws(() => registry.accept("missing", "clone", { runId: "run-1" }), /nicht registriert/);
    assert.throws(() => registry.register("second-plugin", [option]), /bereits von first-plugin bereitgestellt/);
    assert.throws(() => registry.register("second-plugin", [{ ...option, id: "Bad Id" }]), /Ungültige Startoption-Id/);
    registry.register("second-plugin", [{ ...option, id: "example.broken", defaultValue: () => "other" }]);
    assert.throws(
        () => registry.defaultValue("example.broken", { runId: "run-1" }),
        /Ungültiger Standardwert für Startoption example\.broken/,
    );
});
