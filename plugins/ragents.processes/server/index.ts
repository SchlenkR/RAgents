import type { RAgentsPlugin } from "@aicontainer/ragents";
import { eventHubToken, sessionGuardToken } from "@aicontainer/server/ragents/host-services.js";
import type { PluginModule } from "@aicontainer/server/plugin-support/plugin-module.js";
import { PROCESSES_PLUGIN_ID } from "../contract.js";
import { RunProcessObserver } from "./observer.js";
import { processTableForPlatform } from "./process-table.js";
import { createProcessChannel, createProcessRoutes, processesApiPrefix } from "./routes.js";
import { RunProcessTerminator } from "./terminator.js";

const POLL_INTERVAL_MS = 2_000;

const processesPlugin: RAgentsPlugin = {
  manifest: { id: PROCESSES_PLUGIN_ID },
  register: (host) => {
    const table = processTableForPlatform();
    const observer = new RunProcessObserver({
      table,
      serverPid: process.pid,
      serverUid: process.getuid?.(),
      pollIntervalMs: POLL_INTERVAL_MS,
    });
    const terminator = new RunProcessTerminator({ table, serverPid: process.pid, serverUid: process.getuid?.() });
    host.clientConfig({ routePrefix: processesApiPrefix });
    const ensureSession = host.service(sessionGuardToken);
    host.http(...createProcessRoutes({ observer, ensureSession, terminate: (runId, processId, context) => terminator.stop(runId, processId, context) }));
    host.service(eventHubToken).channels(createProcessChannel({ observer, ensureSession }));
    host.lifecycle({
      id: "ragents.processes.lifecycle",
      stopSession: ({ runId, signal }) => terminator.stopRun(runId, { signal }),
      afterStopSession: ({ runId, signal }) => terminator.stopRun(runId, { signal }),
      deleteSession: ({ runId }) => terminator.stopRun(runId),
      shutdown: () => observer.shutdown(),
    });
  },
};

export const plugin: PluginModule = { create: () => processesPlugin };
