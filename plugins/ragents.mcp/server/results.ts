import type { CallToolResult } from "@modelcontextprotocol/client";

export const MCP_OUTPUT_LIMIT = 8000;
const LINE_LIMIT = 1000;

export const boundedMcpText = (value: string, limit = MCP_OUTPUT_LIMIT): string => {
  const lines = value.split("\n");
  const shortened = lines.map((line) => line.length > LINE_LIMIT ? `${line.slice(0, LINE_LIMIT)} [line truncated]` : line).join("\n");
  const truncated = shortened.length > limit || shortened !== value;
  return truncated ? `${shortened.slice(0, Math.max(0, limit - 110))}\n[Output truncated. Use the tool's filters or pagination to request a smaller result.]` : shortened;
};

export interface McpMappedResult {
  readonly text: string;
  readonly images: readonly { readonly type: "image"; readonly data: string; readonly mimeType: string }[];
}

export const mapMcpResult = (result: CallToolResult): McpMappedResult => {
  const text = result.content.filter((part) => part.type === "text").map((part) => part.text).join("\n");
  const other = result.content.flatMap((part) => {
    switch (part.type) {
      case "text": return [];
      case "image": return [`Image: ${part.mimeType}`];
      case "audio": return [`Audio: ${part.mimeType}`];
      case "resource_link": return [`Resource: ${part.uri}${part.mimeType ? ` (${part.mimeType})` : ""}`];
      case "resource": return [`Resource: ${part.resource.uri}${part.resource.mimeType ? ` (${part.resource.mimeType})` : ""}${"text" in part.resource ? `\n${part.resource.text}` : ""}`];
      default: return ["Unsupported MCP result content"];
    }
  });
  const body = [text || (result.structuredContent ? JSON.stringify(result.structuredContent) : ""), ...other].filter(Boolean).join("\n") || "Tool completed.";
  if (result.isError) throw new Error(boundedMcpText(body));
  return {
    text: boundedMcpText(body),
    images: result.content.filter((part) => part.type === "image").map((part) => ({ type: "image" as const, data: part.data, mimeType: part.mimeType })),
  };
};
