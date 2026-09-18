import { runRoute } from "./run-view";
import type { ChatAttachmentInput } from "@aicontainer/web/chat/types";
import { errorFrom } from "@aicontainer/web/lib/http";

const runCommand = async (runId: string, path: string, payload: Record<string, unknown>): Promise<void> => {
  const response = await fetch(runRoute(runId, path), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ commandId: crypto.randomUUID(), ...payload }),
  });
  if (response.ok) return;
  const detail = await response.json().catch(() => undefined) as { message?: string } | undefined;
  throw new Error(detail?.message ?? `Kommando fehlgeschlagen (${response.status})`);
};

export const enqueueActorInput = (runId: string, actorId: string, content: string, artifactIds: string[] = []) =>
  runCommand(runId, `/actors/${encodeURIComponent(actorId)}/inputs`, { content, artifactIds });

export const sendActorMessage = async (runId: string, actorId: string, text: string, attachments?: ChatAttachmentInput[]) => {
  const response = await fetch(`/chat/${encodeURIComponent(runId)}/actors/${encodeURIComponent(actorId)}/send`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text, attachments }),
  });
  if (!response.ok) throw await errorFrom(response, `Nachricht abgelehnt (${response.status})`);
};

export const resolveAction = (
  runId: string,
  actionId: string,
  decision: "approved" | "dismissed",
  response?: string,
) => runCommand(runId, `/actions/${encodeURIComponent(actionId)}/resolve`, { decision, response });

export const stopActor = (runId: string, actorId: string, reason: string) =>
  runCommand(runId, `/actors/${encodeURIComponent(actorId)}/stop`, { reason });

export const restartActor = (runId: string, actorId: string) =>
  runCommand(runId, `/actors/${encodeURIComponent(actorId)}/restart`, {});

export const stopRun = (runId: string, reason: string) => runCommand(runId, "/stop-all", { reason });
