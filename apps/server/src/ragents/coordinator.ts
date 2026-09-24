import type { Orchestration } from "@ragents/engine";

export const isRunCoordinator = (runtime: Orchestration, runId: string, actorId: string): boolean =>
  runtime.events(runId).some((event) => event.type === "agent.spawned"
    && event.payload.agentId === actorId && /(?:^|:)coordinator:[^:]+:\d+$/.test(event.commandId));
