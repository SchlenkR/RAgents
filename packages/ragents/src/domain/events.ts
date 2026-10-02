import type {
    ActionId,
    ActionInput,
    ActionStatus,
    ActorId,
    ActorKind,
    AgentExecution,
    Artifact,
    CapabilityGrant,
    InputId,
    ObservableEventType,
    PluginStateScope,
    RunId,
    RunSharing,
    SubscriptionId,
    TurnId,
    TurnUsage,
} from "./model.ts";
import type { JsonChange, JsonObject, JsonValue } from "./json.ts";

/** A media part the model saw, stored by the SHA-256 of its bytes in the artifact contents instead of Base64. */
export type ModelMediaPart =
    | { type: "image" | "video"; mimeType: string; hash: string }
    | { type: "file"; mimeType: string; filename: string; hash: string };

export type ModelTextPart = { type: "text"; text: string };

/** The content of a user message exactly as the model received it. */
export type ModelInputContent = string | (ModelTextPart | ModelMediaPart)[];

export type ModelToolResultPart = ModelTextPart | { type: "image"; mimeType: string; hash: string };

/** A block of a model step; text and thinking without their own field stand in the observation events of the same command, in order. */
export type ModelStepBlock =
    | { type: "text"; text?: string; textSignature?: string }
    | { type: "thinking"; thinking?: string; thinkingSignature?: string; redacted?: boolean }
    | { type: "toolCall"; id: string; name: string; arguments: JsonObject; thoughtSignature?: string };

export type ModelStepUsage = {
    input: number;
    output: number;
    cacheRead: number;
    cacheWrite: number;
    cacheWrite1h?: number;
    reasoning?: number;
    totalTokens: number;
    cost: { input: number; output: number; cacheRead: number; cacheWrite: number; total: number };
};

export type EventPayloads = {
    "run.created": {
        title: string;
        owner: {
            id: ActorId;
            handle: string;
            displayName: string;
            grants: CapabilityGrant[];
            /** The signed-in user who owns the run; not set without sign-in. */
            userId?: string;
        };
    };
    "run.forked": {
        sourceRunId: RunId;
        sourceSequence: number;
    };
    "run.primary-actor-selected": {
        actorId: ActorId;
    };
    "run.title-changed": {
        title: string;
    };
    /** Replaces the whole sharing; changedBy is the signed-in user who changed it. */
    "run.sharing-changed": RunSharing & {
        changedBy: string;
    };
    /** From now on no turn starts; userId is the signed-in user who paused. */
    "run.paused": {
        reason: string;
        userId?: string;
    };
    /** Lifts the pause: a human input written in the same command, or the explicit resume. */
    "run.resumed": {
        trigger: "input" | "resume";
        userId?: string;
    };
    "agent.spawned": {
        agentId: ActorId;
        handle: string;
        displayName: string;
        prompt: string;
        execution: AgentExecution;
        grants: CapabilityGrant[];
        toolNames: string[] | null;
        forkOf?: ActorId;
        description?: string;
    };
    "script.created": {
        scriptId: ActorId;
        handle: string;
        displayName: string;
        execution: AgentExecution;
        grants: CapabilityGrant[];
        toolNames: string[] | null;
        description?: string;
    };
    "actor.input.enqueued": {
        inputId: InputId;
        actorId: ActorId;
        artifactIds: string[];
        presentation?: "background";
        origin?: "human";
    } & (
        | { subscriptionId: null; sourceEventIds: string[]; content: string }
        | { subscriptionId: SubscriptionId; sourceEventIds: [string]; content?: never }
    );
    "turn.started": {
        turnId: TurnId;
        inputId: InputId;
    };
    "turn.input-steered": {
        turnId: TurnId;
        inputId: InputId;
    };
    "turn.finished": {
        turnId: TurnId;
        usage?: TurnUsage;
    } & ({ outcome: "completed" } | { outcome: "failed"; reason: string });
    "turn.interrupted": {
        turnId: TurnId;
        reason: string;
    };
    "model.input.presented": {
        turnId: TurnId;
        /** The claimed input, or null for a message of the agent loop itself. */
        inputId: InputId | null;
        content: ModelInputContent;
    };
    "model.step.completed": {
        turnId: TurnId;
        api: string;
        provider: string;
        model: string;
        responseModel?: string;
        responseId?: string;
        usage: ModelStepUsage;
        stopReason: "stop" | "length" | "toolUse" | "error";
        errorMessage?: string;
        diagnostics?: JsonValue[];
        timestamp: number;
        content: ModelStepBlock[];
    };
    "model.tool-result.presented": {
        turnId: TurnId;
        toolCallId: string;
        toolName: string;
        isError: boolean;
        /** Absent when the model saw exactly the text of the call's tool.call.completed or tool.call.failed. */
        content?: ModelToolResultPart[];
    };
    "context.compacted": {
        turnId: TurnId;
        summary: string;
        /** The first context event after the cut; everything before it is replaced by the summary. */
        firstKeptEventId: string;
        tokensBefore: number;
        provider: string;
        model: string;
        readFiles: string[];
        modifiedFiles: string[];
        /** The compaction threshold of the model and whether it is the model's own or the catalog standard; absent before file format 9. */
        threshold?: { tokens: number; source: "model" | "catalog" };
    };
    "model.output.completed": {
        turnId: TurnId;
        text: string;
    };
    "model.output.interrupted": {
        turnId: TurnId;
        text: string;
    };
    "model.reasoning.completed": {
        turnId: TurnId;
        text: string;
    };
    "runtime.output.recorded": {
        turnId: TurnId;
        text: string;
    };
    "tool.call.started": {
        turnId: TurnId;
        toolCallId: string;
        name: string;
        input: JsonValue;
        ignoredFields?: string[];
    };
    "tool.call.source": {
        turnId: TurnId;
        toolCallId: string;
        code: string;
        path: string | null;
    };
    "tool.call.completed": {
        turnId: TurnId;
        toolCallId: string;
        name: string;
        output: JsonValue;
    };
    "tool.call.failed": {
        turnId: TurnId;
        toolCallId: string;
        name: string;
        error: string;
    };
    "actor.tools.opened": {
        actorId: ActorId;
        toolNames: string[];
    };
    "actor.stopped": {
        actorId: ActorId;
        reason: string;
    };
    "actor.restarted": {
        actorId: ActorId;
        reason: string;
    };
    "subscription.created": {
        subscriptionId: SubscriptionId;
        subscriberId: ActorId;
        sourceActorIds: ActorId[] | null;
        sourceActorKinds: ActorKind[] | null;
        eventTypes: ObservableEventType[];
        includeSelf: boolean;
    };
    "subscription.removed": {
        subscriptionId: SubscriptionId;
        reason: string;
        discardedInputIds?: InputId[];
    };
    "subscription.failed": {
        subscriptionId: SubscriptionId;
        sourceEventId: string;
        reason: string;
    };
    "plugin.state-replaced": {
        pluginId: string;
        scope: PluginStateScope;
        state: JsonValue;
    };
    "plugin.state-patched": {
        pluginId: string;
        scope: PluginStateScope;
        changes: JsonChange[];
    };
    "action.proposed": {
        actionId: ActionId;
        owner: string;
        title: string;
        description: string | null;
        parameters: Record<string, string>;
        input: ActionInput | null;
        payload: JsonObject | null;
    };
    "action.resolved": {
        actionId: ActionId;
        decision: Exclude<ActionStatus, "pending">;
        result: JsonValue | null;
    };
    "artifact.published": {
        artifact: Omit<Artifact, "createdBy" | "createdAt">;
    };
};

export type EventType = keyof EventPayloads;

export const eventTypeMap: Record<EventType, true> = {
    "run.created": true,
    "run.forked": true,
    "run.primary-actor-selected": true,
    "run.title-changed": true,
    "run.sharing-changed": true,
    "run.paused": true,
    "run.resumed": true,
    "agent.spawned": true,
    "script.created": true,
    "actor.input.enqueued": true,
    "turn.started": true,
    "turn.input-steered": true,
    "turn.finished": true,
    "turn.interrupted": true,
    "model.input.presented": true,
    "model.step.completed": true,
    "model.tool-result.presented": true,
    "context.compacted": true,
    "model.output.completed": true,
    "model.output.interrupted": true,
    "model.reasoning.completed": true,
    "runtime.output.recorded": true,
    "tool.call.started": true,
    "tool.call.source": true,
    "tool.call.completed": true,
    "tool.call.failed": true,
    "actor.tools.opened": true,
    "actor.stopped": true,
    "actor.restarted": true,
    "subscription.created": true,
    "subscription.removed": true,
    "subscription.failed": true,
    "plugin.state-replaced": true,
    "plugin.state-patched": true,
    "action.proposed": true,
    "action.resolved": true,
    "artifact.published": true,
};

export const isEventType = (value: unknown): value is EventType =>
    typeof value === "string" && Object.hasOwn(eventTypeMap, value);

type EventData = {
    [Type in EventType]: {
        type: Type;
        payload: EventPayloads[Type];
    };
}[EventType];

export type UncommittedEvent = EventData & {
    actorId: ActorId;
    correlationId: string | null;
    causationId: string | null;
};

export type JournalEvent = EventData & {
    eventId: string;
    runId: RunId;
    sequence: number;
    schemaVersion: 3;
    occurredAt: string;
    actorId: ActorId;
    commandId: string;
    correlationId: string | null;
    causationId: string | null;
};
