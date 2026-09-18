import type { RunPreparationMessage, RunPreparationResponse } from "../../server/src/run-preparation-contract";
import { errorFrom } from "./lib/http";

export async function discussRun(sessionId: string, messages: RunPreparationMessage[], signal: AbortSignal, skillName?: string): Promise<RunPreparationResponse> {
  const response = await fetch(`/chat/${encodeURIComponent(sessionId)}/prepare`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ messages, ...(skillName ? { skillName } : {}) }), signal,
  });
  if (!response.ok) throw await errorFrom(response, "Der Auftrag konnte nicht besprochen werden.");
  const result = await response.json() as RunPreparationResponse;
  if (result.kind === "start") {
    if (!result.input || typeof result.input.text !== "string" || !result.input.text.trim()) throw new Error("Der vorbereitete Startauftrag fehlt.");
    return result;
  }
  if (result.kind !== "reply" || typeof result.text !== "string" || !result.text.trim()) throw new Error("Die Vorbereitung hat keine Antwort geliefert.");
  return result;
}

export { preparedRunInput } from "../../server/src/run-preparation-input";
