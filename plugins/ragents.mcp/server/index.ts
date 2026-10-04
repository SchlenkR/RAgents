import { DomainError, implement, implementChannel, type RAgentsPlugin } from "@ragents/engine";
import type { PluginModule } from "@ragents/host/plugin-support/plugin-module.js";
import { sandboxServicesToken } from "@ragents/host/plugin-support/workspace-sandbox-host.js";
import { runtimeProviderToken, workspaceGuardToken } from "@ragents/host/ragents/host-services.js";
import { parseMcpServers } from "../config.js";
import { MCP_PLUGIN_ID, mcpContracts } from "../contract.js";
import { RunMcp } from "./runtime.js";
import { mcpRunServersToken } from "./service.js";

export const mcpConfigDescriptors = [{ key: "MCP_SERVERS", source: "profile" }] as const;

const mcpPlugin: RAgentsPlugin = {
  manifest: { id: MCP_PLUGIN_ID },
  register: (host) => {
    host.config(...mcpConfigDescriptors);
    const configured = process.env.MCP_SERVERS;
    const servers = parseMcpServers((() => {
      if (configured === undefined) return undefined;
      try { return JSON.parse(configured); }
      catch { throw new Error("MCP_SERVERS must contain a JSON map of server definitions"); }
    })());
    const sandbox = host.service(sandboxServicesToken);
    const mcp = new RunMcp({ servers, execute: (runId, operation, input, options) => sandbox.execute(runId, operation, input, options),
      fileFor: (runId) => host.storage.session(runId, "servers.json") });
    host.provide(mcpRunServersToken, mcp);
    host.functions({ name: "ragents.mcp.tools", dynamic: true, descriptors: [], tools: ({ runId }) => mcp.tools(runId) });
    host.prompts({ id: "ragents.mcp.servers", order: 760, render: () => "", renderForRun: (runId) => mcp.prompt(runId) });
    host.agentRuntime(mcp.images());
    const ensureWorkspaceAccess = host.service(workspaceGuardToken);
    const runtime = host.service(runtimeProviderToken);
    host.methods(implement(mcpContracts.closeConnections, async ({ runId }, { access }) => {
      ensureWorkspaceAccess(access, runId);
      await mcp.close(runId);
      return null;
    }));
    host.methods(implement(mcpContracts.setServers, async ({ runId, servers }, { access }) => {
      ensureWorkspaceAccess(access, runId);
      const busy = (() => {
        try {
          const view = runtime().view(runId);
          return view.actors.some((actor) => actor.kind !== "human" && actor.lifecycle.kind === "running")
            || view.inputs.some((input) => input.lifecycle.kind === "pending");
        }
        catch (cause) { if (cause instanceof DomainError && cause.code === "run-not-found") return false; throw cause; }
      })();
      if (busy) {
        throw new DomainError("mcp-run-busy", "MCP servers can only be replaced while the run is idle.", 409);
      }
      await mcp.replaceRunServers(runId, servers);
      return null;
    }));
    host.channels(implementChannel(mcpContracts.status, async ({ runId }, emit, { access }) => {
      ensureWorkspaceAccess(access, runId);
      await mcp.restore(runId);
      return mcp.subscribe(runId, (snapshot) => emit({ servers: snapshot.servers.map(({ tools, instructions: _instructions, ...status }) => ({ ...status, toolCount: tools.length })) }));
    }));
    host.lifecycle({
      id: "ragents.mcp.lifecycle",
      prepareSession: ({ runId }) => mcp.restore(runId),
      stopSession: ({ runId }) => mcp.close(runId),
      afterStopSession: ({ runId }) => mcp.close(runId),
      deleteSession: ({ runId }) => mcp.delete(runId),
      shutdown: () => mcp.shutdown(),
    });
  },
};

export const plugin: PluginModule = { requires: ["ragents.workspace"], create: () => mcpPlugin };
