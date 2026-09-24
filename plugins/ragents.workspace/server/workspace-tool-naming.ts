import type { WorkspaceToolNaming } from "@ragents/engine";

const workspaceToolTable = {
  manual: { read: [], write: [], execute: [] },
  script: { read: [], write: [], execute: [] },
  agent: { read: ["read"], write: ["edit", "write"], execute: ["bash"] },
} as const;

export const sandboxToolNaming: WorkspaceToolNaming = {
  agentToolNames: (driver) => workspaceToolTable[driver],
};

export const agentWorkspaceToolNames: readonly string[] = [
  ...workspaceToolTable.agent.read,
  ...workspaceToolTable.agent.write,
  ...workspaceToolTable.agent.execute,
];
