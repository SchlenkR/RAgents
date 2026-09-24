import { coreContracts } from "@ragents/host/api/contracts";
import type { ChatAttachmentInput } from "../../../server/src/chat-events";
import type { ChatUserLocation } from "../../../server/src/chat-context";
import type { StartEntry } from "../../../server/src/plugin-support/start-entries-contract";
import { preparedRunInput } from "../../../server/src/run-preparation-input";
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

/** Die erste Nachricht eines Runs über eine Skill-Vorlage; der Server legt damit dessen Startoptionen fest. */
export async function startSkillEntry(runId: string, entry: string, text: string, attachments?: ChatAttachmentInput[], client: RpcClient = rpc): Promise<void> {
  await client.call(coreContracts.chat.send, { runId, text, attachments, entry });
}

export async function startChatEntry(runId: string, entry: string, input: unknown, client: RpcClient = rpc): Promise<void> {
  await client.call(coreContracts.chat.start, { runId, entry, input });
}

/** Eine Vorlage ohne Vorbereitungschat: ein Run-Script mit seinem Startwert, ein Skill mit seinem vorbereiteten Auftrag. */
export const startEntryDirectly = (runId: string, entry: StartEntry, input: unknown, client: RpcClient = rpc): Promise<void> => entry.action === "script"
  ? startChatEntry(runId, entry.id, input, client)
  : startSkillEntry(runId, entry.id, preparedRunInput([], entry.prompt, undefined, entry.skill).text, undefined, client);
