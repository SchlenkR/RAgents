import { randomUUID } from "node:crypto";
import { inspect } from "node:util";

import { assertJsonValue, type JsonValue } from "../domain/json.ts";
import { scriptStdDeclarations } from "../script/std.ts";
import { compileVirtualTypeScriptAsync } from "./async-compiler.ts";
import type { VirtualTypeScriptDiagnostic } from "./compiler.ts";
import type { NativeTypeScriptExecutor, NativeTypeScriptProgram, NativeTypeScriptRequest } from "./native-executor.ts";
import { createRunContextDeclarations, runCapabilityContract, type RunCapabilityDescriptor } from "./run-context.ts";

const snippetFile = "snippet.ts";

export const typeScriptSnippetDeclarations = (capabilities: readonly RunCapabilityDescriptor[]): string =>
    createRunContextDeclarations({
        capabilities,
        stateType: "Record<string, unknown>",
        program: `${scriptStdDeclarations}\ninterface RAgentsRunContext<State, Capabilities> { readonly std: RAgentsStd; }\ndeclare const context: RunContext;`,
    });

export interface TypeScriptSnippetSource {
    readonly code: string;
    readonly capabilities: readonly RunCapabilityDescriptor[];
    readonly cwd?: string;
    readonly signal?: AbortSignal | undefined;
}

export class TypeScriptSnippetCompilationError extends Error {
    readonly diagnostics: readonly VirtualTypeScriptDiagnostic[];

    constructor(diagnostics: readonly VirtualTypeScriptDiagnostic[]) {
        const original = diagnostics.map((diagnostic) => ({
            ...diagnostic,
            ...(diagnostic.fileName?.endsWith(`/${snippetFile}`) || diagnostic.fileName === snippetFile ? {
                fileName: snippetFile,
                ...(diagnostic.start ? { start: { ...diagnostic.start, line: Math.max(1, diagnostic.start.line - 1) } } : {}),
                ...(diagnostic.end ? { end: { ...diagnostic.end, line: Math.max(1, diagnostic.end.line - 1) } } : {}),
            } : {}),
        }));
        super(`TypeScript-Snippet wurde nicht ausgeführt:\n${original.map((diagnostic) =>
            `${diagnostic.fileName ?? "TypeScript"}${diagnostic.start ? `:${diagnostic.start.line}:${diagnostic.start.column}` : ""} TS${diagnostic.code}: ${diagnostic.message}`,
        ).join("\n")}`);
        this.name = "TypeScriptSnippetCompilationError";
        this.diagnostics = original;
    }
}

export const compileTypeScriptSnippet = async (source: TypeScriptSnippetSource): Promise<NativeTypeScriptProgram> => {
    source.signal?.throwIfAborted();
    if (!source.code.trim()) throw new Error("Das TypeScript-Snippet darf nicht leer sein.");
    const compiled = await compileVirtualTypeScriptAsync({
        sources: [{ fileName: snippetFile, text: `export async function handle(_input: unknown, context: RunContext) {\n${source.code}\n}\n` }],
        declarations: [{ fileName: "snippet-context.d.ts", text: typeScriptSnippetDeclarations(source.capabilities) }],
        contract: runCapabilityContract(source.capabilities),
        emit: "node",
        ...(source.cwd ? { rootDirectory: source.cwd } : {}),
    }, { signal: source.signal });
    if (!compiled.valid) throw new TypeScriptSnippetCompilationError(compiled.diagnostics);
    source.signal?.throwIfAborted();
    return { entry: "snippet.js", exportName: "handle", files: [...compiled.emittedFiles] };
};

export interface TypeScriptSnippetExecution extends TypeScriptSnippetSource {
    readonly executor: NativeTypeScriptExecutor;
    readonly context: Omit<NativeTypeScriptRequest["context"], "capabilities" | "invocationKind" | "actor"> & {
        readonly actor: NonNullable<NativeTypeScriptRequest["context"]["actor"]>;
    };
    readonly call: (name: string, input: JsonValue) => Promise<JsonValue>;
}

export interface TypeScriptSnippetResult {
    readonly result: JsonValue;
    readonly logs: string[];
}

export class TypeScriptSnippetExecutionError extends Error {
    readonly logs: readonly string[];

    constructor(cause: unknown, logs: readonly string[]) {
        super(`TypeScript-Snippet fehlgeschlagen: ${cause instanceof Error ? cause.message : String(cause)}${logs.length > 0 ? `\nLogs vor dem Fehler:\n${logs.join("\n")}` : ""}`, { cause });
        this.name = "TypeScriptSnippetExecutionError";
        this.logs = [...logs];
    }
}

export const executeTypeScriptSnippet = async (execution: TypeScriptSnippetExecution): Promise<TypeScriptSnippetResult> => {
    const program = await compileTypeScriptSnippet(execution);
    const instanceId = `snippet-${randomUUID()}`;
    const logs: string[] = [];
    let failure: TypeScriptSnippetExecutionError | undefined;
    try {
        execution.signal?.throwIfAborted();
        const output = await execution.executor.execute({
            program,
            input: null,
            state: {},
            std: { now: new Date().toISOString(), idPrefix: execution.context.invocationId },
            context: { ...execution.context, invocationKind: "snippet", capabilities: execution.capabilities },
            instanceId,
            ...(execution.cwd ? { cwd: execution.cwd } : {}),
        }, {
            signal: execution.signal,
            call: execution.call,
            log: (value) => logs.push(typeof value === "string" ? value : inspect(value, { depth: 8, maxArrayLength: 100, maxStringLength: 16_000 })),
        });
        execution.signal?.throwIfAborted();
        const returned = output.result === undefined ? null : output.result;
        assertJsonValue(returned, "TypeScript-Snippet result");
        const result: JsonValue = JSON.parse(JSON.stringify(returned));
        return { result, logs };
    } catch (error) {
        failure = new TypeScriptSnippetExecutionError(error, logs);
        throw failure;
    } finally {
        try {
            await execution.executor.stopInstance(execution.context.runId, instanceId);
        } catch (error) {
            if (failure) throw new AggregateError([failure, error], `${failure.message}\nDie Snippet-Instanz konnte nicht vollständig beendet werden: ${error instanceof Error ? error.message : String(error)}`);
            throw new TypeScriptSnippetExecutionError(error, logs);
        }
    }
};
