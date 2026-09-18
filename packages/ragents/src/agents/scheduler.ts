import { isPendingActorInput, type ExecutableActor, type TurnUsage } from "../domain/model.ts";
import {
    isAutomated,
    type AgentDriver,
    type AutomatedDriverKind,
    type DriverEvent,
    type DriverRegistry,
    type DriverToolEvent,
    type LiveEvent,
} from "../drivers/types.ts";
import type { JsonValue } from "../domain/json.ts";
import type { ModelSelection } from "../domain/driver.ts";
import type { Journal } from "../runtime/journal.ts";
import type { Orchestration } from "../runtime/orchestration.ts";
import type { ModelCatalog } from "./catalog.ts";
import { actorRosterText } from "./delivery.ts";
import type { LiveBus } from "./live.ts";
import type { ToolProvider } from "./plugins.ts";
import { holdsUsable, type RunFunction } from "./tools.ts";
import type { WorkspaceToolNaming } from "./workspace-tools.ts";
import { TurnToolset } from "./toolset.ts";
import { toolOrientationText } from "./tool-orientation.ts";
import { claimTurn, promptFor, type ClaimedTurn } from "./turn.ts";
import { FixedWorkspaces, type Workspaces } from "./workspaces.ts";

export type TurnSchedulerOptions = {
    drivers: DriverRegistry;
    catalog: ModelCatalog;
    workspaces?: Workspaces;
    registry?: ToolProvider | undefined;
    live?: LiveBus | undefined;
    workspaceToolNaming?: WorkspaceToolNaming | undefined;
    basePrompt?: (runId: string, actor: ExecutableActor, toolNames: readonly string[]) => string;
    contract?: (actor: ExecutableActor) => string;
    toolChapters?: (runId: string, actor: ExecutableActor, toolNames: readonly string[], availableTools: readonly RunFunction[]) => string | Promise<string>;
    modelSelection?: (turn: ClaimedTurn, actor: ExecutableActor) => ModelSelection;
    onError?: (error: unknown) => void;
};

type ActiveTurn = {
    runId: string;
    actorId: string;
    controller: AbortController;
    promise: Promise<void>;
};

type RuntimeLifecycle = Pick<AgentDriver, "disposeAgent" | "haltRun" | "disposeRun" | "shutdown" | "waitForRunSettlement">;

type PendingAgentDisposal = {
    runId: string;
    actorId: string;
    remaining: Set<RuntimeLifecycle>;
    dispose: () => Promise<void>;
    promise: Promise<boolean> | null;
    lastError: unknown | null;
};

type RunStop = {
    retire: boolean;
    promise: Promise<void>;
};

type RunQuarantine = {
    promise: Promise<void>;
};

type RunRuntimeState = {
    stopping: boolean;
    retired: boolean;
    stop: RunStop | null;
    quarantine: RunQuarantine | null;
    haltBoundaries: number;
};

const clearRunRuntimeState: RunRuntimeState = {
    stopping: false,
    retired: false,
    stop: null,
    quarantine: null,
    haltBoundaries: 0,
};

const keyOf = (runId: string, actorId: string) => JSON.stringify([runId, actorId]);

const errorMessage = (error: unknown) => (error instanceof Error ? error.message : String(error));

export const defaultContract = "";

const systemPromptFor = (
    runId: string,
    actor: ExecutableActor,
    toolNames: readonly string[],
    basePrompt: (runId: string, actor: ExecutableActor, toolNames: readonly string[]) => string,
    contract: (actor: ExecutableActor) => string,
    orientation: string,
) => actor.kind === "agent" && actor.toolNames?.length === 0
    ? actor.prompt.trim()
    : [basePrompt(runId, actor, toolNames).trim(), contract(actor).trim(), orientation].filter(Boolean).join("\n\n");

export class TurnScheduler {
    readonly #runtime: Orchestration;
    readonly #journal: Journal;
    readonly #drivers: DriverRegistry;
    readonly #programLifecycle: RuntimeLifecycle;
    readonly #catalog: ModelCatalog;
    readonly #workspaces: Workspaces;
    readonly #registry: ToolProvider | undefined;
    readonly #live: LiveBus | undefined;
    readonly #workspaceToolNaming: WorkspaceToolNaming | undefined;
    readonly #basePrompt: (runId: string, actor: ExecutableActor, toolNames: readonly string[]) => string;
    readonly #contract: (actor: ExecutableActor) => string;
    readonly #toolChapters: (
        runId: string,
        actor: ExecutableActor,
        toolNames: readonly string[],
        availableTools: readonly RunFunction[],
    ) => string | Promise<string>;
    readonly #onError: (error: unknown) => void;
    readonly #modelSelection: TurnSchedulerOptions["modelSelection"];
    readonly #active = new Map<string, ActiveTurn>();
    readonly #blocked = new Map<string, number>();
    readonly #lifecycle = new Set<{ runId: string; promise: Promise<void> }>();
    readonly #pendingAgentDisposals = new Map<string, PendingAgentDisposal>();
    readonly #runs = new Map<string, RunRuntimeState>();
    #unsubscribe: (() => void) | null = null;
    #stopped = false;
    #stopPromise: Promise<void> | null = null;

    constructor(runtime: Orchestration, journal: Journal, options: TurnSchedulerOptions) {
        this.#runtime = runtime;
        this.#journal = journal;
        this.#drivers = options.drivers;
        this.#programLifecycle = {
            disposeAgent: async (runId, actorId) => runtime.actorProgramLifecycle?.stopActor?.(runId, actorId),
            haltRun: async (runId) => runtime.actorProgramLifecycle?.stopRun?.(runId),
            disposeRun: async (runId) => runtime.actorProgramLifecycle?.disposeRun?.(runId),
            shutdown: async () => runtime.actorProgramLifecycle?.shutdown?.(),
            waitForRunSettlement: (runId) => runtime.actorProgramLifecycle?.waitForRunSettlement?.(runId),
        };
        this.#catalog = options.catalog;
        this.#workspaces = options.workspaces ?? new FixedWorkspaces();
        this.#registry = options.registry;
        this.#live = options.live;
        this.#workspaceToolNaming = options.workspaceToolNaming;
        this.#basePrompt = options.basePrompt ?? ((_runId, actor) => (actor.kind === "agent" ? actor.prompt : ""));
        this.#contract = options.contract ?? (() => defaultContract);
        this.#toolChapters = options.toolChapters ?? (() => "");
        this.#modelSelection = options.modelSelection;
        this.#onError = options.onError ?? ((error) => console.error("Turn scheduler failed:", error));
    }

    #workspaceToolsFor(actor: ExecutableActor): readonly string[] {
        const names = this.#workspaceToolNaming?.agentToolNames(actor.execution.driver.kind);

        if (!names)
            return [];

        if (!holdsUsable(actor, "workspace.use"))
            return [];

        return [...names.read, ...names.write, ...names.execute];
    }

    start() {
        if (this.#unsubscribe)
            return;

        if (this.#stopped)
            throw new Error("A stopped turn scheduler cannot be restarted.");

        this.#unsubscribe = this.#journal.subscribe((events) => {
            try {
                for (const event of events) {
                    if (event.type === "actor.stopped")
                        this.#disposeAgentRuntime(event.runId, event.payload.actorId);
                    if (event.type === "actor.restarted")
                        this.#reviveAgentRuntime(event.runId, event.payload.actorId);
                }

                for (const runId of new Set(events.map((event) => event.runId)))
                    this.#scanRun(runId);
            } catch (error) {
                this.#onError(error);
            }
        });

        for (const runId of this.#journal.runIds())
            this.#scanRun(runId);
    }

    abort(runId: string, actorId: string) {
        this.#active.get(keyOf(runId, actorId))?.controller.abort();
    }

    isRunning(runId: string, actorId: string) {
        return this.#active.has(keyOf(runId, actorId));
    }

    async waitForIdle() {
        while (this.#active.size > 0 || this.#lifecycle.size > 0) {
            await Promise.allSettled([
                ...[...this.#active.values()].map((entry) => entry.promise),
                ...[...this.#lifecycle].map((entry) => entry.promise),
            ]);
        }

        await this.#retryAgentDisposals();
    }

    stopRun(runId: string) {
        const activeStop = this.#runState(runId).stop;
        this.#updateRunState(runId, { retired: true, quarantine: null });

        if (activeStop?.retire)
            return activeStop.promise;

        if (activeStop)
            return this.#rememberRunStop(runId, true, activeStop.promise
                .catch(() => undefined)
                .then(() => this.#stopOneRun(runId, true)));

        return this.#beginRunStop(runId, true);
    }

    #runState(runId: string): RunRuntimeState {
        return this.#runs.get(runId) ?? clearRunRuntimeState;
    }

    #updateRunState(runId: string, patch: Partial<RunRuntimeState>) {
        const next = { ...this.#runState(runId), ...patch };

        if (!next.stopping && !next.retired && !next.stop && !next.quarantine && next.haltBoundaries === 0)
            this.#runs.delete(runId);
        else
            this.#runs.set(runId, next);
    }

    #isolatedRun(runId: string) {
        const state = this.#runState(runId);

        return state.retired || state.stop !== null || state.haltBoundaries > 0 || state.quarantine !== null;
    }

    #acceptsTurns(runId: string) {
        return !this.#stopped && !this.#runState(runId).stopping;
    }

    #beginRunStop(runId: string, retire: boolean) {
        const existing = this.#runState(runId).stop;

        if (existing)
            return existing.promise;

        if (this.#stopped)
            return this.#stopPromise ?? Promise.resolve();

        return this.#rememberRunStop(runId, retire, this.#stopOneRun(runId, retire));
    }

    #rememberRunStop(runId: string, retire: boolean, promise: Promise<void>) {
        const entry = { retire, promise };
        this.#updateRunState(runId, { stop: entry });
        void promise.catch(() => {
            if (this.#runState(runId).stop === entry)
                this.#updateRunState(runId, { stop: null });
        });

        return promise;
    }

    async haltRun(
        runId: string,
        whileHalted?: (runtimeStopped: Promise<void>, runtimeSettled: Promise<void>) => void | Promise<void>,
    ) {
        const previousSettlement = this.#runState(runId).quarantine?.promise;
        const promise = this.#beginRunStop(runId, this.#runState(runId).retired);
        const runtimeStopped = promise;
        this.#updateRunState(runId, { haltBoundaries: this.#runState(runId).haltBoundaries + 1 });
        let driverSettlement: Promise<void> | undefined;
        const settlementStarted = promise.catch(() => undefined).then(() => {
            driverSettlement = this.#driverSettlement(runId);

            if (driverSettlement && !this.#runState(runId).quarantine)
                this.quarantineRun(runId, driverSettlement);
        });
        const runtimeSettled: Promise<void> = Promise.allSettled([settlementStarted.then(() => driverSettlement), previousSettlement]).then(() => undefined);

        try {
            const results = await Promise.allSettled([
                promise,
                settlementStarted,
                ...(whileHalted ? [Promise.resolve().then(() => whileHalted(runtimeStopped, runtimeSettled))] : []),
            ]);
            const failures = results
                .filter((result): result is PromiseRejectedResult => result.status === "rejected")
                .map((result) => result.reason);

            if (failures.length === 1)
                throw failures[0];

            if (failures.length > 1)
                throw new AggregateError(failures, `Run ${runId} konnte nicht vollständig angehalten werden.`);
        } finally {
            const state = this.#runState(runId);

            if (!state.retired && state.stop?.promise === promise)
                this.#updateRunState(runId, { stop: null });

            this.#updateRunState(runId, { haltBoundaries: Math.max(0, this.#runState(runId).haltBoundaries - 1) });
            this.#releaseRunBlock(runId);
        }
    }

    quarantineRun(runId: string, until: Promise<void>): void {
        if (this.#runState(runId).haltBoundaries === 0)
            throw new Error(`Run ${runId} kann nur innerhalb einer aktiven Stopp-Grenze quarantiniert werden.`);

        const quarantine = { promise: until };
        if (!this.#runState(runId).retired)
            this.#updateRunState(runId, { quarantine });

        void until.then(
            () => {
                if (this.#runState(runId).quarantine !== quarantine)
                    return;

                this.#updateRunState(runId, { quarantine: null });
                this.#releaseRunBlock(runId);
            },
            (error: unknown) => {
                this.#onError(error);
            },
        );
    }

    #releaseRunBlock(runId: string): void {
        if (this.#isolatedRun(runId))
            return;

        this.#updateRunState(runId, { stopping: false });
        if (this.#unsubscribe)
            this.#scanRun(runId);
    }

    #driverSettlement(runId: string): Promise<void> | undefined {
        const settlements: Promise<void>[] = [];

        for (const driver of this.#uniqueLifecycles()) {
            try {
                const settlement = driver.waitForRunSettlement?.(runId);

                if (settlement)
                    settlements.push(settlement);
            } catch (error) {
                this.#onError(error);
            }
        }

        if (settlements.length === 0)
            return undefined;

        return Promise.allSettled(settlements).then((results) => {
            for (const result of results) {
                if (result.status === "rejected")
                    this.#onError(result.reason);
            }
        });
    }

    stop() {
        if (this.#stopPromise)
            return this.#stopPromise;

        const promise = this.#stopScheduler();
        this.#stopPromise = promise;
        void promise.catch(() => {
            if (this.#stopPromise === promise)
                this.#stopPromise = null;
        });

        return promise;
    }

    async #stopScheduler() {
        if (!this.#stopped) {
            this.#stopped = true;
            this.#unsubscribe?.();
            this.#unsubscribe = null;

            for (const entry of this.#active.values())
                entry.controller.abort();
        }

        await this.waitForIdle();
        await Promise.allSettled([...this.#runs.values()].flatMap((state) => state.stop ? [state.stop.promise] : []));
        const results = await Promise.allSettled([
            this.#waitForRunQuarantines(),
            ...this.#uniqueLifecycles().map(async (driver) => {
                await driver.shutdown?.();

                if (driver.shutdown)
                    this.#settleAgentDisposals(driver);
            }),
        ]);
        const failures = results
            .filter((result): result is PromiseRejectedResult => result.status === "rejected")
            .map((result) => result.reason);

        if (failures.length === 1)
            throw failures[0];

        if (failures.length > 1)
            throw new AggregateError(failures, "Scheduler shutdown failed.");

        this.#throwPendingAgentDisposals();
    }

    async #waitForRunQuarantines() {
        const waited = new Set<RunQuarantine>();

        for (;;) {
            const pending = [...this.#runs.values()]
                .flatMap((state) => state.quarantine ? [state.quarantine] : [])
                .filter((entry) => !waited.has(entry));

            if (pending.length === 0)
                return;

            pending.forEach((entry) => waited.add(entry));
            await Promise.allSettled(pending.map((entry) => entry.promise));
        }
    }

    async #stopOneRun(runId: string, retire: boolean) {
        this.#updateRunState(runId, { stopping: true });
        const drivers = this.#uniqueLifecycles();
        const idle = this.#waitForRunIdle(runId);
        const stoppingDrivers = Promise.allSettled(drivers.map((driver) => Promise.resolve().then(() =>
            retire ? driver.disposeRun?.(runId) : driver.haltRun?.(runId))));

        await idle;
        await this.#retryAgentDisposals(runId);
        const results = await stoppingDrivers;
        await this.#waitForRunIdle(runId);
        const failures = results.flatMap((result, index) => {
            if (result.status === "rejected")
                return [result.reason];

            const driver = drivers[index];
            if (driver && (retire ? driver.disposeRun : driver.haltRun))
                this.#settleAgentDisposals(driver, runId);

            return [];
        });

        try {
            this.#throwPendingAgentDisposals(runId);
        } catch (error) {
            failures.push(error);
        }

        if (failures.length > 0)
            throw new AggregateError(
                failures,
                `Failed to stop ${failures.length} runtime branch(es) for run ${runId}: ${failures.map(errorMessage).join("; ")}`,
            );
    }

    async #waitForRunIdle(runId: string) {
        for (;;) {
            const active = [...this.#active.values()].filter((entry) => entry.runId === runId);
            const lifecycle = [...this.#lifecycle].filter((entry) => entry.runId === runId);

            if (active.length === 0 && lifecycle.length === 0)
                return;

            for (const entry of active)
                entry.controller.abort();

            await Promise.allSettled([
                ...active.map((entry) => entry.promise),
                ...lifecycle.map((entry) => entry.promise),
            ]);
        }
    }

    #reviveAgentRuntime(runId: string, actorId: string) {
        const actor = this.#actor(runId, actorId);

        if (!actor || !isAutomated(actor.execution.driver.kind))
            return;

        const driver = this.#drivers[actor.execution.driver.kind];

        if (!driver?.reviveAgent)
            return;

        const pending = this.#pendingAgentDisposals.get(keyOf(runId, actorId));
        const revive = () => driver.reviveAgent?.(runId, actorId);

        if (pending?.promise)
            void pending.promise.then(revive, revive);
        else
            revive();
    }

    #disposeAgentRuntime(runId: string, actorId: string) {
        const key = keyOf(runId, actorId);
        const active = this.#active.get(key);
        active?.controller.abort();
        const actor = this.#actor(runId, actorId);

        if (!actor) return;
        const driver = isAutomated(actor.execution.driver.kind) ? this.#drivers[actor.execution.driver.kind] : undefined;
        const remaining = new Set<RuntimeLifecycle>([
            ...(driver?.disposeAgent ? [driver] : []),
            ...(this.#runtime.actorProgramLifecycle?.stopActor ? [this.#programLifecycle] : []),
        ]);
        if (remaining.size === 0 || this.#pendingAgentDisposals.has(key)) return;

        const pending: PendingAgentDisposal = {
            runId, actorId, remaining,
            dispose: async () => {
                const results = await Promise.allSettled([...remaining].map(async (runtime) => {
                    await runtime.disposeAgent?.(runId, actorId);
                    remaining.delete(runtime);
                }));
                const failures = results.filter((result): result is PromiseRejectedResult => result.status === "rejected").map((result) => result.reason);
                if (failures.length === 1) throw failures[0];
                if (failures.length > 1) throw new AggregateError(failures, `Actor ${actorId} cleanup failed.`);
            },
            promise: null, lastError: null,
        };
        this.#pendingAgentDisposals.set(key, pending);

        const lifecycle = {
            runId,
            promise: Promise.resolve(active?.promise)
                .then(async () => {
                    const succeeded = await this.#attemptAgentDisposal(key, pending);

                    if (!succeeded)
                        await this.#attemptAgentDisposal(key, pending);
                })
                .then(() => undefined),
        };
        this.#lifecycle.add(lifecycle);
        void lifecycle.promise.finally(() => this.#lifecycle.delete(lifecycle));
    }

    async #attemptAgentDisposal(key: string, entry: PendingAgentDisposal) {
        if (entry.promise)
            return entry.promise;

        const promise: Promise<boolean> = Promise.resolve()
            .then(entry.dispose)
            .then(() => {
                if (this.#pendingAgentDisposals.get(key) === entry)
                    this.#pendingAgentDisposals.delete(key);

                entry.lastError = null;

                return true;
            })
            .catch((error: unknown) => {
                entry.lastError = error;
                this.#onError(error);

                return false;
            });
        entry.promise = promise;
        void promise.finally(() => {
            if (entry.promise === promise)
                entry.promise = null;
        });

        return promise;
    }

    async #retryAgentDisposals(runId?: string) {
        const pending = [...this.#pendingAgentDisposals.entries()].filter(
            ([, entry]) => runId === undefined || entry.runId === runId,
        );
        await Promise.all(pending.map(([key, entry]) => this.#attemptAgentDisposal(key, entry)));
    }

    #settleAgentDisposals(runtime: RuntimeLifecycle, runId?: string) {
        for (const [key, entry] of this.#pendingAgentDisposals) {
            if (runId !== undefined && entry.runId !== runId) continue;
            entry.remaining.delete(runtime);
            if (entry.remaining.size === 0) this.#pendingAgentDisposals.delete(key);
        }
    }

    #throwPendingAgentDisposals(runId?: string) {
        const pending = [...this.#pendingAgentDisposals.values()].filter(
            (entry) => runId === undefined || entry.runId === runId,
        );

        if (pending.length === 0)
            return;

        throw new AggregateError(
            pending.map((entry) => entry.lastError ?? new Error(`Disposal of actor ${entry.actorId} is still pending.`)),
            `Failed to dispose ${pending.length} actor runtime(s)${runId ? ` for run ${runId}` : ""}.`,
        );
    }

    #uniqueLifecycles(): RuntimeLifecycle[] {
        return [...new Set(Object.values(this.#drivers).filter((driver) => driver !== undefined)),
            ...(this.#runtime.actorProgramLifecycle ? [this.#programLifecycle] : [])];
    }

    #scanRun(runId: string) {
        if (!this.#acceptsTurns(runId) || !this.#journal.stateOf(runId))
            return;

        const view = this.#runtime.view(runId);

        for (const actor of view.actors) {
            const input = view.inputs
                .filter((entry) => entry.actorId === actor.id && isPendingActorInput(entry))
                .sort((left, right) => left.sequence - right.sequence)[0];

            if (
                actor.kind !== "human" &&
                isAutomated(actor.execution.driver.kind) &&
                actor.lifecycle.kind === "idle" &&
                input
            )
                this.#launch(runId, actor.id, input.id, view.revision);
        }
    }

    #launch(runId: string, actorId: string, inputId: string, revision: number) {
        const key = keyOf(runId, actorId);

        if (this.#active.has(key) || !this.#acceptsTurns(runId) || this.#blocked.get(key) === revision)
            return;

        const controller = new AbortController();
        const promise = Promise.resolve()
            .then(() => this.#runTurn(runId, actorId, inputId, controller, revision))
            .catch((error: unknown) => {
                this.#blocked.set(key, revision);
                this.#onError(error);
            })
            .finally(() => {
                this.#active.delete(key);

                if (this.#stopped)
                    return;

                try {
                    this.#scanRun(runId);
                } catch (error) {
                    this.#onError(error);
                }
            });
        this.#active.set(key, { runId, actorId, controller, promise });
    }

    async #runTurn(
        runId: string,
        actorId: string,
        inputId: string,
        controller: AbortController,
        revision: number,
    ) {
        if (!this.#acceptsTurns(runId))
            return;

        const idle = this.#actor(runId, actorId);
        const pending = this.#runtime.view(runId).inputs.find(
            (entry) => entry.id === inputId && entry.actorId === actorId && isPendingActorInput(entry),
        );

        if (!idle || !isAutomated(idle.execution.driver.kind) || idle.lifecycle.kind !== "idle" || !pending)
            return;

        const turn = claimTurn(
            this.#runtime,
            runId,
            actorId,
            inputId,
            `scheduler:start:${actorId}:${inputId}:${revision}`,
        );
        this.#live?.publish(runId, actorId, { kind: "turn-started", turnId: turn.turnId });
        const timeout = idle.execution.turnTimeoutMs
            ? setTimeout(() => controller.abort(), idle.execution.turnTimeoutMs)
            : null;

        try {
            const actor = this.#actor(runId, actorId);
            const driverRef = actor?.execution.driver;

            if (!actor || !driverRef || driverRef.kind === "manual")
                throw new Error(`Actor ${actorId} lost its driver before turn ${turn.turnId}.`);

            const driver = this.#requiredDriver(driverRef.kind);
            const selection = driverRef.kind === "agent"
                ? { ...(this.#modelSelection ? this.#modelSelection(turn, actor) : driverRef.config) }
                : null;

            if (actor.kind === "agent"
                && actor.toolNames?.length === 0
                && driver.supportsPlainLlm !== true)
                throw new Error(
                    `Driver ${driverRef.kind} cannot guarantee a plain LLM without intrinsic tools.`,
                );

            const workspace = this.#workspaces.ensure(runId, actor.execution.workspacePath);
            const toolset = await TurnToolset.create({
                runtime: this.#runtime,
                turn,
                catalog: this.#catalog,
                registry: this.#registry,
                workspace,
                signal: controller.signal,
                chapters: (toolNames) => this.#toolChapters(runId, actor, toolNames, toolset.functions),
            });
            const allowed = actor.toolNames === null ? null : new Set(actor.toolNames);
            const configuredWorkspace = this.#workspaceToolNaming?.agentToolNames(driverRef.kind);
            const configuredWorkspaceNames = configuredWorkspace
                ? [...configuredWorkspace.read, ...configuredWorkspace.write, ...configuredWorkspace.execute]
                : [];
            const deniedWorkspaceTools = actor.toolNames?.filter(
                (name) => configuredWorkspaceNames.includes(name) && !holdsUsable(actor, "workspace.use"),
            ) ?? [];

            if (deniedWorkspaceTools.length > 0)
                throw new Error(
                    `Actor ${actor.id} requested workspace tools without workspace.use: ${deniedWorkspaceTools.join(", ")}.`,
                );

            const workspaceTools = this.#workspaceToolsFor(actor)
                .filter((name) => !toolset.functions.some((tool) => tool.name === name))
                .filter((name) => allowed === null || allowed.has(name));
            const resolvedToolNames = new Set([...toolset.functions.map((tool) => tool.name), ...workspaceTools]);
            const unresolvedToolNames = actor.toolNames?.filter((name) => !resolvedToolNames.has(name)) ?? [];

            if (driverRef.kind !== "agent" && unresolvedToolNames.length > 0)
                throw new Error(`Actor ${actor.id} requested unknown tools: ${unresolvedToolNames.join(", ")}.`);

            let emitted = 0;
            const request = {
                runId,
                agentId: actorId,
                turnId: turn.turnId,
                startedAt: turn.startedAt,
                input: turn.input,
                attachments: turn.input.artifactIds.map((artifactId) => {
                    const { artifact, content } = this.#runtime.artifactContent(runId, artifactId, actorId);
                    return { name: artifact.title, mediaType: artifact.mediaType, content };
                }),
                prompt: promptFor(this.#runtime.view(runId), actorId, turn.input),
                systemPrompt: systemPromptFor(
                    runId,
                    actor,
                    [...resolvedToolNames],
                    this.#basePrompt,
                    this.#contract,
                    actor.kind === "agent" ? [
                        toolOrientationText(toolset.functions),
                        toolset.functions.some((tool) => tool.name === "actor_list")
                            ? actorRosterText(this.#runtime.view(runId), actorId)
                            : "",
                    ].filter(Boolean).join("\n\n") : "",
                ),
                workspace,
                tools: driverRef.kind === "script" ? toolset.functions : toolset.tools,
                workspaceTools,
                allowedToolNames: actor.toolNames,
                refreshTools: async () => {
                    await toolset.refresh();
                    return {
                        tools: toolset.tools,
                        systemPrompt: systemPromptFor(
                            runId, actor,
                            [...new Set([...toolset.functions.map((tool) => tool.name), ...workspaceTools])],
                            this.#basePrompt, this.#contract,
                            actor.kind === "agent" ? [
                                toolOrientationText(toolset.functions),
                                toolset.functions.some((tool) => tool.name === "actor_list")
                                    ? actorRosterText(this.#runtime.view(runId), actorId)
                                    : "",
                            ].filter(Boolean).join("\n\n") : "",
                        ),
                    };
                },
                emit: (driverEvent: DriverEvent) => this.#append(turn, emitted++, driverEvent),
                recordTool: (toolEvent: DriverToolEvent) => this.#appendTool(turn, emitted++, toolEvent),
                publish: (liveEvent: LiveEvent) => this.#live?.publish(runId, actorId, liveEvent),
            };
            const result = driverRef.kind === "agent"
                ? await this.#requiredDriver("agent").runTurn(
                    {
                        ...request,
                        driverKind: "agent",
                        selection: selection!,
                        forkOf: actor.kind === "agent" ? actor.forkOf : null,
                        invoke: (toolCallId: string, name: string, input: JsonValue) => toolset.invoke(toolCallId, name, input),
                    },
                    controller.signal,
                )
                : await this.#requiredDriver("script").runTurn(
                    {
                        ...request,
                        driverKind: "script",
                        invoke: (toolCallId: string, name: string, input: JsonValue) => toolset.invokeFunction(toolCallId, name, input),
                    },
                    controller.signal,
                );

            if (!this.#isRunning(turn))
                return;

            if (controller.signal.aborted || !this.#acceptsTurns(runId)) {
                this.#interrupt(turn, "Der Turn wurde abgebrochen.");

                return;
            }

            if (result.failure) {
                this.#fail(turn, result.failure, result.usage);

                return;
            }

            this.#finish(turn, result.usage);
        } catch (error) {
            const usage = (error as { usage?: TurnUsage }).usage;
            const message = controller.signal.aborted
                ? "Der Turn wurde abgebrochen."
                : `Der Turn ist gescheitert: ${errorMessage(error)}`;

            if (this.#isRunning(turn)) {
                if (controller.signal.aborted || !this.#acceptsTurns(runId))
                    this.#interrupt(turn, message);
                else
                    this.#fail(turn, message, usage);
            }
        } finally {
            if (timeout)
                clearTimeout(timeout);
        }
    }

    #requiredDriver<Kind extends AutomatedDriverKind>(kind: Kind): AgentDriver<Kind> {
        const driver = this.#drivers[kind];

        if (!driver)
            throw new Error(`Driver ${kind} is not registered.`);

        return driver;
    }

    #actor(runId: string, actorId: string): ExecutableActor | null {
        const found = this.#runtime.view(runId).actors.find((entry) => entry.id === actorId);

        return found && found.kind !== "human" ? found : null;
    }

    #isRunning(turn: ClaimedTurn) {
        const actor = this.#actor(turn.runId, turn.actorId);

        return actor?.lifecycle.kind === "running" && actor.lifecycle.turnId === turn.turnId;
    }

    #append(turn: ClaimedTurn, index: number, driverEvent: DriverEvent) {
        const context = {
            actorId: turn.actorId,
            commandId: `scheduler:${turn.turnId}:${driverEvent.kind}:${index}`,
            turnId: turn.turnId,
            correlationId: turn.turnId,
        };
        const payload = { turnId: turn.turnId, text: driverEvent.text };

        if (driverEvent.kind === "assistant")
            this.#runtime.appendModelOutput(context, turn.runId, turn.actorId, payload);
        else if (driverEvent.kind === "reasoning")
            this.#runtime.appendModelReasoning(context, turn.runId, turn.actorId, payload);
        else
            this.#runtime.appendRuntimeOutput(context, turn.runId, turn.actorId, payload);
    }

    #appendTool(turn: ClaimedTurn, index: number, event: DriverToolEvent) {
        const context = {
            actorId: turn.actorId,
            commandId: `scheduler:${turn.turnId}:tool:${event.id}:${event.kind}:${index}`,
            turnId: turn.turnId,
            correlationId: event.id,
        };

        if (event.kind === "started")
            this.#runtime.startToolCall(context, turn.runId, turn.actorId, {
                turnId: turn.turnId,
                toolCallId: event.id,
                name: event.name,
                input: event.input,
            });
        else if (event.kind === "completed")
            this.#runtime.completeToolCall(context, turn.runId, turn.actorId, {
                turnId: turn.turnId,
                toolCallId: event.id,
                name: event.name,
                output: event.output,
            });
        else
            this.#runtime.failToolCall(context, turn.runId, turn.actorId, {
                turnId: turn.turnId,
                toolCallId: event.id,
                name: event.name,
                error: event.error,
            });
    }

    #finish(turn: ClaimedTurn, usage: TurnUsage) {
        const openCalls = this.#openToolCalls(turn);

        if (openCalls.length > 0) {
            this.#fail(
                turn,
                `Turn ended with unfinished tool calls: ${openCalls.map((call) => call.id).join(", ")}.`,
                usage,
            );

            return;
        }

        this.#runtime.finishTurn(
            {
                actorId: turn.actorId,
                commandId: `scheduler:${turn.turnId}:finish:completed`,
                turnId: turn.turnId,
                correlationId: turn.turnId,
            },
            turn.runId,
            turn.actorId,
            { turnId: turn.turnId, outcome: "completed", usage },
        );
        this.#live?.publish(turn.runId, turn.actorId, {
            kind: "turn-finished",
            turnId: turn.turnId,
            outcome: "completed",
        });
    }

    #fail(turn: ClaimedTurn, message: string, usage: TurnUsage | undefined) {
        if (!this.#isRunning(turn))
            return;

        try {
            this.#append(turn, Number.MAX_SAFE_INTEGER, { kind: "runtime", text: message });
            this.#closeOpenToolCalls(turn, message);
            this.#runtime.finishTurn(
                {
                    actorId: turn.actorId,
                    commandId: `scheduler:${turn.turnId}:finish:failed`,
                    turnId: turn.turnId,
                    correlationId: turn.turnId,
                },
                turn.runId,
                turn.actorId,
                { turnId: turn.turnId, outcome: "failed", reason: message, ...(usage ? { usage } : {}) },
            );
            this.#live?.publish(turn.runId, turn.actorId, {
                kind: "turn-finished",
                turnId: turn.turnId,
                outcome: "failed",
            });
        } catch (error) {
            if (this.#isRunning(turn))
                this.#onError(error);
        }
    }

    #interrupt(turn: ClaimedTurn, reason: string) {
        if (!this.#isRunning(turn))
            return;

        try {
            this.#closeOpenToolCalls(turn, reason);
            this.#runtime.interruptTurn(
                {
                    actorId: turn.actorId,
                    commandId: `scheduler:${turn.turnId}:interrupt`,
                    turnId: turn.turnId,
                    correlationId: turn.turnId,
                },
                turn.runId,
                turn.actorId,
                { turnId: turn.turnId, reason },
            );
            this.#live?.publish(turn.runId, turn.actorId, {
                kind: "turn-finished",
                turnId: turn.turnId,
                outcome: "abandoned",
            });
        } catch (error) {
            if (this.#isRunning(turn))
                this.#onError(error);
        }
    }

    #openToolCalls(turn: ClaimedTurn) {
        const open = new Map<string, { id: string; name: string }>();

        for (const event of this.#runtime.events(turn.runId)) {
            if (event.actorId !== turn.actorId)
                continue;

            if (event.type === "tool.call.started" && event.payload.turnId === turn.turnId) {
                open.set(event.payload.toolCallId, {
                    id: event.payload.toolCallId,
                    name: event.payload.name,
                });
            }

            if ((event.type === "tool.call.completed" || event.type === "tool.call.failed")
                && event.payload.turnId === turn.turnId)
                open.delete(event.payload.toolCallId);
        }

        return [...open.values()];
    }

    #closeOpenToolCalls(turn: ClaimedTurn, reason: string) {
        for (const call of this.#openToolCalls(turn)) {
            this.#runtime.failToolCall(
                {
                    actorId: turn.actorId,
                    commandId: `scheduler:${turn.turnId}:tool:${call.id}:abandoned`,
                    turnId: turn.turnId,
                    correlationId: call.id,
                },
                turn.runId,
                turn.actorId,
                {
                    turnId: turn.turnId,
                    toolCallId: call.id,
                    name: call.name,
                    error: reason,
                },
            );
        }
    }
}
