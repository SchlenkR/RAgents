import { serviceToken } from "@ragents/engine";
import type { McpServers } from "../config.js";

export type { McpServerDefinition, McpServers } from "../config.js";

export interface McpRunServers {
  readonly serversFor: (runId: string) => Promise<McpServers>;
  readonly setRunServers: (runId: string, servers: McpServers) => Promise<void>;
  readonly replaceRunServers: (runId: string, servers: McpServers) => Promise<void>;
}

export const mcpRunServersToken = serviceToken<McpRunServers>("ragents.mcp.run-servers");
