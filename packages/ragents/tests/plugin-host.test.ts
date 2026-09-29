import assert from "node:assert/strict";
import test from "node:test";
import { Type } from "typebox";

import {
    AccessProjectionRegistry,
    AgentContributionRegistry,
    LifecycleContributionRegistry,
    OperationContributionRegistry,
    PluginHost,
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
    assert.equal(await operations.invoke("example.echo", operationContext("operator"), { value: "Hello" }), "Hello");
    await assert.rejects(
        operations.invoke("example.echo", operationContext("operator"), { value: 42 }),
        /Invalid input/,
    );
    assert.throws(() => operations.register("second-plugin", [{
        id: "example.echo",
        label: "Echo again",
        description: "Conflicting operation.",
        schema: Type.Object({}),
        resultSchema: Type.Unknown(),
        operator: "direct",
        execute: () => null,
    }]), /already provided by first-plugin/);
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
        /requires a confirmation bound to this call/,
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
        /requires a confirmation bound to this call/,
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
        /requires a confirmation bound to this call/,
    );
    await assert.rejects(
        operations.invoke(
            "example.internal",
            operationContext("operator", { operationId: "example.internal", input: {} }),
            {},
        ),
        /not available to the operator/,
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
        /Invalid result of operation example\.invalid-result: ok must be boolean, got "not-a-boolean"/,
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

    await assert.rejects(lifecycle.stopSession("run-1"), /Plugin stop failed in 1 plugin/);
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
    await assert.rejects(final.bounded, /Plugin stop/);
    assert.equal(signal?.aborted, true);
    assert.throws(final.release, /before all contributions have ended/);
    const repeated = lifecycle.beginAfterStopSession("run-1");
    await assert.rejects(repeated.bounded, /Plugin stop/);
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
            assert.match(String(error.errors[0]), /hanging\.lifecycle.*timeout of 20 ms/);
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
        assert.match(String(error.errors[0]), /late\.lifecycle.*timeout of 20 ms/);
        return true;
    };

    const first = lifecycle.beginStopSession("run-1");
    let actuallySettled = false;
    void first.settled.then(() => { actuallySettled = true; });
    await assert.rejects(first.bounded, isTimeout);
    assert.equal(actuallySettled, false);
    assert.deepEqual(mutations, []);
    assert.throws(first.release, /before all contributions have ended/);

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
            && error.errors.some((entry) => /timeout of 20 ms/.test(String(entry))),
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
            && error.errors.some((entry) => /timeout of 20 ms/.test(String(entry))),
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

    await assert.rejects(lifecycle.deleteSession("run-1"), /Plugin deletion failed in 1 plugin/);
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
        describe: () => ({ kind: "choice", label: "Source", options: [] }),
    };
    registry.register("first-plugin", [option]);

    assert.deepEqual(registry.describe(), [{ id: "example.source", owner: "first-plugin" }]);
    assert.equal(registry.entry("example.source")?.owner, "first-plugin");
    assert.equal(registry.defaultValue("example.source", { runId: "run-1", userId: null }), "empty");
    assert.equal(registry.accept("example.source", "clone", { runId: "run-1", userId: null }), "clone");
    assert.throws(() => registry.accept("example.source", "other", { runId: "run-1", userId: null }), /Invalid value for start option example\.source: value got "other", allowed values: empty, clone/);
    assert.throws(() => registry.accept("missing", "clone", { runId: "run-1", userId: null }), /is not registered/);
    assert.throws(() => registry.register("second-plugin", [option]), /already provided by first-plugin/);
    assert.throws(() => registry.register("second-plugin", [{ ...option, id: "Bad Id" }]), /Invalid start option id/);
    assert.throws(() => registry.register("second-plugin", [{ ...option, id: "example.owner", ownerOnly: true as never }]), /invalid ownerOnly/);
    assert.throws(() => registry.register("second-plugin", [{ ...option, id: "example.rights", rights: ["Runs Inspect"] }]), /invalid rights/);
    assert.throws(() => registry.register("second-plugin", [{ ...option, id: "example.changeable", changeable: "yes" as never }]), /invalid changeable/);
    registry.register("second-plugin", [{ ...option, id: "example.technical", rights: ["runs.inspect"] }]);
    const inspecting = { can: (right: string) => right === "runs.inspect" };
    const plain = { can: () => false };
    assert.equal(registry.missingRight("example.technical", plain), "runs.inspect");
    assert.equal(registry.missingRight("example.technical", inspecting), undefined);
    assert.equal(registry.missingRight("example.source", plain), undefined, "without rights the rights of the method suffice");
    assert.throws(() => registry.assertRights("example.technical", plain), /The right runs\.inspect is missing for the start option example\.technical/);
    registry.register("second-plugin", [{ ...option, id: "example.broken", defaultValue: () => "other" }]);
    assert.throws(
        () => registry.defaultValue("example.broken", { runId: "run-1", userId: null }),
        /Invalid default value for start option example\.broken/,
    );
});

test("access projections apply per state id to viewers without runs.inspect; start options with rights hide their value first", () => {
    const options = new StartOptionContributionRegistry();
    const open = {
        id: "example.open",
        schema: Type.String(),
        selectable: () => true,
        defaultValue: () => "value",
        accept: (value: unknown) => String(value),
        describe: () => ({ kind: "text" }),
    };
    options.register("example.product", [open, { ...open, id: "example.technical", rights: ["runs.inspect"] }]);
    const registry = new AccessProjectionRegistry(options);
    registry.register("example.board", [{
        id: "example.board",
        state: (entry) => ({ title: (entry.state as { title: string }).title, at: entry.updatedAt }),
        chatEvent: (event) => event.type === "state-replaced" ? { type: event.type, payload: { title: "Board" } } : undefined,
    }]);
    assert.throws(() => registry.register("example.other", [{ id: "example.board", state: () => null, chatEvent: () => undefined }]), /Access projection example\.board is already provided by example\.board/);
    assert.throws(() => registry.register("example.other", [{ id: "example.broken", state: () => null } as never]), /Access projection example\.broken has no chatEvent/);

    const plain = { can: (right: string) => right === "runs.read" };
    const inspecting = { can: () => true };
    const entry = (pluginId: string, state: { title: string; secret?: string }) => ({ pluginId, scope: { kind: "run" as const }, state, updatedAt: "now" });
    const board = entry("example.board", { title: "Board", secret: "hidden" });
    assert.deepEqual(registry.state(board, plain), { ...board, state: { title: "Board", at: "now" } });
    assert.equal(registry.state(board, inspecting), board);
    assert.equal(registry.state(entry("example.technical", { title: "hidden" }), plain), undefined);
    const visible = entry("example.open", { title: "open" });
    assert.equal(registry.state(visible, plain), visible);
    const unknown = entry("example.unknown", { title: "Unknown", secret: "kept" });
    assert.equal(registry.state(unknown, plain), unknown, "without a projection the state stays");

    const chat = { kind: "plugin" as const, pluginId: "example.board", type: "state-replaced", payload: { state: { secret: "hidden" } }, at: "now" };
    assert.deepEqual(registry.chatEvent("example.board", chat, plain), { ...chat, payload: { title: "Board" } });
    assert.equal(registry.chatEvent("example.board", { ...chat, type: "custom" }, plain), undefined);
    assert.equal(registry.chatEvent("example.board", chat, inspecting), chat);
    assert.equal(registry.chatEvent("example.technical", { ...chat, pluginId: "example.technical" }, plain), undefined);
    const other = { ...chat, pluginId: "example.unknown" };
    assert.equal(registry.chatEvent("example.unknown", other, plain), other);
});

test("agent hooks reach the driver bound to their agent: they keep data, add notes and replace tool results", async () => {
    const registry = new AgentContributionRegistry();
    assert.throws(() => registry.register("test.plugin", [{ id: "test.empty" }]), /has no hook/);
    const seen: unknown[] = [];
    registry.register("test.plugin", [{
        id: "test.hooks",
        beforeModelCall: (agent, call) => {
            seen.push({ agent: agent.agentId, kept: call.kept, images: call.modelReadsImages });
            call.keep({ count: typeof call.kept === "number" ? call.kept + 1 : 1 });
            return agent.agentId === "quiet" ? undefined : "Note";
        },
        afterToolCall: (_agent, outcome, call) => outcome.toolName === "shot" && call.modelReadsImages
            ? { content: [{ type: "image", data: "AA==", mimeType: "image/png" }], isError: false }
            : undefined,
    }]);
    assert.deepEqual(registry.describe(), [{
        id: "test.hooks", owner: "test.plugin", kind: "plugin", factories: [{ name: "test.hooks", scope: "per-agent" }], resolvesPerAgent: true,
    }]);
    const kept: unknown[] = [];
    const hookOf = (agentId: string) => {
        const [hook] = registry.resolve({ runId: "run-1", agentId, audience: "agent", workspace: "/unused" });
        assert.ok(hook);
        assert.equal(hook.id, "test.hooks");
        return hook;
    };
    const loud = hookOf("loud");
    const call = (modelReadsImages: boolean) => ({ signal: undefined, modelReadsImages, kept: 3, keep: (value: unknown) => { kept.push(value); } });
    assert.equal(await loud.beforeModelCall!(call(true)), "Note");
    assert.deepEqual(kept, [{ count: 4 }]);
    assert.deepEqual(await loud.afterToolCall!({ toolName: "shot", isError: false }, { signal: undefined, modelReadsImages: true }), {
        content: [{ type: "image", data: "AA==", mimeType: "image/png" }], isError: false,
    });
    assert.equal(await loud.afterToolCall!({ toolName: "read", isError: false }, { signal: undefined, modelReadsImages: true }), undefined);
    assert.equal(await hookOf("quiet").beforeModelCall!(call(false)), undefined);
    assert.deepEqual(seen, [{ agent: "loud", kept: 3, images: true }, { agent: "quiet", kept: 3, images: false }]);
});

test("a run condition takes prompts, skills and agent hooks of its plugin out of the runs it does not apply to", async () => {
    const host = new PluginHost({
        product: { id: "test", title: "Test" },
        dataDirectory: "/private/tmp/ragents-run-condition",
        storageModes: { sessionsRoot: 0o700, session: 0o700 },
    });
    const contribute = (id: string, condition?: (runId: string) => boolean) => host.register({
        manifest: { id },
        register: (registration) => {
            registration.prompts(
                { id: `${id}.prompt`, order: 1, render: () => `Text of ${id}.` },
                { id: `${id}.per-run`, order: 2, render: () => "Default.", renderForRun: (runId) => runId === "own-text" ? `Own text of ${id}.` : undefined },
            );
            registration.skills({ id: `${id}.skills`, paths: () => [`/skills/${id}`] });
            registration.agentRuntime({ id: `${id}.hook`, beforeModelCall: () => undefined });
            if (condition) registration.runCondition(condition);
        },
    });
    contribute("test.open");
    contribute("test.gated", (runId) => {
        if (runId === "broken") throw new Error("The condition is not determined for this run.");
        return runId !== "foreign";
    });
    assert.throws(
        () => host.register({ manifest: { id: "test.twice" }, register: (registration) => {
            registration.runCondition(() => true);
            registration.runCondition(() => false);
        } }),
        /Plugin test\.twice already has a run condition/,
    );
    const agent = (runId: string) => ({ runId, agentId: "agent", audience: "agent" as const, workspace: "/unused" });

    assert.deepEqual(Object.fromEntries(host.prompts.runOverrides("own-text")), {
        "test.open.per-run": "Own text of test.open.",
        "test.gated.per-run": "Own text of test.gated.",
    });
    assert.deepEqual(Object.fromEntries(host.prompts.runOverrides("foreign")), {
        "test.gated.prompt": "",
        "test.gated.per-run": "",
    });
    assert.deepEqual(await host.skills.resolve(agent("own")), ["/skills/test.open", "/skills/test.gated"]);
    assert.deepEqual(await host.skills.resolve(agent("foreign")), ["/skills/test.open"]);
    assert.deepEqual(await host.skills.global(), ["/skills/test.open", "/skills/test.gated"]);
    assert.deepEqual(host.agentRuntime.resolve(agent("own")).map((hook) => hook.id), ["test.open.hook", "test.gated.hook"]);
    assert.deepEqual(host.agentRuntime.resolve(agent("foreign")).map((hook) => hook.id), ["test.open.hook"]);
    assert.throws(() => host.prompts.runOverrides("broken"), /not determined/);
});
