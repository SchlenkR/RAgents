import type { RunState } from "../../domain/model.ts";
import { event, type CommandContext, type Decision } from "../command.ts";
import { DomainError } from "../domain-error.ts";
import { clean, commandActorOf } from "../guards.ts";

const assertOwner = (state: RunState, context: CommandContext, verb: string) => {
    const caller = commandActorOf(state, context);

    if (caller.id !== state.ownerId)
        throw new DomainError("run-pause-denied", `${caller.displayName} may not ${verb} the run; only its owner does.`, 403);
};

const userOf = (userId: string | undefined) => userId === undefined ? {} : { userId: clean(userId, "userId") };

/** The caller checks that the run is not paused yet; an already paused run writes nothing. */
export const pauseRun = (input: { reason: string; userId?: string }): Decision => (state, context) => {
    assertOwner(state, context, "pause");

    return [event(context, { type: "run.paused", payload: { reason: clean(input.reason, "reason"), ...userOf(input.userId) } })];
};

export const resumeRun = (input: { trigger: "input" | "resume"; userId?: string }): Decision => (state, context) => {
    assertOwner(state, context, "resume");

    return [event(context, { type: "run.resumed", payload: { trigger: input.trigger, ...userOf(input.userId) } })];
};
