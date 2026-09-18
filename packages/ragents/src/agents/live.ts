import type { LiveEvent } from "../drivers/types.ts";

export type AgentLiveEvent =
    | LiveEvent
    | { kind: "turn-started"; turnId: string }
    | { kind: "turn-finished"; turnId: string; outcome: "waiting" | "completed" | "failed" | "abandoned" };

export type AgentLiveListener = (event: AgentLiveEvent) => unknown;

export type AgentLiveListenerContext = {
    readonly runId: string;
    readonly agentId: string;
    readonly event: AgentLiveEvent;
};

export type AgentLiveListenerErrorHandler = (
    error: unknown,
    context: AgentLiveListenerContext,
) => void | Promise<void>;

export type LiveBusOptions = {
    readonly onListenerError?: AgentLiveListenerErrorHandler;
};

const keyOf = (runId: string, agentId: string) => `${runId}\0${agentId}`;

export class LiveBus {
    readonly #listeners = new Map<string, Set<AgentLiveListener>>();
    readonly #onListenerError: AgentLiveListenerErrorHandler;

    constructor(options: LiveBusOptions = {}) {
        this.#onListenerError = options.onListenerError ?? (() => undefined);
    }

    subscribe(runId: string, agentId: string, listener: AgentLiveListener) {
        const key = keyOf(runId, agentId);
        const set = this.#listeners.get(key) ?? new Set<AgentLiveListener>();
        set.add(listener);
        this.#listeners.set(key, set);

        return () => {
            set.delete(listener);

            if (set.size === 0)
                this.#listeners.delete(key);
        };
    }

    publish(runId: string, agentId: string, event: AgentLiveEvent): void {
        const context = { runId, agentId, event };
        const listeners = [...(this.#listeners.get(keyOf(runId, agentId)) ?? [])];

        for (const listener of listeners) {
            try {
                const result = listener(event);
                if (result !== undefined)
                    void Promise.resolve(result).catch((error: unknown) => this.#report(error, context));
            } catch (error: unknown) {
                this.#report(error, context);
            }
        }
    }

    #report(error: unknown, context: AgentLiveListenerContext): void {
        try {
            void Promise.resolve(this.#onListenerError(error, context)).catch(() => undefined);
        } catch {
            return;
        }
    }
}
