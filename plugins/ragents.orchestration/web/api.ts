import { coreContracts } from "@aicontainer/server/api/contracts";
import { runContracts } from "@aicontainer/ragents/src/http/contracts";
import type { ChatAttachmentInput } from "@aicontainer/web/chat/types";
import { rpc } from "@aicontainer/web/rpc";

export const enqueueActorInput = async (runId: string, actorId: string, content: string, artifactIds: string[] = []) => {
  await rpc.call(runContracts.enqueueInput, { runId, commandId: crypto.randomUUID(), actorId, content, artifactIds });
};

export const sendActorMessage = async (runId: string, actorId: string, text: string, attachments?: ChatAttachmentInput[]) => {
  await rpc.call(coreContracts.chat.sendToActor, { runId, actorId, text, attachments });
};

export const resolveAction = async (
  runId: string,
  actionId: string,
  decision: "approved" | "dismissed",
  response?: string,
) => {
  await rpc.call(runContracts.resolveAction, { runId, commandId: crypto.randomUUID(), actionId, decision, response });
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
