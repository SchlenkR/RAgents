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
    SubscriptionId,
    TurnId,
    TurnUsage,
} from "./model.ts";
import type { JsonChange, JsonObject, JsonValue } from "./json.ts";

export type EventPayloads = {
    "run.created": {
        title: string;
        owner: {
            id: ActorId;
            handle: string;
            displayName: string;
            grants: CapabilityGrant[];
            /** Der angemeldete Benutzer, dem der Run gehört; ohne Anmeldung nicht gesetzt. */
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
    "agent.spawned": {
        agentId: ActorId;
        handle: string;
        displayName: string;
        prompt: string;
        execution: AgentExecution;
        grants: CapabilityGrant[];
        toolNames: string[] | null;
        forkOf?: ActorId;
    };
    "script.created": {
        scriptId: ActorId;
        handle: string;
        displayName: string;
        execution: AgentExecution;
        grants: CapabilityGrant[];
        toolNames: string[] | null;
    };
    "actor.input.enqueued": {
        inputId: InputId;
        actorId: ActorId;
        artifactIds: string[];
        presentation?: "background";
    } & (
        | { subscriptionId: null; sourceEventIds: string[]; content: string }
        | { subscriptionId: SubscriptionId; sourceEventIds: [string]; content?: never }
    );
    "turn.started": {
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
        owner: string | null;
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
    "agent.spawned": true,
    "script.created": true,
    "actor.input.enqueued": true,
    "turn.started": true,
    "turn.finished": true,
    "turn.interrupted": true,
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
