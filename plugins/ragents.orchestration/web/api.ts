import { runContracts } from "@ragents/engine/src/http/contracts";
import { rpc } from "@ragents/web/rpc";

export const enqueueActorInput = async (runId: string, actorId: string, content: string, artifactIds: string[] = []) => {
  await rpc.call(runContracts.enqueueInput, { runId, commandId: crypto.randomUUID(), actorId, content, artifactIds });
};

export const resolveAction = async (
  runId: string,
  actionId: string,
  decision: "approved" | "dismissed",
  result?: string,
) => {
  await rpc.call(runContracts.resolveAction, { runId, commandId: crypto.randomUUID(), actionId, decision, result });
};

export const stopActor = async (runId: string, actorId: string, reason: string) => {
  await rpc.call(runContracts.stopActor, { runId, commandId: crypto.randomUUID(), actorId, reason });
};

export const restartActor = async (runId: string, actorId: string) => {
  await rpc.call(runContracts.restartActor, { runId, commandId: crypto.randomUUID(), actorId });
};

export const stopRun = async (runId: string, reason: string) => {
  await rpc.call(runContracts.stopAll, { runId, commandId: crypto.randomUUID(), reason });
};
