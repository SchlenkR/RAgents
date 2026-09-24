import type { JsonObject, JsonValue } from "../../domain/json.ts";
import { assertJsonValue } from "../../domain/json.ts";
import type { ActionInput, ActionStatus } from "../../domain/model.ts";
import { event, type Decision } from "../command.ts";
import { DomainError } from "../domain-error.ts";
import { commandActorOf, assertCapability, clean, optionalClean } from "../guards.ts";

const isBlank = (result: JsonValue | null) =>
    result === null || (typeof result === "string" && result.trim() === "");

export const proposeAction =
    (input: {
        owner?: string | null;
        title: string;
        description?: string | null;
        parameters?: Record<string, string>;
        input?: ActionInput | null;
        payload?: JsonObject | null;
    }): Decision =>
    (state, context, services) => {
        const caller = commandActorOf(state, context);
        const owner = input.owner ? clean(input.owner, "owner") : null;

        if (owner === null)
            assertCapability(caller, "action.propose", { kind: "run" });

        if (input.payload !== undefined && input.payload !== null)
            assertJsonValue(input.payload, "payload");

        return [event(context, {
            type: "action.proposed",
            payload: {
                actionId: services.newId("action"),
                owner,
                title: clean(input.title, "title"),
                description: optionalClean(input.description, "description"),
                parameters: Object.fromEntries(
                    Object.entries(input.parameters ?? {}).map(([name, value]) => [clean(name, "parameter name"), value]),
                ),
                input: input.input
                    ? {
                          label: clean(input.input.label, "input.label"),
                          placeholder: optionalClean(input.input.placeholder, "input.placeholder"),
                          required: input.input.required,
                      }
                    : null,
                payload: input.payload ?? null,
            },
        })];
    };

export const resolveAction =
    (actionId: string, input: { decision: Exclude<ActionStatus, "pending">; result?: JsonValue | null }): Decision =>
    (state, context) => {
        const caller = commandActorOf(state, context);

        if (caller.kind !== "human")
            throw new DomainError("human-confirmation-required", "Only a human can resolve a proposed action.", 403);

        const action = state.actions.get(actionId);

        if (!action)
            throw new DomainError("action-not-found", `Action ${actionId} does not exist.`, 404);

        if (action.status !== "pending")
            throw new DomainError("action-already-resolved", `Action ${actionId} is already ${action.status}.`, 409);

        const result = input.result ?? null;

        if (result !== null)
            assertJsonValue(result, "result");

        if (input.decision === "approved" && action.input?.required && isBlank(result))
            throw new DomainError("action-result-required", `Action ${actionId} requires a result.`, 400);

        return [event(context, {
            type: "action.resolved",
            payload: { actionId, decision: input.decision, result },
        })];
    };
