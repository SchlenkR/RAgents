import type { Actor, ExecutableActor, RunView } from "../domain/model.ts";
import { isActiveActor } from "../domain/projection.ts";
import type { TurnInterruption } from "../agents/scheduler.ts";
import { throwFailures } from "./failures.ts";
import type { Orchestration } from "./orchestration.ts";

export type RunStopCommand = {
    commandId: string;
    reason: string;
    userId?: string;
    correlationId?: string;
    causationId?: string;
};

export type RunStopOperation = (runId: string, input: RunStopCommand) => Promise<RunView>;

export type RunStopBoundary = (runId: string) => void | Promise<void>;

export type RunStopperOptions = {
    runtime: Orchestration;
    interruptTurns: (runId: string, interruption: TurnInterruption) => Promise<void>;
    stopExternal?: RunStopBoundary;
};

export const descendantsOf = (view: { readonly actors: Iterable<Actor> }, rootId: string): ExecutableActor[] => {
    const working = [...view.actors].filter((entry): entry is ExecutableActor => entry.kind !== "human");
    const reached = new Set([rootId]);
    const frontier = [rootId];
    const found: ExecutableActor[] = [];

    for (const creatorId of frontier) {
        for (const actor of working) {
            if (actor.createdBy !== creatorId || reached.has(actor.id))
                continue;

            reached.add(actor.id);
            frontier.push(actor.id);

            if (isActiveActor(actor))
                found.push(actor);
        }
    }

    return found;
};

export class RunStopper {
    readonly #options: RunStopperOptions;
    readonly #active = new Map<string, Promise<RunView>>();

    constructor(options: RunStopperOptions) {
        this.#options = options;
    }

    stop: RunStopOperation = (runId, input) => {
        const running = this.#active.get(runId);
        if (running)
            return running;

        const operation = this.#stop(runId, input);
        this.#active.set(runId, operation);
        void operation.then(
            () => {
                if (this.#active.get(runId) === operation)
                    this.#active.delete(runId);
            },
            () => {
                if (this.#active.get(runId) === operation)
                    this.#active.delete(runId);
            },
        );
        return operation;
    };

    async #stop(runId: string, input: RunStopCommand): Promise<RunView> {
        const { runtime } = this.#options;
        const context = {
            commandId: input.commandId,
            actorId: runtime.view(runId).ownerId,
            ...(input.correlationId ? { correlationId: input.correlationId } : {}),
            ...(input.causationId ? { causationId: input.causationId } : {}),
        };
        runtime.stopRun(context, runId, { reason: input.reason, ...(input.userId === undefined ? {} : { userId: input.userId }) });
        const results = await Promise.allSettled([
            Promise.resolve().then(() => this.#options.interruptTurns(runId, { context, reason: input.reason })),
            ...(this.#options.stopExternal ? [Promise.resolve().then(() => this.#options.stopExternal!(runId))] : []),
        ]);
        throwFailures(results.flatMap((result) => result.status === "rejected" ? [result.reason] : []), `The run ${runId} could not be stopped completely.`);

        return runtime.view(runId);
    }
}
