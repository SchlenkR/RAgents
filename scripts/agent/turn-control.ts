import { randomUUID } from "node:crypto";
import type { RpcClient } from "../../apps/web/src/rpc/client.ts";
import { runContracts } from "../../packages/ragents/src/http/contracts.ts";

/** Only the running turn of the primary actor ends, run and actors stay active. */
export const interruptPrimaryTurn = async (rpc: RpcClient, runId: string): Promise<string> => {
  const view = await rpc.call(runContracts.view, { runId });
  if (!view) throw new Error(`The run ${runId} is not started.`);
  const actorId = view.primaryActorId;
  if (!actorId) throw new Error(`The run ${runId} has no primary actor whose turn could be interrupted; ragents stop stops the whole run.`);
  await rpc.call(runContracts.interruptTurn, { runId, commandId: randomUUID(), actorId });
  return actorId;
};

/** Stops all run work until the next human message, keeping every actor active. */
export const stopWholeRun = async (rpc: RpcClient, runId: string): Promise<void> => {
  await rpc.call(runContracts.stop, { runId, commandId: randomUUID() });
};
