import { coreContracts } from "@ragents/host/api/contracts";
import type { ChatAttachmentInput } from "quassel/events";
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

/** The first message of a run from a skill template; the server uses it to set the run's start options. */
export async function startSkillEntry(runId: string, entry: string, text: string, attachments?: ChatAttachmentInput[], client: RpcClient = rpc): Promise<void> {
  await client.call(coreContracts.chat.send, { runId, text, attachments, entry });
}

export async function startChatEntry(runId: string, entry: string, input: unknown, client: RpcClient = rpc): Promise<void> {
  await client.call(coreContracts.chat.start, { runId, entry, input });
}

/** A template without a preparation chat: a run script with its start value, a skill with its prepared task. */
export const startEntryDirectly = (runId: string, entry: StartEntry, input: unknown, client: RpcClient = rpc): Promise<void> => entry.action === "script"
  ? startChatEntry(runId, entry.id, input, client)
  : startSkillEntry(runId, entry.id, preparedRunInput([], entry.prompt, undefined, entry.skill).text, undefined, client);
