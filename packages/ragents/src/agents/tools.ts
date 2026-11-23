import type { Static, TSchema } from "typebox";
import type { JsonValue } from "../domain/json.ts";
import type { Actor, CapabilityName, RunView } from "../domain/model.ts";
import type { CommandContext } from "../runtime/command.ts";
import type { Orchestration } from "../runtime/orchestration.ts";
import type { ModelCatalog } from "./catalog.ts";

export type ToolCaller = {
    runId: string;
    actorId: string;
    turnId: string | null;
};

export type ToolScope = {
    runtime: Orchestration;
    caller: ToolCaller;
    catalog: ModelCatalog;
    signal: AbortSignal | undefined;
    workspace?: string;
    context: (toolCallId: string, step?: string) => CommandContext;
    eventsFor: (toolCallId: string, step?: string) => Array<{ type: string; payload: JsonValue }>;
    invokeFunction: (toolCallId: string, name: string, input: JsonValue) => Promise<JsonValue>;
    functionGuidance: (names: readonly string[]) => Promise<string>;
    availableFunctions: () => readonly RunFunction[];
    resolveToolsFor: (actor: Actor, view?: RunView, onUnavailable?: (tool: RunFunction) => void) => Promise<readonly RunFunction[]>;
    /** Only for a direct call of the model: names the model context its result enters; it changes when that context is compacted or replaced. */
    modelContext?: string;
};

export type ToolAvailability = (actor: Actor, view: RunView) => boolean;

export type ToolAvailabilitySummary = {
    availability: "always" | "conditional";
    availabilityDetail: string;
    requiredCapabilities?: readonly CapabilityName[];
};

export type ToolDescriptor = ToolAvailabilitySummary & {
    name: string;
    description: string;
    scope: "global" | "per-agent" | "per-turn";
    nativeTool?: boolean;
};

type CataloguedToolAvailability = ToolAvailability & {
    readonly summary?: ToolAvailabilitySummary;
};

export const defineToolAvailability = (
    summary: ToolAvailabilitySummary,
    available: ToolAvailability,
): ToolAvailability => Object.assign(available, { summary: Object.freeze({ ...summary }) });

export const describeToolAvailability = (available: ToolAvailability): ToolAvailabilitySummary =>
    (available as CataloguedToolAvailability).summary ?? {
        availability: "conditional",
        availabilityDetail: "Availability is determined for each actor and run from the current context.",
    };

export type ToolExecutionMode = "sequential" | "parallel";

export type RunFunction = {
    name: string;
    label: string;
    description: string;
    longDescription?: string;
    schema: TSchema;
    resultSchema: TSchema;
    available: ToolAvailability;
    run: (scope: ToolScope, toolCallId: string, input: never) => JsonValue | Promise<JsonValue>;
    recordOutput?: (output: JsonValue) => JsonValue;
    /** Whether this output ends the caller's turn when the model called the function as a native tool. */
    endsTurn?: (output: JsonValue) => boolean;
    executionMode?: ToolExecutionMode;
    /** Every function is a native model tool unless it opts out with false; context.functions offers it either way. */
    nativeTool?: boolean;
};

export const isNativeTool = (tool: { readonly nativeTool?: boolean | undefined }): boolean => tool.nativeTool !== false;

export const defineRunFunction = <Schema extends TSchema, ResultSchema extends TSchema>(definition: {
    name: string;
    label: string;
    description: string;
    longDescription?: string;
    schema: Schema;
    resultSchema: ResultSchema;
    available: ToolAvailability;
    run: (
        scope: ToolScope,
        toolCallId: string,
        input: Static<Schema>,
    ) => (Static<ResultSchema> & JsonValue) | Promise<Static<ResultSchema> & JsonValue>;
    recordOutput?: (output: Static<ResultSchema> & JsonValue) => JsonValue;
    endsTurn?: (output: Static<ResultSchema> & JsonValue) => boolean;
    executionMode?: ToolExecutionMode;
    nativeTool?: boolean;
}): RunFunction => definition as unknown as RunFunction;

export const holdsUsable = (actor: Actor, capability: CapabilityName) =>
    actor.grants.some((grant) => grant.capability === capability && grant.usable !== false);
