import type { UncommittedEvent } from "../../domain/events.ts";
import type { ActorInput, RestartRecoveryOutcome, RunState } from "../../domain/model.ts";
import { viewOf } from "../../domain/projection.ts";
import { deliveredInputOf, renderedPromptFor } from "../../agents/delivery.ts";
import { event, type Decision } from "../command.ts";
import { executableActorOf, turnOf } from "../guards.ts";

export const restartGuardMs = 60_000;

export const restartInput = "The server was restarted while you were working. Check the current state before continuing: "
    + "tool results may be missing, files may have been partly written, and processes may have ended. "
    + "An interrupted tool call is reported as interrupted; its effects may still have happened. "
    + "Keep completed steps completed, do not blindly repeat them, and continue your task from the verified state.";

const recoveryReason: Record<RestartRecoveryOutcome, string> = {
    continued: "Server restarted. Continuing the interrupted task.",
    disabled: "Server restarted. Automatic continuation is disabled.",
    guarded: "Server restarted. Continuation stopped by the 60-second restart guard.",
    unsupported: "Server restarted. This actor runtime does not support automatic continuation.",
    stopped: "Server restarted. The run remains stopped.",
    unavailable: "Server restarted. The run is unavailable for continuation.",
};

export type RestartPolicy = {
    enabled?: (state: RunState) => boolean;
    available?: (runId: string) => boolean;
};

export const recoverTurn = (actorId: string, turnId: string, policy: RestartPolicy, unpresented: readonly ActorInput[]): Decision => (state, context, services) => {
    const actor = executableActorOf(state, actorId);
    const turn = turnOf(state, turnId);
    const original = state.inputs.get(turn.inputId)!;
    const wasContinuation = [...state.inputs.values()].some((input) => typeof input.origin === "object"
        && input.lifecycle.kind === "claimed" && input.lifecycle.turnId === turnId);
    const elapsed = Date.parse(turn.finishedAt ?? services.now()) - Date.parse(turn.startedAt);
    const outcome: RestartRecoveryOutcome = policy.available && !policy.available(state.id) ? "unavailable"
        : state.stopped || actor.held ? "stopped"
        : policy.enabled && !policy.enabled(state) ? "disabled"
        : actor.execution.driver.kind !== "agent" && actor.execution.driver.kind !== "script" ? "unsupported"
        : wasContinuation && elapsed < restartGuardMs ? "guarded"
        : "continued";
    const events: UncommittedEvent[] = turn.status === "running" ? [event(context, {
        type: "turn.interrupted",
        payload: { turnId, reason: "The turn was interrupted by a restart of the server.", cause: "server-stop" },
    })] : [];
    events.push(event(context, { type: "turn.restart-recovered", payload: { turnId, outcome, reason: recoveryReason[outcome] } }));
    if (outcome === "continued") {
        const view = viewOf(state);
        const content = actor.kind === "script" ? original.content : [restartInput,
            ...(unpresented.length > 0 ? ["Inputs claimed by the interrupted turn but not yet presented to the model:",
                ...unpresented.map((input) => renderedPromptFor(view, actorId, deliveredInputOf(view, input)))] : []),
        ].join("\n\n");
        events.push(event(context, {
            type: "actor.input.enqueued",
            payload: {
                inputId: services.newId("input"),
                actorId,
                origin: { kind: "restart", turnId },
                presentation: "background",
                artifactIds: actor.kind === "script" ? [...original.artifactIds] : [...new Set(unpresented.flatMap((input) => input.artifactIds))],
                ...(actor.kind === "script" && original.subscriptionId
                    ? { subscriptionId: original.subscriptionId, sourceEventIds: [...original.sourceEventIds] as [string] }
                    : { subscriptionId: null, sourceEventIds: actor.kind === "script" ? [...original.sourceEventIds] : [],
                        content }),
            },
        }));
    }
    return events;
};
