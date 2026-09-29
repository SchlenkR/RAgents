import { createRoot } from "react-dom/client";
import { createAccessContext } from "../../../packages/ragents/src/access";
import { OrchestrationRunPanel } from "../../../plugins/ragents.orchestration/web/run-panel/RunPanel";
import { AccessContext } from "../src/AccessContext";
import type { PluginActivationState } from "../src/PluginActivation";
import { PluginRegistry } from "../src/PluginRegistry";
import type { Message } from "quassel/events";
import { RunPanelApp } from "../src/run-panel/RunPanelApp";
import { RunPanelHostProvider, type RunPanelHost } from "../src/run-panel/host";
import type { RunActor, RunActorInput, RunView } from "../src/run-view";
import "../src/ui/tailwind.css";
import { QuasselHost } from "../src/chat/QuasselHost";

type Subscription = { id: string; runId?: string; message: (event: unknown) => void };
const subscriptions = new Set<Subscription>();
const at = (minute: number) => `2026-09-25T09:${String(minute).padStart(2, "0")}:00.000Z`;
const idle = { kind: "idle", since: at(30) } as const;
const running = { kind: "running", turnId: "turn", inputId: "input", startedAt: at(31) } as const;
const stopped = { kind: "stopped", stoppedAt: at(32), reason: "Task done" } as const;
const actor = (id: string, kind: RunActor["kind"], createdBy: string | undefined, extra: Partial<RunActor> = {}): RunActor =>
  ({ id, kind, handle: id, displayName: id, grants: [], createdAt: at(1), ...createdBy ? { createdBy } : {}, lifecycle: kind === "human" ? undefined : idle, ...extra });
const assignment = (actorId: string, sequence: number, content: string): RunActorInput =>
  ({ id: `input-${actorId}`, actorId, content, artifactIds: [], sourceEventIds: [], subscriptionId: null, enqueuedBy: "coordinator", enqueuedAt: at(2), sequence, lifecycle: { kind: "claimed", turnId: "turn", steered: false } });

const rules = [
  "async", "boundaries", "caching", "collections", "comments", "configuration", "contracts", "dates", "dependencies", "disposal",
  "errors", "events", "exceptions", "formatting", "generics", "immutability", "interfaces", "linq", "logging", "magic-numbers",
  "mutation", "naming", "nullability", "parameters", "patterns", "queries", "records", "recursion", "security", "serialization",
  "state", "strings", "switches", "testing", "threads", "timers", "visibility",
];
const reviewers = rules.map((rule, index) => actor(`review-${rule}`, "agent", "coordinator", {
  displayName: `Review ${rule}`,
  description: `checks the rule ${rule} in the change set`,
  lifecycle: index > 32 ? stopped : index % 9 === 0 ? running : idle,
}));
const view: RunView = {
  id: "demo", revision: 1, title: "Rule review", ownerId: "tester", primaryActorId: "coordinator", createdAt: at(0), forkedFrom: null,
  actors: [
    actor("tester", "human", undefined, { displayName: "Tester" }),
    actor("coordinator", "agent", "tester", { displayName: "Coordinator", lifecycle: running }),
    actor("implementer", "agent", "coordinator", { displayName: "Implementer", lifecycle: running }),
    actor("test-writer", "agent", "implementer", { displayName: "Test writer" }),
    actor("formatter", "script", "implementer", { displayName: "Formatter", description: "formats changed files after every step" }),
    ...reviewers,
    actor("summary", "agent", "coordinator", { displayName: "Summary" }),
  ],
  inputs: [
    assignment("implementer", 3, "Rebuild the chat's addressee list into a tree.\nDetails are in the task."),
    assignment("test-writer", 4, "Write tests for building the tree from the journal."),
    assignment("summary", 5, "Summarize the findings of all reviewers once they are done."),
  ],
  turns: [], subscriptions: [], pluginStates: [], actions: [], artifacts: [],
};
const conversation = (who: string): Message[] => [
  { key: `${who}-question`, role: "user", sender: "tester", text: `Please check the status, @${who}.`, closed: true, at: at(5) },
  { key: `${who}-answer`, role: "assistant", sender: who, text: "I am on it.", closed: true, at: at(6) },
];
const conversations = Object.fromEntries(view.actors.map(({ id }) => [id, conversation(id)]));
const registry = new PluginRegistry({
  brand: { title: "Addressees" }, product: { id: "addressees", title: "Addressees" },
  plugins: [{ id: "addressees", needsRunView: true, surface: { Center: () => null, RunPanel: OrchestrationRunPanel } }],
  startEntries: [],
});

const fixture = {
  activation: { status: "ready", registry, failures: [] } as PluginActivationState,
  unexpected: [] as string[],
  chat(runId: string, event: unknown) { subscriptions.forEach((entry) => { if (entry.id === "ragents.chat" && entry.runId === runId) entry.message(event); }); },
  async call(contract: { id: string }, params: { runId?: string }) {
    switch (contract.id) {
      case "ragents.runs.view": return params.runId === "demo" ? view : null;
      case "ragents.runs.list": return [{ id: "demo", title: "Rule review", updatedAt: 0 }];
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

declare global { interface Window { addresseeFixture: typeof fixture } }
window.addresseeFixture = fixture;

const centered: ReadonlySet<string> = new Set();
const host: RunPanelHost = {
  kind: "vscode", machines: "all", centerElements: () => centered, subscribe: () => () => {},
  openInCenter() {}, returnToRunPanel() {}, requestLogin() {}, requestLogout() {}, openExternal() {}, openPage() {},
  onCommand: () => () => {}, notify() {},
};
const access = createAccessContext({ enabled: true, user: { id: "tester", label: "Tester", rights: ["runs.read", "runs.write", "runs.create", "runs.inspect"], startEntries: [] } });

createRoot(document.getElementById("root")!).render(<QuasselHost><AccessContext.Provider value={{ ...access, logout: async () => {} }}>
  <RunPanelHostProvider value={host}>
    <RunPanelApp location={{ layout: "panel", runId: "demo", host: "vscode", connection: "lokal", theme: undefined, access: undefined }} />
  </RunPanelHostProvider>
</AccessContext.Provider></QuasselHost>);
