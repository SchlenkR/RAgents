import type { RunState } from "../../domain/model.ts";
import { event, type CommandContext, type Decision } from "../command.ts";
import { DomainError } from "../domain-error.ts";
import { clean, commandActorOf } from "../guards.ts";

export const assertStopOwner = (state: RunState, context: CommandContext) => {
    const caller = commandActorOf(state, context);
    if (caller.id !== state.ownerId)
        throw new DomainError("run-stop-denied", `${caller.displayName} may not stop the run; only its owner does.`, 403);

};

export const stopRun = (input: { reason: string; userId?: string }): Decision => (state, context) => {
    assertStopOwner(state, context);

    return [event(context, { type: "run.stopped", payload: {
        reason: clean(input.reason, "reason"),
        ...(input.userId === undefined ? {} : { userId: clean(input.userId, "userId") }),
    } })];
};
