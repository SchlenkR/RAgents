import type { AgentDriverKind } from "../domain/driver.ts";

export interface WorkspaceToolNames {
    read: readonly string[];
    write: readonly string[];
    execute: readonly string[];
}

export interface WorkspaceToolNaming {
    agentToolNames: (driver: AgentDriverKind) => WorkspaceToolNames;
}
