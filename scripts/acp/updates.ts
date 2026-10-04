import path from "node:path";
import type { SessionUpdate, ToolCallContent, ToolKind } from "@agentclientprotocol/sdk";
import type { ChatEvent } from "quassel/events";
import { ASK_PLUGIN_ID, askPayloadOf } from "../../plugins/ragents.ask/ask-payload.ts";
import { TODO_PLUGIN_ID, todoStateOf } from "../../plugins/ragents.todo/contract.ts";
import { boundedText, DISPLAY_TEXT_LIMIT } from "./content.ts";

export const toolKind = (name: string): ToolKind => {
  if (name === "read" || name.endsWith("_read")) return "read";
  if (name === "write" || name === "edit" || name.endsWith("_edit")) return "edit";
  if (/^(bash|typescript_eval|actor_program_.*|script_tool_.*)$/.test(name)) return "execute";
  if (/search|grep|glob|find/.test(name)) return "search";
  if (/fetch|browse|navigate/.test(name)) return "fetch";
  if (name === "todo_write") return "think";
  return "other";
};

const toolInput = (text: string): Record<string, unknown> => {
  try {
    const value: unknown = JSON.parse(text);
    return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
  } catch { return {}; }
};

const filePath = (cwd: string, input: Record<string, unknown>): string | undefined => {
  const file = input.file_path ?? input.path;
  return typeof file === "string" && !file.startsWith("@") ? path.resolve(cwd, file) : undefined;
};

const toolContent = (name: string, input: Record<string, unknown>, file: string | undefined): ToolCallContent[] => {
  if (!file) return [];
  if (name === "edit" && typeof input.old_string === "string" && typeof input.new_string === "string"
    && input.old_string.length <= DISPLAY_TEXT_LIMIT && input.new_string.length <= DISPLAY_TEXT_LIMIT) {
    return [{ type: "diff", path: file, oldText: input.old_string, newText: input.new_string }];
  }
  if (name === "write" && typeof input.content === "string" && input.content.length <= DISPLAY_TEXT_LIMIT) {
    return [{ type: "diff", path: file, newText: input.content }];
  }
  return [];
};

export const questionText = (payload: unknown): string => askPayloadOf(payload).questions.map((question) =>
  `${question.header}: ${question.question}\n${question.options.map((option) => `- ${option.label}${option.description ? `: ${option.description}` : ""}`).join("\n")}`,
).join("\n\n");

export const chatUpdates = (event: ChatEvent, cwd: string, replay = false): SessionUpdate[] => {
  if (event.kind === "text") return [{ sessionUpdate: "agent_message_chunk", content: { type: "text", text: event.delta } }];
  if (event.kind === "thinking") return event.delta ? [{ sessionUpdate: "agent_thought_chunk", content: { type: "text", text: event.delta } }] : [];
  if (event.kind === "user") return replay && event.text ? [{ sessionUpdate: "user_message_chunk", content: { type: "text", text: event.text } }] : [];
  if (event.kind === "system") return [{ sessionUpdate: "agent_message_chunk", content: { type: "text", text: `${event.text}\n\n` } }];
  if (event.kind === "tool") {
    const input = toolInput(event.arguments);
    const file = filePath(cwd, input);
    const locations = file ? [{ path: file, ...typeof input.offset === "number" && input.offset >= 1 ? { line: input.offset } : {} }] : [];
    return [
      { sessionUpdate: "tool_call", toolCallId: event.id, title: event.label ?? event.name, name: event.name, kind: toolKind(event.name), status: "pending", locations },
      { sessionUpdate: "tool_call_update", toolCallId: event.id, status: "in_progress", content: toolContent(event.name, input, file) },
    ];
  }
  if (event.kind === "tool-result") return [{ sessionUpdate: "tool_call_update", toolCallId: event.id,
    status: event.isError ? "failed" : "completed", content: [{ type: "content", content: { type: "text", text: boundedText(event.result) } }] }];
  if (event.kind === "action" && event.owner === ASK_PLUGIN_ID) return [{ sessionUpdate: "agent_message_chunk", content: { type: "text", text: questionText(event.payload) } }];
  if (event.kind === "plugin" && event.pluginId === TODO_PLUGIN_ID && event.type === "state-replaced") {
    const payload = event.payload as { state?: unknown } | undefined;
    const state = todoStateOf(payload?.state);
    return state ? [{ sessionUpdate: "plan", entries: state.todos.map((todo) => ({ content: todo.content, priority: "medium", status: todo.status })) }] : [];
  }
  return [];
};
