import type { Actor, ExecutableActor, RunView } from "../domain/model.ts";
import { isActiveActor } from "../domain/projection.ts";
import { canonicalHash } from "./canonical-hash.ts";
import type { CommandContext } from "./command.ts";
import { throwFailures } from "./failures.ts";
import type { Orchestration } from "./orchestration.ts";

export type RunStopCommand = {
    commandId: string;
    reason: string;
    correlationId?: string;
    causationId?: string;
};

export type RunStopOperation = (runId: string, input: RunStopCommand) => Promise<RunView>;

export type RunStopJournal = (cleanupSettled: Promise<void>) => Promise<void>;

export type RunStopBoundary = (
    runId: string,
    stopJournal: RunStopJournal,
) => void | Promise<void>;

export type RunStopperOptions = {
    runtime: Orchestration;
    primaryActorId?: (view: RunView) => string | null | undefined;
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
        const initial = runtime.view(runId);
        const primaryActorId = this.#options.primaryActorId?.(initial) ?? initial.primaryActorId;
        const context = (step: string): CommandContext => ({
            commandId: `${input.commandId}:${step}`,
            actorId: initial.ownerId,
            ...(input.correlationId ? { correlationId: input.correlationId } : {}),
            ...(input.causationId ? { causationId: input.causationId } : {}),
        });
        const journalOperations: Promise<void>[] = [];
        let journalPass = 0;
        const stopJournal: RunStopJournal = (cleanupSettled) => {
            const pass = ++journalPass;
            const operation = this.#stopJournal(
                runId,
                initial.ownerId,
                primaryActorId,
                input.reason,
                (step) => context(`pass:${pass}:${step}`),
                cleanupSettled,
            );
            journalOperations.push(operation);

            return operation;
        };
        let boundaryFailure: unknown | null = null;

        if (this.#options.stopExternal) {
            try {
                await this.#options.stopExternal(runId, stopJournal);
            } catch (error) {
                boundaryFailure = error;
            }
        }

        if (journalOperations.length === 0)
            stopJournal(Promise.resolve());

        const journalResults = await Promise.allSettled([...journalOperations]);
        const journalFailures = journalResults
            .filter((result): result is PromiseRejectedResult => result.status === "rejected")
            .map((result) => result.reason);
        throwFailures([boundaryFailure, ...journalFailures].filter((failure) => failure !== null), `Der Run ${runId} konnte nicht vollständig gestoppt werden.`);

        return runtime.view(runId);
    }

    async #stopJournal(
        runId: string,
        ownerId: string,
        primaryActorId: string | null | undefined,
        reason: string,
        context: (step: string) => CommandContext,
        cleanupSettled: Promise<void>,
    ) {
        const failures: unknown[] = [];
        const stopOwnedActors = (step: string) => {
            const lineage = descendantsOf(this.#options.runtime.view(runId), ownerId).filter((actor) => actor.id !== primaryActorId);

            if (lineage.length === 0)
                return;

            const actorIds = lineage.map((actor) => actor.id);

            try {
                // The actors name the command, so a repeated stop with the same ID reaches actors created since.
                this.#options.runtime.stopActors(context(`${step}:${canonicalHash(actorIds).slice(0, 16)}`), runId, actorIds, reason);
            } catch (error: unknown) {
                failures.push(error);
            }
        };

        stopOwnedActors("before-cleanup");
        const cleanupResult = await Promise.allSettled([cleanupSettled]);
        if (cleanupResult[0]?.status === "rejected")
            failures.push(cleanupResult[0].reason);

        stopOwnedActors("after-cleanup");
        throwFailures(failures, `Der Run ${runId} konnte nicht vollständig gestoppt werden.`);
    }
}
