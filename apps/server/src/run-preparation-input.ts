import type { ChatAttachmentInput } from "quassel/events";
import type { RunPreparationMessage } from "./run-preparation-contract.js";

export function preparedRunInput(history: readonly RunPreparationMessage[], text: string, attachments?: ChatAttachmentInput[], skillName?: string) {
  const current = text.trim();
  const messages = [...history, ...(current || attachments?.length ? [{ role: "user" as const, text: current, attachments }] : [])];
  const files = messages.flatMap((message) => message.role === "user" ? message.attachments ?? [] : []);
  if (!messages.length) throw new Error("The task is empty.");
  const prepared = history.length === 0 ? current : "Carry out the task worked out in the following preparation conversation now. "
      + "The user's latest statements apply. Assistant responses are suggestions, not work already done.\n\n"
      + messages.map((message) => `${message.role === "user" ? "User" : "Assistant"}:\n${message.text}`).join("\n\n");
  return {
    text: skillName ? `Use the skill ${skillName} for this task.\n\n${prepared}` : prepared,
    attachments: files.length ? files : undefined,
  };
}
