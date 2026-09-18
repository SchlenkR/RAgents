import type { Orchestration } from "@aicontainer/ragents";

export const isRunCoordinator = (runtime: Orchestration, runId: string, actorId: string): boolean =>
  runtime.events(runId).some((event) => event.type === "agent.spawned"
    && event.payload.agentId === actorId && /(?:^|:)coordinator:[^:]+:\d+$/.test(event.commandId));
