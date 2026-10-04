import type { RAgentsPlugin } from "@ragents/engine";
import type { PluginModule } from "@ragents/host/plugin-support/plugin-module.js";
import { sandboxServicesToken } from "@ragents/host/plugin-support/workspace-sandbox-host.js";
import { runtimeProviderToken } from "@ragents/host/ragents/host-services.js";
import { askServiceToken } from "@ragents/plugins/ragents.ask/server/contract.js";
import { mcpRunServersToken } from "@ragents/plugins/ragents.mcp/server/service.js";
import { parseAcpAgents } from "../config.js";
import { AcpDriver, ACP_STATE_ID } from "./driver.js";

export const acpConfigDescriptors = [{ key: "ACP_AGENTS", source: "profile" }] as const;

const acpPlugin: RAgentsPlugin = {
  manifest: { id: "ragents.acp" },
  register: (host) => {
    host.config(...acpConfigDescriptors);
    host.accessProjections({ id: ACP_STATE_ID, private: true, state: () => undefined, chatEvent: () => undefined });
    const configured = process.env.ACP_AGENTS;
    const agents = parseAcpAgents(configured === undefined ? undefined : (() => {
      try { return JSON.parse(configured); }
      catch { throw new Error("ACP_AGENTS must contain a JSON map of agent server definitions"); }
    })());
    if (Object.keys(agents).length === 0) return;
    const runtimes = new Map(Object.entries(agents).map(([name, definition]) => [`acp.${name}`, definition]));
    const sandbox = host.service(sandboxServicesToken);
    const driver = new AcpDriver({ runtime: host.service(runtimeProviderToken), execute: (runId, operation, input, options) => sandbox.execute(runId, operation, input, options),
      ask: host.service(askServiceToken), mcp: host.service(mcpRunServersToken), agents: runtimes });
    host.actorRuntimes(...[...runtimes].map(([id, definition]) => ({ id, title: definition.title ?? id, driver })));
    host.lifecycle({ id: "ragents.acp.connections", stopSession: ({ runId }) => driver.haltRun(runId), afterStopSession: ({ runId }) => driver.haltRun(runId), deleteSession: ({ runId }) => driver.disposeRun(runId) });
  },
};

export const plugin: PluginModule = { requires: ["ragents.workspace", "ragents.ask", "ragents.mcp"], create: () => acpPlugin };
