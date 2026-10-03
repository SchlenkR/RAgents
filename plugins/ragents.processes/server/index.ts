import type { RAgentsPlugin } from "@ragents/engine";
import { workspaceGuardToken } from "@ragents/host/ragents/host-services.js";
import { workspaceRuntimeToken } from "@ragents/host/ragents/workspace-runtime.js";
import type { PluginModule } from "@ragents/host/plugin-support/plugin-module.js";
import { sandboxServicesToken } from "@ragents/host/plugin-support/workspace-sandbox-host.js";
import { PROCESSES_PLUGIN_ID } from "../contract.js";
import { RunProcessObserver } from "./observer.js";
import { createProcessChannel, createProcessMethods } from "./methods.js";
import { runProcessesOf } from "./run-processes.js";
import { TunnelStreams } from "./tunnel-streams.js";

const POLL_INTERVAL_MS = 2_000;

const processesPlugin: RAgentsPlugin = {
  manifest: { id: PROCESSES_PLUGIN_ID },
  register: (host) => {
    const workspace = host.service(workspaceRuntimeToken);
    const processes = runProcessesOf(host.service(sandboxServicesToken), (runId) => workspace.placementOf(runId));
    const observer = new RunProcessObserver({ snapshot: processes.snapshot, pollIntervalMs: POLL_INTERVAL_MS });
    const ensureWorkspaceAccess = host.service(workspaceGuardToken);
    const streams = new TunnelStreams({ dial: (runId, port, path, signal) => processes.dial(runId, port, path, signal) });
    host.methods(...createProcessMethods({
      observer,
      ensureWorkspaceAccess,
      terminate: processes.terminate,
      checkPort: (runId, port, signal) => processes.dial(runId, port, null, signal),
      openStream: (runId, port, signal) => streams.open(runId, port, signal),
    }));
    host.channels(createProcessChannel({ observer, ensureWorkspaceAccess }));
    host.http(streams.route());
    host.lifecycle({
      id: "ragents.processes.lifecycle",
      stopSession: ({ runId, signal }) => {
        streams.closeRun(runId, "The run stopped");
        return processes.stopAll(runId, signal);
      },
      afterStopSession: ({ runId, signal }) => processes.stopAll(runId, signal),
      deleteSession: ({ runId }) => {
        streams.closeRun(runId, "The run was deleted");
        return processes.stopAll(runId);
      },
      shutdown: async () => {
        await Promise.all([observer.shutdown(), streams.shutdown()]);
      },
    });
  },
};

export const plugin: PluginModule = { create: () => processesPlugin };
