import { createHash } from "node:crypto";

import type { UncommittedEvent } from "../domain/events.ts";
import type { RunState } from "../domain/model.ts";
import { canonicalJson } from "./canonical-json.ts";
import type { JournalCommand } from "./journal.ts";
import type { RuntimeServices } from "./services.ts";

export type CommandContext = {
    commandId: string;
    actorId: string;
    turnId?: string;
    correlationId?: string;
    causationId?: string;
};

export type Decision = (state: RunState, context: CommandContext, services: RuntimeServices) => UncommittedEvent[];

export const event = <Event extends UncommittedEvent>(
    context: CommandContext,
    value: Omit<Event, "actorId" | "correlationId" | "causationId">,
) =>
    ({
        ...value,
        actorId: context.actorId,
        correlationId: context.correlationId ?? context.turnId ?? null,
        causationId: context.causationId ?? null,
    }) as Event;

export const journalCommand = (id: string, type: string, actorId: string, input: unknown): JournalCommand => ({
    id,
    type,
    actorId,
    requestHash: createHash("sha256").update(canonicalJson(input)).digest("hex"),
});
