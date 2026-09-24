import { Type } from "typebox";
import {
    assertJsonValue,
    defineRunFunction,
    defineToolAvailability,
    executeTypeScriptSnippet,
    typeScriptSnippetDeclarations,
    type RunCapabilityDescriptor,
    type RunFunction,
    type PluginHost,
    type ToolContributor,
    type ToolScope,
} from "@ragents/engine";
import { FILE_OPERATIONS, type FileText, type WorkspaceProcessContext } from "@ragents/workspace-executor";
import { sandboxServicesToken, type SandboxServices } from "../plugin-support/workspace-sandbox-host.js";

const metadata = [
    {
        name: "typescript_api",
        label: "TypeScript API",
        description: "Discover the typed functions available to this actor. Omit names for a compact searchable list; pass exact names for their TypeScript declarations with field documentation and the matching guidance. JSON schemas with validation constraints are added only on request. Functions are called as await context.functions.name(input) from snippets and actor programs.",
    },
    {
        name: "typescript_eval",
        label: "Evaluate TypeScript",
        description: "Typecheck and execute a one-off TypeScript snippet as the calling actor, with the same context.functions API as actor programs. Supply code or a workspace path containing an async function body: await and return are supported; use await import() for Node modules. Return a JSON value; no return yields null. context.log captures output. Locals and context.state last for this execution only. Function calls can change the run and are not rolled back on later failure. Use an actor program for persistent state and future messages or events.",
    },
] as const;

const available = defineToolAvailability({
    availability: "conditional",
    availabilityDetail: "Für aktive ausführbare Actors mit einer Funktionsauswahl.",
}, (actor) => actor.kind !== "human" && actor.lifecycle.kind !== "stopped");

export interface TypeScriptToolOptions {
    /** Das Snippet läuft auf dem Server, auch wenn der Arbeitsbereich auf einem Arbeitsplatz liegt. */
    readonly serverProcessContextFor: (runId: string) => Promise<WorkspaceProcessContext>;
    /** Eine Quelldatei kommt über den Executor des Runs, wo immer der Arbeitsbereich liegt. */
    readonly execute: SandboxServices["execute"];
}

const functionsOf = (scope: ToolScope): readonly RunFunction[] => scope.availableFunctions()
    .filter((entry) => !metadata.some((tool) => tool.name === entry.name))
    .sort((left, right) => left.name.localeCompare(right.name));

const descriptorOf = (entry: RunFunction): RunCapabilityDescriptor => ({
    id: entry.name,
    label: entry.label,
    description: entry.description,
    schema: entry.schema,
    resultSchema: entry.resultSchema,
});

const apiEntrySchema = Type.Object({
    name: Type.String(),
    label: Type.String(),
    description: Type.String(),
    longDescription: Type.Optional(Type.String()),
    inputSchema: Type.Optional(Type.Unknown()),
    resultSchema: Type.Optional(Type.Unknown()),
}, { additionalProperties: false });

const schemaJson = (schema: RunFunction["schema"]) => {
    const value: unknown = JSON.parse(JSON.stringify(schema));
    assertJsonValue(value, "Function schema");
    return value;
};

/** Ein Alias wie `@actors` nennt eine zusätzliche Wurzel des Executors, sonst gilt der Pfad relativ zur Wurzel des Runs. */
const sourceRequest = (requested: string): { path: string; alias?: string } => {
    if (!requested.startsWith("@")) return { path: requested };
    const separator = requested.indexOf("/");
    return separator < 0 ? { alias: requested, path: "" } : { alias: requested.slice(0, separator), path: requested.slice(separator + 1) };
};

const sourceOf = async (options: TypeScriptToolOptions, runId: string, toolCallId: string, input: { code?: string; path?: string }): Promise<string> => {
    if (input.code !== undefined) return input.code;
    const text = await options.execute(runId, FILE_OPERATIONS.read, sourceRequest(input.path!), { toolCallId }) as FileText;
    if (!text.previewable) throw new Error(`${input.path}: ${text.reason}`);
    return text.content;
};

export const createTypeScriptToolContributor = (options: TypeScriptToolOptions): ToolContributor => {
    const tools: readonly RunFunction[] = [
        defineRunFunction({
            ...metadata[0],
            nativeTool: true,
            available,
            executionMode: "parallel",
            schema: Type.Object({
                query: Type.Optional(Type.String({ minLength: 1, description: "Search names and descriptions. Omit for all available names." })),
                names: Type.Optional(Type.Array(Type.String({ minLength: 1 }), { minItems: 1, uniqueItems: true, description: "Exact function names whose complete declarations and guidance are needed." })),
                schemas: Type.Optional(Type.Boolean({ description: "With names: also return the JSON schemas including validation constraints such as lengths and patterns." })),
            }, { additionalProperties: false }),
            resultSchema: Type.Object({
                functions: Type.Array(apiEntrySchema),
                declarations: Type.Optional(Type.String()),
                guidance: Type.Optional(Type.String()),
            }, { additionalProperties: false }),
            run: async (scope, _id, input) => {
                if (input.names && input.query !== undefined) throw new Error("typescript_api erwartet names oder query, nicht beides.");
                if (input.schemas && !input.names) throw new Error("typescript_api liefert JSON-Schemas nur zu ausgewählten names.");
                const functions = functionsOf(scope);
                if (input.names) {
                    const unknown = input.names.filter((name) => !functions.some((entry) => entry.name === name));
                    if (unknown.length > 0) throw new Error(`Nicht verfügbare TypeScript-Funktionen: ${unknown.join(", ")}. Mit typescript_api ohne names verfügbare Funktionen nachschlagen.`);
                }
                const query = input.query?.toLocaleLowerCase();
                const selected = input.names ? functions.filter((entry) => input.names!.includes(entry.name))
                    : query ? functions.filter((entry) => `${entry.name} ${entry.label} ${entry.description}`.toLocaleLowerCase().includes(query)) : functions;
                return {
                    functions: selected.map(({ name, label, description, longDescription, schema, resultSchema }) => ({
                        name, label, description,
                        ...(input.names && longDescription ? { longDescription } : {}),
                        ...(input.schemas ? { inputSchema: schemaJson(schema), resultSchema: schemaJson(resultSchema) } : {}),
                    })),
                    ...(input.names ? {
                        declarations: typeScriptSnippetDeclarations(selected.map(descriptorOf)),
                        guidance: [
                            "The context belongs to the calling actor: functions act as context.principal. In a snippet, context.state starts as {} and is discarded when it finishes. Actor programs retain their declared state and can receive later inputs. TypeScript checks calls against the declared input and result types before execution; schema constraints are also validated by the host.",
                            await scope.functionGuidance(input.names),
                        ].filter(Boolean).join("\n\n"),
                    } : {}),
                };
            },
        }),
        defineRunFunction({
            ...metadata[1],
            nativeTool: true,
            available,
            executionMode: "sequential",
            schema: Type.Object({
                code: Type.Optional(Type.String({ minLength: 1, description: "Async TypeScript function body. context is supplied; await and return work directly." })),
                path: Type.Optional(Type.String({ minLength: 1, description: "Workspace file containing the same snippet body. Use a relative path or an existing workspace alias such as @actors; generated absolute paths are not needed." })),
            }, { additionalProperties: false }),
            resultSchema: Type.Object({ result: Type.Unknown(), logs: Type.Array(Type.String()) }, { additionalProperties: false }),
            run: async (scope, id, input) => {
                if ((input.code === undefined) === (input.path === undefined)) throw new Error("typescript_eval braucht genau eines von code oder path.");
                scope.signal?.throwIfAborted();
                const actor = scope.runtime.view(scope.caller.runId).actors.find((candidate) => candidate.id === scope.caller.actorId);
                if (!actor || actor.kind === "human" || actor.lifecycle.kind === "stopped") throw new Error("Das TypeScript-Snippet braucht einen aktiven ausführbaren Actor.");
                const code = await sourceOf(options, scope.caller.runId, id, input);
                const processContext = await options.serverProcessContextFor(scope.caller.runId);
                if (!scope.caller.turnId) throw new Error("Das TypeScript-Snippet braucht einen laufenden Turn.");
                scope.runtime.recordToolCallSource(scope.context(id, "source"), scope.caller.runId, actor.id, {
                    turnId: scope.caller.turnId, toolCallId: id, code, path: input.path ?? null,
                });
                const capabilities = functionsOf(scope).map(descriptorOf);
                let callIndex = 0;
                const output = await executeTypeScriptSnippet({
                    code,
                    capabilities,
                    cwd: processContext.cwd,
                    signal: scope.signal,
                    executor: scope.runtime.nativeTypeScriptExecutor,
                    context: {
                        runId: scope.caller.runId,
                        invocationId: id,
                        actor: { id: actor.id, handle: actor.handle },
                        principal: { id: actor.id, kind: actor.kind === "script" ? "script" : "agent" },
                    },
                    call: (name, value) => scope.invokeFunction(`${id}:function:${++callIndex}`, name, value),
                });
                return { result: output.result, logs: output.logs };
            },
        }),
    ];
    return {
        name: "ragents.typescript",
        descriptors: tools.map((entry) => ({
            name: entry.name,
            description: entry.description,
            nativeTool: true,
            scope: "per-turn",
            availability: "conditional",
            availabilityDetail: "Für aktive ausführbare Actors mit einer Funktionsauswahl.",
        })),
        tools: () => tools,
    };
};

/** The profile registers them once while composing; the engine finds them among the tools of the host. */
export const registerTypeScriptFunctions = (host: PluginHost): void => {
    host.tools.register("ragents.runtime", [createTypeScriptToolContributor({
        serverProcessContextFor: (runId) => host.service(sandboxServicesToken).serverProcessContextFor(runId),
        execute: (runId, operation, input, options) => host.service(sandboxServicesToken).execute(runId, operation, input, options),
    })]);
};
