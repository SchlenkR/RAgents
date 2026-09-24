import { coreContracts } from "@ragents/host/api/contracts";
import type { RunPreparationMessage, RunPreparationResponse } from "../../server/src/run-preparation-contract";
import { rpc } from "./rpc";
import type { RpcClient } from "./rpc/client";

export async function discussRun(sessionId: string, messages: RunPreparationMessage[], signal: AbortSignal, skillName?: string, client: RpcClient = rpc): Promise<RunPreparationResponse> {
  const result = await client.call(coreContracts.prepare, { runId: sessionId, messages, ...(skillName ? { skillName } : {}) }, { signal });
  if (result.kind === "start") {
    if (!result.input || typeof result.input.text !== "string" || !result.input.text.trim()) throw new Error("Der vorbereitete Startauftrag fehlt.");
    return result;
  }
  if (result.kind !== "reply" || typeof result.text !== "string" || !result.text.trim()) throw new Error("Die Vorbereitung hat keine Antwort geliefert.");
  return result;
}

export { preparedRunInput } from "../../server/src/run-preparation-input";
