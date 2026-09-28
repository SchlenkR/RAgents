import { agentSettings, type AgentSettingsInput, type ModelRuntime, type Skill, type ThinkingLevel as LoopThinkingLevel } from "@ragents/agent";
import { clampThinkingLevel, getSupportedThinkingLevels } from "@ragents/ai";

import { emptyUsage, type TurnUsage } from "../domain/model.ts";
import type { ThinkingLevel } from "../domain/driver.ts";
import type { AgentHook } from "./agent-hooks.ts";
import { AgentTurn } from "./agent-turn.ts";
import { createSkillPreload, type SkillPreload, type SkillPreloadConfiguration } from "./skill-preload.ts";
import type { TurnRequest, TurnResult } from "./types.ts";

export type AgentRuntimeContext = {
    runId: string;
    agentId: string;
    /** The working directory of the workspace tools; a runtime stays bound to it, and it is never a local path of this runtime. */
    workspace: string;
    allowedToolNames: readonly string[] | null;
};

export type AgentRuntimeDiagnostic = {
    type: "warning" | "error";
    message: string;
    context: AgentRuntimeContext;
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
    /** The hooks of the plugins, bound to the agent. */
    resolveHooks?: (
        context: AgentRuntimeContext,
        signal: AbortSignal,
    ) => readonly AgentHook[] | Promise<readonly AgentHook[]>;
    /** Compaction, retry and provider request limits; unset values keep the defaults. */
    settings?: AgentSettingsInput;
    turnAbortTimeoutMs?: number;
    onDiagnostic?: (diagnostic: AgentRuntimeDiagnostic) => void;
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

type ManagedAgentRuntimeSetup = {
    context: AgentRuntimeContext;
    modelRuntime: ModelRuntime;
    skills: readonly Skill[];
    hooks: readonly AgentHook[];
    options: AgentRuntimeManagerOptions;
    turnAbortTimeoutMs: number;
};

/** What an agent keeps between its turns: skills, hooks and the skill preload. Its conversation lives only in the journal. */
class ManagedAgentRuntime {
    readonly #setup: ManagedAgentRuntimeSetup;
    readonly #preload: SkillPreload | null;
    #turn: AgentTurn | null = null;
    #running = false;
    #disposed = false;
    #disposePromise: Promise<void> | null = null;
    #abortActiveTurn: (() => Promise<void> | null) | null = null;
    #idle: Promise<void> = Promise.resolve();
    #resolveIdle: (() => void) | null = null;
    readonly #inFlight = new Set<Promise<unknown>>();

    constructor(setup: ManagedAgentRuntimeSetup) {
        this.#setup = setup;
        const { skills, options, context, modelRuntime } = setup;
        this.#preload = skills.length > 0 && options.skillPreload !== false
            ? createSkillPreload({
                modelRuntime,
                ...options.skillPreload,
                onDiagnostic: (message) => options.onDiagnostic?.({ type: "warning", message, context }),
                onUsage: (usage: TurnUsage) => this.#turn?.addUsage(usage),
            })
            : null;
    }

    async runTurn(request: TurnRequest<"agent">, signal: AbortSignal): Promise<TurnResult> {
        if (this.#disposed || this.#disposePromise)
            throw new Error(`agent runtime for ${request.agentId} is stopping or disposed.`);

        if (this.#running)
            throw new Error(`agent runtime for ${request.agentId} cannot run concurrent turns.`);

        const stopController = new AbortController();
        const turnSignal = AbortSignal.any([signal, stopController.signal]);
        this.#running = true;
        this.#idle = new Promise<void>((resolveIdle) => {
            this.#resolveIdle = resolveIdle;
        });
        const abortDeadline = new TurnAbortDeadline(turnSignal, this.#setup.turnAbortTimeoutMs);
        const abortLatch = createTurnAbortLatch(() => this.#turn?.abort() ?? Promise.resolve());
        const abort = () => void abortLatch.request();
        const abortTurn = () => {
            stopController.abort(new Error(`agent runtime ${request.runId}/${request.agentId} is stopping.`));

            return abortLatch.request();
        };
        let turn: AgentTurn | null = null;
        this.#abortActiveTurn = abortTurn;
        turnSignal.addEventListener("abort", abort, { once: true });

        try {
            if (turnSignal.aborted) {
                abortLatch.request();

                return { failure: "The agent turn was aborted.", usage: emptyUsage() };
            }

            turn = this.#turnFor(request, turnSignal);
            this.#turn = turn;
            await abortDeadline.wait(this.#track(turn.run(() => {
                abortLatch.accept();
                queueMicrotask(() => void abortLatch.reapply());
            })));

            const abortPromise = abortLatch.pending();

            if (abortPromise)
                await abortDeadline.wait(this.#track(abortPromise));

            return turnSignal.aborted ? turn.abortedResult() : turn.result();
        } catch (error) {
            if (!turn)
                return { failure: turnSignal.aborted ? "The agent turn was aborted." : errorMessage(error), usage: emptyUsage() };

            const result = turn.result();

            return turnSignal.aborted
                ? turn.abortedResult()
                : { failure: result.failure ?? errorMessage(error), usage: result.usage };
        } finally {
            turnSignal.removeEventListener("abort", abort);
            turn?.deactivate();

            if (this.#turn === turn)
                this.#turn = null;

            if (this.#abortActiveTurn === abortTurn)
                this.#abortActiveTurn = null;

            abortDeadline.dispose();
            this.#running = false;
            this.#resolveIdle?.();
            this.#resolveIdle = null;
        }
    }

    #turnFor(request: TurnRequest<"agent">, signal: AbortSignal): AgentTurn {
        const { modelRuntime, options, context } = this.#setup;
        const { provider, model: modelId, thinking } = request.selection;
        const model = modelRuntime.getModel(provider, modelId);

        if (!model)
            throw new Error(`The model ${provider}/${modelId} is not configured.`);

        const level = thinking ?? options.thinkingLevel;

        if (level) {
            const available = getSupportedThinkingLevels(model);

            if (!available.includes(level))
                throw new Error(`The thinking level ${level} does not exist for ${modelId}; valid: ${available.join(", ")}.`);
        }

        return new AgentTurn({
            request,
            signal,
            modelRuntime,
            model,
            thinkingLevel: (level ?? clampThinkingLevel(model, "medium")) as LoopThinkingLevel,
            skills: this.#setup.skills,
            hooks: this.#setup.hooks,
            preload: this.#preload,
            settings: agentSettings(options.settings),
            track: (operation) => this.#track(operation),
            onDiagnostic: (message) => options.onDiagnostic?.({ type: "warning", message, context }),
        });
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

        this.#turn?.deactivate();
        await idle;
    }

    waitForSettlement(): Promise<void> {
        return Promise.allSettled([...this.#inFlight]).then(() => undefined);
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
        };
        let record = this.#runtimes.get(key);

        if (record && record.context.workspace !== context.workspace)
            throw new Error(`agent runtime workspace changed from ${record.context.workspace} to ${context.workspace}.`);

        if (record && !sameToolNames(record.context.allowedToolNames, context.allowedToolNames))
            throw new Error(`agent runtime tool allow-list changed for ${request.runId}/${request.agentId}.`);

        if (!record) {
            const creationAbort = new AbortController();
            const creationSignal = AbortSignal.any([signal, creationAbort.signal]);
            const runtime = this.#create(context, creationSignal);
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

    async #create(context: AgentRuntimeContext, signal: AbortSignal) {
        const modelRuntime = await awaitWithSignal(this.#modelRuntime, signal);
        const managedEnvironment = context.allowedToolNames === null;
        const loadHostHooks = managedEnvironment || (context.allowedToolNames?.length ?? 0) > 0;
        const hooks = loadHostHooks && this.#options.resolveHooks
            ? await this.#settled(context.runId, this.#options.resolveHooks(context, signal), signal)
            : [];
        const skills = managedEnvironment && this.#options.resolveSkills
            ? await this.#settled(context.runId, this.#options.resolveSkills(context, signal), signal)
            : [];
        assertUniqueSkillNames(skills);

        return new ManagedAgentRuntime({
            context,
            modelRuntime,
            skills,
            hooks,
            options: this.#options,
            turnAbortTimeoutMs: this.#turnAbortTimeoutMs,
        });
    }

    /** Waits for a resolution under the creation signal; a halt of the run still waits for its real end. */
    #settled<T>(runId: string, operation: PromiseLike<T> | T, signal: AbortSignal): Promise<T> {
        const pending = Promise.resolve(operation);
        this.#rememberRunSettlement(runId, pending.then(() => undefined, () => undefined));

        return awaitWithSignal(pending, signal);
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
