import { randomUUID } from "node:crypto";
import { closeSync, fsyncSync, openSync } from "node:fs";
import { access, chmod, mkdir, open, readFile, rename } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";

import {
    createAgentSessionFromServices,
    createAgentSessionRuntime,
    createAgentSessionServices,
    defineTool,
    CURRENT_SESSION_VERSION,
    SessionManager,
    type AgentSession,
    type SessionEntry,
    type AgentSessionRuntime,
    type CreateAgentSessionRuntimeFactory,
    type ExtensionAPI,
    type ExtensionContext,
    type ExtensionError,
    type InlineExtension,
    type ModelRuntime,
    type Skill,
} from "@ragents/agent";
import type { UserMessage } from "@ragents/ai";

import { ignoredFieldsNotice } from "../agents/toolset.ts";
import { assertJsonValue, type JsonValue } from "../domain/json.ts";
import { addUsage, emptyUsage, type TurnUsage } from "../domain/model.ts";
import { type TurnRequest, type TurnResult } from "./types.ts";
import {
    createSkillPreloadExtension,
    type SkillPreloadConfiguration,
} from "./skill-preload.ts";
import { prepareInputAttachments } from "./attachments.ts";
import type { ThinkingLevel } from "../domain/driver.ts";

export type AgentRuntimeContext = {
    runId: string;
    agentId: string;
    /** The working directory of the workspace tools; a runtime stays bound to it, and it is never a local path of this runtime. */
    workspace: string;
    allowedToolNames: readonly string[] | null;
    forkOf: string | null;
};

export type AgentRuntimeDiagnostic = {
    type: "warning" | "error";
    message: string;
    context: AgentRuntimeContext;
};

export type AgentSessionStore = {
    directory: (runId: string, agentId: string) => string | undefined;
    directoryMode: number;
};

export type AgentRuntimeManagerOptions = {
    modelRuntime: ModelRuntime | Promise<ModelRuntime>;
    /** The skills of an agent, read and checked by the host. */
    resolveSkills?: (
        context: AgentRuntimeContext,
        signal: AbortSignal,
    ) => readonly Skill[] | Promise<readonly Skill[]>;
    skillPreload?: false | SkillPreloadConfiguration;
    thinkingLevel?: ThinkingLevel;
    sessions?: AgentSessionStore;
    extensionFactories?: readonly InlineExtension[];
    resolveExtensionFactories?: (
        context: AgentRuntimeContext,
        signal: AbortSignal,
    ) => readonly InlineExtension[] | Promise<readonly InlineExtension[]>;
    turnAbortTimeoutMs?: number;
    onDiagnostic?: (diagnostic: AgentRuntimeDiagnostic) => void;
};

type AgentUsage = {
    input: number;
    output: number;
    cacheRead: number;
    cacheWrite: number;
    cost?: { total?: number };
};

type RuntimeConfiguration = {
    selection: TurnRequest<"agent">["selection"];
    systemPrompt: string;
};

const errorMessage = (error: unknown) => (error instanceof Error ? error.message : String(error));

const sameToolNames = (left: readonly string[] | null, right: readonly string[] | null) =>
    left === null || right === null
        ? left === right
        : left.length === right.length && left.every((name, index) => name === right[index]);

const assertUniqueSkillNames = (skills: readonly Skill[]) => {
    for (const name of new Set(skills.map((skill) => skill.name))) {
        const paths = skills.filter((skill) => skill.name === name).map((skill) => skill.filePath);

        if (paths.length > 1)
            throw new Error(`Der Skill ${name} ist mehrfach vorhanden: ${paths.join(", ")}.`);
    }
};

const DEFAULT_TURN_ABORT_TIMEOUT_MS = 5_000;

const turnAbortTimeout = (value: number | undefined) => {
    const timeout = value ?? DEFAULT_TURN_ABORT_TIMEOUT_MS;

    if (!Number.isSafeInteger(timeout) || timeout < 1)
        throw new RangeError("agent turn abort timeout must be a positive integer.");

    return timeout;
};

const abortReason = (signal: AbortSignal) =>
    signal.reason instanceof Error ? signal.reason : new Error("agent runtime creation was aborted.");

const awaitWithSignal = <T>(operation: PromiseLike<T> | T, signal: AbortSignal): Promise<T> => {
    if (signal.aborted)
        return Promise.reject(abortReason(signal));

    return new Promise<T>((resolvePromise, rejectPromise) => {
        const abort = () => rejectPromise(abortReason(signal));
        signal.addEventListener("abort", abort, { once: true });
        Promise.resolve(operation)
            .then(resolvePromise, rejectPromise)
            .finally(() => signal.removeEventListener("abort", abort));
    });
};

class TurnAbortDeadline {
    readonly #signal: AbortSignal;
    readonly #timeoutMs: number;
    #deadlineAt: number | undefined;
    readonly #markAborted = () => {
        this.#deadlineAt ??= Date.now() + this.#timeoutMs;
    };

    constructor(signal: AbortSignal, timeoutMs: number) {
        this.#signal = signal;
        this.#timeoutMs = timeoutMs;

        if (signal.aborted)
            this.#markAborted();
        else
            signal.addEventListener("abort", this.#markAborted, { once: true });
    }

    wait<T>(operation: PromiseLike<T> | T): Promise<T> {
        const pending = Promise.resolve(operation);

        return new Promise<T>((resolvePromise, rejectPromise) => {
            let settled = false;
            let timer: ReturnType<typeof setTimeout> | undefined;
            const cleanup = () => {
                this.#signal.removeEventListener("abort", armDeadline);

                if (timer)
                    clearTimeout(timer);
            };
            const resolve = (value: T) => {
                if (settled)
                    return;

                settled = true;
                cleanup();
                resolvePromise(value);
            };
            const reject = (error: unknown) => {
                if (settled)
                    return;

                settled = true;
                cleanup();
                rejectPromise(error);
            };
            const armDeadline = () => {
                this.#markAborted();
                const remaining = Math.max(0, (this.#deadlineAt ?? Date.now()) - Date.now());
                timer = setTimeout(
                    () => reject(new Error(`agent turn did not settle within ${this.#timeoutMs} ms after abort.`)),
                    remaining,
                );
            };

            pending.then(resolve, reject);

            if (this.#signal.aborted)
                armDeadline();
            else
                this.#signal.addEventListener("abort", armDeadline, { once: true });
        });
    }

    dispose() {
        this.#signal.removeEventListener("abort", this.#markAborted);
    }
}

const syncFile = (file: string) => {
    const descriptor = openSync(file, "r+");

    try {
        fsyncSync(descriptor);
    } finally {
        closeSync(descriptor);
    }
};

const syncDirectory = async (directory: string) => {
    const handle = await open(directory, "r");

    try {
        await handle.sync();
    } finally {
        await handle.close();
    }
};

const writeDurably = async (file: string, content: string) => {
    const handle = await open(file, "wx");

    try {
        await handle.writeFile(content);
        await handle.sync();
    } finally {
        await handle.close();
    }
};

const usageOf = (usage: AgentUsage | undefined): TurnUsage => ({
    inputTokens: usage?.input ?? 0,
    outputTokens: usage?.output ?? 0,
    cacheReadTokens: usage?.cacheRead ?? 0,
    cacheWriteTokens: usage?.cacheWrite ?? 0,
    costUsd: usage?.cost?.total ?? 0,
});

const asJson = (value: unknown) => {
    try {
        return JSON.stringify(value ?? {});
    } catch {
        return String(value);
    }
};

const asJsonValue = (value: unknown): JsonValue => JSON.parse(asJson(value)) as JsonValue;

/** The conversation and its latest compaction; a new session or a compaction yields another model context. */
const modelContextOf = (branch: readonly SessionEntry[]): string =>
    `${branch[0]?.id ?? ""}:${branch.findLast((entry) => entry.type === "compaction")?.id ?? ""}`;

const asText = (value: unknown): string => {
    if (typeof value === "string")
        return value;

    const content = (value as { content?: unknown })?.content;

    if (Array.isArray(content)) {
        const texts = content
            .filter((entry): entry is { type: string; text: string } => (entry as { type?: string })?.type === "text")
            .map((entry) => entry.text);

        if (texts.length > 0)
            return texts.join("\n");
    }

    return asJson(value);
};

export const turnDispatcherExtensionName = "ragents-turn-dispatcher";

export type TurnAbortLatch = {
    request: () => Promise<void> | null;
    accept: () => void;
    reapply: () => Promise<void> | null;
    pending: () => Promise<void> | null;
};

export const createTurnAbortLatch = (abort: () => Promise<void>): TurnAbortLatch => {
    let requested = false;
    let accepted = false;
    let pending: Promise<void> = Promise.resolve();
    let applied = false;
    const apply = () => {
        applied = true;
        pending = Promise.all([pending, abort()]).then(() => undefined);
        void pending.catch(() => undefined);

        return pending;
    };

    return {
        request: () => {
            requested = true;

            if (!accepted)
                return null;

            return applied ? pending : apply();
        },
        accept: () => {
            if (requested)
                throw new Error("The agent turn was aborted before agent start.");

            accepted = true;
        },
        reapply: () => requested && accepted ? apply() : null,
        pending: () => applied ? pending : null,
    };
};

class TurnDispatcher {
    readonly #context: AgentRuntimeContext;
    readonly #onDiagnostic: ((diagnostic: AgentRuntimeDiagnostic) => void) | undefined;
    #api: ExtensionAPI | null = null;
    #registeredNames = new Set<string>();
    #activeManagedNames = new Set<string>();
    readonly #directToolCalls = new Map<string, { name: string; input: unknown }>();
    readonly #unexecutedManagedCalls = new Map<string, { name: string; input: JsonValue }>();
    #turn: {
        request: TurnRequest<"agent">;
        signal: AbortSignal;
        usage: TurnUsage;
        failure: string | null;
        modelFailure: string | null;
        pendingText: string;
    } | null = null;

    constructor(context: AgentRuntimeContext, onDiagnostic: ((diagnostic: AgentRuntimeDiagnostic) => void) | undefined) {
        this.#context = context;
        this.#onDiagnostic = onDiagnostic;
    }

    extension(): InlineExtension {
        return {
            name: turnDispatcherExtensionName,
            factory: (agent) => {
                this.#api = agent;
            },
        };
    }

    initialize() {
        const api = this.#requiredApi();
        this.#registeredNames = new Set();
        api.setActiveTools([]);

        if (this.#turn)
            this.#configureTools(this.#turn.request);
    }

    unknownToolError(name: string): string | undefined {
        const turn = this.#turn;
        if (!turn || turn.signal.aborted)
            return undefined;

        return `Die Funktion ${name} ist kein natives Werkzeug. Suche ihren Vertrag mit typescript_api und rufe sie in typescript_eval über context.functions auf.`;
    }

    /** The running turn that may still take steering; null between turns and after an abort. */
    steerableTurn(): TurnRequest<"agent"> | null {
        const turn = this.#turn;

        return turn && !turn.signal.aborted ? turn.request : null;
    }

    activate(request: TurnRequest<"agent">, signal: AbortSignal) {
        if (this.#turn)
            throw new Error(`agent ${request.agentId} already has an active turn.`);

        this.#configureTools(request);
        this.#turn = { request, signal, usage: emptyUsage(), failure: null, modelFailure: null, pendingText: "" };
    }

    async refreshTools(): Promise<string | undefined> {
        const turn = this.#turn;
        if (!turn?.request.refreshTools) return undefined;
        turn.signal.throwIfAborted();
        const snapshot = await turn.request.refreshTools();
        turn.signal.throwIfAborted();
        if (this.#turn !== turn) throw new Error("The agent turn ended while refreshing tools.");
        Object.assign(turn.request, snapshot);
        this.#configureTools(turn.request);
        return snapshot.systemPrompt;
    }

    deactivate() {
        if (
            !this.#turn &&
            this.#activeManagedNames.size === 0 &&
            this.#directToolCalls.size === 0 &&
            this.#unexecutedManagedCalls.size === 0
        )
            return;

        const turn = this.#turn;
        this.#turn = null;
        this.#activeManagedNames.clear();
        this.#directToolCalls.clear();
        this.#unexecutedManagedCalls.clear();

        this.#api?.setActiveTools([]);

        if (turn?.signal.aborted)
            this.#recordInterruptedOutput(turn);
    }

    result(): { failure: string | null; usage: TurnUsage } {
        return this.#turn
            ? { failure: this.#turn.failure ?? this.#turn.modelFailure, usage: this.#turn.usage }
            : { failure: null, usage: emptyUsage() };
    }

    addUsage(usage: TurnUsage) {
        if (this.#turn)
            this.#turn.usage = addUsage(this.#turn.usage, usage);
    }

    #recordInterruptedOutput(turn = this.#turn) {
        if (!turn?.pendingText.trim())
            return;

        turn.request.emit({ kind: "assistant-interrupted", text: turn.pendingText });
        turn.pendingText = "";
    }

    handleExtensionError(error: ExtensionError) {
        const message = `agent extension ${error.extensionPath} failed during ${error.event}: ${error.error}`;

        if (this.#turn)
            this.#turn.failure ??= message;
        else
            this.#onDiagnostic?.({ type: "error", message, context: this.#context });
    }

    handleEvent(raw: unknown) {
        const turn = this.#turn;

        if (!turn)
            return;

        const event = raw as Record<string, unknown>;

        if (event.type === "message_update") {
            if (turn.signal.aborted)
                return;

            const delta = event.assistantMessageEvent as { type?: string; delta?: string } | undefined;

            if (delta?.type === "text_delta" && delta.delta) {
                turn.pendingText += delta.delta;
                turn.request.publish({ kind: "text", delta: delta.delta });
            } else if (delta?.type === "thinking_delta" && delta.delta)
                turn.request.publish({ kind: "thinking", delta: delta.delta });

            return;
        }

        if (event.type === "tool_execution_start") {
            const id = String(event.toolCallId);
            const name = String(event.toolName);
            turn.request.publish({
                kind: "tool",
                id,
                name,
                arguments: asJson(event.args),
            });

            if (this.#activeManagedNames.has(name)) {
                this.#unexecutedManagedCalls.set(id, { name, input: asJsonValue(event.args) });
            } else {
                assertJsonValue(event.args, `agent tool ${name} input`);
                this.#directToolCalls.set(id, { name, input: event.args });
                turn.request.recordTool?.({ kind: "started", id, name, input: event.args });
            }

            return;
        }

        if (event.type === "tool_execution_end") {
            const id = String(event.toolCallId);
            turn.request.publish({
                kind: "tool-result",
                id,
                result: asText(event.result),
                isError: event.isError === true,
            });

            const unexecuted = this.#unexecutedManagedCalls.get(id);

            if (unexecuted) {
                this.#unexecutedManagedCalls.delete(id);

                if (event.isError === true) {
                    turn.request.recordTool?.({
                        kind: "started",
                        id,
                        name: unexecuted.name,
                        input: unexecuted.input,
                    });
                    turn.request.recordTool?.({
                        kind: "failed",
                        id,
                        name: unexecuted.name,
                        error: asText(event.result),
                    });
                }
            }

            const direct = this.#directToolCalls.get(id);

            if (direct) {
                this.#directToolCalls.delete(id);
                const output = asText(event.result);
                turn.request.recordTool?.(event.isError === true
                    ? { kind: "failed", id, name: direct.name, error: output }
                    : { kind: "completed", id, name: direct.name, output });
            }

            return;
        }

        if (event.type !== "message_end")
            return;

        const message = event.message as {
            role?: string;
            usage?: AgentUsage;
            content?: Array<{ type: string; text?: string; thinking?: string }>;
            stopReason?: string;
            errorMessage?: string;
        };

        if (message.role !== "assistant")
            return;

        turn.usage = addUsage(turn.usage, usageOf(message.usage));

        if (turn.signal.aborted || message.stopReason === "aborted") {
            this.#recordInterruptedOutput(turn);
            turn.failure ??= "The agent turn was aborted.";
            return;
        }

        turn.pendingText = "";
        for (const entry of message.content ?? []) {
            if (entry.type === "text" && entry.text?.trim())
                turn.request.emit({ kind: "assistant", text: entry.text.trim() });
            else if (entry.type === "thinking" && entry.thinking?.trim())
                turn.request.emit({ kind: "reasoning", text: entry.thinking.trim() });
        }

        // The session retries or compacts after a provider error, so only the last answer decides.
        turn.modelFailure = message.stopReason === "error"
            ? message.errorMessage ?? "The model provider returned an error."
            : null;
    }

    #configureTools(request: TurnRequest<"agent">) {
        const api = this.#requiredApi();
        const requestedNames = new Set<string>();
        const allowedNames = request.allowedToolNames === null ? null : new Set(request.allowedToolNames);

        if (allowedNames && allowedNames.size !== request.allowedToolNames?.length)
            throw new Error(`agent ${request.agentId} received duplicate allowed tool names.`);

        if (allowedNames) {
            const outside = request.tools
                .map((tool) => tool.name)
                .filter((name) => !["typescript_api", "typescript_eval"].includes(name) && !allowedNames.has(name));

            if (outside.length > 0)
                throw new Error(`Der Agent erhielt Werkzeuge außerhalb seiner Freigabeliste: ${[...new Set(outside)].join(", ")}.`);
        }

        for (const entry of request.tools) {
            if (requestedNames.has(entry.name))
                throw new Error(`RAgents supplied duplicate agent tool ${entry.name}.`);

            requestedNames.add(entry.name);
            const existing = api.getAllTools().find((tool) => tool.name === entry.name);

            if (existing && !this.#registeredNames.has(entry.name))
                throw new Error(`RAgents tool ${entry.name} conflicts with agent extension tool ${existing.sourceInfo.path}.`);

            api.registerTool(
                defineTool({
                    name: entry.name,
                    label: entry.label,
                    description: [entry.description, entry.longDescription].filter(Boolean).join("\n\n"),
                    parameters: entry.schema,
                    executionMode:
                        entry.executionMode ??
                        (entry.name.startsWith("agent_") ? "sequential" : "parallel"),
                    execute: async (toolCallId: string, params: unknown, toolSignal: AbortSignal | undefined, _onUpdate: unknown, context: ExtensionContext) => {
                        const current = this.#turn;

                        if (!current)
                            throw new Error(`agent tool ${entry.name} was called outside an RAgents turn.`);

                        if (current.signal.aborted || toolSignal?.aborted)
                            throw new Error(`agent tool ${entry.name} was aborted.`);

                        assertJsonValue(params, `agent tool ${entry.name} input`);
                        this.#unexecutedManagedCalls.delete(toolCallId);
                        const call = await current.request.invoke(toolCallId, entry.name, params, modelContextOf(context.sessionManager.getBranch()));
                        const text = typeof call.output === "string" ? call.output : asJson(call.output);

                        return {
                            content: [{
                                type: "text" as const,
                                text: call.ignoredFields.length === 0 ? text : `${ignoredFieldsNotice(entry, call.ignoredFields)}\n\n${text}`,
                            }],
                            details: {},
                        };
                    },
                }),
            );
            this.#registeredNames.add(entry.name);
        }

        this.#activeManagedNames = requestedNames;
        api.setActiveTools([...requestedNames]);
    }

    #requiredApi() {
        if (!this.#api)
            throw new Error(`agent extensions are not bound for agent ${this.#context.agentId}.`);

        return this.#api;
    }
}

type SessionIdentityRecord = {
    version: 1;
    runId: string;
    agentId: string;
    sessionId: string;
    file: string;
};

/** The source branch up to its last finished exchange, without unfinished tool calls and without reasoning. */
export const forkableBranch = (branch: readonly SessionEntry[]): SessionEntry[] => {
    const answered = new Set(branch.flatMap((entry) =>
        entry.type === "message" && entry.message.role === "toolResult" ? [entry.message.toolCallId] : []));
    const unfinished = (entry: SessionEntry) =>
        entry.type === "message" && entry.message.role === "assistant"
        && entry.message.content.some((block) => block.type === "toolCall" && !answered.has(block.id));
    const end = branch.findIndex(unfinished);
    const kept = end === -1 ? branch : branch.slice(0, end);

    return kept.map((entry) => entry.type === "message" && entry.message.role === "assistant"
        ? { ...entry, message: { ...entry.message, content: entry.message.content.filter((block) => block.type !== "thinking") } }
        : entry);
};

class PersistedAgentSession {
    readonly #context: AgentRuntimeContext;
    readonly #store: AgentSessionStore | undefined;
    readonly #runtimeDirectory: string;
    #directory: string | null = null;
    #signature: string | null = null;

    constructor(context: AgentRuntimeContext, store: AgentSessionStore | undefined, runtimeDirectory: string) {
        this.#context = context;
        this.#store = store;
        this.#runtimeDirectory = runtimeDirectory;
    }

    async open(): Promise<SessionManager> {
        if (!this.#store)
            return SessionManager.inMemory(this.#runtimeDirectory);

        const configuredDirectory = this.#store.directory(this.#context.runId, this.#context.agentId);

        if (!configuredDirectory)
            return SessionManager.inMemory(this.#runtimeDirectory);

        this.#directory = resolve(configuredDirectory);
        await mkdir(this.#directory, { recursive: true, mode: this.#store.directoryMode });
        await chmod(this.#directory, this.#store.directoryMode);
        const stored = await this.#readMarker();

        if (stored) {
            const manager = await this.#openStored(stored);
            this.#signature = `${stored.sessionId}\u0000${resolve(this.#directory, stored.file)}`;

            return manager;
        }

        const manager = this.#context.forkOf ? await this.#forkedManager(this.#context.forkOf) : await this.#newManager();
        await this.persist(manager.getSessionFile(), manager.getSessionId());

        return manager;
    }

    async persist(file: string | undefined, sessionId: string) {
        if (!file || !this.#store)
            return;

        const resolvedFile = resolve(file);

        if (this.#directory && dirname(resolvedFile) !== this.#directory)
            throw new Error(`agent session ${resolvedFile} is outside its configured directory ${this.#directory}.`);

        const signature = `${sessionId}\u0000${resolvedFile}`;

        if (signature === this.#signature)
            return;

        if (this.#directory) {
            const marker = this.#markerPath();
            const temporary = `${marker}.${process.pid}.${randomUUID()}.tmp`;
            const record: SessionIdentityRecord = {
                version: 1,
                runId: this.#context.runId,
                agentId: this.#context.agentId,
                sessionId,
                file: basename(resolvedFile),
            };
            await writeDurably(temporary, `${JSON.stringify(record, null, 2)}\n`);
            await rename(temporary, marker);
            await syncDirectory(this.#directory);
        }

        this.#signature = signature;
    }

    async #newManager() {
        if (!this.#directory)
            return SessionManager.inMemory(this.#runtimeDirectory);

        const file = join(this.#directory, `ragents-${randomUUID()}.jsonl`);
        await writeDurably(file, "");
        await syncDirectory(this.#directory);
        const manager = SessionManager.open(file, this.#directory, this.#runtimeDirectory);
        syncFile(file);

        return manager;
    }

    async #forkedManager(sourceAgentId: string) {
        if (!this.#directory || !this.#store)
            throw new Error("Forking an agent session requires a session directory.");

        const sourceDirectory = this.#store.directory(this.#context.runId, sourceAgentId);

        if (!sourceDirectory)
            throw new Error(`Fork source ${sourceAgentId} has no persisted session directory.`);

        const record = await this.#readMarker(join(resolve(sourceDirectory), "active-session.json"), sourceAgentId);

        if (!record)
            throw new Error(`Fork source ${sourceAgentId} has no model context yet.`);

        const sourceFile = resolve(sourceDirectory, record.file);
        const source = SessionManager.open(sourceFile, resolve(sourceDirectory), this.#runtimeDirectory);
        const header = {
            type: "session",
            version: CURRENT_SESSION_VERSION,
            id: randomUUID(),
            timestamp: new Date().toISOString(),
            cwd: this.#runtimeDirectory,
            parentSession: sourceFile,
        };
        const lines = [header, ...forkableBranch(source.getBranch())].map((entry) => JSON.stringify(entry)).join("\n");
        const file = join(this.#directory, `ragents-${randomUUID()}.jsonl`);
        await writeDurably(file, `${lines}\n`);
        await syncDirectory(this.#directory);
        const manager = SessionManager.open(file, this.#directory, this.#runtimeDirectory);
        syncFile(file);

        return manager;
    }

    async #readMarker(marker = this.#markerPath(), agentId = this.#context.agentId): Promise<SessionIdentityRecord | null> {
        let content: string;

        try {
            content = await readFile(marker, "utf8");
        } catch (error) {
            if ((error as NodeJS.ErrnoException).code === "ENOENT")
                return null;

            throw error;
        }

        let candidate: unknown;

        try {
            candidate = JSON.parse(content);
        } catch (error) {
            throw new Error(`agent session identity marker is invalid: ${errorMessage(error)}`);
        }

        const record = candidate as Partial<SessionIdentityRecord>;

        if (
            record.version !== 1 ||
            record.runId !== this.#context.runId ||
            record.agentId !== agentId ||
            typeof record.sessionId !== "string" ||
            !record.sessionId ||
            typeof record.file !== "string" ||
            !record.file ||
            basename(record.file) !== record.file
        )
            throw new Error(`agent session identity marker for ${agentId} has invalid contents.`);

        return record as SessionIdentityRecord;
    }

    async #openStored(record: SessionIdentityRecord) {
        const directory = this.#directory;

        if (!directory)
            throw new Error("A agent session marker requires a session directory.");

        const file = resolve(directory, record.file);
        await access(file);
        const manager = SessionManager.open(file, directory, this.#runtimeDirectory);

        if (manager.getSessionId() !== record.sessionId)
            throw new Error(`agent session identity ${record.sessionId} does not match ${manager.getSessionId()} in ${file}.`);

        return manager;
    }

    #markerPath() {
        if (!this.#directory)
            throw new Error("A agent session marker requires a session directory.");

        return join(this.#directory, "active-session.json");
    }
}

class ManagedAgentRuntime {
    readonly #context: AgentRuntimeContext;
    readonly #runtime: AgentSessionRuntime;
    readonly #dispatcher: TurnDispatcher;
    readonly #identity: PersistedAgentSession;
    readonly #configuration: RuntimeConfiguration;
    readonly #modelRuntime: ModelRuntime;
    readonly #defaultThinking: ThinkingLevel | undefined;
    readonly #turnAbortTimeoutMs: number;
    readonly #onDiagnostic: ((diagnostic: AgentRuntimeDiagnostic) => void) | undefined;
    #unsubscribe: (() => void) | null = null;
    #running = false;
    #disposed = false;
    #disposePromise: Promise<void> | null = null;
    #abortActiveTurn: (() => Promise<void> | null) | null = null;
    #idle: Promise<void> = Promise.resolve();
    #resolveIdle: (() => void) | null = null;
    readonly #inFlight = new Set<Promise<unknown>>();

    constructor(options: {
        context: AgentRuntimeContext;
        runtime: AgentSessionRuntime;
        dispatcher: TurnDispatcher;
        identity: PersistedAgentSession;
        configuration: RuntimeConfiguration;
        modelRuntime: ModelRuntime;
        defaultThinking: ThinkingLevel | undefined;
        turnAbortTimeoutMs: number;
        onDiagnostic: ((diagnostic: AgentRuntimeDiagnostic) => void) | undefined;
    }) {
        this.#context = options.context;
        this.#runtime = options.runtime;
        this.#dispatcher = options.dispatcher;
        this.#identity = options.identity;
        this.#configuration = options.configuration;
        this.#modelRuntime = options.modelRuntime;
        this.#defaultThinking = options.defaultThinking;
        this.#turnAbortTimeoutMs = options.turnAbortTimeoutMs;
        this.#onDiagnostic = options.onDiagnostic;
    }

    async start() {
        await this.#bind(this.#runtime.session);
    }

    async runTurn(request: TurnRequest<"agent">, signal: AbortSignal): Promise<TurnResult> {
        if (this.#disposed || this.#disposePromise)
            throw new Error(`agent runtime for ${request.agentId} is stopping or disposed.`);

        if (this.#running)
            throw new Error(`agent runtime for ${request.agentId} cannot run concurrent turns.`);

        const promptChanged = request.systemPrompt !== this.#configuration.systemPrompt;
        const stopController = new AbortController();
        const turnSignal = AbortSignal.any([signal, stopController.signal]);
        this.#running = true;
        this.#idle = new Promise<void>((resolveIdle) => {
            this.#resolveIdle = resolveIdle;
        });
        this.#configuration.selection = request.selection;
        const abortLatch = createTurnAbortLatch(() => this.#runtime.session.abort());
        const abortDeadline = new TurnAbortDeadline(turnSignal, this.#turnAbortTimeoutMs);
        const abort = () => void abortLatch.request();
        const abortTurn = () => {
            stopController.abort(new Error(`agent runtime ${request.runId}/${request.agentId} is stopping.`));

            return abortLatch.request();
        };
        this.#abortActiveTurn = abortTurn;

        turnSignal.addEventListener("abort", abort, { once: true });

        try {
            if (turnSignal.aborted) {
                abortLatch.request();

                return this.#abortedResult();
            }

            if (promptChanged) {
                this.#configuration.systemPrompt = request.systemPrompt;
                this.#runtime.session.setSystemPrompt(request.systemPrompt);
            }

            await abortDeadline.wait(this.#track(this.#selectModel(request)));

            if (turnSignal.aborted) {
                return this.#abortedResult();
            }

            this.#dispatcher.activate(request, turnSignal);
            await abortDeadline.wait(this.#track(this.#refreshTools()));

            const prepared = await prepareInputAttachments(request, this.#runtime.session.model?.input ?? []);

            if (turnSignal.aborted) {
                abortLatch.request();
            } else {
                await abortDeadline.wait(this.#track(this.#runtime.session.prompt(prepared.prompt, {
                    attachments: prepared.attachments,
                    preflightResult: (accepted) => {
                        if (!accepted)
                            return;

                        abortLatch.accept();
                        queueMicrotask(() => void abortLatch.reapply());
                    },
                })));
            }

            const abortPromise = abortLatch.pending();

            if (abortPromise)
                await abortDeadline.wait(this.#track(abortPromise));

            return turnSignal.aborted
                ? this.#abortedResult()
                : this.#dispatcher.result();
        } catch (error) {
            const result = this.#dispatcher.result();

            return turnSignal.aborted
                ? this.#abortedResult()
                : { failure: result.failure ?? errorMessage(error), usage: result.usage };
        } finally {
            try {
                turnSignal.removeEventListener("abort", abort);
                this.#dispatcher.deactivate();
                if (this.#abortActiveTurn === abortTurn)
                    this.#abortActiveTurn = null;

                await abortDeadline.wait(
                    this.#track(
                        this.#identity.persist(this.#runtime.session.sessionFile, this.#runtime.session.sessionId),
                    ),
                );
            } finally {
                abortDeadline.dispose();
                this.#running = false;
                this.#resolveIdle?.();
                this.#resolveIdle = null;
            }
        }
    }

    dispose(): Promise<void> {
        if (this.#disposed)
            return Promise.resolve();

        if (this.#disposePromise)
            return this.#disposePromise;

        this.#disposePromise = this.#disposeInner()
            .then(() => {
                this.#disposed = true;
            })
            .catch((error: unknown) => {
                this.#disposePromise = null;
                throw error;
            });

        return this.#disposePromise;
    }

    async #disposeInner() {
        const idle = this.#running ? this.#idle : Promise.resolve();

        if (this.#running)
            this.#abortActiveTurn?.();

        this.#unsubscribe?.();
        this.#unsubscribe = null;
        this.#dispatcher.deactivate();
        const active = await Promise.allSettled([this.#runtime.dispose(), idle]);
        const persistence = await Promise.allSettled([
            this.#identity.persist(this.#runtime.session.sessionFile, this.#runtime.session.sessionId),
        ]);

        for (const result of [...active, ...persistence]) {
            if (result.status === "rejected")
                throw result.reason;
        }
    }

    waitForSettlement(): Promise<void> {
        return Promise.allSettled([...this.#inFlight, this.#runtime.waitForSettlement()]).then(() => undefined);
    }

    #track<T>(operation: PromiseLike<T> | T): Promise<T> {
        const pending = Promise.resolve(operation);
        this.#inFlight.add(pending);
        void pending.then(
            () => this.#inFlight.delete(pending),
            () => this.#inFlight.delete(pending),
        );

        return pending;
    }

    #abortedResult(): TurnResult {
        const result = this.#dispatcher.result();

        return {
            failure: result.failure ?? "The agent turn was aborted.",
            usage: result.usage,
        };
    }

    async #bind(session: AgentSession) {
        const bindingErrors: ExtensionError[] = [];
        let initializing = true;
        await session.bindExtensions({
            onError: (error) => {
                if (initializing)
                    bindingErrors.push(error);
                else
                    this.#dispatcher.handleExtensionError(error);
            },
        });
        initializing = false;

        if (bindingErrors.length > 0)
            throw new Error(bindingErrors.map((entry) => `${entry.extensionPath}: ${entry.error}`).join("; "));

        this.#dispatcher.initialize();
        const prepareNextTurn = session.agent.prepareNextTurnWithContext;
        session.agent.prepareNextTurnWithContext = async (turn, signal) => {
            await this.#refreshTools();
            return prepareNextTurn?.(turn, signal);
        };
        session.agent.formatUnknownToolError = (name) => this.#dispatcher.unknownToolError(name);
        session.agent.steeringSource = () => this.#steering();
        this.#unsubscribe = session.subscribe((event) => this.#dispatcher.handleEvent(event));
        await this.#identity.persist(session.sessionFile, session.sessionId);
    }

    async #steering(): Promise<UserMessage[]> {
        const request = this.#dispatcher.steerableTurn();

        if (!request)
            return [];

        const messages: UserMessage[] = [];

        for (const steered of request.claimSteering()) {
            const prepared = await prepareInputAttachments(
                { ...request, attachments: steered.attachments, prompt: steered.prompt },
                this.#runtime.session.model?.input ?? [],
            );
            messages.push({ role: "user", content: [{ type: "text", text: prepared.prompt }, ...prepared.attachments], timestamp: Date.now() });
        }

        return messages;
    }

    async #refreshTools(): Promise<void> {
        const systemPrompt = await this.#dispatcher.refreshTools();
        if (systemPrompt !== undefined && systemPrompt !== this.#configuration.systemPrompt) {
            this.#configuration.systemPrompt = systemPrompt;
            this.#runtime.session.setSystemPrompt(systemPrompt);
        }
    }

    async #selectModel(request: TurnRequest<"agent">) {
        const { provider, model: modelId, thinking } = request.selection;
        const model = this.#modelRuntime.getModel(provider, modelId);

        if (!model)
            throw new Error(`Das Modell ${provider}/${modelId} ist nicht konfiguriert.`);

        if (this.#runtime.session.model?.provider !== provider || this.#runtime.session.model.id !== modelId)
            await this.#runtime.session.setModel(model);

        const level = thinking ?? this.#defaultThinking;

        if (!level)
            return;

        const available = this.#runtime.session.getAvailableThinkingLevels();
        if (!available.includes(level))
            throw new Error(`Die Denktiefe ${level} gibt es für ${modelId} nicht; gültig: ${available.join(", ")}.`);

        this.#runtime.session.setThinkingLevel(level);
    }
}

type RuntimeRecord = {
    context: AgentRuntimeContext;
    runtime: Promise<ManagedAgentRuntime>;
    creationAbort: AbortController;
};

export class AgentRuntimeManager {
    readonly #options: AgentRuntimeManagerOptions;
    readonly #modelRuntime: Promise<ModelRuntime>;
    readonly #turnAbortTimeoutMs: number;
    readonly #runtimes = new Map<string, RuntimeRecord>();
    readonly #runSettlements = new Map<string, Set<Promise<void>>>();
    readonly #retiredAgents = new Set<string>();
    readonly #retiredRuns = new Set<string>();
    #stopped = false;
    #shutdownPromise: Promise<void> | null = null;

    constructor(options: AgentRuntimeManagerOptions) {
        this.#options = options;
        this.#modelRuntime = Promise.resolve(options.modelRuntime);
        this.#turnAbortTimeoutMs = turnAbortTimeout(options.turnAbortTimeoutMs);
    }

    async runTurn(request: TurnRequest<"agent">, signal: AbortSignal): Promise<TurnResult> {
        if (this.#stopped)
            throw new Error("The agent runtime manager is shut down.");

        const key = this.#key(request.runId, request.agentId);

        if (this.#retiredRuns.has(request.runId) || this.#retiredAgents.has(key))
            throw new Error(`agent runtime ${request.runId}/${request.agentId} has been retired.`);

        const context: AgentRuntimeContext = {
            runId: request.runId,
            agentId: request.agentId,
            workspace: request.workspace,
            allowedToolNames: request.allowedToolNames === null ? null : [...request.allowedToolNames],
            forkOf: request.forkOf,
        };
        let record = this.#runtimes.get(key);

        if (record && record.context.workspace !== context.workspace)
            throw new Error(`agent runtime workspace changed from ${record.context.workspace} to ${context.workspace}.`);

        if (record && !sameToolNames(record.context.allowedToolNames, context.allowedToolNames))
            throw new Error(`agent runtime tool allow-list changed for ${request.runId}/${request.agentId}.`);

        if (!record) {
            const creationAbort = new AbortController();
            const creationSignal = AbortSignal.any([signal, creationAbort.signal]);
            const runtime = this.#create(context, request, creationSignal);
            record = { context, runtime, creationAbort };
            this.#runtimes.set(key, record);
            void runtime.catch(() => {
                if (this.#runtimes.get(key)?.runtime === runtime)
                    this.#runtimes.delete(key);
            });
        }

        let runtime: ManagedAgentRuntime;

        try {
            runtime = await record.runtime;
        } catch (error) {
            return {
                failure: signal.aborted ? "The agent turn was aborted." : errorMessage(error),
                usage: emptyUsage(),
            };
        }

        return runtime.runTurn(request, signal);
    }

    reviveAgent(runId: string, agentId: string) {
        this.#retiredAgents.delete(this.#key(runId, agentId));
    }

    async disposeAgent(runId: string, agentId: string) {
        const key = this.#key(runId, agentId);
        this.#retiredAgents.add(key);
        const record = this.#runtimes.get(key);

        if (record)
            await this.#disposeRecord(key, record);
    }

    haltRun(runId: string) {
        return this.#disposeRunRuntimes(runId);
    }

    waitForRunSettlement(runId: string): Promise<void> | undefined {
        const settlements = [...(this.#runSettlements.get(runId) ?? [])];

        if (settlements.length === 0)
            return undefined;

        return Promise.allSettled(settlements).then(() => undefined);
    }

    async disposeRun(runId: string) {
        this.#retiredRuns.add(runId);
        await this.#disposeRunRuntimes(runId);
    }

    async #disposeRunRuntimes(runId: string) {
        const records = [...this.#runtimes.entries()].filter(([, entry]) => entry.context.runId === runId);
        const failures: unknown[] = [];

        await Promise.all(records.map(async ([key, entry]) => {
            try {
                await this.#disposeRecord(key, entry);
            } catch (error) {
                failures.push(error);
            }
        }));

        if (failures.length > 0)
            throw new AggregateError(failures, `Failed to dispose ${failures.length} agent runtime(s) for run ${runId}.`);
    }

    shutdown(): Promise<void> {
        this.#stopped = true;

        if (this.#shutdownPromise)
            return this.#shutdownPromise;

        const promise = this.#shutdownOnce();
        this.#shutdownPromise = promise;
        void promise.catch(() => {
            if (this.#shutdownPromise === promise)
                this.#shutdownPromise = null;
        });

        return promise;
    }

    async #shutdownOnce() {
        const records = [...this.#runtimes.entries()];
        const failures: unknown[] = [];

        await Promise.all(records.map(async ([key, entry]) => {
            try {
                await this.#disposeRecord(key, entry);
            } catch (error) {
                failures.push(error);
            }
        }));
        await this.#waitForRunSettlements();

        if (failures.length > 0)
            throw new AggregateError(failures, `Failed to dispose ${failures.length} agent runtime(s) during shutdown.`);
    }

    async #waitForRunSettlements() {
        const waited = new Set<Promise<void>>();

        for (;;) {
            const pending = [...this.#runSettlements.values()]
                .flatMap((settlements) => [...settlements])
                .filter((settlement) => !waited.has(settlement));

            if (pending.length === 0)
                return;

            pending.forEach((settlement) => waited.add(settlement));
            await Promise.allSettled(pending);
        }
    }

    async #create(context: AgentRuntimeContext, request: TurnRequest<"agent">, signal: AbortSignal) {
        const modelRuntime = await awaitWithSignal(this.#modelRuntime, signal);
        const runtimeDirectory = resolve(await awaitWithSignal(request.runtimeDirectory(), signal));
        const identity = new PersistedAgentSession(context, this.#options.sessions, runtimeDirectory);
        const sessionManager = await awaitWithSignal(identity.open(), signal);
        const dispatcher = new TurnDispatcher(context, this.#options.onDiagnostic);
        const managedEnvironment = request.allowedToolNames === null;
        const loadHostFactories = managedEnvironment || (request.allowedToolNames?.length ?? 0) > 0;
        const resolvedFactories = loadHostFactories && this.#options.resolveExtensionFactories
            ? await awaitWithSignal(this.#options.resolveExtensionFactories(context, signal), signal)
            : undefined;
        const skills = managedEnvironment && this.#options.resolveSkills
            ? await awaitWithSignal(this.#options.resolveSkills(context, signal), signal)
            : [];
        assertUniqueSkillNames(skills);
        const skillPreload = skills.length > 0 && this.#options.skillPreload !== false
            ? createSkillPreloadExtension({
                modelRuntime,
                ...this.#options.skillPreload,
                onDiagnostic: (message) => this.#options.onDiagnostic?.({ type: "warning", message, context }),
                onUsage: (usage) => dispatcher.addUsage(usage),
            })
            : null;
        const extensionFactories = [
            ...(loadHostFactories ? this.#options.extensionFactories ?? [] : []),
            ...(resolvedFactories ?? []),
            ...(skillPreload ? [skillPreload] : []),
            dispatcher.extension(),
        ];
        const configuration: RuntimeConfiguration = {
            selection: request.selection,
            systemPrompt: request.systemPrompt,
        };
        const factory: CreateAgentSessionRuntimeFactory = async (runtimeOptions) => {
            const services = await createAgentSessionServices({
                cwd: runtimeOptions.cwd,
                signal: runtimeOptions.signal,
                ...(runtimeOptions.onExtensionFactorySettlement
                    ? { onExtensionFactorySettlement: runtimeOptions.onExtensionFactorySettlement }
                    : {}),
                modelRuntime,
                resourceLoaderOptions: {
                    skills,
                    extensionFactories,
                    systemPrompt: configuration.systemPrompt,
                },
            });
            const extensionErrors = services.resourceLoader.getExtensions().errors;

            if (extensionErrors.length > 0)
                throw new Error(extensionErrors.map((entry) => `${entry.path}: ${entry.error}`).join("; "));

            const { provider, model: modelId, thinking } = configuration.selection;
            const model = modelRuntime.getModel(provider, modelId);

            if (!model)
                throw new Error(`Das Modell ${provider}/${modelId} ist nicht konfiguriert.`);

            runtimeOptions.signal.throwIfAborted();

            const created = await createAgentSessionFromServices({
                services,
                sessionManager: runtimeOptions.sessionManager,
                model,
                ...(thinking ?? this.#options.thinkingLevel
                    ? { thinkingLevel: thinking ?? this.#options.thinkingLevel }
                    : {}),
            });

            return { ...created, services };
        };
        const runtime = await createAgentSessionRuntime(factory, {
            cwd: runtimeDirectory,
            sessionManager,
            signal,
            onExtensionFactorySettlement: (settlement) =>
                this.#rememberRunSettlement(context.runId, settlement),
        });
        const managed = new ManagedAgentRuntime({
            context,
            runtime,
            dispatcher,
            identity,
            configuration,
            modelRuntime,
            defaultThinking: this.#options.thinkingLevel,
            turnAbortTimeoutMs: this.#turnAbortTimeoutMs,
            onDiagnostic: this.#options.onDiagnostic,
        });

        try {
            await awaitWithSignal(managed.start(), signal);
            return managed;
        } catch (error) {
            await managed.dispose().catch(() => undefined);
            throw error;
        }
    }

    async #disposeRecord(key: string, record: RuntimeRecord) {
        record.creationAbort.abort(new Error(`agent runtime ${record.context.runId}/${record.context.agentId} is stopping.`));
        let created = false;
        let runtime: ManagedAgentRuntime | undefined;

        try {
            runtime = await record.runtime;
            created = true;
            await runtime.dispose();
        } catch (error) {
            if (created || !record.creationAbort.signal.aborted)
                throw error;
        } finally {
            if (runtime)
                this.#rememberRunSettlement(record.context.runId, runtime.waitForSettlement());
        }

        if (this.#runtimes.get(key) === record)
            this.#runtimes.delete(key);
    }

    #rememberRunSettlement(runId: string, settlement: Promise<void>) {
        const settlements = this.#runSettlements.get(runId) ?? new Set<Promise<void>>();
        settlements.add(settlement);
        this.#runSettlements.set(runId, settlements);
        void settlement.then(
            () => this.#forgetRunSettlement(runId, settlement),
            () => this.#forgetRunSettlement(runId, settlement),
        );
    }

    #forgetRunSettlement(runId: string, settlement: Promise<void>) {
        const settlements = this.#runSettlements.get(runId);
        settlements?.delete(settlement);

        if (settlements?.size === 0)
            this.#runSettlements.delete(runId);
    }

    #key(runId: string, agentId: string) {
        return JSON.stringify([runId, agentId]);
    }
}
