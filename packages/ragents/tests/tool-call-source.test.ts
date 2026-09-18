import assert from "node:assert/strict";
import test from "node:test";
import { claimTurn } from "../src/agents/turn.ts";
import { validatedEventPayloadOf } from "../src/domain/event-validation.ts";
import type { UncommittedEvent } from "../src/domain/events.ts";
import { project, viewOf } from "../src/domain/projection.ts";
import { Journal } from "../src/runtime/journal.ts";
import { postTo, setupRun, testServices } from "./support.ts";

const fixture = () => {
    const setup = setupRun();
    const queued = postTo(setup.runtime, setup.view, setup.agent.id, "input", "Evaluate a snippet.");
    const input = queued.inputs.find((entry) => entry.actorId === setup.agent.id && entry.lifecycle.kind === "pending");
    assert.ok(input);
    const turn = claimTurn(setup.runtime, setup.view.id, setup.agent.id, input.id, "turn");
    const context = (step: string) => ({ actorId: setup.agent.id, turnId: turn.turnId, commandId: step });
    const payload = { turnId: turn.turnId, toolCallId: "eval", code: '  const text = "Grüße";\r\nreturn text;\n', path: "@actors/report.ts" };
    const begin = () => setup.runtime.startToolCall(context("started"), setup.view.id, setup.agent.id, {
        turnId: turn.turnId, toolCallId: "eval", name: "typescript_eval", input: { path: payload.path },
    });
    const record = (step: string) => setup.runtime.recordToolCallSource(context(step), setup.view.id, setup.agent.id, payload);
    const source = (): UncommittedEvent => ({ type: "tool.call.source", actorId: setup.agent.id, correlationId: turn.turnId, causationId: null, payload });
    return { ...setup, turn, context, payload, begin, record, source };
};

test("source snapshots preserve exact code and remain in the journal after failure and replay", () => {
    const run = fixture();
    const target = new Journal(":memory:", testServices());
    try {
        run.begin();
        run.record("source");
        run.runtime.failToolCall(run.context("failed"), run.view.id, run.agent.id, {
            turnId: run.turn.turnId, toolCallId: "eval", name: "typescript_eval", error: "Compilation failed.",
        });
        const snapshot = run.runtime.events(run.view.id).find((entry) => entry.type === "tool.call.source");
        assert.deepEqual(snapshot?.payload, run.payload);
        assert.equal(snapshot?.actorId, run.agent.id);
        assert.equal(run.runtime.view(run.view.id).turns[0]?.toolCalls[0]?.status, "failed");
        assert.equal(JSON.stringify(run.runtime.view(run.view.id).turns).includes("Grüße"), false);
        target.adopt(JSON.parse(JSON.stringify(run.journal.records(run.view.id))));
        assert.deepEqual(target.load(run.view.id).find((entry) => entry.type === "tool.call.source")?.payload, run.payload);
        const replay = project(target.load(run.view.id));
        assert.ok(replay);
        assert.deepEqual(viewOf(replay).turns, run.runtime.view(run.view.id).turns);
    } finally { target.close(); run.journal.close(); }
});

test("only the owning running turn can attach one snapshot to its active call", () => {
    const run = fixture();
    try {
        assert.throws(() => run.record("before-start"), /does not exist/);
        run.begin();
        const revision = run.runtime.view(run.view.id).revision;
        const foreign = { ...run.source(), actorId: run.view.ownerId };
        assert.throws(() => run.journal.append(run.view.id, {
            id: "foreign-source", type: "test.source", actorId: run.view.ownerId, requestHash: "foreign",
        }, [foreign]), /does not own turn/);
        assert.equal(run.runtime.view(run.view.id).revision, revision);
        run.record("source");
        run.record("source");
        assert.equal(run.runtime.events(run.view.id).filter((entry) => entry.type === "tool.call.source").length, 1);
        assert.throws(() => run.record("second-source"), /already has a source snapshot/);
        run.runtime.completeToolCall(run.context("completed"), run.view.id, run.agent.id, {
            turnId: run.turn.turnId, toolCallId: "eval", name: "typescript_eval", output: null,
        });
        assert.throws(() => run.record("after-completion"), /already completed/);
        run.runtime.finishTurn(run.context("finished"), run.view.id, run.agent.id, { turnId: run.turn.turnId, outcome: "completed" });
        assert.throws(() => run.record("after-turn"), /is not running/);
    } finally { run.journal.close(); }
});

test("journal validation rejects source snapshots without a call or after its completion", () => {
    const run = fixture();
    try {
        const command = { id: "source", type: "test.source", actorId: run.agent.id, requestHash: "source" };
        assert.throws(() => run.journal.append(run.view.id, command, [run.source()]), /does not exist/);
        run.begin();
        run.runtime.completeToolCall(run.context("completed"), run.view.id, run.agent.id, {
            turnId: run.turn.turnId, toolCallId: "eval", name: "typescript_eval", output: null,
        });
        assert.throws(() => run.journal.append(run.view.id, command, [run.source()]), /already completed/);
    } finally { run.journal.close(); }
});

test("a rejected journal batch does not reserve the source snapshot", () => {
    const run = fixture();
    try {
        run.begin();
        const revision = run.runtime.view(run.view.id).revision;
        assert.throws(() => run.journal.append(run.view.id, {
            id: "invalid-batch", type: "test.source", actorId: run.agent.id, requestHash: "batch",
        }, [run.source(), {
            type: "tool.call.failed", actorId: run.agent.id, correlationId: run.turn.turnId, causationId: null,
            payload: { turnId: run.turn.turnId, toolCallId: "missing", name: "typescript_eval", error: "Invalid reference." },
        }]), /does not exist/);
        assert.equal(run.runtime.view(run.view.id).revision, revision);
        run.record("valid-source");
        assert.equal(run.runtime.events(run.view.id).filter((entry) => entry.type === "tool.call.source").length, 1);
    } finally { run.journal.close(); }
});

test("source payload validation requires literal code and a nullable path", () => {
    const valid = { turnId: "turn", toolCallId: "call", code: "", path: null };
    assert.deepEqual(validatedEventPayloadOf("tool.call.source", valid, "source"), valid);
    for (const invalid of [{ ...valid, code: 3 }, { ...valid, path: [] }, { ...valid, path: undefined }, { ...valid, extra: true }])
        assert.throws(() => validatedEventPayloadOf("tool.call.source", invalid, "source"), /must be|not supported/);
});
