import { createRoot } from "react-dom/client";
import { useState } from "react";
import { ChatInputToolbar, ChatMessages, ChatPanel, type Message } from "quassel";
import { createAccessContext } from "../../../packages/ragents/src/access";
import { askTitleOf, type AskPayload, type QuestionAnswer } from "../../../plugins/ragents.ask/ask-payload";
import { webPlugin as askWebPlugin } from "../../../plugins/ragents.ask/web/index";
import { ActorRunPanelChat } from "../../../plugins/ragents.orchestration/web/run-panel/RunPanel";
import { OrchestrationRunPanel } from "../../../plugins/ragents.orchestration/web/run-panel/RunPanel";
import { AccessContext } from "../src/AccessContext";
import { QuasselHost } from "../src/chat/QuasselHost";
import { ChatStepsProvider, defaultChatDisplayPolicy, PluginRegistry, PluginSessionProviders, useActionRenderer, type ChatDisplayOptions, type SessionContext } from "../src/PluginRegistry";
import { createBrowserHost, RunPanelHostProvider } from "../src/run-panel/host";
import type { RunAction, RunView } from "../src/run-view";
import "../src/ui/tailwind.css";

declare global {
  interface Window {
    dockFixture: { calls: Array<[string, Record<string, unknown>]>; resolve: () => void };
  }
}

const params = new URLSearchParams(location.search);
const runId = params.get("run") ?? "dock";
const at = "2026-09-29T10:00:00Z";
const running = { kind: "running", turnId: "turn", inputId: "input", startedAt: at } as const;
const period = {
  question: "Which review period applies?", header: "Period", multiSelect: false,
  options: [{ label: "3 days", description: "" }, { label: "14 days", description: "" }, { label: "30 days", description: "" }],
};
const several = params.get("questions") === "several";
const payload: AskPayload = { questions: several ? [
  { ...period, options: period.options.map((option) => ({ ...option, description: `Review within ${option.label}` })) },
  { question: "Which checks run first?", header: "Checks", multiSelect: true,
    options: [{ label: "lint", description: "Style rules" }, { label: "tests", description: "Unit tests" }, { label: "build", description: "Full build" }] },
  { question: "Who reviews the change?", header: "Reviewer", multiSelect: false,
    options: [{ label: "Domain lead", description: "Knows the rules" }, { label: "Second developer", description: "Knows the code" }] },
] : [period] };
const answers: readonly QuestionAnswer[] = several
  ? [{ selected: ["14 days"] }, { selected: ["lint", "tests"] }, { text: "Someone from QA" }]
  : [{ selected: ["14 days"] }];
const question: RunAction = {
  id: "review-window", askedBy: "worker", owner: "ragents.ask", title: askTitleOf(payload.questions), description: null,
  payload,
  parameters: {}, input: null, status: "pending", proposedAt: at, resolvedAt: null, resolvedBy: null, result: null,
};
const history: Message[] = Array.from({ length: 12 }, (_, index) => ({ key: `answer-${index}`, role: "assistant", text: `Answer ${index}: ${"Text in the history. ".repeat(15)}`, closed: true }));
const registry = new PluginRegistry({ brand: { title: "Dock" }, product: { id: "dock", title: "Dock" }, startEntries: [], plugins: [askWebPlugin] }, new Map());
const navigation = { activeTabId: "", openTab() {}, revealEntity: () => false, selectionFor: () => undefined };
const access = createAccessContext({ enabled: true, user: { id: "operator", label: "Operator", rights: params.get("access") === "read" ? ["runs.read", "runs.inspect"] : ["runs.read", "runs.write", "runs.inspect"] } });
const host = createBrowserHost(window);

const sessionFor = (answered: boolean): SessionContext => {
  const view: RunView = {
    id: runId, revision: 1, title: "Dock", ownerId: "owner", primaryActorId: "primary", createdAt: at, forkedFrom: null,
    actors: [
      { id: "owner", kind: "human", handle: "owner", displayName: "Owner", grants: [], createdAt: at },
      { id: "primary", kind: "agent", handle: "coordinator", displayName: "Coordinator", grants: [], createdAt: at, lifecycle: running },
      { id: "worker", kind: "agent", handle: "reviewer", displayName: "Reviewer", grants: [], createdAt: at, createdBy: "primary", lifecycle: running },
    ],
    inputs: [], turns: [], subscriptions: [], pluginStates: [], artifacts: [],
    actions: [answered ? { ...question, status: "approved", resolvedAt: at, resolvedBy: "operator", result: { answers } } : question],
  };
  const action: Message = { key: question.id, role: "action", text: question.title, closed: true, action: {
    actionId: question.id, owner: question.owner, payload: question.payload, ...answered ? { status: "approved", result: { answers } } : {},
  } };
  const conversation = [...history, action];
  return {
    connected: true, pluginEvents: [], runView: view, running: true, messages: conversation, actorConversations: { worker: conversation },
    session: { id: runId, title: "Dock", updatedAt: 0 }, send: async () => {}, start: async () => {},
  };
};

function Chat({ options, session }: { options: ChatDisplayOptions; session: SessionContext }) {
  const renderAction = useActionRenderer();
  return <ChatPanel className={`min-h-0 flex-1 ${options.chatElementClassName ?? ""}`} composer={<ChatInputToolbar maxRows={4} onSend={() => {}} rows={1} toolbarLeft={options.toolbarLeft} />}>
    <ChatMessages messages={session.messages} renderAction={renderAction} running scrollerRef={options.chatScrollerRef} />
  </ChatPanel>;
}

function Fixture() {
  const [answered, setAnswered] = useState(params.get("status") === "approved");
  window.dockFixture.resolve = () => setAnswered(true);
  const session = sessionFor(answered);
  const view = session.runView as RunView;
  return <AccessContext.Provider value={{ ...access, logout: async () => {} }}><QuasselHost><ChatStepsProvider policy={defaultChatDisplayPolicy}>
    <PluginSessionProviders navigation={navigation} registry={registry} session={session}><RunPanelHostProvider value={host}>
      {params.get("scene") === "actor"
        ? <div className="flex min-h-0 flex-1 flex-col" data-fixture="actor">
          <ActorRunPanelChat actor={view.actors[2]} cardSections={registry.cardSections} navigation={navigation} onNavigate={() => {}} session={session} view={view} />
        </div>
        : <OrchestrationRunPanel
          cardSections={registry.cardSections} navigation={navigation} session={session} statusContainer={null} tabIds={[]} toolbarContainer={null}
          renderChat={(options = {}) => <Chat options={options} session={session} />}
          surfaceElements={[{ id: "mini", order: 0, select: () => [{ id: "mini", title: "Stage" }], Element: () => <div><button className="m-8 self-start" id="stage-button">Operate mini-app</button><input aria-label="App draft" /></div> }]}
        />}
    </RunPanelHostProvider></PluginSessionProviders>
  </ChatStepsProvider></QuasselHost></AccessContext.Provider>;
}

window.dockFixture = { calls: [], resolve: () => {} };
createRoot(document.getElementById("root")!).render(<Fixture />);
