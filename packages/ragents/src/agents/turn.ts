import type { AgentActor, ExecutableActor, RunView } from "../domain/model.ts";
import type { Orchestration } from "../runtime/orchestration.ts";
import { deliveredInputOf, renderedPromptFor, type DeliveredInput } from "./delivery.ts";

export type ClaimedTurn = {
    runId: string;
    actorId: string;
    turnId: string;
    startedAt: string;
    input: DeliveredInput;
};

export const workingActorFrom = (view: RunView, actorId: string): ExecutableActor => {
    const found = view.actors.find((entry) => entry.id === actorId);

    if (!found || found.kind === "human")
        throw new Error(`Actor ${actorId} does not take turns.`);

    return found;
};

export const agentFrom = (view: RunView, actorId: string): AgentActor => {
    const found = view.actors.find((entry) => entry.id === actorId);

    if (found?.kind !== "agent")
        throw new Error(`Agent ${actorId} does not exist.`);

    return found;
};

export const promptFor = (view: RunView, actorId: string, input: DeliveredInput) =>
    renderedPromptFor(view, actorId, input);

export function claimTurn(
    runtime: Orchestration,
    runId: string,
    actorId: string,
    inputId: string,
    commandId: string,
): ClaimedTurn {
    const view = runtime.startTurn({ actorId, commandId }, runId, actorId, inputId);
    const actor = workingActorFrom(view, actorId);

    if (actor.lifecycle.kind !== "running")
        throw new Error(`Actor ${actorId} did not enter a running turn.`);

    const turnId = actor.lifecycle.turnId;
    const input = view.inputs.find((entry) => entry.id === inputId);

    if (!input || input.actorId !== actorId || input.lifecycle.kind !== "claimed" || input.lifecycle.turnId !== turnId)
        throw new Error(`Turn ${turnId} did not claim input ${inputId}.`);

    const started = view.turns.find((entry) => entry.id === turnId);

    if (!started)
        throw new Error(`Turn ${turnId} of ${actorId} is not journalled.`);

    return {
        runId,
        actorId,
        turnId: started.id,
        startedAt: started.startedAt,
        input: deliveredInputOf(view, input),
    };
}
