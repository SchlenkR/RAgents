import { randomUUID } from "node:crypto";
import { coreContracts } from "../../apps/server/src/api/contracts.ts";
import type { RpcClient } from "../../apps/web/src/rpc/client.ts";
import { runContracts } from "../../packages/ragents/src/http/contracts.ts";

/** Like the chat's Stop button: no actor starts a turn until a message or a resume continues the run; nothing is lost. */
export const pauseRun = async (rpc: RpcClient, runId: string, reason: string): Promise<void> => {
  await rpc.call(runContracts.pause, { runId, commandId: randomUUID(), reason });
};

/** Continues a paused run without a message; false if the run was not paused. */
export const resumeRun = async (rpc: RpcClient, runId: string): Promise<boolean> => {
  const view = await rpc.call(runContracts.view, { runId });
  if (!view) throw new Error(`The run ${runId} is not started.`);
  if (!view.pause) return false;
  await rpc.call(runContracts.resume, { runId, commandId: randomUUID() });
  return true;
};

/** Only the running turn of the primary actor ends, run and actors stay active. */
export const interruptPrimaryTurn = async (rpc: RpcClient, runId: string): Promise<string> => {
  const view = await rpc.call(runContracts.view, { runId });
  if (!view) throw new Error(`The run ${runId} is not started.`);
  const actorId = view.primaryActorId;
  if (!actorId) throw new Error(`The run ${runId} has no primary actor whose turn could be interrupted; stop with --run stops the whole run.`);
  await rpc.call(runContracts.interruptTurn, { runId, commandId: randomUUID(), actorId });
  return actorId;
};

/** Emergency stop: cancels all turns and stops all actors of the run. */
export const stopWholeRun = async (rpc: RpcClient, runId: string): Promise<void> => {
  await rpc.call(coreContracts.chat.stop, { runId });
};
