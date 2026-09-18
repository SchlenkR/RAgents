import type { CommandContext } from "../runtime/command.ts";
import type { JournalEvent } from "../domain/events.ts";
import { assertJsonValue, type JsonValue } from "../domain/json.ts";
import type { TSchema } from "typebox";
import { Value } from "typebox/value";
import { schemaComplaints } from "../domain/schema-errors.ts";
import { canonicalJson } from "../runtime/canonical-json.ts";
import { toolResultEventOf } from "./actor-input.ts";
import type { Orchestration } from "../runtime/orchestration.ts";
import type { ModelCatalog } from "./catalog.ts";
import { ToolRegistry, type ToolProvider } from "./plugins.ts";
import type { ToolChapters } from "./tool-orientation.ts";
import { type RunFunction, type ToolScope } from "./tools.ts";
import { workingActorFrom, type ClaimedTurn } from "./turn.ts";

export type TurnToolsetOptions = {
    runtime: Orchestration;
    turn: ClaimedTurn;
    catalog: ModelCatalog;
    registry?: ToolProvider | undefined;
    workspace?: string;
    signal?: AbortSignal | undefined;
    chapters?: ToolChapters | undefined;
};

const nativeInfrastructure = new Set(["typescript_api", "typescript_eval"]);
const noChapters: ToolChapters = () => "";

const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error));

export { schemaComplaints } from "../domain/schema-errors.ts";

type ToolCallEvent = Extract<
    JournalEvent,
    { type: "tool.call.started" | "tool.call.completed" | "tool.call.failed" }
>;

export type ToolInvocation = { output: JsonValue; ignoredFields: readonly string[] };

type ToleratedInput = { input: JsonValue; ignoredFields: readonly string[] };

type ObjectSchema = { type?: string; properties?: Record<string, TSchema>; additionalProperties?: unknown; patternProperties?: unknown };

const knownFieldsOf = (schema: TSchema) => Object.keys((schema as ObjectSchema).properties ?? {});

const takesNoInput = (schema: TSchema) => knownFieldsOf(schema).length === 0;

const withoutUnknownFields = (schema: TSchema, input: JsonValue): ToleratedInput => {
    const { type, additionalProperties, patternProperties } = schema as ObjectSchema;
    const closed = type === "object" && additionalProperties === false && patternProperties === undefined;

    if (!closed || input === null || typeof input !== "object" || Array.isArray(input))
        return { input, ignoredFields: [] };

    const known = new Set(knownFieldsOf(schema));
    const ignoredFields = Object.keys(input).filter((key) => !known.has(key));

    return ignoredFields.length === 0
        ? { input, ignoredFields }
        : { input: Object.fromEntries(Object.entries(input).filter(([key]) => known.has(key))), ignoredFields };
};

const inputComplaint = (tool: RunFunction, input: JsonValue, ignoredFields: readonly string[]) => {
    const subject = takesNoInput(tool.schema) ? `Tool ${tool.name} takes no input` : `Tool ${tool.name} received input that does not match its schema`;
    const complaints = [
        ...(ignoredFields.length > 0 ? [`input has unknown field ${ignoredFields.join(", ")}`] : []),
        schemaComplaints(tool.schema, input),
    ];

    return `${subject}: ${complaints.join("; ")}. Fix the named fields and call the tool again.`;
};

export const ignoredFieldsNotice = (tool: Pick<RunFunction, "name" | "schema">, ignoredFields: readonly string[]) => {
    const fields = ignoredFields.length === 1 ? `das Feld ${ignoredFields[0]}` : `die Felder ${ignoredFields.join(", ")}`;
    const ignored = ignoredFields.length === 1 ? "wurde ignoriert" : "wurden ignoriert";

    return takesNoInput(tool.schema)
        ? `Hinweis: ${tool.name} nimmt keine Eingabe; ${fields} ${ignoredFields.length === 1 ? "ist" : "sind"} unbekannt und ${ignored}.`
        : `Hinweis: ${fields} kennt ${tool.name} nicht und ${ignored}.`;
};

export class TurnToolset {
    readonly functions: RunFunction[] = [];
    readonly tools: RunFunction[];
    readonly #runtime: Orchestration;
    readonly #turn: ClaimedTurn;
    readonly #scope: ToolScope;
    readonly #registry: ToolProvider;
    readonly #workspace: string;
    readonly #chapters: ToolChapters;

    static async create(options: TurnToolsetOptions) {
        const registry = options.registry ?? new ToolRegistry();
        const toolset = new TurnToolset(options, [], registry);
        await toolset.refresh();
        return toolset;
    }

    private constructor(
        options: TurnToolsetOptions,
        tools: RunFunction[],
        registry: ToolProvider,
    ) {
        this.#runtime = options.runtime;
        this.#turn = options.turn;
        this.#registry = registry;
        this.#workspace = options.workspace ?? process.cwd();
        this.#chapters = options.chapters ?? noChapters;

        this.tools = tools;
        this.#scope = {
            workspace: this.#workspace,
            runtime: this.#runtime,
            caller: { runId: this.#turn.runId, actorId: this.#turn.actorId, turnId: this.#turn.turnId },
            catalog: options.catalog,
            signal: options.signal,
            context: (toolCallId, step) => this.#context(toolCallId, step),
            eventsFor: (toolCallId, step) =>
                this.#runtime
                    .events(this.#turn.runId)
                    .filter((entry) => entry.commandId === this.#commandId(toolCallId, step))
                    .map((entry) => {
                        assertJsonValue(entry.payload, `Event ${entry.eventId} payload`);
                        return toolResultEventOf(entry);
                    }),
            invokeFunction: (toolCallId, name, input) => this.invokeFunction(toolCallId, name, input),
            functionGuidance: async (names) => this.#chapters(names),
            availableFunctions: () => this.functions,
            resolveToolsFor: (actor, view, onUnavailable) => this.#registry.resolve({
                runId: this.#turn.runId,
                actorId: actor.id,
                turnId: null,
                actor,
                view: view ?? this.#runtime.view(this.#turn.runId),
                workspace: this.#workspace,
            }, onUnavailable),
        };
    }

    async refresh(): Promise<void> {
        this.#assertActive();
        const view = this.#runtime.view(this.#turn.runId);
        const actor = workingActorFrom(view, this.#turn.actorId);
        const resolved = await this.#registry.resolve({
            runId: this.#turn.runId,
            actorId: this.#turn.actorId,
            turnId: this.#turn.turnId,
            actor,
            view,
            workspace: this.#workspace,
        });
        this.#assertActive();
        if (actor.toolNames !== null && new Set(actor.toolNames).size !== actor.toolNames.length)
            throw new Error(`Actor ${actor.id} contains duplicate tool names.`);
        const requested = actor.toolNames === null ? null : new Set(actor.toolNames);
        const selected = requested === null ? resolved : resolved.filter((tool) => requested.has(tool.name));
        const infrastructure = actor.toolNames?.length === 0 ? [] : resolved.filter((tool) =>
            nativeInfrastructure.has(tool.name) && !selected.some((entry) => entry.name === tool.name));
        this.functions.splice(0, this.functions.length, ...selected, ...infrastructure);
        this.tools.splice(0, this.tools.length, ...this.functions.filter((tool) => tool.nativeTool === true));
    }

    async invoke(toolCallId: string, name: string, input: JsonValue): Promise<ToolInvocation> {
        await this.refresh();
        const tool = this.tools.find((entry) => entry.name === name);

        if (!tool)
            throw new Error(`Tool ${name} is not available to actor ${this.#turn.actorId}.`);

        assertJsonValue(input, `Tool ${name} input`);
        const tolerated = withoutUnknownFields(tool.schema, input);
        const output = await this.#execute(toolCallId, tool, tolerated.input, tolerated.ignoredFields);

        return { output, ignoredFields: tolerated.ignoredFields };
    }

    async invokeFunction(toolCallId: string, name: string, input: JsonValue): Promise<JsonValue> {
        await this.refresh();
        const fn = this.functions.find((entry) => entry.name === name);
        if (!fn)
            throw new Error(`Function ${name} is not available to actor ${this.#turn.actorId}.`);
        return this.#execute(toolCallId, fn, input, []);
    }

    async #execute(toolCallId: string, tool: RunFunction, input: JsonValue, ignoredFields: readonly string[]): Promise<JsonValue> {
        const name = tool.name;

        assertJsonValue(input, `Tool ${name} input`);

        const replay = this.#replayOf(toolCallId);

        if (replay) {
            if (replay.name !== name || canonicalJson(replay.input) !== canonicalJson(input))
                throw new Error(`Tool call ID ${toolCallId} was already used with another tool or input.`);

            if (replay.failed)
                throw new Error(
                    replay.output && typeof replay.output === "object" && "error" in replay.output
                        ? String(replay.output.error)
                        : `Tool call ${toolCallId} failed previously.`,
                );

            assertJsonValue(replay.output, `Tool ${name} replay output`);
            return replay.output;
        }

        if (!Value.Check(tool.schema, input))
            throw new Error(inputComplaint(tool, input, ignoredFields));

        this.#runtime.startToolCall(
            this.#context(toolCallId, "started"),
            this.#turn.runId,
            this.#turn.actorId,
            {
                turnId: this.#turn.turnId,
                toolCallId,
                name,
                input,
                ...(ignoredFields.length > 0 ? { ignoredFields: [...ignoredFields] } : {}),
            },
        );

        try {
            const output = await tool.run(this.#scope, toolCallId, input as never);
            this.#assertActive();
            if (!Value.Check(tool.resultSchema, output))
                throw new Error(`Tool ${name} returned output that does not match its result schema.`);
            assertJsonValue(output, `Tool ${name} output`);
            const recordedOutput = tool.recordOutput ? tool.recordOutput(output) : output;
            assertJsonValue(recordedOutput, `Tool ${name} recorded output`);
            this.#runtime.completeToolCall(
                this.#context(toolCallId, "completed"),
                this.#turn.runId,
                this.#turn.actorId,
                {
                    turnId: this.#turn.turnId,
                    toolCallId,
                    name,
                    output: recordedOutput,
                },
            );

            return output;
        } catch (error) {
            try {
                this.#assertActive();
            } catch {
                throw error;
            }

            this.#runtime.failToolCall(
                this.#context(toolCallId, "failed"),
                this.#turn.runId,
                this.#turn.actorId,
                { turnId: this.#turn.turnId, toolCallId, name, error: errorText(error) },
            );
            throw error;
        }
    }

    #assertActive() {
        this.#scope.signal?.throwIfAborted();
        this.#runtime.assertActorTurn(this.#turn.runId, this.#turn.actorId, this.#turn.turnId);
    }

    #commandId(toolCallId: string, step?: string) {
        return step ? `${this.#turn.turnId}:${toolCallId}:${step}` : `${this.#turn.turnId}:${toolCallId}`;
    }

    #context(toolCallId: string, step?: string): CommandContext {
        return {
            actorId: this.#turn.actorId,
            commandId: this.#commandId(toolCallId, step),
            turnId: this.#turn.turnId,
            correlationId: this.#turn.turnId,
            causationId: this.#turn.turnId,
        };
    }

    #replayOf(toolCallId: string) {
        const events = this.#runtime.events(this.#turn.runId).filter((event): event is ToolCallEvent => {
            if (
                event.type !== "tool.call.started" &&
                event.type !== "tool.call.completed" &&
                event.type !== "tool.call.failed"
            )
                return false;

            return event.actorId === this.#turn.actorId &&
                event.payload.turnId === this.#turn.turnId &&
                event.payload.toolCallId === toolCallId;
        });
        const started = events.find((event) => event.type === "tool.call.started");
        const terminal = events.findLast(
            (event) => event.type === "tool.call.completed" || event.type === "tool.call.failed",
        );

        if (!terminal) {
            if (started)
                throw new Error(`Tool call ${toolCallId} started previously without a durable result.`);

            return null;
        }

        if (!started || started.type !== "tool.call.started")
            throw new Error(`Tool call ${toolCallId} has a result without a matching start event.`);

        if (terminal.payload.name !== started.payload.name)
            throw new Error(`Tool call ${toolCallId} has inconsistent start and result events.`);

        return terminal.type === "tool.call.completed"
            ? { name: started.payload.name, input: started.payload.input, output: terminal.payload.output, failed: false }
            : {
                name: started.payload.name,
                input: started.payload.input,
                output: { error: terminal.payload.error },
                failed: true,
            };
    }
}
