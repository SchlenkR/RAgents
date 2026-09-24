import type { ChatAttachmentInput } from "./chat-events.js";

export interface RunPreparationMessage {
  role: "user" | "assistant";
  text: string;
  attachments?: ChatAttachmentInput[];
}

export interface RunPreparationRequest {
  messages: RunPreparationMessage[];
  skillName?: string;
}

export type RunPreparationResponse =
  | { kind: "reply"; text: string }
  | { kind: "start"; input: { text: string; attachments?: ChatAttachmentInput[] } };

export const MAX_RUN_PREPARATION_MESSAGES = 40;
export const MAX_RUN_PREPARATION_TEXT_CHARS = 32_000;
export const MAX_RUN_PREPARATION_TOTAL_TEXT_CHARS = 100_000;
