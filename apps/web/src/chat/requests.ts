import { coreContracts } from "@aicontainer/server/api/contracts";
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

export async function startChatEntry(runId: string, entry: string, input: unknown, client: RpcClient = rpc): Promise<void> {
  await client.call(coreContracts.chat.start, { runId, entry, input });
}

export async function stopChat(runId: string, client: RpcClient = rpc): Promise<void> {
  await client.call(coreContracts.chat.stop, { runId });
}
