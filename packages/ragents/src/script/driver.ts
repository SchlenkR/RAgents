import type { AgentDriver, TurnRequest, TurnResult } from "../drivers/types.ts";
import type { Orchestration } from "../runtime/orchestration.ts";

export type ScriptDriverOptions = { runtime: Orchestration };

export class ScriptDriver implements AgentDriver<"script"> {
    readonly kind = "script" as const;
    readonly #runtime: Orchestration;

    constructor(options: ScriptDriverOptions) {
        this.#runtime = options.runtime;
    }

    runTurn(request: TurnRequest<"script">, signal: AbortSignal): Promise<TurnResult> {
        return this.#runtime.actorPrograms.runInput(request, signal);
    }

}
