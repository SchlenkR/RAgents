import type { Message } from "@ragents/web/chat/types";

/** Die eine Zeile des zugeschobenen Sheets: was der Chat gerade tut oder zuletzt gesagt hat. */
export interface SheetStatus {
  text: string;
  kind: "idle" | "working" | "waiting";
}

const firstLine = (text: string, limit = 160): string => {
  const line = text.trim().split(/\r?\n/).find((entry) => entry.trim() !== "") ?? "";
  return line.length > limit ? `${line.slice(0, limit - 1)}…` : line;
};

const senderOf = (message: Message, handle: string): string =>
  message.role === "user" ? "Du" : message.sender ?? `@${handle}`;

export function sheetStatus(messages: readonly Message[], working: boolean, handle: string): SheetStatus {
  const last = messages[messages.length - 1];
  const waiting = [...messages].reverse().find((message) => message.role === "action" && message.action?.status === undefined);
  if (waiting) return { kind: "waiting", text: `Wartet auf Eingabe: ${firstLine(waiting.text) || "Antwort erwartet"}` };
  if (working) {
    if (last?.role === "thinking" && !last.closed) return { kind: "working", text: `@${handle} denkt ...` };
    if (last?.role === "tool" && last.tool && last.tool.result === undefined) return { kind: "working", text: `@${handle} nutzt ${last.tool.name} ...` };
    if (last?.role === "assistant" && !last.closed && last.text.trim() !== "") return { kind: "working", text: `${senderOf(last, handle)} antwortet: ${firstLine(last.text)}` };
    return { kind: "working", text: `@${handle} arbeitet ...` };
  }
  const spoken = [...messages].reverse().find((message) => (message.role === "user" || message.role === "assistant") && message.text.trim() !== "");
  if (!spoken) return { kind: "idle", text: "Noch keine Nachrichten." };
  return { kind: "idle", text: `${senderOf(spoken, handle)}: ${firstLine(spoken.text)}` };
}
