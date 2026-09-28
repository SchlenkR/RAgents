import {
    contextMessages,
    latestCompaction,
    type AgentMessage,
    type ContextLogEntry,
} from "@ragents/agent";
import type { AssistantMessage, ImageContent, TextContent, ToolResultMessage, UserContent, UserMessage } from "@ragents/ai";

import type { EventPayloads, JournalEvent, ModelInputContent, ModelToolResultPart } from "../domain/events.ts";
import type { JsonValue } from "../domain/json.ts";
import { pluginStateKey } from "../domain/model.ts";
import { derivedToolResultText } from "../domain/tool-result-text.ts";
import type { ModelContextRecord, TurnRequest } from "../drivers/types.ts";
import type { Orchestration } from "../runtime/orchestration.ts";
import type { ClaimedTurn } from "./turn.ts";

/** Reads the bytes behind a stored media hash as Base64. */
export type MediaSource = (hash: string) => string;

/** The model context of one actor, projected from the journal; `key` changes with every compaction. */
export type ModelContext = {
    readonly entries: readonly ContextLogEntry[];
    readonly messages: readonly AgentMessage[];
    readonly key: string;
};

type ToolEvent = Extract<JournalEvent, { type: "tool.call.completed" | "tool.call.failed" }>;

const timeOf = (event: JournalEvent) => Date.parse(event.occurredAt);

const userContentOf = (content: ModelInputContent, media: MediaSource): string | UserContent[] =>
    typeof content === "string"
        ? content
        : content.map((part): UserContent => {
            if (part.type === "text") return part;
            if (part.type === "file") return { type: "file", data: media(part.hash), mimeType: part.mimeType, filename: part.filename };
            return { type: part.type, data: media(part.hash), mimeType: part.mimeType };
        });

const toolResultContentOf = (content: readonly ModelToolResultPart[], media: MediaSource): (TextContent | ImageContent)[] =>
    content.map((part) => part.type === "text" ? part : { type: "image", data: media(part.hash), mimeType: part.mimeType });

const assistantMessageOf = (
    event: Extract<JournalEvent, { type: "model.step.completed" }>,
    observed: readonly JournalEvent[],
): AssistantMessage => {
    const texts = observed.filter((entry) => entry.type === "model.output.completed").map((entry) => entry.payload.text as string);
    const thoughts = observed.filter((entry) => entry.type === "model.reasoning.completed").map((entry) => entry.payload.text as string);
    const next = (queue: string[], kind: string) => {
        const value = queue.shift();

        if (value === undefined)
            throw new Error(`Model step ${event.eventId} misses the ${kind} of one of its blocks in its command.`);

        return value;
    };
    const { turnId: _turnId, content, ...step } = event.payload;
    const message: AssistantMessage = {
        role: "assistant",
        ...step,
        content: content.map((block) => {
            if (block.type === "text")
                return block.text === undefined ? { ...block, text: next(texts, "text") } : { ...block, text: block.text };

            if (block.type === "thinking")
                return block.thinking === undefined ? { ...block, thinking: next(thoughts, "reasoning") } : { ...block, thinking: block.thinking };

            return block;
        }),
    } as unknown as AssistantMessage;

    if (texts.length > 0 || thoughts.length > 0)
        throw new Error(`Model step ${event.eventId} has observation events that none of its blocks takes.`);

    return message;
};

/** The context log of one actor from its own events, built event by event. */
class OwnContextLog {
    readonly entries: ContextLogEntry[] = [];
    readonly #actorId: string;
    readonly #media: MediaSource;
    readonly #toolResults = new Map<string, ToolEvent>();
    readonly #observedByCommand = new Map<string, JournalEvent[]>();

    constructor(actorId: string, media: MediaSource) {
        this.#actorId = actorId;
        this.#media = media;
    }

    /** Takes one event of the run; true when the context of the actor changed. */
    apply(event: JournalEvent): boolean {
        if (event.actorId !== this.#actorId)
            return false;

        switch (event.type) {
            case "tool.call.completed":
            case "tool.call.failed":
                this.#toolResults.set(`${event.payload.turnId}\0${event.payload.toolCallId}`, event);
                return false;

            case "model.output.completed":
            case "model.reasoning.completed":
                this.#observedByCommand.set(event.commandId, [...(this.#observedByCommand.get(event.commandId) ?? []), event]);
                return false;

            case "model.input.presented": {
                const message: UserMessage = { role: "user", content: userContentOf(event.payload.content, this.#media), timestamp: timeOf(event) };
                this.entries.push({ kind: "message", id: event.eventId, message });
                return true;
            }

            case "model.step.completed":
                this.entries.push({ kind: "message", id: event.eventId, message: assistantMessageOf(event, this.#observedByCommand.get(event.commandId) ?? []) });
                this.#observedByCommand.delete(event.commandId);
                return true;

            case "model.tool-result.presented": {
                const key = `${event.payload.turnId}\0${event.payload.toolCallId}`;
                this.entries.push({ kind: "message", id: event.eventId, message: toolResultMessageOf(event, this.#toolResults, this.#media) });
                this.#toolResults.delete(key);
                return true;
            }

            case "context.compacted":
                this.entries.push({
                    kind: "compaction",
                    id: event.eventId,
                    summary: event.payload.summary,
                    firstKeptId: event.payload.firstKeptEventId,
                    tokensBefore: event.payload.tokensBefore,
                    timestamp: timeOf(event),
                    readFiles: [...event.payload.readFiles],
                    modifiedFiles: [...event.payload.modifiedFiles],
                });
                return true;

            default:
                return false;
        }
    }
}

const ownEntries = (events: readonly JournalEvent[], actorId: string, media: MediaSource): ContextLogEntry[] => {
    const log = new OwnContextLog(actorId, media);

    for (const event of events)
        log.apply(event);

    return log.entries;
};

const toolResultMessageOf = (
    event: Extract<JournalEvent, { type: "model.tool-result.presented" }>,
    toolResults: ReadonlyMap<string, ToolEvent>,
    media: MediaSource,
): ToolResultMessage => {
    const payload: EventPayloads["model.tool-result.presented"] = event.payload;
    let content: (TextContent | ImageContent)[];

    if (payload.content) {
        content = toolResultContentOf(payload.content, media);
    } else {
        const result = toolResults.get(`${payload.turnId}\0${payload.toolCallId}`);

        if (!result)
            throw new Error(`Tool result ${event.eventId} names call ${payload.toolCallId}, which has no recorded result.`);

        content = [{ type: "text", text: derivedToolResultText(result) }];
    }

    return {
        role: "toolResult",
        toolCallId: payload.toolCallId,
        toolName: payload.toolName,
        content,
        isError: payload.isError,
        timestamp: timeOf(event),
    };
};

/** Where a fork cuts its source: before the source's turn that was still running at the spawn, else at the spawn. */
const forkCut = (events: readonly JournalEvent[], source: string, spawnSequence: number): number => {
    const running = new Map<string, number>();

    for (const event of events) {
        if (event.sequence >= spawnSequence)
            break;

        if (event.type === "turn.started" && event.actorId === source)
            running.set(event.payload.turnId, event.sequence);
        else if (event.type === "turn.finished" || event.type === "turn.interrupted")
            running.delete(event.payload.turnId);
    }

    return Math.min(spawnSequence, ...running.values());
};

/** What a fork took over from its source: an unchanged copy of the context of the source's finished turns. */
const inheritedEntries = (events: readonly JournalEvent[], actorId: string, media: MediaSource): ContextLogEntry[] => {
    const spawn = events.find((event): event is Extract<JournalEvent, { type: "agent.spawned" }> =>
        event.type === "agent.spawned" && event.payload.agentId === actorId);
    const source = spawn?.payload.forkOf;

    if (!source)
        return [];

    const cut = forkCut(events, source, spawn.sequence);
    const inherited = modelContextLog(events.filter((event) => event.sequence < cut), source, media);

    if (inherited.length === 0)
        throw new Error(`Fork source ${source} had no model context from a finished turn at the spawn.`);

    return inherited;
};

/** The context log of an actor, including the part a fork took over from its source at its spawn. */
export const modelContextLog = (events: readonly JournalEvent[], actorId: string, media: MediaSource): ContextLogEntry[] =>
    [...inheritedEntries(events, actorId, media), ...ownEntries(events, actorId, media)];

const contextOf = (entries: ContextLogEntry[], conversation: string): ModelContext => ({
    entries,
    messages: contextMessages(entries),
    key: `${conversation}:${latestCompaction(entries)?.id ?? ""}`,
});

/** The model context of an actor as a pure projection of the journal; no rendering, only stored forms. */
export const modelContextOf = (events: readonly JournalEvent[], actorId: string, media: MediaSource): ModelContext =>
    contextOf(modelContextLog(events, actorId, media), events.find((event) => event.type === "run.created")?.eventId ?? "");

const deepFreeze = <T>(value: T): T => {
    if (value === null || typeof value !== "object" || Object.isFrozen(value))
        return value;

    for (const entry of Object.values(value))
        deepFreeze(entry);

    return Object.freeze(value);
};

/** The events of a run as the journal holds them; the sequence counts from 1 without gaps. */
export type ModelContextSource = {
    eventsSince: (runId: string, sequence: number) => readonly JournalEvent[];
    firstEventId: (runId: string) => string | undefined;
    media: MediaSource;
};

type CachedContext = {
    conversation: string;
    sequence: number;
    inherited: ContextLogEntry[];
    own: OwnContextLog;
    context: ModelContext | null;
};

/** The model contexts of actors in a turn, extended by new events only; always equal to `modelContextOf` over the journal. */
export class ModelContexts {
    readonly #source: ModelContextSource;
    readonly #runs = new Map<string, Map<string, CachedContext>>();

    constructor(source: ModelContextSource) {
        this.#source = source;
    }

    contextOf(runId: string, actorId: string): ModelContext {
        const actors = this.#runs.get(runId) ?? new Map<string, CachedContext>();
        const conversation = this.#source.firstEventId(runId) ?? "";
        let cached = actors.get(actorId);

        if (!cached || cached.conversation !== conversation) {
            const events = this.#source.eventsSince(runId, 0);
            cached = {
                conversation,
                sequence: 0,
                inherited: deepFreeze(inheritedEntries(events, actorId, this.#source.media)),
                own: new OwnContextLog(actorId, this.#source.media),
                context: null,
            };
            this.#extend(cached, events);
        } else {
            this.#extend(cached, this.#source.eventsSince(runId, cached.sequence));
        }

        actors.set(actorId, cached);
        this.#runs.set(runId, actors);
        cached.context ??= deepFreeze(contextOf([...cached.inherited, ...cached.own.entries], conversation));

        return cached.context;
    }

    forget(runId: string) {
        this.#runs.delete(runId);
    }

    /** Drops what an actor holds once its turn ended; the next turn builds its context once from the journal. */
    forgetActor(runId: string, actorId: string) {
        const actors = this.#runs.get(runId);
        actors?.delete(actorId);

        if (actors?.size === 0)
            this.#runs.delete(runId);
    }

    /** How many actor contexts are held; only actors in a running turn keep one. */
    get size() {
        return [...this.#runs.values()].reduce((sum, actors) => sum + actors.size, 0);
    }

    #extend(cached: CachedContext, events: readonly JournalEvent[]) {
        for (const event of events) {
            if (event.sequence !== cached.sequence + 1)
                throw new Error(`The model context expected event ${cached.sequence + 1} and got ${event.sequence}.`);

            cached.sequence = event.sequence;

            if (cached.own.apply(event))
                cached.context = null;
        }
    }
}

/** How a turn of an LLM actor reads and writes its model context in the journal; `next` numbers the commands of the turn. */
export const turnModelContext = (
    runtime: Orchestration,
    turn: ClaimedTurn,
    next: () => number,
): Pick<TurnRequest<"agent">, "modelContext" | "recordContext" | "hookState"> => {
    const { runId, actorId, turnId } = turn;
    const context = (kind: string) => ({ actorId, commandId: `scheduler:${turnId}:context:${kind}:${next()}`, turnId, correlationId: turnId });

    return {
        modelContext: () => runtime.modelContext(runId, actorId),
        recordContext: (entry: ModelContextRecord) => {
            if (entry.kind === "input")
                runtime.presentModelInput(context(entry.kind), runId, actorId, { turnId, inputId: entry.inputId, content: entry.content });
            else if (entry.kind === "step")
                runtime.completeModelStep(context(entry.kind), runId, actorId, { turnId, step: entry.step });
            else if (entry.kind === "tool-result")
                runtime.presentToolResult(context(entry.kind), runId, actorId, {
                    turnId,
                    toolCallId: entry.toolCallId,
                    toolName: entry.toolName,
                    isError: entry.isError,
                    content: entry.content,
                });
            else
                runtime.compactContext(context(entry.kind), runId, actorId, { turnId, ...entry.compaction });
        },
        hookState: {
            kept: (hookId: string) => runtime.select(runId, (state) => state.pluginStates.get(pluginStateKey(hookId, { kind: "actor", actorId }))?.state),
            keep: (hookId: string, value: JsonValue) => {
                runtime.replacePluginState(
                    { actorId: runtime.select(runId, (state) => state.ownerId), commandId: `scheduler:${turnId}:hook:${hookId}:${next()}`, turnId },
                    runId,
                    { pluginId: hookId, scope: { kind: "actor", actorId }, state: value },
                );
            },
        },
    };
};
