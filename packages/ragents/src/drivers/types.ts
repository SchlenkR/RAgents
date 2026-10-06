import type { ImageContent, TextContent, UserContent } from "@ragents/ai";

import type { AgentDriverKind, ModelSelection } from "../domain/driver.ts";
import type { EventPayloads } from "../domain/events.ts";
import type { CompletedModelStep } from "../runtime/decisions/turns.ts";
import type { ModelContext } from "../agents/model-context.ts";
import type { JsonValue } from "../domain/json.ts";
import type { TurnUsage } from "../domain/model.ts";
import type { DeliveredInput } from "../agents/delivery.ts";
import type { RunFunction } from "../agents/tools.ts";
import type { ToolInvocation } from "../agents/toolset.ts";

export type AutomatedDriverKind = Exclude<AgentDriverKind, "manual">;

export type TurnAttachment = { name: string; mediaType: string; content: Uint8Array };

/** A pending input that joined the running turn; the driver hands it to the model before its next request. */
export type SteeredInput = {
    input: DeliveredInput;
    prompt: string;
    /** What the model reads before the prompt, such as the interface context of a message; empty for none. */
    orientation: string;
    attachments: readonly TurnAttachment[];
};

type TurnDriverFacts = {
    external: {
        driverKind: "external";
        runtime: string;
        instructions: string;
    };
    script: {
        driverKind: "script";
        invoke: (toolCallId: string, name: string, input: JsonValue) => Promise<JsonValue>;
    };
    agent: {
        driverKind: "agent";
        selection: ModelSelection;
        /** What the model reads before the prompt of the input that starts the turn: the actor roster as of turn start and the input's own context; never part of the system prompt. */
        orientation: string;
        /** `modelContext` names the model context the result enters, see `ToolScope.modelContext`; without it file tools track no seen state. */
        invoke: (toolCallId: string, name: string, input: JsonValue, modelContext?: string) => Promise<ToolInvocation>;
        /** Claims the pending inputs that may join this turn now, in journal order; empty once the turn ends or aborts. */
        claimSteering: () => readonly SteeredInput[];
        /** The model context of this agent as the journal holds it now. */
        modelContext: () => ModelContext;
        /** Records what enters the model context; only a recorded entry is context. */
        recordContext: (entry: ModelContextRecord) => void;
        /** What a hook kept for this agent, in the journal as plugin state of the actor. */
        hookState: {
            kept: (hookId: string) => JsonValue | undefined;
            keep: (hookId: string, value: JsonValue) => void;
        };
    };
};

export type DriverEvent =
    | { kind: "assistant-completed"; text: string }
    | { kind: "reasoning-completed"; text: string }
    | { kind: "assistant-interrupted"; text: string }
    | { kind: "runtime"; text: string };

/** What a driver writes into the model context of its agent, in the order the model sees it. */
export type ModelContextRecord =
    | { kind: "input"; inputId: string | null; content: string | readonly UserContent[] }
    | { kind: "step"; step: CompletedModelStep }
    | { kind: "tool-result"; toolCallId: string; toolName: string; isError: boolean; content: readonly (TextContent | ImageContent)[] }
    | { kind: "compaction"; compaction: Omit<EventPayloads["context.compacted"], "turnId"> };

export type DriverToolEvent =
    | { kind: "started"; id: string; name: string; input: JsonValue }
    | { kind: "completed"; id: string; name: string; output: JsonValue }
    | { kind: "failed"; id: string; name: string; error: string };

export type LiveEvent =
    | { kind: "text"; delta: string }
    | { kind: "thinking"; delta: string }
    | { kind: "tool"; id: string; name: string; arguments: string }
    | { kind: "tool-result"; id: string; result: string; isError: boolean };

export type TurnRequest<Kind extends AutomatedDriverKind = AutomatedDriverKind> = TurnDriverFacts[Kind] & {
    runId: string;
    agentId: string;
    turnId: string;
    startedAt: string;
    input: DeliveredInput;
    attachments?: readonly TurnAttachment[];
    prompt: string;
    systemPrompt: string;
    /** The working directory of the workspace tools, as the model sees it; it may lie on another machine. */
    workspace: string;
    /** Stores an attached file under attachments/ of the workspace, where the workspace tools read it; returns its name there. */
    storeAttachment: (name: string, content: Uint8Array) => Promise<string>;
    tools: readonly RunFunction[];
    allowedToolNames: readonly string[] | null;
    refreshTools?: () => Promise<{ tools: readonly RunFunction[]; systemPrompt: string }>;
    emit: (event: DriverEvent) => void;
    recordTool?: (event: DriverToolEvent) => void;
    publish: (event: LiveEvent) => void;
    progress?: () => void;
};

export type TurnResult = {
    failure: string | null;
    usage: TurnUsage;
};

export interface AgentDriver<Kind extends AutomatedDriverKind = AutomatedDriverKind> {
    readonly kind: Kind;
    readonly supportsPlainLlm?: boolean;
    runTurn(request: TurnRequest<Kind>, signal: AbortSignal): Promise<TurnResult>;
    disposeAgent?(runId: string, agentId: string): Promise<void>;
    reviveAgent?(runId: string, agentId: string): void;
    haltRun?(runId: string): Promise<void>;
    waitForRunSettlement?(runId: string): Promise<void> | undefined;
    disposeRun?(runId: string): Promise<void>;
    shutdown?(): Promise<void>;
}

export type DriverRegistry = { [Kind in AutomatedDriverKind]?: AgentDriver<Kind> };

export const isAutomated = (kind: AgentDriverKind): kind is AutomatedDriverKind => kind !== "manual";
