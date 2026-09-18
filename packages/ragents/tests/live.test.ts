import assert from "node:assert/strict";
import test from "node:test";

import { LiveBus, type AgentLiveListenerContext } from "../src/agents/live.ts";

test("publish isolates a throwing listener and continues delivery", () => {
    const listenerFailure = new Error("Listener failed.");
    const reports: Array<{ error: unknown; context: AgentLiveListenerContext }> = [];
    const delivered: string[] = [];
    const bus = new LiveBus({
        onListenerError: (error, context) => {
            reports.push({ error, context });
        },
    });
    bus.subscribe("run-1", "agent-1", () => {
        throw listenerFailure;
    });
    bus.subscribe("run-1", "agent-1", (event) => {
        delivered.push(event.kind);
    });

    assert.doesNotThrow(() => bus.publish("run-1", "agent-1", { kind: "turn-started", turnId: "turn-1" }));
    assert.deepEqual(delivered, ["turn-started"]);
    assert.equal(reports.length, 1);
    assert.equal(reports[0]?.error, listenerFailure);
    assert.equal(reports[0]?.context.runId, "run-1");
    assert.equal(reports[0]?.context.agentId, "agent-1");
    assert.equal(reports[0]?.context.event.kind, "turn-started");
});

test("an error handler failure cannot escape publish", () => {
    let delivered = false;
    const bus = new LiveBus({
        onListenerError: () => {
            throw new Error("Error handler failed.");
        },
    });
    bus.subscribe("run-1", "agent-1", () => {
        throw new Error("Listener failed.");
    });
    bus.subscribe("run-1", "agent-1", () => {
        delivered = true;
    });

    assert.doesNotThrow(() => bus.publish("run-1", "agent-1", { kind: "turn-finished", turnId: "turn-1", outcome: "waiting" }));
    assert.equal(delivered, true);
});

test("async listener and error handler rejections stay isolated", async () => {
    const listenerFailure = new Error("Async listener failed.");
    const reports: unknown[] = [];
    let delivered = false;
    const bus = new LiveBus({
        onListenerError: async (error) => {
            reports.push(error);
            throw new Error("Async error handler failed.");
        },
    });
    bus.subscribe("run-1", "agent-1", async () => {
        throw listenerFailure;
    });
    bus.subscribe("run-1", "agent-1", () => {
        delivered = true;
    });

    assert.doesNotThrow(() => bus.publish("run-1", "agent-1", { kind: "text", delta: "Hallo" }));
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.equal(delivered, true);
    assert.deepEqual(reports, [listenerFailure]);
});
