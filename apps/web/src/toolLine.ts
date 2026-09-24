import type { Message, ToolInfo } from "./chat/types";

const SUMMARY_LIMIT = 140;

const SUMMARY_KEYS = [
  "path",
  "file_path",
  "filePath",
  "command",
  "cmd",
  "pattern",
  "query",
  "url",
  "handle",
  "title",
  "name",
  "body",
  "text",
  "message",
  "prompt",
];

const oneLine = (value: string) => {
  const line = value.replace(/\s+/g, " ").trim();
  return line.length > SUMMARY_LIMIT ? `${line.slice(0, SUMMARY_LIMIT)} ...` : line;
};

const preferredValue = (values: Record<string, unknown>) => {
  for (const key of SUMMARY_KEYS) {
    const value = values[key];
    if (typeof value === "string" && value.trim() !== "") return value;
  }
  return undefined;
};

export const toolSummary = (tool: ToolInfo): string => {
  const raw = (tool.arguments ?? "").trim();
  if (raw === "" || raw === "{}") return "";
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return oneLine(raw);
  }
  if (typeof parsed === "string") return oneLine(parsed);
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return oneLine(raw);
  const values = parsed as Record<string, unknown>;
  const preferred = preferredValue(values);
  if (preferred !== undefined) return oneLine(preferred);
  const scalars = Object.entries(values)
    .filter(([, value]) => typeof value !== "object" || value === null)
    .map(([key, value]) => `${key}=${String(value)}`);
  return oneLine(scalars.length > 0 ? scalars.join(" ") : raw);
};

export const toolLine = (tool: ToolInfo, label?: string): string => {
  const name = label !== undefined && label.trim() !== "" ? label : tool.name;
  const summary = toolSummary(tool);
  return summary === "" ? name : `${name} ${summary}`;
};

export const withToolSummaries = (messages: readonly Message[]): Message[] =>
  messages.map((message) =>
    message.tool
      ? { ...message, text: toolLine(message.tool, message.text) }
      : message
  );
