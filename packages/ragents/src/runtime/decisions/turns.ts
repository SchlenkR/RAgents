import type { JsonValue } from "../../domain/json.ts";
import type { TurnUsage } from "../../domain/model.ts";
import { event, type Decision } from "../command.ts";
import { DomainError } from "../domain-error.ts";
import { actorById, actorOf, assertSelf, clean, executableActorOf } from "../guards.ts";

const runningTurn = (state: Parameters<Decision>[0], context: Parameters<Decision>[1], actorId: string, turnId: string) => {
    assertSelf(context, actorId, "record activity");
    const target = executableActorOf(state, actorId);

    if (target.lifecycle.kind !== "running" || target.lifecycle.turnId !== turnId)
        throw new DomainError("turn-mismatch", `Turn ${turnId} is not running for actor ${actorId}.`, 409);

    actorOf(state, context);

    return target;
};

export const startTurn =
    (actorId: string, inputId: string): Decision =>
    (state, context, services) => {
        actorById(state, context.actorId);
        assertSelf(context, actorId, "start a turn");
        const target = executableActorOf(state, actorId);

        if (target.lifecycle.kind !== "idle")
            throw new DomainError("actor-not-idle", `Actor ${actorId} cannot start a turn while ${target.lifecycle.kind}.`, 409);

        const input = state.inputs.get(inputId);

        if (!input)
            throw new DomainError("input-not-found", `Input ${inputId} does not exist.`, 404);

        if (input.actorId !== actorId)
            throw new DomainError("input-not-addressed", `Input ${inputId} is not addressed to actor ${actorId}.`, 400);

        if (input.lifecycle.kind === "claimed")
            throw new DomainError("input-consumed", `Input ${inputId} was already consumed by turn ${input.lifecycle.turnId}.`, 409);

        if (input.lifecycle.kind === "discarded")
            throw new DomainError("input-discarded", `Input ${inputId} was discarded.`, 409);

        return [event(context, {
            type: "turn.started",
            payload: { turnId: services.newId("turn"), inputId },
        })];
    };

const appendText = (
    type: "model.output.completed" | "model.reasoning.completed" | "runtime.output.recorded",
    actorId: string,
    input: { turnId: string; text: string },
): Decision => (state, context) => {
    runningTurn(state, context, actorId, input.turnId);

    return [event(context, { type, payload: { turnId: input.turnId, text: clean(input.text, "text") } })];
};

export const appendModelOutput = (actorId: string, input: { turnId: string; text: string }): Decision =>
    appendText("model.output.completed", actorId, input);

export const appendModelReasoning = (actorId: string, input: { turnId: string; text: string }): Decision =>
    appendText("model.reasoning.completed", actorId, input);

export const appendRuntimeOutput = (actorId: string, input: { turnId: string; text: string }): Decision =>
    appendText("runtime.output.recorded", actorId, input);

export const startToolCall =
    (actorId: string, input: { turnId: string; toolCallId: string; name: string; input: JsonValue; ignoredFields?: string[] }): Decision =>
    (state, context) => {
        runningTurn(state, context, actorId, input.turnId);

        return [event(context, {
            type: "tool.call.started",
            payload: {
                turnId: input.turnId,
                toolCallId: clean(input.toolCallId, "toolCallId"),
                name: clean(input.name, "name"),
                input: input.input,
                ...(input.ignoredFields ? { ignoredFields: input.ignoredFields } : {}),
            },
        })];
    };

export const completeToolCall =
    (actorId: string, input: { turnId: string; toolCallId: string; name: string; output: JsonValue }): Decision =>
    (state, context) => {
        runningTurn(state, context, actorId, input.turnId);

        return [event(context, {
            type: "tool.call.completed",
            payload: {
                turnId: input.turnId,
                toolCallId: clean(input.toolCallId, "toolCallId"),
                name: clean(input.name, "name"),
                output: input.output,
            },
        })];
    };

export const recordToolCallSource =
    (actorId: string, input: { turnId: string; toolCallId: string; code: string; path: string | null }): Decision =>
    (state, context) => {
        runningTurn(state, context, actorId, input.turnId);
        const call = state.turns.get(input.turnId)?.toolCalls.find((entry) => entry.id === input.toolCallId);
        if (!call)
            throw new DomainError("tool-call-missing", `Tool call ${input.toolCallId} does not exist in turn ${input.turnId}.`, 404);
        if (call.status !== "running")
            throw new DomainError("tool-call-finished", `Tool call ${input.toolCallId} in turn ${input.turnId} is already ${call.status}.`, 409);
        return [event(context, { type: "tool.call.source", payload: input })];
    };

export const failToolCall =
    (actorId: string, input: { turnId: string; toolCallId: string; name: string; error: string }): Decision =>
    (state, context) => {
        runningTurn(state, context, actorId, input.turnId);

        return [event(context, {
            type: "tool.call.failed",
            payload: {
                turnId: input.turnId,
                toolCallId: clean(input.toolCallId, "toolCallId"),
                name: clean(input.name, "name"),
                error: clean(input.error, "error"),
            },
        })];
    };

export const finishTurn =
    (
        actorId: string,
        input: { turnId: string; usage?: TurnUsage }
            & ({ outcome: "completed" } | { outcome: "failed"; reason: string }),
    ): Decision =>
    (state, context) => {
        runningTurn(state, context, actorId, input.turnId);

        const usage = input.usage ? { usage: input.usage } : {};

        return [event(context, {
            type: "turn.finished",
            payload: input.outcome === "failed"
                ? { turnId: input.turnId, outcome: input.outcome, reason: clean(input.reason, "reason"), ...usage }
                : { turnId: input.turnId, outcome: input.outcome, ...usage },
        })];
    };

export const interruptTurn =
    (actorId: string, input: { turnId: string; reason: string }): Decision =>
    (state, context) => {
        const caller = actorById(state, context.actorId);
        const target = executableActorOf(state, actorId);

        if (caller.id !== actorId && caller.id !== state.ownerId)
            throw new DomainError("turn-interrupt-denied", `Actor ${caller.id} may not interrupt ${actorId}.`, 403);

        if (target.lifecycle.kind !== "running" || target.lifecycle.turnId !== input.turnId)
            throw new DomainError("turn-mismatch", `Turn ${input.turnId} is not running for actor ${actorId}.`, 409);

        return [event(context, {
            type: "turn.interrupted",
            payload: { turnId: input.turnId, reason: clean(input.reason, "reason") },
        })];
    };
