import { createRoot } from "react-dom/client";
import { PluginRegistry, type SessionContext } from "../src/PluginRegistry";
import { StartOptionsProvider } from "../src/StartOptions";
import { SystemPromptBadge } from "../src/product/SystemPromptControl";
import { RunHeader } from "../src/run-panel/RunHeader";
import { RunPanelHeader } from "../src/run-panel/RunPanelHeader";
import { createBrowserHost, RunPanelHostProvider } from "../src/run-panel/host";
import { ActivityHeader } from "../../../plugins/ragents.activity/web/ActivityHeader";
import { processHeader } from "../../../plugins/ragents.processes/web/ProcessHeader";
import { StopRunHeader } from "../../../plugins/ragents.orchestration/web/StopRunButton";
import { WorkspaceBindingBadge, WorkspaceMetadata } from "../../../plugins/ragents.workspace/web/WorkspaceBinding";
import { AccessBadge } from "../../../plugins/ragents.workspace/web/AccessOption";
import { WorkspaceGrants } from "../../../plugins/ragents.workspace/web/WorkspaceGrants";
import { WORKSPACE_ACCESS_OPTION_ID, WORKSPACE_BINDING_OPTION_ID, WORKSPACE_GRANTS_STATE_ID, WORKSPACE_METADATA_ID } from "../../../plugins/ragents.workspace/contract";
import type { RunProcessMessage } from "../../../plugins/ragents.processes/contract";
import type { StartOptionState } from "../../../apps/server/src/plugin-support/start-options-contract";
import { initializeTheme } from "../src/theme";
import { initializeAppearance } from "../src/appearance";
import "../src/ui/tailwind.css";

export const branch = "feature/improve-example-project-document-search-with-complete-accessible-results-and-readable-details";
export const actorName = "Document indexing and verification worker";
export const processNames = ["Document search development server", "TypeScript incremental project compiler", "Background image preview generator", "Workspace documentation index watcher", "Project integration test worker"];
export const stopError = "The run could not stop because the workstation is disconnected. Reconnect the workstation and try again. " + "diagnostic-".repeat(18);
const startedAt = new Date(Date.now() - 125_000).toISOString();
const binding = { machine: "server" as const, folder: { path: "/home/user/project/worktrees/example-run" } };
const options: readonly StartOptionState[] = [
  { id: WORKSPACE_BINDING_OPTION_ID, owner: "ragents.workspace", value: binding, presentation: { kind: "workspace-binding", clients: [], fresh: { server: "New folder", client: "New folder" }, serverFolders: true }, selectable: true, locked: true, chosen: true },
  { id: WORKSPACE_ACCESS_OPTION_ID, owner: "ragents.workspace", value: "isolated", presentation: { kind: "workspace-access", machine: "server", commandIsolation: "isolated", fullAccessDisabledReason: null }, selectable: true, locked: false, chosen: true },
  { id: "ragents.system-prompt", owner: "host", value: { promptIds: ["careful"], shareWithAgents: true }, presentation: { kind: "system-prompt", options: [{ id: "careful", label: "Check project conventions", text: "Read the project conventions before changing files." }] }, selectable: true, locked: true, chosen: true },
];
const processMessage: RunProcessMessage = { kind: "snapshot", snapshot: { runId: "example-run", observedAt: startedAt, machine: "server", processes: processNames.map((label, index) => ({
  id: `${index + 100}-${"a".repeat(64)}`, pid: index + 100, label, command: `node /home/user/project/tools/worker-${index + 1}.js`, origin: "background", seenSince: startedAt,
  ports: index === 0 ? [{ address: "127.0.0.1", port: 5300 }] : [],
})) } };
const callbacks = new Set<(message: RunProcessMessage) => void>();
const calls: { method: string; input: unknown }[] = [];
let stopFailure: string | undefined;

declare global {
  interface Window {
    runDetailsFixture: {
      branch: string;
      actorName: string;
      processNames: readonly string[];
      stopError: string;
      calls: readonly { method: string; input: unknown }[];
      call: (method: string, input: unknown) => Promise<unknown>;
      subscribe: (method: string, listener: (message: RunProcessMessage) => void) => () => void;
      setStopError: (error: string | undefined) => void;
      monitoringError: (error: string) => void;
    };
  }
}
window.runDetailsFixture = {
  branch,
  actorName,
  processNames,
  stopError,
  calls,
  call: async (method, input) => {
    calls.push({ method, input });
    if (method === "ragents.startOptions.list") return options;
    if (method === "ragents.runs.stop") {
      if (stopFailure) throw new Error(stopFailure);
      return null;
    }
    if (method === "ragents.processes.stop") return null;
    throw new Error(`Unexpected fixture call: ${method}`);
  },
  subscribe: (method, listener) => {
    if (method !== "ragents.processes") throw new Error(`Unexpected fixture channel: ${method}`);
    callbacks.add(listener);
    queueMicrotask(() => { if (callbacks.has(listener)) listener(processMessage); });
    return () => { callbacks.delete(listener); };
  },
  setStopError: (error) => { stopFailure = error; },
  monitoringError: (error) => { for (const listener of callbacks) listener({ kind: "error", error }); },
};

const withBadge = new URLSearchParams(location.search).has("badge");
const withoutBranch = new URLSearchParams(location.search).has("no-branch");
const registry = new PluginRegistry({ brand: { title: "Example" }, product: { id: "example", title: "Example" }, startEntries: [], plugins: [
  { id: "example.metadata", sessionMetadata: withBadge ? [] : [{ id: WORKSPACE_BINDING_OPTION_ID, order: 0, Metadata: WorkspaceMetadata }] },
  { id: "example.details", sessionHeaders: [
    { id: WORKSPACE_GRANTS_STATE_ID, order: 95, Header: WorkspaceGrants },
    { id: "example.activity", order: 100, Header: ActivityHeader },
    { id: "example.processes", order: 110, Header: processHeader() },
    { id: "example.stop", placement: "actions", order: 900, Header: StopRunHeader },
    { id: "example.absent", order: -200, Header: () => null },
    { id: "example.branch", placement: "details", order: -100, label: "Branch", explanation: "Runs in its own copy of the project on this branch.", Header: () => withoutBranch ? null : <span>{branch}</span> },
  ], startOptions: [
    { id: WORKSPACE_BINDING_OPTION_ID, Badge: WorkspaceBindingBadge },
    { id: WORKSPACE_ACCESS_OPTION_ID, Badge: AccessBadge },
    { id: "ragents.system-prompt", Badge: SystemPromptBadge },
  ] },
] });
const session: SessionContext = {
  connected: true, pluginEvents: [], messages: [], running: true, send: async () => {}, start: async () => {},
  session: { id: "example-run", title: "Improve document search", updatedAt: 0, metadata: withBadge ? {} : { [WORKSPACE_METADATA_ID]: { binding, summary: "Project copy on branch feature/example" } } },
  runView: {
    id: "example-run", ownerId: "owner", primaryActorId: "coordinator", inputs: [], subscriptions: [], actions: [], artifacts: [],
    pluginStates: [{ pluginId: WORKSPACE_GRANTS_STATE_ID, scope: { kind: "run" }, state: [
      { path: "/home/user/reference/project-documentation/complete-technical-reference-with-readable-paths-and-examples.md", access: "read" },
      { path: "/home/user/exports/search-results", access: "write" },
    ] }],
    actors: [{ id: "worker", displayName: actorName }], turns: [{ id: "worker-turn", actorId: "worker", status: "running", startedAt, toolCalls: [] }],
  },
};
const navigation = { activeTabId: "chat", openTab: () => {}, revealEntity: () => false, selectionFor: () => undefined };
initializeTheme(window);
initializeAppearance(window);
createRoot(document.getElementById("root")!).render(<RunPanelHostProvider value={createBrowserHost(window)}>
  <StartOptionsProvider connected messageCount={1} sessionId={session.session.id}>
    <RunHeader leading={<RunPanelHeader attention={undefined} contributions={registry.sessionHeaders} navigation={navigation} registry={registry} runError={undefined} session={session} working />}>
      <p className="p-4">Project workspace</p>
    </RunHeader>
  </StartOptionsProvider>
</RunPanelHostProvider>);
