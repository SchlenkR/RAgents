import type { TurnRequest, TurnResult } from "../drivers/types.ts";

export interface ActorProgramExecutor {
    runInput(request: TurnRequest<"script">, signal: AbortSignal): Promise<TurnResult>;
    stopActor?(runId: string, actorId: string): void | Promise<void>;
    stopRun?(runId: string): void | Promise<void>;
    waitForRunSettlement?(runId: string): Promise<void> | undefined;
    disposeRun?(runId: string): void | Promise<void>;
    shutdown?(): void | Promise<void>;
}
