import { Type } from "typebox";
import { ModelRuntime } from "@ragents/agent";
import { createAssistantMessageEventStream, registerFauxProvider, type AssistantMessage, type Context, type InputModality } from "@ragents/ai";
import { turnModelContext } from "../src/agents/model-context.ts";
import { defineRunFunction, type RunFunction } from "../src/agents/tools.ts";
import { claimTurn } from "../src/agents/turn.ts";
import type { JsonValue } from "../src/domain/json.ts";
import type { CapabilityGrant } from "../src/domain/model.ts";
import { agentHookOf, type AgentHook } from "../src/drivers/agent-hooks.ts";
import { AgentRuntimeManager } from "../src/drivers/agent-runtime.ts";
import type { LiveEvent, TurnRequest, TurnResult } from "../src/drivers/types.ts";
import type { AgentContribution } from "../src/plugin-types.ts";
import { Journal } from "../src/runtime/journal.ts";
import { Orchestration } from "../src/runtime/orchestration.ts";
import { executionFor, testServices } from "./support.ts";

export const fauxModelRuntime = (id: string, input?: InputModality[], tokensPerSecond = 100_000) => {
    const faux = registerFauxProvider({ models: [{ id, reasoning: false, ...(input ? { input } : {}) }], tokensPerSecond });
    const modelRuntime = ModelRuntime.create();
    const model = faux.getModel();
    modelRuntime.registerProvider(model.provider, {
        baseUrl: model.baseUrl,
        apiKey: "faux-key",
        api: faux.api,
        models: faux.models.map((entry) => ({
            id: entry.id, name: entry.name, api: entry.api, reasoning: entry.reasoning, input: entry.input,
            cost: entry.cost, contextWindow: entry.contextWindow, maxTokens: entry.maxTokens, baseUrl: entry.baseUrl,
        })),
    });

    return { faux, modelRuntime, selection: { provider: model.provider, model: model.id } };
};

export type TurnOverrides = Partial<Omit<TurnRequest<"agent">, "invoke">> & {
    invoke?: (toolCallId: string, name: string, input: JsonValue) => Promise<JsonValue>;
};

/** A run with one agent in a journal; each turn is claimed, handed to the driver and ended like the scheduler does. */
export const journalHarness = (selection: { provider: string; model: string }, directory = ":memory:", grants: readonly CapabilityGrant[] = []) => {
    const services = testServices();
    const journal = new Journal(directory, services);
    const runtime = new Orchestration(journal, services);
    const run = runtime.createRun({ commandId: "create" }, { title: "Driver", ownerHandle: "owner", ownerDisplayName: "Owner" });
    const agentId = runtime.spawnAgent({ actorId: run.ownerId, commandId: "spawn" }, run.id, {
        handle: "agent", displayName: "Agent", prompt: "Work.",
        execution: executionFor("agent", { profile: "agent", isolateWorkspace: false }), grants, toolNames: null,
    }).actors.find((actor) => actor.kind === "agent")!.id;

    return harnessOver(selection, journal, runtime, run.id, agentId);
};

export const harnessOver = (
    selection: { provider: string; model: string },
    journal: Journal,
    runtime: Orchestration,
    runId: string,
    agentId: string,
    prefix = "",
) => {
    const run = { id: runId, ownerId: runtime.view(runId).ownerId };
    let posts = 0;
    const published: LiveEvent[] = [];

    const request = (prompt: string, overrides: TurnOverrides = {}): TurnRequest<"agent"> => {
        const inputId = runtime.enqueueInput({ actorId: run.ownerId, commandId: `${prefix}post-${++posts}` }, run.id, { actorId: agentId, content: prompt })
            .inputs.at(-1)!.id;
        const turn = claimTurn(runtime, run.id, agentId, inputId, `${prefix}claim-${posts}`);
        let emitted = 0;
        const command = (kind: string) => ({ actorId: agentId, commandId: `${turn.turnId}:${kind}:${emitted++}`, turnId: turn.turnId });
        const invoke = overrides.invoke ?? (async () => null);

        return {
            driverKind: "agent",
            runId: run.id,
            agentId,
            turnId: turn.turnId,
            startedAt: turn.startedAt,
            input: turn.input,
            prompt,
            selection,
            orientation: "",
            systemPrompt: "System contract.",
            workspace: process.cwd(),
            storeAttachment: async (name) => name,
            tools: [],
            functionNames: [],
            allowedToolNames: null,
            claimSteering: () => [],
            emit: (event) => {
                if (event.kind === "assistant-interrupted")
                    runtime.appendInterruptedModelOutput(command("interrupted"), run.id, agentId, { turnId: turn.turnId, text: event.text });
            },
            recordTool: (event) => {
                if (event.kind === "started")
                    runtime.startToolCall(command("tool"), run.id, agentId, { turnId: turn.turnId, toolCallId: event.id, name: event.name, input: event.input });
                else if (event.kind === "failed")
                    runtime.failToolCall(command("tool"), run.id, agentId, { turnId: turn.turnId, toolCallId: event.id, name: event.name, error: event.error });
                else
                    runtime.completeToolCall(command("tool"), run.id, agentId, { turnId: turn.turnId, toolCallId: event.id, name: event.name, output: event.output });
            },
            publish: (event) => { published.push(event); },
            ...turnModelContext(runtime, turn, () => emitted++),
            ...overrides,
            invoke: async (toolCallId, name, input) => {
                runtime.startToolCall(command("tool"), run.id, agentId, { turnId: turn.turnId, toolCallId, name, input });
                try {
                    const output = await invoke(toolCallId, name, input);
                    runtime.completeToolCall(command("tool"), run.id, agentId, { turnId: turn.turnId, toolCallId, name, output });
                    return { output, ignoredFields: [], endsTurn: false };
                } catch (error) {
                    runtime.failToolCall(command("tool"), run.id, agentId, { turnId: turn.turnId, toolCallId, name, error: error instanceof Error ? error.message : String(error) });
                    throw error;
                }
            },
        };
    };

    /** Ends the turn in the journal the way the scheduler does after the driver returned. */
    const finish = (request: TurnRequest<"agent">, result: TurnResult, aborted = false) => {
        const context = { actorId: agentId, commandId: `${request.turnId}:end`, turnId: request.turnId };
        const running = runtime.state(run.id).actors.get(agentId);

        if (running?.kind === "human" || running?.lifecycle.kind !== "running")
            return result;

        if (aborted)
            runtime.interruptTurn(context, run.id, agentId, { turnId: request.turnId, reason: "Test" });
        else
            runtime.finishTurn(context, run.id, agentId, result.failure
                ? { turnId: request.turnId, outcome: "failed", reason: result.failure }
                : { turnId: request.turnId, outcome: "completed" });

        return result;
    };

    const outputsOf = (turnId: string) => runtime.events(run.id).flatMap((event) => {
        if ((event.type === "model.output.completed" || event.type === "model.reasoning.completed" || event.type === "model.output.interrupted")
            && event.payload.turnId === turnId)
            return [`${event.type}: ${event.payload.text}`];
        return [];
    });

    return { journal, runtime, runId: run.id, agentId, request, finish, outputsOf, published };
};

export const turnOf = async (
    harness: ReturnType<typeof journalHarness>,
    manager: AgentRuntimeManager,
    prompt: string,
    overrides: TurnOverrides = {},
    signal = new AbortController().signal,
) => {
    const request = harness.request(prompt, overrides);
    const result = await manager.runTurn(request, signal);

    return { request, result: harness.finish(request, result, signal.aborted) };
};

export const nativeTool = (name: string, description = `Execute ${name}.`): RunFunction => defineRunFunction({
    name, label: name, description, nativeTool: true,
    schema: Type.Object({}, { additionalProperties: false }), resultSchema: Type.Null(),
    available: () => true, run: () => null,
}) as RunFunction;

export const hooksOf = (...contributions: AgentContribution[]) => (context: { runId: string; agentId: string; workspace: string }): AgentHook[] =>
    contributions.map((contribution) => agentHookOf(contribution, { ...context, audience: "agent" }));

export const scriptedRuntime = (id: string, respond: (context: Context) => AssistantMessage) => {
    const setup = fauxModelRuntime(id);
    const model = setup.faux.getModel();
    setup.modelRuntime.registerProvider(model.provider, {
        baseUrl: model.baseUrl, apiKey: "faux-key", api: setup.faux.api,
        models: [{
            id, name: id, reasoning: false, input: model.input, cost: model.cost, maxTokens: model.maxTokens, contextWindow: 4_000,
            compaction: { threshold: 3_000, keepRecentTokens: 200, summaryTokens: 800 },
        }],
    });
    setup.modelRuntime.streamSimple = (requestModel, context) => {
        const stream = createAssistantMessageEventStream();
        const message = { ...respond(context), api: requestModel.api, provider: requestModel.provider, model: requestModel.id };
        stream.push(message.stopReason === "error" || message.stopReason === "aborted"
            ? { type: "error", reason: message.stopReason, error: message }
            : { type: "done", reason: message.stopReason, message });
        stream.end(message);
        return stream;
    };
    return setup;
};

export const withTokens = (message: AssistantMessage, input: number, output = 1): AssistantMessage => ({
    ...message,
    usage: { ...message.usage, input, output, totalTokens: input + output },
});

export const isSummary = (context: Context) => context.systemPrompt?.startsWith("You are a context summarization assistant");
