import type { ActionInput, ActionKind, ActionStatus } from "../../domain/model.ts";
import { event, type Decision } from "../command.ts";
import { DomainError } from "../domain-error.ts";
import { actorOf, assertCapability, clean, optionalClean } from "../guards.ts";

export const proposeAction =
    (input: {
        kind?: ActionKind;
        question?: { options: readonly string[]; multi?: boolean } | null;
        title: string;
        description?: string | null;
        parameters?: Record<string, string>;
        input?: ActionInput | null;
    }): Decision =>
    (state, context, services) => {
        const caller = actorOf(state, context);
        const kind = input.kind ?? "action";

        if (kind !== "question")
            assertCapability(caller, "action.propose", { kind: "run" });

        const base = {
            actionId: services.newId("action"),
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
        };

        return [event(context, {
            type: "action.proposed",
            payload: kind === "question"
                ? {
                    ...base,
                    kind,
                    question: input.question
                        ? { options: [...input.question.options], multi: input.question.multi === true }
                        : null,
                }
                : { ...base, kind },
        })];
    };

export const resolveAction =
    (actionId: string, input: { decision: Exclude<ActionStatus, "pending">; response?: string | null }): Decision =>
    (state, context) => {
        const caller = actorOf(state, context);

        if (caller.kind !== "human")
            throw new DomainError("human-confirmation-required", "Only a human can resolve a proposed action.", 403);

        const action = state.actions.get(actionId);

        if (!action)
            throw new DomainError("action-not-found", `Action ${actionId} does not exist.`, 404);

        if (action.status !== "pending")
            throw new DomainError("action-already-resolved", `Action ${actionId} is already ${action.status}.`, 409);

        const response = optionalClean(input.response, "response");

        if (input.decision === "approved" && action.input?.required && !response)
            throw new DomainError("action-response-required", `Action ${actionId} requires a response.`, 400);

        return [event(context, {
            type: "action.resolved",
            payload: { actionId, decision: input.decision, response },
        })];
    };
