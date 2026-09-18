import type { Message } from "../../../server/src/chat-events";

export type { Role, ToolInfo, Question, Message, ChatEvent, ChatTextCursor, ChatJournalCursor, ChatAttachment, ChatAttachmentInput } from "../../../server/src/chat-events";
export { applyEvent, prettyJson, compactToolLine } from "../../../server/src/chat-events";

/**
 * current = nur der laufende Schritt, off = nur Antworten, icons = Schritte als reine Symbole nebeneinander,
 * chips = Schritte als Symbol + Kurztext nebeneinander (mit Umbruch),
 * grouped = aufeinanderfolgende Schritte als eine aufklappbare Zeile, dahinter einzeilig,
 * compact = Denken und Werkzeuge einzeilig, full = alles ausgeklappt.
 */
export type DetailMode = "off" | "current" | "icons" | "chips" | "grouped" | "compact" | "full";

/** running = call still open, thinking = thought block still open, done = finished, error = failed. */
export type StepState = "running" | "thinking" | "done" | "error";

/** The single derivation of a step state, so chips, hosts and tests read the same signal. */
export function stepState(message: Message): StepState {
  if (message.tool?.isError) {
    return "error";
  }
  if (message.role === "thinking") {
    return message.closed ? "done" : "thinking";
  }
  return message.tool !== undefined && message.tool.result === undefined ? "running" : "done";
}
