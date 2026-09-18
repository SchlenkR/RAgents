import type { WorkspaceToolNaming } from "@aicontainer/ragents";

const workspaceToolTable = {
  manual: { read: [], write: [], execute: [] },
  script: { read: [], write: [], execute: [] },
  agent: { read: ["read"], write: ["edit", "write"], execute: ["bash"] },
} as const;

export const sandboxToolNaming: WorkspaceToolNaming = {
  agentToolNames: (driver) => workspaceToolTable[driver],
};
