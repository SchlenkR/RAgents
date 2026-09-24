import { nativeTestExecutor } from "./native-executor.ts";
import assert from "node:assert/strict";

import { StaticModelCatalog, resolveExecution, type CatalogModel } from "../src/agents/catalog.ts";
import type { TurnToolset } from "../src/agents/toolset.ts";
import type { WorkspaceToolNaming } from "../src/agents/workspace-tools.ts";
import { thinkingLevels, type AgentExecution } from "../src/domain/driver.ts";
import type { CapabilityGrant, CapabilityName, RunView } from "../src/domain/model.ts";
import type { AgentDriver, DriverRegistry, TurnRequest, TurnResult } from "../src/drivers/types.ts";
import { Journal } from "../src/runtime/journal.ts";
import { Orchestration } from "../src/runtime/orchestration.ts";
import type { RuntimeServices } from "../src/runtime/services.ts";

export const testServices = (hour = 12): RuntimeServices => {
    let next = 0;
    let tick = 0;

    return {
        nativeTypeScriptExecutor: nativeTestExecutor,
        now: () => new Date(Date.UTC(2026, 7, 16, hour, 0, tick++)).toISOString(),
        newId: (kind: string) => `${kind}-${++next}`,
    };
};

export const catalogModels: CatalogModel[] = [
    { driver: "agent", provider: "openrouter", model: "fable-5", label: "openrouter/fable-5", thinking: thinkingLevels },
    { driver: "agent", provider: "ollama", model: "qwen3", label: "ollama/qwen3", thinking: thinkingLevels },
];

export const catalog = new StaticModelCatalog(catalogModels, [
    {
        name: "agent",
        description: "Testprofil mit festem Modell.",
        driver: "agent",
        provider: "ollama",
        model: "qwen3",
        turnTimeoutMs: 600_000,
        isolateWorkspace: true,
    },
    {
        name: "manual",
        description: "Kein automatischer Treiber.",
        driver: "manual",
        turnTimeoutMs: null,
        isolateWorkspace: false,
    },
]);

export const allGrants = (delegable = true): CapabilityGrant[] =>
    (
        [
            "actor.input",
            "event.subscribe",
            "agent.spawn",
            "artifact.publish",
            "plugin.state.write",
            "action.propose",
            "workspace.use",
            "execution.stopOwned",
        ] satisfies CapabilityName[]
    ).map((capability) => ({ capability, scope: { kind: "run" }, delegable }));

export const manualExecution = (): AgentExecution => ({
    driver: { kind: "manual", config: {} },
    workspacePath: null,
    turnTimeoutMs: null,
});

export const executionFor = (handle: string, request: Parameters<typeof resolveExecution>[1] = {}): AgentExecution =>
    resolveExecution(catalog, request, handle, catalogModels);

export const agentToolNaming: WorkspaceToolNaming = {
    agentToolNames: (driver) =>
        driver === "agent"
            ? { read: ["read"], write: ["edit", "write"], execute: ["bash"] }
            : { read: [], write: [], execute: [] },
};

export type Deferred = { promise: Promise<void>; resolve: () => void };

export const deferred = (): Deferred => {
    let resolve: () => void = () => undefined;
    const promise = new Promise<void>((done) => {
        resolve = done;
    });

    return { promise, resolve };
};

export class FakeDriver implements AgentDriver<"agent"> {
    readonly kind = "agent" as const;
    readonly supportsPlainLlm = true;
    readonly requests: TurnRequest<"agent">[] = [];
    readonly #handle: (request: TurnRequest<"agent">, signal: AbortSignal) => Promise<TurnResult>;

    constructor(handle: (request: TurnRequest<"agent">, signal: AbortSignal) => Promise<TurnResult>) {
        this.#handle = handle;
    }

    async runTurn(request: TurnRequest<"agent">, signal: AbortSignal) {
        this.requests.push(request);

        return this.#handle(request, signal);
    }
}

export const noUsage = () => ({
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    costUsd: 0,
});

export const registryOf = (driver: AgentDriver<"agent">): DriverRegistry => ({
    agent: driver,
});

export const setupRun = (
    options: {
        grants?: CapabilityGrant[];
        execution?: AgentExecution;
        toolNames?: readonly string[] | null;
    } = {},
) => {
    const services = testServices();
    const journal = new Journal(":memory:", services);
    const runtime = new Orchestration(journal, services);
    let view = runtime.createRun(
        { commandId: "create-run" },
        { title: "Scheduler", ownerHandle: "owner", ownerDisplayName: "Owner" },
    );
    view = runtime.spawnAgent({ actorId: view.ownerId, commandId: "spawn-worker" }, view.id, {
        handle: "worker",
        displayName: "Worker",
        prompt: "Work only on the addressed task.",
        execution: options.execution ?? executionFor("worker", { profile: "agent", isolateWorkspace: false }),
        grants: options.grants ?? [],
        toolNames: options.toolNames ?? null,
    });
    const agent = view.actors.find((entry) => entry.kind === "agent");

    assert.ok(agent);

    return { services, journal, runtime, view, agent };
};

export const postTo = (runtime: Orchestration, view: RunView, actorId: string, commandId: string, content: string) =>
    runtime.enqueueInput({ actorId: view.ownerId, commandId }, view.id, { actorId, content });
