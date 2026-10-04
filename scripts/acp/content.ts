import { createHash } from "node:crypto";
import type { ContentBlock, McpServer } from "@agentclientprotocol/sdk";
import { RequestError } from "@agentclientprotocol/sdk";
import { parseChatAttachments, type ChatAttachmentInput } from "quassel/events";
import { parseMcpServers, type McpServers } from "../../plugins/ragents.mcp/config.ts";

export const DISPLAY_TEXT_LIMIT = 16_384;
const PROMPT_TEXT_LIMIT = 65_536;

export const boundedText = (text: string, limit = DISPLAY_TEXT_LIMIT): string =>
  text.length <= limit ? text : `${text.slice(0, limit - 16)}\n[... truncated]`;

export const promptMessage = (blocks: readonly ContentBlock[]): { text: string; attachments: ChatAttachmentInput[] } => {
  const attachments: ChatAttachmentInput[] = [];
  const parts = blocks.map((block, index) => {
    if (block.type === "text") return block.text;
    if (block.type === "resource_link") return `${block.title ?? block.name}: ${block.uri}${block.description ? `\n${boundedText(block.description)}` : ""}`;
    if (block.type === "image") {
      attachments.push({ name: `image-${index + 1}`, mediaType: block.mimeType, data: block.data });
      return "";
    }
    if (block.type === "resource") {
      const resource = block.resource;
      if ("text" in resource) {
        const text = boundedText(resource.text);
        const ticks = Math.max(3, ...Array.from(text.matchAll(/`+/g), (match) => match[0].length + 1));
        const fence = "`".repeat(ticks);
        return `Resource ${JSON.stringify(resource.uri)}:\n${fence}\n${text}\n${fence}`;
      }
      if (!resource.mimeType) throw RequestError.invalidParams(undefined, "An embedded binary resource needs a MIME type.");
      attachments.push({ name: `resource-${index + 1}`, mediaType: resource.mimeType, data: resource.blob });
      return `Resource: ${resource.uri}`;
    }
    throw RequestError.invalidParams(undefined, `Unsupported prompt content: ${block.type}.`);
  });
  const text = parts.filter(Boolean).join("\n\n");
  if (text.length > PROMPT_TEXT_LIMIT) throw RequestError.invalidParams(undefined, `Prompt text exceeds ${PROMPT_TEXT_LIMIT} characters.`);
  if (!text.trim() && attachments.length === 0) throw RequestError.invalidParams(undefined, "The prompt needs text or an attachment.");
  try { return { text, attachments: parseChatAttachments(attachments) }; }
  catch (cause) { throw RequestError.invalidParams(undefined, cause instanceof Error ? cause.message : String(cause)); }
};

const serverName = (name: string): string => /^[A-Za-z0-9_-]{1,40}$/.test(name) ? name
  : `${name.replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 27) || "server"}_${createHash("sha256").update(name).digest("hex").slice(0, 12)}`;

const namedValues = (entries: readonly { name: string; value: string }[]): Record<string, string> => {
  if (new Set(entries.map(({ name }) => name)).size !== entries.length) throw RequestError.invalidParams(undefined, "MCP environment or headers contain duplicate names.");
  return Object.fromEntries(entries.map(({ name, value }) => [name, value]));
};

export const sessionMcpServers = (entries: readonly McpServer[]): McpServers => {
  const names = entries.map(({ name }) => serverName(name));
  if (new Set(names).size !== names.length) throw RequestError.invalidParams(undefined, "MCP server names must be unique.");
  const definitions = Object.fromEntries(entries.map((server, index) => {
    if (!("type" in server)) {
      return [names[index], { type: "stdio", command: server.command, args: [...server.args], env: namedValues(server.env) }];
    }
    if (server.type !== "http" && server.type !== "sse") throw RequestError.invalidParams(undefined, `Unsupported MCP transport: ${server.type}.`);
    return [names[index], { type: server.type, url: server.url, headers: namedValues(server.headers) }];
  }));
  try { return parseMcpServers(definitions); }
  catch (cause) { throw RequestError.invalidParams(undefined, cause instanceof Error ? cause.message : String(cause)); }
};
