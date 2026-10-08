import type { JournalEvent } from "./events.ts";

/** A fork excludes every source turn that was still running at its spawn. */
export const forkContextCut = (events: readonly JournalEvent[], source: string, spawnSequence: number): number => {
    const running = new Map<string, number>();
    for (const event of events) {
        if (event.sequence >= spawnSequence) break;
        if (event.type === "turn.started" && event.actorId === source)
            running.set(event.payload.turnId, event.sequence);
        else if (event.type === "turn.finished" || event.type === "turn.interrupted")
            running.delete(event.payload.turnId);
    }
    return Math.min(spawnSequence, ...running.values());
};

export const belongsToModelContext = (events: readonly JournalEvent[], actorId: string, candidate: JournalEvent): boolean => {
    if (candidate.actorId === actorId) return true;
    const spawn = events.find((event) => event.type === "agent.spawned" && event.payload.agentId === actorId);
    if (spawn?.type !== "agent.spawned" || !spawn.payload.forkOf) return false;
    const cut = forkContextCut(events, spawn.payload.forkOf, spawn.sequence);
    return candidate.sequence < cut && belongsToModelContext(events, spawn.payload.forkOf, candidate);
};
