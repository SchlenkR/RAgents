import { createRoot } from "react-dom/client";
import { createAccessContext } from "../../../packages/ragents/src/access";
import { AgentsHeader } from "../../../plugins/ragents.orchestration/web/run-panel/AgentsHeader";
import { OrchestrationRunPanel } from "../../../plugins/ragents.orchestration/web/run-panel/RunPanel";
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
    actor("summary", "agent", "coordinator", { displayName: "Summary" }),
  ],
  inputs: [
    assignment("coordinator", 1, "Rebuild the addressee list as a graph and have all rules checked."),
    assignment("implementer", 3, "Rebuild the chat's addressee list into a graph.\nDetails are in the task."),
    assignment("test-writer", 4, "Write tests for laying out the graph from the journal."),
    assignment("test-writer", 6, "Also cover wrapped rows.", true),
    assignment("summary", 5, "Summarize the findings of all reviewers once they are done."),
  ],
  turns: [
    finished("test-writer", 400, 42),
    finished("formatter", 200, 3),
    ...reviewers.filter((reviewer) => reviewer.lifecycle?.kind !== "running").map((reviewer, index) => finished(reviewer.id, 500 - index, 25 + (index * 7) % 90)),
  ],
  subscriptions: [], pluginStates: [], actions: [question("review-dates")], artifacts: [],
};
const conversation = (who: string): Message[] => [
  { key: `${who}-question`, role: "user", sender: "tester", text: `Please check the status, @${who}.`, closed: true, at: ago(800) },
  { key: `${who}-answer`, role: "assistant", sender: who, text: "I am on it.", closed: true, at: ago(790) },
];
const conversations = Object.fromEntries(view.actors.map(({ id }) => [id, conversation(id)]));
const registry = new PluginRegistry({
  brand: { title: "Agents" }, product: { id: "agents", title: "Agents" },
  plugins: [{
    id: "agents", needsRunView: true, surface: { RunPanel: OrchestrationRunPanel },
    sessionHeaders: [{ id: "agents.graph", placement: "bar", order: 10, Header: AgentsHeader }],
  }],
  startEntries: [],
});

const fixture = {
  activation: { status: "ready", registry, failures: [] } as PluginActivationState,
  unexpected: [] as string[],
  chat(runId: string, event: unknown) { subscriptions.forEach((entry) => { if (entry.id === "ragents.chat" && entry.runId === runId) entry.message(event); }); },
  async call(contract: { id: string }, params: { runId?: string }) {
    switch (contract.id) {
      case "ragents.runs.view": return params.runId === "demo" ? view : null;
      case "ragents.runs.list": return [{ id: "demo", title: "Rule review", updatedAt: 0, running: false, state: "idle", pendingActions: 0, workspaceAccessible: true }];
      case "ragents.runs.markViewed": return null;
      case "ragents.startOptions.list": return [];
      case "ragents.chat.actorHistory": return { actors: conversations };
      case "ragents.chat.capabilities": return { input: ["text"], model: "demo-model" };
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

const host: RunPanelHost = {
  kind: "vscode", machines: "all",
  openApp() {}, requestLogin() {}, requestLogout() {}, openExternal() {}, openPage() {},
  onCommand: () => () => {}, notify() {},
};
const access = createAccessContext({ enabled: true, user: { id: "tester", label: "Tester", rights: ["runs.read", "runs.write", "runs.create", "runs.inspect"], startEntries: [] } });

createRoot(document.getElementById("root")!).render(<QuasselHost><AccessContext.Provider value={{ ...access, logout: async () => {} }}>
  <RunPanelHostProvider value={host}>
    <RunPanelApp location={{ layout: "panel", runId: "demo", host: "vscode", connection: "lokal", theme: undefined, access: undefined }} />
  </RunPanelHostProvider>
</AccessContext.Provider></QuasselHost>);
