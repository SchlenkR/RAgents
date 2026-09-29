import type { Message } from "quassel/events";

/** The single line of the collapsed sheet: what the chat is doing right now or said last; open actions themselves are in the dock below. */
export interface SheetStatus {
  text: string;
  kind: "idle" | "working" | "waiting";
}

const firstLine = (text: string, limit = 160): string => {
  const line = text.trim().split(/\r?\n/).find((entry) => entry.trim() !== "") ?? "";
  return line.length > limit ? `${line.slice(0, limit - 3)}...` : line;
};

const senderOf = (message: Message, handle: string): string =>
  message.role === "user" ? "You" : message.sender ?? `@${handle}`;

export function sheetStatus(messages: readonly Message[], working: boolean, handle: string): SheetStatus {
  const last = messages[messages.length - 1];
  const waiting = messages.filter((message) => message.role === "action" && message.action?.status === undefined).length;
  if (waiting > 0) return { kind: "waiting", text: waiting === 1 ? "Waiting for input" : `Waiting for ${waiting} inputs` };
  if (working) {
    if (last?.role === "thinking" && !last.closed) return { kind: "working", text: `@${handle} is thinking ...` };
    if (last?.role === "tool" && last.tool && last.tool.result === undefined) return { kind: "working", text: `@${handle} is using ${last.tool.name} ...` };
    if (last?.role === "assistant" && !last.closed && last.text.trim() !== "") return { kind: "working", text: `${senderOf(last, handle)} is answering: ${firstLine(last.text)}` };
    return { kind: "working", text: `@${handle} is working ...` };
  }
  const spoken = [...messages].reverse().find((message) => (message.role === "user" || message.role === "assistant") && message.text.trim() !== "");
  if (!spoken) return { kind: "idle", text: "No messages yet." };
  return { kind: "idle", text: `${senderOf(spoken, handle)}: ${firstLine(spoken.text)}` };
}
