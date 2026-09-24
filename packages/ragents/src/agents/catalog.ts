import type { AgentDriverKind, AgentExecution, ModelSelection, ThinkingLevel } from "../domain/driver.ts";
import { agentDriverKinds } from "../domain/driver.ts";
import { DomainError } from "../runtime/domain-error.ts";

export type CatalogModel = {
    driver: AgentDriverKind;
    provider: string;
    model: string;
    label: string;
    thinking: readonly ThinkingLevel[];
};

type ProfileBase = {
    name: string;
    description: string;
    turnTimeoutMs: number | null;
    isolateWorkspace: boolean;
};

export type AgentProfile = ProfileBase & (
    | { driver: "manual" | "script" }
    | { driver: "agent"; provider: string; model: string; thinking?: ThinkingLevel }
);

type AgentDriverProfile = Extract<AgentProfile, { driver: "agent" }>;

export type ExecutionRequest = {
    profile?: string;
    driver?: AgentDriverKind;
    provider?: string;
    model?: string;
    thinking?: ThinkingLevel;
    turnTimeoutMs?: number;
    isolateWorkspace?: boolean;
};

export interface ModelCatalog {
    models(): Promise<readonly CatalogModel[]>;
    profiles(): readonly AgentProfile[];
}

const defaultProfiles: AgentProfile[] = [
    {
        name: "manual",
        description: "Kein automatischer Treiber. Ein Mensch führt die Turns.",
        driver: "manual",
        turnTimeoutMs: null,
        isolateWorkspace: false,
    },
];

const spawnFormsOf = (models: readonly CatalogModel[]) => {
    const byProvider = new Map<string, string[]>();

    for (const entry of models)
        byProvider.set(entry.provider, [...(byProvider.get(entry.provider) ?? []), entry.model]);

    return [...byProvider.entries()]
        .map(([provider, names]) => `provider "${provider}" with model ${names.map((name) => `"${name}"`).join(", ")}`)
        .join("; ") || "none";
};

const providerFor = (models: readonly CatalogModel[], driver: AgentDriverKind, model: string): string => {
    const known = models.filter((entry) => entry.driver === driver);
    const providers = [...new Set(known.flatMap((entry) => (entry.model === model ? [entry.provider] : [])))];
    const [only] = providers;

    if (providers.length > 1)
        throw new DomainError(
            "model-ambiguous",
            `Model ${model} is offered by several providers for driver ${driver}: ${providers.join(", ")}. Name the provider explicitly.`,
            400,
        );

    if (!only)
        throw new DomainError(
            "model-not-found",
            `Model ${model} is unknown for driver ${driver}. Pass provider and model as SEPARATE fields, exactly as listed: ${spawnFormsOf(known)}. Or spawn with a profile from model_list.`,
            400,
        );

    return only;
};

const unprefixed = (
    models: readonly CatalogModel[],
    driver: AgentDriverKind,
    named: string | null,
    model: string | null,
): { named: string | null; model: string | null } => {
    if (!model || !model.includes("/"))
        return { named, model };

    const known = models.filter((entry) => entry.driver === driver);
    const [head, ...rest] = model.split("/");
    const tail = rest.join("/");

    if (!head || !tail || (named && named !== head))
        return { named, model };

    if (known.some((entry) => entry.provider === head && entry.model === tail))
        return { named: head, model: tail };

    return { named, model };
};

const thinkingFor = (
    models: readonly CatalogModel[],
    driver: AgentDriverKind,
    provider: string,
    model: string,
    request: ExecutionRequest,
    profile: AgentDriverProfile | undefined,
): ThinkingLevel | null => {
    const thinking = request.thinking ?? profile?.thinking ?? null;
    const requested = thinking;

    if (!requested)
        return thinking;

    const entry = models.find((candidate) =>
        candidate.driver === driver
        && candidate.model === model
        && candidate.provider === provider);

    if (entry && !entry.thinking.includes(requested))
        throw new DomainError(
            "thinking-not-supported",
            `Model ${model} does not offer thinking ${requested}. Valid levels for it: ${entry.thinking.join(", ")}. `
            + "model_list names them per model.",
            400,
        );

    return thinking;
};

const selectionFor = (
    models: readonly CatalogModel[],
    driver: AgentDriverKind,
    request: ExecutionRequest,
    profile: AgentDriverProfile | undefined,
    profiles: readonly AgentProfile[],
): ModelSelection => {
    const requested = unprefixed(
        models,
        driver,
        request.provider ?? profile?.provider ?? null,
        request.model ?? profile?.model ?? null,
    );
    const model = requested.model;
    const named = requested.named;

    if (!model)
        throw new DomainError(
            "model-missing",
            `Driver ${driver} needs a model to run turns. Spawn with a profile from model_list, or pass provider and model. `
            + `Known profiles for ${driver}: ${profiles.filter((entry) => entry.driver === driver).map((entry) => entry.name).join(", ") || "none"}.`,
            400,
        );

    const provider = named ?? providerFor(models, driver, model);

    const thinking = thinkingFor(models, driver, provider, model, request, profile);

    return { provider, model, ...(thinking ? { thinking } : {}) };
};

export const resolveExecution = (
    catalog: ModelCatalog,
    request: ExecutionRequest,
    agentId: string,
    models: readonly CatalogModel[] = [],
): AgentExecution => {
    const profiles = catalog.profiles();
    const profile = request.profile ? profiles.find((entry) => entry.name === request.profile) : undefined;

    if (request.profile && !profile)
        throw new DomainError(
            "profile-not-found",
            `Profile ${request.profile} does not exist. Known profiles: ${profiles.map((entry) => entry.name).join(", ")}.`,
            400,
        );

    const kind = request.driver ?? profile?.driver ?? "agent";

    if (!agentDriverKinds.includes(kind))
        throw new DomainError("driver-not-found", `Driver ${kind} does not exist.`, 400);

    const isolate = request.isolateWorkspace ?? profile?.isolateWorkspace ?? kind !== "manual";

    const workspacePath = isolate ? agentId : null;
    const turnTimeoutMs = request.turnTimeoutMs ?? profile?.turnTimeoutMs ?? null;

    if (kind === "manual" || kind === "script")
        return { driver: { kind, config: {} }, workspacePath, turnTimeoutMs };

    const agentProfile = profile?.driver === "agent" ? profile : undefined;

    return { driver: { kind, config: selectionFor(models, kind, request, agentProfile, profiles) }, workspacePath, turnTimeoutMs };
};

export class StaticModelCatalog implements ModelCatalog {
    readonly modelList: readonly CatalogModel[];
    readonly #profiles: readonly AgentProfile[];

    constructor(models: readonly CatalogModel[] = [], profiles: readonly AgentProfile[] = defaultProfiles) {
        this.modelList = models;
        this.#profiles = profiles;
    }

    async models() {
        return this.modelList;
    }

    profiles() {
        return this.#profiles;
    }
}

export const builtinProfiles = defaultProfiles;
