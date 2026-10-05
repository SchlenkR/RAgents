import { setTimeout as sleep } from "node:timers/promises";

import {
    Agent,
    type AgentEvent,
    type AgentLoopTurnUpdate,
    type AgentMessage,
    type AgentSettings,
    type AgentTool,
    compact,
    compactionOf,
    contextMessages,
    convertToLlm,
    EMPTY_RESPONSE_NUDGE,
    estimateContextTokens,
    formatSkillsForPrompt,
    isRunFailure,
    type ModelRuntime,
    prepareCompaction,
    shouldCompact,
    type Skill,
    type ThinkingLevel,
} from "@ragents/agent";
import {
    type AssistantMessage,
    type ImageContent,
    isContextOverflow,
    isRetryableAssistantError,
    type Model,
    type TextContent,
    type ToolCall,
    type ToolResultMessage,
    type UserMessage,
} from "@ragents/ai";

import { ignoredFieldsNotice } from "../agents/toolset.ts";
import type { RunFunction } from "../agents/tools.ts";
import { assertJsonValue, type JsonValue } from "../domain/json.ts";
import { addUsage, emptyUsage, type TurnUsage } from "../domain/model.ts";
import type { CompletedModelStep } from "../runtime/decisions/turns.ts";
import type { AgentHook } from "./agent-hooks.ts";
import { prepareInputAttachments } from "./attachments.ts";
import type { SkillPreload } from "./skill-preload.ts";
import type { TurnRequest, TurnResult } from "./types.ts";

type AgentUsage = { input: number; output: number; cacheRead: number; cacheWrite: number; cost?: { total?: number } };

export type AgentTurnOptions = {
    request: TurnRequest<"agent">;
    signal: AbortSignal;
    modelRuntime: ModelRuntime;
    model: Model<any>;
    thinkingLevel: ThinkingLevel;
    skills: readonly Skill[];
    hooks: readonly AgentHook[];
    preload: SkillPreload | null;
    settings: AgentSettings;
    track: <T>(operation: PromiseLike<T> | T) => Promise<T>;
    onDiagnostic: (message: string) => void;
};

const errorMessage = (error: unknown) => (error instanceof Error ? error.message : String(error));

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

const lastAssistantOf = (messages: readonly AgentMessage[]): AssistantMessage | undefined =>
    [...messages].reverse().find((message): message is AssistantMessage => message.role === "assistant");

/** A retry continues behind every failed step at the end, since the journal keeps each of them. */
const withoutTrailingFailures = (messages: readonly AgentMessage[], contextWindow: number) => {
    const failed = (message: AgentMessage | undefined) =>
        message?.role === "assistant" && (message.stopReason === "error" || message.stopReason === "aborted"
            || (message.stopReason === "length" && isContextOverflow(message, contextWindow)));
    let end = messages.length;

    while (failed(messages[end - 1]))
        end--;

    return messages.slice(0, end);
};

/** One turn of an LLM actor on the agent loop; its context is always the projection of the journal. */
export class AgentTurn {
    readonly #options: AgentTurnOptions;
    readonly #request: TurnRequest<"agent">;
    readonly #inputIds = new WeakMap<object, string | null>();
    readonly #unexecutedManagedCalls = new Map<string, { name: string; input: JsonValue }>();
    readonly #directToolCalls = new Map<string, { name: string; input: unknown }>();
    #activeManagedNames = new Set<string>();
    #agent: Agent | null = null;
    #active = true;
    #usage: TurnUsage = emptyUsage();
    #failure: string | null = null;
    #modelFailure: string | null = null;
    #pendingText = "";
    #systemPrompt = "";
    #preloadedSkills = "";
    #contextKey: string | undefined;
    #lastAssistant: AssistantMessage | undefined;
    #retryAttempt = 0;
    #overflowRecoveryAttempted = false;
    #retryAbort: AbortController | null = null;
    #compactionAbort: AbortController | null = null;
    #settled: Promise<void> = Promise.resolve();

    constructor(options: AgentTurnOptions) {
        this.#options = options;
        this.#request = options.request;
    }

    /** Runs the turn up to its last model answer; `onAccepted` marks the point from which an abort reaches the loop. */
    async run(onAccepted: () => void): Promise<void> {
        const { request, signal, model } = this.#options;
        const tools = this.#toolsOf(request);
        this.#setSystemPrompt(request.systemPrompt, tools);
        await this.#refreshTools(tools);
        const prepared = await prepareInputAttachments(request, model.input);

        if (signal.aborted)
            return;

        if (!(await this.#options.modelRuntime.checkAuth(model.provider)))
            throw new Error(`No key is configured for the provider ${model.provider}; it comes from the configuration of the profile.`);

        this.#preloadedSkills = this.#options.preload
            ? (await this.#options.track(this.#options.preload({ prompt: prepared.prompt, skills: this.#options.skills, model, signal }))) ?? ""
            : "";

        if (signal.aborted)
            return;

        const prompt: UserMessage = {
            role: "user",
            content: [{ type: "text", text: prepared.prompt }, ...prepared.attachments],
            timestamp: Date.now(),
        };
        this.#inputIds.set(prompt, request.input.id);
        const agent = this.#agentFor(request.modelContext().messages, tools);
        this.#agent = agent;
        const settled = Promise.withResolvers<void>();
        this.#settled = settled.promise;
        onAccepted();

        try {
            await agent.prompt(prompt);

            while (await this.#afterRun())
                await agent.continue();
        } finally {
            settled.resolve();
        }
    }

    /** Stops the loop, a waiting retry and a running compaction, and waits until the run has settled. */
    async abort(): Promise<void> {
        this.#retryAbort?.abort();
        this.#compactionAbort?.abort();
        this.#agent?.abort();
        await this.#settled;
    }

    result(): TurnResult {
        return { failure: this.#failure ?? this.#modelFailure, usage: this.#usage };
    }

    abortedResult(): TurnResult {
        return { failure: this.#failure ?? "The agent turn was aborted.", usage: this.#usage };
    }

    addUsage(usage: TurnUsage) {
        this.#usage = addUsage(this.#usage, usage);
    }

    /** Ends the turn: no further journal writes, and an aborted turn keeps the text it already streamed. */
    deactivate() {
        if (!this.#active)
            return;

        this.#active = false;
        this.#unexecutedManagedCalls.clear();
        this.#directToolCalls.clear();

        if (this.#options.signal.aborted)
            this.#recordInterruptedOutput();
    }

    #agentFor(messages: readonly AgentMessage[], tools: AgentTool[]): Agent {
        const { modelRuntime, model, thinkingLevel, settings, request } = this.#options;
        const agent: Agent = new Agent({
            initialState: { systemPrompt: this.#currentSystemPrompt(), model, thinkingLevel, tools, messages: [...messages] },
            convertToLlm,
            streamFn: (streamModel, context, options) => {
                const maxRetries = options?.maxRetries ?? settings.providerRequest.maxRetries;

                return modelRuntime.streamSimple(streamModel, context, {
                    ...options,
                    timeoutMs: options?.timeoutMs ?? settings.providerRequest.timeoutMs,
                    ...(maxRetries === undefined ? {} : { maxRetries }),
                    maxRetryDelayMs: options?.maxRetryDelayMs ?? settings.providerRequest.maxRetryDelayMs,
                });
            },
            sessionId: `${request.runId}.${request.agentId}`,
            transformContext: (_messages, signal) => this.#contextForModelCall(signal),
            afterToolCall: async ({ toolCall, result, isError }) => this.#afterToolCall(toolCall.id, toolCall.name, result.content, isError),
            prepareNextTurnWithContext: async (turn): Promise<AgentLoopTurnUpdate> => {
                await this.#refreshTools(agent.state.tools);
                return { context: { ...turn.context, systemPrompt: this.#currentSystemPrompt(), tools: agent.state.tools.slice() } };
            },
            steeringSource: () => this.#steering(),
            formatUnknownToolError: (name) => this.#active && !this.#options.signal.aborted
                ? `The function ${name} is not a native tool. Look up its contract with typescript_api and call it in typescript_eval through context.functions.`
                : undefined,
            maxRetryDelayMs: settings.providerRequest.maxRetryDelayMs,
        });
        agent.subscribe((event: AgentEvent) => this.#handleEvent(event));

        return agent;
    }

    #currentSystemPrompt() {
        return this.#preloadedSkills ? `${this.#systemPrompt}\n\n${this.#preloadedSkills}` : this.#systemPrompt;
    }

    #setSystemPrompt(prompt: string, tools: readonly AgentTool[]) {
        const skills = tools.some((tool) => tool.name === "read") ? formatSkillsForPrompt(this.#options.skills) : "";
        this.#systemPrompt = `${prompt}${skills}`;
    }

    async #refreshTools(tools: AgentTool[]) {
        const request = this.#request;

        if (!request.refreshTools)
            return;

        this.#options.signal.throwIfAborted();
        const snapshot = await this.#options.track(request.refreshTools());
        this.#options.signal.throwIfAborted();

        if (!this.#active)
            throw new Error("The agent turn ended while refreshing tools.");

        Object.assign(request, snapshot);
        tools.splice(0, tools.length, ...this.#toolsOf(request));
        this.#setSystemPrompt(snapshot.systemPrompt, tools);
    }

    #toolsOf(request: TurnRequest<"agent">): AgentTool[] {
        const names = new Set<string>();
        const allowedNames = request.allowedToolNames === null ? null : new Set(request.allowedToolNames);

        if (allowedNames && allowedNames.size !== request.allowedToolNames?.length)
            throw new Error(`agent ${request.agentId} received duplicate allowed tool names.`);

        if (allowedNames) {
            const outside = request.tools
                .map((tool) => tool.name)
                .filter((name) => !["typescript_api", "typescript_eval"].includes(name) && !allowedNames.has(name));

            if (outside.length > 0)
                throw new Error(`The agent received tools outside its allowlist: ${[...new Set(outside)].join(", ")}.`);
        }

        const tools = request.tools.map((entry) => {
            if (names.has(entry.name))
                throw new Error(`RAgents supplied duplicate agent tool ${entry.name}.`);

            names.add(entry.name);

            return this.#toolOf(entry);
        });
        this.#activeManagedNames = names;

        return tools;
    }

    #toolOf(entry: RunFunction): AgentTool {
        return {
            name: entry.name,
            label: entry.label,
            description: [entry.description, entry.longDescription].filter(Boolean).join("\n\n"),
            parameters: entry.schema,
            executionMode: entry.executionMode ?? "sequential",
            execute: async (toolCallId: string, params: unknown, toolSignal: AbortSignal | undefined) => {
                if (!this.#active)
                    throw new Error(`agent tool ${entry.name} was called outside an RAgents turn.`);

                if (this.#options.signal.aborted || toolSignal?.aborted)
                    throw new Error(`agent tool ${entry.name} was aborted.`);

                assertJsonValue(params, `agent tool ${entry.name} input`);
                this.#unexecutedManagedCalls.delete(toolCallId);
                const call = await this.#request.invoke(toolCallId, entry.name, params, this.#contextKey);
                const text = typeof call.output === "string" ? call.output : asJson(call.output);

                return {
                    content: [{
                        type: "text" as const,
                        text: call.ignoredFields.length === 0 ? text : `${ignoredFieldsNotice(entry, call.ignoredFields)}\n\n${text}`,
                    }],
                    details: {},
                    terminate: call.endsTurn,
                };
            },
        };
    }

    /** The projection of the journal plus the hidden notes of the hooks for this one call. */
    async #contextForModelCall(signal: AbortSignal | undefined): Promise<AgentMessage[]> {
        await this.#checkCompaction(lastAssistantOf(this.#request.modelContext().messages), false);

        if (this.#overflowRecoveryAttempted && this.#modelFailure)
            throw new Error(this.#modelFailure);

        const context = this.#request.modelContext();
        this.#contextKey = context.key;
        const notes: AgentMessage[] = [];

        for (const hook of this.#options.hooks) {
            if (!hook.beforeModelCall)
                continue;

            try {
                const note = await this.#options.track(hook.beforeModelCall({
                    signal,
                    modelReadsImages: this.#options.model.input.includes("image"),
                    kept: this.#request.hookState.kept(hook.id),
                    keep: (value) => {
                        if (!this.#active)
                            throw new Error(`The hook ${hook.id} is stale: its agent turn has ended.`);

                        this.#request.hookState.keep(hook.id, value);
                    },
                }));

                if (note !== undefined)
                    notes.push({ role: "custom", customType: hook.id, content: note, display: false, timestamp: Date.now() });
            } catch (error) {
                this.#hookFailed(hook.id, "beforeModelCall", error);
            }
        }

        const messages = this.#overflowRecoveryAttempted || this.#retryAttempt > 0
            ? withoutTrailingFailures(context.messages, this.#options.model.contextWindow)
            : context.messages;

        return [...messages, ...notes];
    }

    async #afterToolCall(toolCallId: string, toolName: string, original: (TextContent | ImageContent)[], isError: boolean) {
        let content = original;
        let error = isError;
        let replaced = false;

        for (const hook of this.#options.hooks) {
            if (!hook.afterToolCall)
                continue;

            try {
                const replacement = await this.#options.track(hook.afterToolCall(
                    { toolCallId, toolName, isError: error },
                    { signal: this.#agent?.signal, modelReadsImages: this.#options.model.input.includes("image") },
                ));

                if (!replacement)
                    continue;

                content = replacement.content.map((part) => ({ ...part }));
                error = replacement.isError ?? error;
                replaced = true;
            } catch (failure) {
                this.#hookFailed(hook.id, "afterToolCall", failure);
            }
        }

        // A replacement keeps the call's end of the turn, but the model always gets to react to an error.
        return replaced ? { content, isError: error, ...(error ? { terminate: false } : {}) } : undefined;
    }

    #hookFailed(id: string, phase: string, error: unknown) {
        this.#failure ??= `agent hook ${id} failed during ${phase}: ${errorMessage(error)}`;
    }

    async #steering(): Promise<UserMessage[]> {
        if (!this.#active || this.#options.signal.aborted)
            return [];

        const messages: UserMessage[] = [];

        for (const steered of this.#request.claimSteering()) {
            const prepared = await prepareInputAttachments(
                { ...this.#request, attachments: steered.attachments, prompt: steered.prompt },
                this.#options.model.input,
            );
            const message: UserMessage = { role: "user", content: [{ type: "text", text: prepared.prompt }, ...prepared.attachments], timestamp: Date.now() };
            this.#inputIds.set(message, steered.input.id);
            messages.push(message);
        }

        return messages;
    }

    #handleEvent(event: AgentEvent) {
        if (!this.#active)
            return;

        const request = this.#request;

        if (event.type === "message_update") {
            if (this.#options.signal.aborted)
                return;

            const delta = event.assistantMessageEvent;

            if (delta.type === "text_delta" && delta.delta) {
                this.#pendingText += delta.delta;
                request.publish({ kind: "text", delta: delta.delta });
            } else if (delta.type === "thinking_delta" && delta.delta)
                request.publish({ kind: "thinking", delta: delta.delta });

            return;
        }

        if (event.type === "message_start") {
            if (event.message.role === "user")
                this.#overflowRecoveryAttempted = false;

            return;
        }

        if (event.type === "tool_execution_start") {
            const { toolCallId: id, toolName: name, args } = event;
            request.publish({ kind: "tool", id, name, arguments: asJson(args) });

            if (this.#activeManagedNames.has(name)) {
                this.#unexecutedManagedCalls.set(id, { name, input: asJsonValue(args) });
            } else {
                assertJsonValue(args, `agent tool ${name} input`);
                this.#directToolCalls.set(id, { name, input: args });
                request.recordTool?.({ kind: "started", id, name, input: args });
            }

            return;
        }

        if (event.type === "tool_execution_end") {
            const id = event.toolCallId;
            request.publish({ kind: "tool-result", id, result: asText(event.result), isError: event.isError });
            const unexecuted = this.#unexecutedManagedCalls.get(id);

            if (unexecuted) {
                this.#unexecutedManagedCalls.delete(id);

                if (event.isError) {
                    request.recordTool?.({ kind: "started", id, name: unexecuted.name, input: unexecuted.input });
                    request.recordTool?.({ kind: "failed", id, name: unexecuted.name, error: asText(event.result) });
                }
            }

            const direct = this.#directToolCalls.get(id);

            if (direct) {
                this.#directToolCalls.delete(id);
                const output = asText(event.result);
                request.recordTool?.(event.isError
                    ? { kind: "failed", id, name: direct.name, error: output }
                    : { kind: "completed", id, name: direct.name, output });
            }

            return;
        }

        if (event.type !== "message_end")
            return;

        const message = event.message;

        if (message.role === "user") {
            const inputId = this.#inputIds.get(message);

            if (inputId === undefined && message.content !== EMPTY_RESPONSE_NUDGE)
                throw new Error("The agent loop added a user message that no input and no nudge explains.");

            request.recordContext({ kind: "input", inputId: inputId ?? null, content: message.content });
            return;
        }

        if (message.role === "toolResult") {
            const result = message as ToolResultMessage;
            request.recordContext({ kind: "tool-result", toolCallId: result.toolCallId, toolName: result.toolName, isError: result.isError, content: result.content });
            return;
        }

        if (message.role !== "assistant")
            return;

        this.#usage = addUsage(this.#usage, usageOf(message.usage));

        if (this.#options.signal.aborted || message.stopReason === "aborted") {
            this.#recordInterruptedOutput();
            this.#failure ??= "The agent turn was aborted.";
            return;
        }

        if (isRunFailure(message)) {
            this.#failure ??= message.errorMessage ?? "The agent loop failed without a message.";
            return;
        }

        this.#pendingText = "";
        this.#uniqueToolCallIds(message);
        const { role: _role, ...step } = message;
        request.recordContext({ kind: "step", step: step as unknown as CompletedModelStep });
        this.#lastAssistant = message;

        if (message.stopReason !== "error" && !isContextOverflow(message, this.#options.model.contextWindow)) {
            this.#overflowRecoveryAttempted = false;
            this.#retryAttempt = 0;
        }

        // A retry or a compaction continues after a provider error, so only the last answer decides.
        this.#modelFailure = message.stopReason === "error"
            ? message.errorMessage ?? "The model provider returned an error."
            : message.stopReason === "length"
                ? "The model response hit the output token limit before producing a complete answer."
                : null;
    }

    /** The journal keys a tool call by its ID; a model that reuses one gets a suffixed ID before the loop runs the call. */
    #uniqueToolCallIds(message: AssistantMessage) {
        const calls = message.content.filter((block): block is ToolCall => block.type === "toolCall");

        if (calls.length === 0)
            return;

        const used = new Set(this.#request.modelContext().messages.flatMap((entry) => entry.role === "assistant"
            ? entry.content.flatMap((block) => block.type === "toolCall" ? [block.id] : [])
            : []));

        for (const call of calls) {
            let id = call.id;

            for (let suffix = 2; used.has(id); suffix++)
                id = `${call.id}-${suffix}`;

            call.id = id;
            used.add(id);
        }
    }

    #recordInterruptedOutput() {
        if (!this.#pendingText.trim())
            return;

        this.#request.emit({ kind: "assistant-interrupted", text: this.#pendingText });
        this.#pendingText = "";
    }

    async #afterRun(): Promise<boolean> {
        const message = this.#lastAssistant;
        this.#lastAssistant = undefined;

        if (!message || this.#failure || !this.#active || this.#options.signal.aborted)
            return false;

        if (this.#isRetryable(message) && (await this.#prepareRetry()))
            return true;

        if (this.#options.signal.aborted)
            return false;

        if (message.stopReason === "error")
            this.#retryAttempt = 0;

        if (await this.#checkCompaction(message))
            return true;

        if (!this.#modelFailure && !message.content.some((part) => part.type === "toolCall" || (part.type === "text" && part.text.trim())))
            this.#modelFailure = "The model ended the turn without an answer.";

        return false;
    }

    #isRetryable(message: AssistantMessage) {
        return !isContextOverflow(message, this.#options.model.contextWindow ?? 0) && isRetryableAssistantError(message);
    }

    async #prepareRetry(): Promise<boolean> {
        const settings = this.#options.settings.retry;

        if (!settings.enabled || this.#retryAttempt >= settings.maxRetries)
            return false;

        this.#retryAttempt++;
        const agent = this.#agent!;
        agent.state.messages = withoutTrailingFailures(agent.state.messages, this.#options.model.contextWindow);
        this.#retryAbort = new AbortController();

        try {
            await sleep(settings.baseDelayMs * 2 ** (this.#retryAttempt - 1), undefined, {
                signal: AbortSignal.any([this.#retryAbort.signal, this.#options.signal]),
            });
        } catch {
            this.#retryAttempt = 0;
            return false;
        } finally {
            this.#retryAbort = null;
        }

        return true;
    }

    /** After a context overflow compacts and retries once; over the threshold of the turn's model compacts without a retry. */
    async #checkCompaction(assistant: AssistantMessage | undefined, skipAborted = true): Promise<boolean> {
        const { model } = this.#options;

        if (skipAborted && assistant?.stopReason === "aborted")
            return false;

        const contextWindow = model.contextWindow ?? 0;
        const sameModel = assistant?.provider === model.provider && assistant.model === model.id;
        const log = this.#request.modelContext().entries;
        const compactionIndex = log.findLastIndex((entry) => entry.kind === "compaction");
        const assistantIndex = log.findLastIndex((entry) => entry.kind === "message" && entry.message.role === "assistant");

        if (assistant && sameModel && assistantIndex > compactionIndex && isContextOverflow(assistant, contextWindow)) {
            if (assistant.stopReason === "stop")
                return this.#compact(false);

            if (this.#overflowRecoveryAttempted) {
                this.#modelFailure = "The model context overflowed again after compaction and one retry.";
                return false;
            }

            this.#overflowRecoveryAttempted = true;
            return this.#compact(true);
        }

        const messages = contextMessages(log);
        const usageStartIndex = compactionIndex < 0 ? 0 : messages.length - (log.length - compactionIndex - 1);
        const contextTokens = estimateContextTokens(messages, usageStartIndex).tokens;
        return shouldCompact(contextTokens, compactionOf(model).values) ? this.#compact(false) : false;
    }

    async #compact(retry: boolean): Promise<boolean> {
        const { model, modelRuntime, thinkingLevel } = this.#options;
        const compaction = compactionOf(model);
        const preparation = prepareCompaction([...this.#request.modelContext().entries], compaction.values);

        if (!preparation) {
            if (retry)
                this.#modelFailure = "Context overflow recovery failed: there is no context to compact.";
            return false;
        }

        const abort = new AbortController();
        this.#compactionAbort = abort;

        try {
            const auth = await modelRuntime.getAuth(model).catch(() => undefined);
            const headers = auth?.auth.headers
                ? Object.fromEntries(Object.entries(auth.auth.headers).filter((entry): entry is [string, string] => entry[1] !== null))
                : undefined;
            const result = await this.#options.track(compact(
                preparation,
                model,
                auth?.auth.apiKey,
                headers,
                undefined,
                AbortSignal.any([abort.signal, this.#options.signal]),
                thinkingLevel,
                (streamModel, context, options) => modelRuntime.streamSimple(streamModel, context, options),
                auth?.env,
            ));

            if (abort.signal.aborted || this.#options.signal.aborted || !this.#active)
                return false;

            this.#request.recordContext({
                kind: "compaction",
                compaction: {
                    summary: result.summary,
                    firstKeptEventId: result.firstKeptId,
                    tokensBefore: result.tokensBefore,
                    provider: model.provider,
                    model: model.id,
                    readFiles: result.readFiles,
                    modifiedFiles: result.modifiedFiles,
                    threshold: { tokens: compaction.values.threshold, source: compaction.source },
                },
            });
            const messages = this.#request.modelContext().messages;

            if (this.#agent)
                this.#agent.state.messages = retry ? withoutTrailingFailures(messages, model.contextWindow) : [...messages];

            if (retry)
                this.#modelFailure = null;

            return retry;
        } catch (error) {
            if (!abort.signal.aborted && !this.#options.signal.aborted) {
                this.#options.onDiagnostic(`Compaction of the model context failed: ${errorMessage(error)}`);
                if (retry)
                    this.#modelFailure = `Context overflow recovery failed: compaction failed: ${errorMessage(error)}`;
            }
            return false;
        } finally {
            if (this.#compactionAbort === abort)
                this.#compactionAbort = null;
        }
    }
}
