import type { RAgentsPlugin } from "@ragents/engine";
import { workspaceGuardToken } from "@ragents/host/ragents/host-services.js";
import type { PluginModule } from "@ragents/host/plugin-support/plugin-module.js";
import { sandboxServicesToken } from "@ragents/host/plugin-support/workspace-sandbox-host.js";
import { PROCESSES_PLUGIN_ID } from "../contract.js";
import { RunProcessObserver } from "./observer.js";
import { createProcessChannel, createProcessMethods } from "./methods.js";
import { runProcessesOf } from "./run-processes.js";

const POLL_INTERVAL_MS = 2_000;

const processesPlugin: RAgentsPlugin = {
  manifest: { id: PROCESSES_PLUGIN_ID },
  register: (host) => {
    const processes = runProcessesOf(host.service(sandboxServicesToken));
    const observer = new RunProcessObserver({ snapshot: processes.snapshot, pollIntervalMs: POLL_INTERVAL_MS });
    const ensureWorkspaceAccess = host.service(workspaceGuardToken);
    host.methods(...createProcessMethods({ observer, ensureWorkspaceAccess, terminate: processes.terminate }));
    host.channels(createProcessChannel({ observer, ensureWorkspaceAccess }));
    host.lifecycle({
      id: "ragents.processes.lifecycle",
      stopSession: ({ runId, signal }) => processes.stopAll(runId, signal),
      afterStopSession: ({ runId, signal }) => processes.stopAll(runId, signal),
      deleteSession: ({ runId }) => processes.stopAll(runId),
      shutdown: () => observer.shutdown(),
    });
  },
};

export const plugin: PluginModule = { create: () => processesPlugin };
