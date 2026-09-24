import { randomUUID } from "node:crypto";
import { coreContracts } from "../../apps/server/src/api/contracts.ts";
import type { RpcClient } from "../../apps/web/src/rpc/client.ts";
import { runContracts } from "../../packages/ragents/src/http/contracts.ts";

/** Wie die Chat-Eingabe: nur der laufende Turn des Primary-Actors endet, Run und Actors bleiben aktiv. */
export const interruptPrimaryTurn = async (rpc: RpcClient, runId: string): Promise<string> => {
  const view = await rpc.call(runContracts.view, { runId });
  if (!view) throw new Error(`Der Run ${runId} ist nicht gestartet.`);
  const actorId = view.primaryActorId;
  if (!actorId) throw new Error(`Der Run ${runId} hat keinen Primary-Actor, dessen Turn sich unterbrechen ließe; den ganzen Run hält stop mit --run an.`);
  await rpc.call(runContracts.interruptTurn, { runId, commandId: randomUUID(), actorId });
  return actorId;
};

/** Not-Aus: bricht alle Turns ab und stoppt alle Actors des Runs. */
export const stopWholeRun = async (rpc: RpcClient, runId: string): Promise<void> => {
  await rpc.call(coreContracts.chat.stop, { runId });
};
