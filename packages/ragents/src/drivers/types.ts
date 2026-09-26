import type { AgentDriverKind, ModelSelection } from "../domain/driver.ts";
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
    attachments: readonly TurnAttachment[];
};

type TurnDriverFacts = {
    script: {
        driverKind: "script";
        invoke: (toolCallId: string, name: string, input: JsonValue) => Promise<JsonValue>;
    };
    agent: {
        driverKind: "agent";
        selection: ModelSelection;
        forkOf: string | null;
        /** `modelContext` names the model context the result enters, see `ToolScope.modelContext`; without it file tools track no seen state. */
        invoke: (toolCallId: string, name: string, input: JsonValue, modelContext?: string) => Promise<ToolInvocation>;
        /** Claims the pending inputs that may join this turn now, in journal order; empty once the turn ends or aborts. */
        claimSteering: () => readonly SteeredInput[];
    };
};

export type DriverEvent =
    | { kind: "assistant"; text: string }
    | { kind: "assistant-interrupted"; text: string }
    | { kind: "reasoning"; text: string }
    | { kind: "runtime"; text: string };

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
    /** The folder on this machine for the driver's own work, resolved only when a driver needs it. */
    runtimeDirectory: () => Promise<string>;
    /** Stores an attached file under attachments/ of the workspace, where the workspace tools read it; returns its name there. */
    storeAttachment: (name: string, content: Uint8Array) => Promise<string>;
    tools: readonly RunFunction[];
    allowedToolNames: readonly string[] | null;
    refreshTools?: () => Promise<{ tools: readonly RunFunction[]; systemPrompt: string }>;
    emit: (event: DriverEvent) => void;
    recordTool?: (event: DriverToolEvent) => void;
    publish: (event: LiveEvent) => void;
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
