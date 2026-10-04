import type { AgentCapabilities, ContentBlock, SessionUpdate, ToolCallUpdate } from "@agentclientprotocol/sdk";

export const ACP_OPERATIONS = {
  open: "acp.open",
  prompt: "acp.prompt",
  permission: "acp.permission",
  close: "acp.close",
} as const;

export type AcpProgress =
  | { readonly kind: "update"; readonly update: SessionUpdate }
  | { readonly kind: "permission"; readonly request: string; readonly title: string; readonly toolCall: ToolCallUpdate; readonly options: readonly { label: string; description: string }[] };

export interface AcpOpened {
  readonly sessionId: string;
  readonly capabilities: AgentCapabilities;
}

export interface AcpPrompt {
  readonly actorId: string;
  readonly prompt: readonly ContentBlock[];
}
