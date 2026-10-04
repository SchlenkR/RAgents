import { useEffect, useState } from "react";
import { Plug } from "lucide-react";
import type { Static } from "typebox";
import type { WebPlugin, WorkspaceTabContext } from "@ragents/web/PluginRegistry";
import { rpc } from "@ragents/web/rpc";
import { MCP_PLUGIN_ID, mcpContracts } from "../contract";

function McpServersPanel({ active, session }: WorkspaceTabContext) {
  const runId = session.session.id;
  const [status, setStatus] = useState<Static<typeof mcpContracts.status.message> & { runId?: string; error?: string }>({ servers: [] });
  const current = status.runId === runId ? status : undefined;
  useEffect(() => {
    if (!active) return;
    return rpc.subscribe(mcpContracts.status, { runId }, (value) => setStatus({ ...value, runId }),
      (error) => setStatus((previous) => ({ servers: previous.runId === runId ? previous.servers : [], runId, error })));
  }, [active, runId]);
  return <section className="flex h-full flex-col gap-3 overflow-auto p-4" aria-label="MCP servers">
    {current?.error && <p role="alert" className="text-sm text-destructive">{current.error}</p>}
    {!current && <p className="text-sm text-muted-foreground">Loading MCP server status...</p>}
    {current?.servers.length === 0 && <p className="text-sm text-muted-foreground">No MCP servers configured for this run.</p>}
    {current?.servers.map((server) => <div key={server.name} className="border-b border-border pb-3">
      <div className="flex items-center justify-between gap-2"><strong className="text-sm">{server.name}</strong><span className="text-xs text-muted-foreground">{server.state}</span></div>
      <p className="mt-1 text-xs text-muted-foreground">{server.transport} {server.protocolVersion ?? ""} - {server.toolCount} tools</p>
      {server.error && <p className="mt-2 break-words text-sm text-destructive">{server.error}</p>}
    </div>)}
  </section>;
}

export const webPlugin: WebPlugin = {
  id: MCP_PLUGIN_ID,
  workspaceTabs: [{ id: "ragents.mcp.servers", label: "MCP servers", order: 125, readRight: "ragents.mcp.read", requiresWorkspace: true, Icon: Plug, Panel: McpServersPanel }],
};
