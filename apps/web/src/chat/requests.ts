import { coreContracts } from "@ragents/host/api/contracts";
import type { ChatAttachmentInput } from "quassel/events";
import type { ChatUserLocation } from "../../../server/src/chat-context";
import type { ScriptParameters } from "../../../server/src/plugin-support/actor-programs/script-parameters";
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

export async function startChatEntry(runId: string, entry: string, parameters: Readonly<Record<string, unknown>>, client: RpcClient = rpc): Promise<void> {
  await client.call(coreContracts.chat.start, { runId, entry, parameters });
}

/** The parameters a script template declares; the host reads them from the script's setup contract. */
export async function scriptParameters(runId: string, entry: string, client: RpcClient = rpc): Promise<ScriptParameters> {
  return client.call(coreContracts.runs.scriptParameters, { runId, entry });
}

/** A template without a preparation chat: a run script with its parameters, a skill with its prepared task. */
export const startEntryDirectly = (runId: string, entry: StartEntry, parameters: Readonly<Record<string, unknown>>, client: RpcClient = rpc): Promise<void> => entry.action === "script"
  ? startChatEntry(runId, entry.id, parameters, client)
  : startSkillEntry(runId, entry.id, preparedRunInput([], entry.prompt, undefined, entry.skill).text, undefined, client);
