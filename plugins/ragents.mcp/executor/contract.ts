export const MCP_OPERATIONS = {
  connect: "mcp.connect",
  call: "mcp.call",
  watch: "mcp.watch",
  close: "mcp.close",
} as const;

export interface McpToolDefinition {
  readonly name: string;
  readonly title?: string;
  readonly description?: string;
  readonly inputSchema: { readonly type: "object"; readonly [key: string]: unknown };
  readonly annotations?: { readonly readOnlyHint?: boolean; readonly [key: string]: unknown };
}

export interface McpServerSnapshot {
  readonly name: string;
  readonly transport: "stdio" | "http" | "sse";
  readonly protocolVersion?: string;
  readonly state: "connecting" | "connected" | "failed" | "closed";
  readonly error?: string;
  readonly instructions?: string;
  readonly tools: readonly McpToolDefinition[];
}

export interface McpSnapshot {
  readonly servers: readonly McpServerSnapshot[];
}
