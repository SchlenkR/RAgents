import { coreContracts } from "@ragents/host/api/contracts";
import type { ChatAttachmentInput } from "../../../server/src/chat-events";
import type { ChatUserLocation } from "../../../server/src/chat-context";
import { rpc } from "../rpc";
import type { RpcClient } from "../rpc/client";

export async function sendChatMessage(
  runId: string,
  text: string,
  attachments?: ChatAttachmentInput[],
  userLocation?: ChatUserLocation,
  client: RpcClient = rpc,
): Promise<void> {
  await client.call(coreContracts.chat.send, { runId, text, attachments, userLocation });
}

/** Die erste Nachricht eines Runs über einen Skill-Einstieg; der Server legt damit dessen Startoptionen fest. */
export async function startSkillEntry(runId: string, entry: string, text: string, attachments?: ChatAttachmentInput[], client: RpcClient = rpc): Promise<void> {
  await client.call(coreContracts.chat.send, { runId, text, attachments, entry });
}

export async function startChatEntry(runId: string, entry: string, input: unknown, client: RpcClient = rpc): Promise<void> {
  await client.call(coreContracts.chat.start, { runId, entry, input });
}

export async function stopChat(runId: string, client: RpcClient = rpc): Promise<void> {
  await client.call(coreContracts.chat.stop, { runId });
}
