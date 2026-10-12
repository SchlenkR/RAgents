import { createRoot } from "react-dom/client";
import { createAccessContext } from "../../../packages/ragents/src/access";
import { webPlugin } from "../../../plugins/ragents.orchestration/web/index";
import { AGENTS_TAB_ID } from "../../../plugins/ragents.orchestration/web/run-panel/AgentsPanel";
import { OrchestrationRunPanel } from "../../../plugins/ragents.orchestration/web/run-panel/RunPanel";
import { ActorProgramsProvider } from "../../../plugins/ragents.actor-programs/web/AppsPanel";
import { createActorProgramsApi } from "../../../plugins/ragents.actor-programs/web/api";
import { AccessContext } from "../src/AccessContext";
import type { PluginActivationState } from "../src/PluginActivation";
import { PluginRegistry } from "../src/PluginRegistry";
import type { Message } from "quassel/events";
import { RunPanelApp } from "../src/run-panel/RunPanelApp";
import { RunPanelHostProvider, type RunPanelHost } from "../src/run-panel/host";
import type { RunAction, RunActor, RunActorInput, RunTurn, RunView } from "../src/run-view";
import "../src/ui/tailwind.css";
import { QuasselHost } from "../src/chat/QuasselHost";

type Subscription = { id: string; runId?: string; message: (event: unknown) => void };
const subscriptions = new Set<Subscription>();
const loaded = Date.now();
const ago = (seconds: number) => new Date(loaded - seconds * 1000).toISOString();
const idle = { kind: "idle", since: ago(600) } as const;
const runningFor = (seconds: number) => ({ kind: "running", turnId: `turn-${seconds}`, inputId: "input", startedAt: ago(seconds) }) as const;
const stopped = { kind: "stopped", stoppedAt: ago(300), reason: "Task done" } as const;
const actor = (id: string, kind: RunActor["kind"], createdBy: string | undefined, extra: Partial<RunActor> = {}): RunActor =>
  ({ id, kind, handle: id, displayName: id, grants: [], createdAt: ago(3600), ...createdBy ? { createdBy } : {}, lifecycle: kind === "human" ? undefined : idle, ...extra });
const assignment = (actorId: string, sequence: number, content: string, pending = false): RunActorInput =>
  ({ id: `input-${actorId}-${sequence}`, actorId, content, artifactIds: [], sourceEventIds: [], subscriptionId: null, enqueuedBy: "coordinator", enqueuedAt: ago(900), sequence, lifecycle: pending ? { kind: "pending" } : { kind: "claimed", turnId: "turn", steered: false } });
const finished = (actorId: string, startedSecondsAgo: number, seconds: number): RunTurn =>
  ({ id: `turn-${actorId}-${startedSecondsAgo}`, actorId, inputId: "input", status: "completed", startedAt: ago(startedSecondsAgo), finishedAt: ago(startedSecondsAgo - seconds), reason: null, usage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, costUsd: 0 } });
const question = (askedBy: string): RunAction =>
  ({ id: `question-${askedBy}`, askedBy, owner: "ragents.ask", payload: null, title: "Which rule set applies?", description: null, parameters: {}, input: null, status: "pending", proposedAt: ago(30), resolvedAt: null, resolvedBy: null, result: null });

const rules = [
  "async", "boundaries", "caching", "collections", "comments", "configuration", "contracts", "dates", "dependencies", "disposal",
  "errors", "events", "exceptions", "formatting", "generics", "immutability", "interfaces", "linq", "logging", "magic-numbers",
  "mutation", "naming", "nullability", "parameters", "patterns", "queries", "records", "recursion", "security", "serialization",
  "state", "strings", "switches", "testing", "threads", "timers", "visibility",
];
const reviewers = rules.map((rule, index) => actor(`review-${rule}`, "agent", "coordinator", {
  displayName: `Review ${rule}`,
  description: `checks the rule ${rule} in the change set`,
  lifecycle: index > 32 ? stopped : index % 9 === 0 ? runningFor(20 + index) : idle,
}));
const view: RunView = {
  id: "demo", revision: 1, title: "Rule review", ownerId: "tester", primaryActorId: "coordinator", createdAt: ago(3600), forkedFrom: null,
  actors: [
    actor("tester", "human", undefined, { displayName: "Tester" }),
    actor("coordinator", "agent", "tester", { displayName: "Coordinator", lifecycle: runningFor(72) }),
    actor("implementer", "agent", "coordinator", { displayName: "Implementer", lifecycle: runningFor(35) }),
    actor("test-writer", "agent", "implementer", { displayName: "Test writer" }),
    actor("formatter", "script", "implementer", { displayName: "Formatter", description: "formats changed files after every step" }),
    ...reviewers,
    actor("summary", "agent", "coordinator", { displayName: "Summary", description: "Summarize the findings of all reviewers, explain the remaining risks, and include the verification results with enough detail for the next person to continue the work." }),
  ],
  inputs: [
    assignment("coordinator", 1, "Rebuild the addressee list as a graph and have all rules checked."),
    assignment("implementer", 3, "Rebuild the chat's addressee list into a graph.\nDetails are in the task.\nKeep the creator relationships and all graph interactions intact.\nVerify the result in both hosts."),
    assignment("test-writer", 4, "Write tests for laying out the graph from the journal."),
    assignment("test-writer", 6, "Also cover wrapped rows.", true),
    assignment("summary", 5, "Summarize the findings of all reviewers once they are done."),
    assignment("formatter", 7, '{"input":null,"options":{"ragents.workspace.binding":{"kind":"server"}}}'),
    assignment("formatter", 8, "Please echo this message"),
  ],
  turns: [
    finished("test-writer", 400, 42),
    finished("formatter", 200, 3),
    ...reviewers.filter((reviewer) => reviewer.lifecycle?.kind !== "running").map((reviewer, index) => ({ ...finished(reviewer.id, 500 - index, 25 + (index * 7) % 90), status: reviewer.handle === "review-errors" ? "failed" as const : "completed" as const })),
  ],
  subscriptions: [], pluginStates: [{
    pluginId: "ragents.actor-programs", scope: { kind: "actor", actorId: "formatter" }, updatedAt: ago(600),
    state: { version: 1, program: { name: "format-files", actorId: "formatter", actorHandle: "formatter", revision: "build",
      functions: [{ id: "format" }, { id: "check" }], views: [{ id: "format-files--status", title: "Format status", visible: false }] } },
  }], actions: [question("review-dates")], artifacts: [],
};
const conversation = (who: string): Message[] => [
  { key: `${who}-question`, role: "user", sender: "tester", text: `Please check the status, @${who}.`, closed: true, at: ago(800) },
  { key: `${who}-answer`, role: "assistant", sender: who, text: "I am on it.", closed: true, at: ago(790) },
];
const conversations = Object.fromEntries(view.actors.map(({ id }) => [id, conversation(id)]));
const programApi = createActorProgramsApi("/plugins/ragents.actor-programs");
const registry = new PluginRegistry({
  brand: { title: "Agents" }, product: { id: "agents", title: "Agents" },
  plugins: [{
    id: "agents", needsRunView: true, surface: { RunPanel: OrchestrationRunPanel },
    workspaceTabs: webPlugin.workspaceTabs!.filter((tab) => tab.id === AGENTS_TAB_ID),
  }, {
    id: "ragents.actor-programs", needsRunView: true,
    SessionProvider: ({ children, session }) => <ActorProgramsProvider api={programApi} session={session}>{children}</ActorProgramsProvider>,
  }],
  startEntries: [],
});

const fixture = {
  activation: { status: "ready", registry, failures: [] } as PluginActivationState,
  unexpected: [] as string[],
  sent: [] as { runId: string; actorId: string; text: string }[],
  chat(runId: string, event: unknown) { subscriptions.forEach((entry) => { if (entry.id === "ragents.chat" && entry.runId === runId) entry.message(event); }); },
  async call(contract: { id: string }, params: { runId?: string; actorId?: string; text?: string }) {
    switch (contract.id) {
      case "ragents.runs.view": return params.runId === "demo" ? view : null;
      case "ragents.runs.list": return [{ id: "demo", title: "Rule review", updatedAt: 0, running: false, state: "idle", pendingActions: 0, workspaceAccessible: true }];
      case "ragents.runs.markViewed": return null;
      case "ragents.preferences.read": return null;
      case "ragents.startOptions.list": return [];
      case "ragents.chat.actorHistory": return { actors: conversations };
      case "ragents.chat.capabilities": return { input: ["text"], model: "demo-model" };
      case "ragents.chat.contextUsage": return null;
      case "ragents.actor-programs.apps": return { apps: [], tools: [] };
      case "ragents.chat.sendToActor": {
        if (!params.runId || !params.actorId || !params.text) throw new Error("An actor message requires a run, actor, and text.");
        fixture.sent.push({ runId: params.runId, actorId: params.actorId, text: params.text });
        return null;
      }
      default: fixture.unexpected.push(contract.id); return null;
    }
  },
  subscribe(contract: { id: string }, params: { runId?: string }, message: Subscription["message"]) {
    const entry = { id: contract.id, runId: params.runId, message };
    subscriptions.add(entry);
    return () => { subscriptions.delete(entry); };
  },
};

declare global { interface Window { actorGraphFixture: typeof fixture } }
window.actorGraphFixture = fixture;

const hostKind = new URLSearchParams(location.search).get("host") === "browser" ? "browser" : "vscode";
const host: RunPanelHost = {
  kind: hostKind, machines: hostKind === "browser" ? "server" : "all",
  openApp() {}, requestLogin() {}, requestLogout() {}, openExternal() {}, openPage() {}, openService() {},
  onCommand: () => () => {}, notify() {},
};
const access = createAccessContext({ enabled: true, user: { id: "tester", label: "Tester", rights: ["runs.read", "runs.write", "runs.create", "runs.inspect"], startEntries: [] } });

createRoot(document.getElementById("root")!).render(<QuasselHost><AccessContext.Provider value={{ ...access, logout: async () => {} }}>
  <RunPanelHostProvider value={host}>
    <RunPanelApp location={{ layout: "panel", runId: "demo", host: hostKind, connection: "local", theme: undefined, access: undefined }} />
  </RunPanelHostProvider>
</AccessContext.Provider></QuasselHost>);
