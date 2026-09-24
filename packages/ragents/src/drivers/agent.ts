import { ModelRuntime } from "@ragents/agent";
import { getSupportedThinkingLevels } from "@ragents/ai";

import { thinkingLevels, type ThinkingLevel } from "../domain/driver.ts";
import type { CatalogModel } from "../agents/catalog.ts";
import { AgentRuntimeManager, type AgentRuntimeManagerOptions } from "./agent-runtime.ts";
import type { AgentDriver, TurnRequest } from "./types.ts";

export type {
    AgentRuntimeContext,
    AgentRuntimeDiagnostic,
    AgentRuntimeManagerOptions,
    AgentSessionStore,
} from "./agent-runtime.ts";
export { AgentRuntimeManager, turnDispatcherExtensionName } from "./agent-runtime.ts";
export {
    createSkillPreloadExtension,
    skillPreloadExtensionName,
    type SkillPreloadConfiguration,
    type SkillPreloadOptions,
    type SkillCatalogEntry,
    type SkillSelectionRequest,
    type SkillSelector,
} from "./skill-preload.ts";

export type AgentSessionDriverOptions = Omit<AgentRuntimeManagerOptions, "modelRuntime"> & {
    modelRuntime?: ModelRuntime | Promise<ModelRuntime>;
};

export class AgentSessionDriver implements AgentDriver<"agent"> {
    readonly kind = "agent" as const;
    readonly supportsPlainLlm = true;
    readonly #modelRuntime: Promise<ModelRuntime>;
    readonly #runtimeManager: AgentRuntimeManager;

    constructor(options: AgentSessionDriverOptions = {}) {
        this.#modelRuntime = Promise.resolve(options.modelRuntime ?? ModelRuntime.create());
        this.#runtimeManager = new AgentRuntimeManager({ ...options, modelRuntime: this.#modelRuntime });
    }

    async catalog(): Promise<CatalogModel[]> {
        const modelRuntime = await this.#modelRuntime;

        return modelRuntime.getModels().map((entry) => ({
            driver: "agent" as const,
            provider: entry.provider,
            model: entry.id,
            label: `${entry.provider}/${entry.id}`,
            thinking: getSupportedThinkingLevels(entry),
        }));
    }

    async inputCapabilities(provider: string, modelId: string): Promise<readonly string[]> {
        const model = (await this.#modelRuntime).getModel(provider, modelId);
        if (!model) throw new Error(`Das Modell ${provider}/${modelId} ist nicht konfiguriert.`);
        return model.input;
    }

    async thinkingCapabilities(provider: string, modelId: string): Promise<readonly ThinkingLevel[]> {
        const model = (await this.#modelRuntime).getModel(provider, modelId);
        if (!model) throw new Error(`Das Modell ${provider}/${modelId} ist nicht konfiguriert.`);
        const supported = getSupportedThinkingLevels(model);
        return thinkingLevels.filter((level) => supported.includes(level));
    }

    runTurn(request: TurnRequest<"agent">, signal: AbortSignal) {
        return this.#runtimeManager.runTurn(request, signal);
    }

    disposeAgent(runId: string, agentId: string) {
        return this.#runtimeManager.disposeAgent(runId, agentId);
    }

    reviveAgent(runId: string, agentId: string) {
        this.#runtimeManager.reviveAgent(runId, agentId);
    }

    haltRun(runId: string) {
        return this.#runtimeManager.haltRun(runId);
    }

    waitForRunSettlement(runId: string) {
        return this.#runtimeManager.waitForRunSettlement(runId);
    }

    disposeRun(runId: string) {
        return this.#runtimeManager.disposeRun(runId);
    }

    shutdown() {
        return this.#runtimeManager.shutdown();
    }
}
