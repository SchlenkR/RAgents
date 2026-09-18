import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ChatStepsProvider, defaultChatDisplayPolicy, PluginRegistry, PluginSessionProviders, type SessionContext, type SessionNavigation } from "../src/PluginRegistry";
import { ActorChat } from "../../../plugins/ragents.orchestration/web/ActorChat";
import { DocumentToolCall, documentMessagesFrom, documentsFrom } from "../../../plugins/ragents.documents/web/DocumentViewer";
import { ActorChatPreview } from "../../../plugins/ragents.orchestration/web/ActorChatPreview";
import { ActorTile } from "../../../plugins/ragents.orchestration/web/ActorTile";
import { ActorChatControls } from "../../../plugins/ragents.orchestration/web/ActorChatControls";
import { QuestionSection } from "../../../plugins/ragents.ask/web/QuestionSection";
import { AccessContext } from "../src/AccessContext";
import { createAccessContext } from "../../../packages/ragents/src/access";
import { Chat as AppChat } from "../../../plugins/ragents.actor-programs/client-ui/index";
import type { ChatConnection } from "../../../plugins/ragents.actor-programs/client-ui/contracts";
import { ChatMessages } from "../src/chat/ChatMessages";
import type { Message } from "../src/chat/types";
import { chatSnapshotOf, resolveChatActor } from "../../../plugins/ragents.actor-programs/web/chat-state";
import { RUN_APP_CHAT_SEND, RUN_APP_CHAT_WATCH, validateRunAppBridgeRequest } from "../../../plugins/ragents.actor-programs/web/bridge";
import { actorChatMessages, actorConversation } from "../../../plugins/ragents.orchestration/web/actor-conversation";
import type { RunAction, RunActor, RunView } from "../../../plugins/ragents.orchestration/web/run-view";

const actor = (id: string, handle: string, kind: RunActor["kind"]): RunActor => ({
  id, handle, kind, displayName: handle, grants: [], createdAt: "2026-09-06T10:00:00Z", lifecycle: { kind: "idle", since: "2026-09-06T10:00:00Z" },
});
const primary = actor("main-agent", "coordinator", "agent");
const worker = actor("worker-agent", "reviewer", "agent");
const view: RunView = {
  id: "sample-run", ownerId: "owner", primaryActorId: primary.id, title: "Test", createdAt: "2026-09-06T10:00:00Z", revision: 12,
  actors: [actor("owner", "user", "human"), primary, worker],
  inputs: [
    { id: "input-2", actorId: worker.id, content: "Weiter", artifactIds: [], sourceEventIds: [], subscriptionId: null, enqueuedBy: primary.id, enqueuedAt: "2026-09-06T10:02:00Z", sequence: 8, lifecycle: { kind: "pending" } },
    { id: "input-1", actorId: worker.id, content: "Prüfe den Text", artifactIds: [], sourceEventIds: [], subscriptionId: null, enqueuedBy: "owner", enqueuedAt: "2026-09-06T10:00:00Z", sequence: 3, lifecycle: { kind: "claimed", turnId: "turn-1" } },
    { id: "discarded", actorId: worker.id, content: "Verworfen", artifactIds: [], sourceEventIds: [], subscriptionId: null, enqueuedBy: "owner", enqueuedAt: "2026-09-06T10:00:00Z", sequence: 9, lifecycle: { kind: "discarded", at: "2026-09-06T10:03:00Z", reason: "Stopp" } },
  ],
  turns: [{ id: "turn-1", actorId: worker.id, inputId: "input-1", status: "completed", startedAt: "2026-09-06T10:00:00Z", finishedAt: "2026-09-06T10:01:00Z", reason: null, usage: { inputTokens: 1, outputTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 0, costUsd: 0 }, outputs: [{ sequence: 6, text: "Geprüft", occurredAt: "2026-09-06T10:01:00Z" }] }],
  subscriptions: [], pluginStates: [], actions: [], artifacts: [],
};
const session = (overrides: Partial<SessionContext> = {}): SessionContext => ({
  centerMode: "chat", connected: true, extensionEvents: [], messages: [{ key: "streamed", role: "assistant", text: "Noch nicht fertig" }],
  running: true, session: { id: view.id, title: view.title, updatedAt: 0 }, runView: view,
  send: async () => {}, start: async () => {}, stop: async () => {}, respond: async () => {}, ...overrides,
});

test("actor chats share the inspector's ordered conversation and exclude discarded inputs", () => {
  const messages = actorConversation(view, worker);
  assert.deepEqual(messages.map((entry) => entry.text), ["Prüfe den Text", "Geprüft", "Weiter"]);
  assert.deepEqual(messages.map((entry) => entry.role), ["user", "assistant", "assistant"]);
  assert.deepEqual(messages.map((entry) => entry.sender), [view.ownerId, worker.id, primary.id]);
  assert.equal(messages[2].bubble?.label, "Zugestellt von @coordinator");
  assert.deepEqual(chatSnapshotOf(session(), "@reviewer").messages, messages);
  assert.equal(chatSnapshotOf(session(), "@reviewer").owner, worker.id);
  assert.equal(chatSnapshotOf(session(), "@reviewer").running, false);
});

test("fallback actor chats hide background inputs without hiding their answers", () => {
  const background: RunView = {
    ...view,
    inputs: view.inputs.map((input) => input.id === "input-1" ? { ...input, presentation: "background" } : input),
  };
  const messages = actorConversation(background, worker);
  assert.deepEqual(messages.map((message) => message.text), ["Geprüft", "Weiter"]);
  assert.deepEqual(messages.map((message) => message.sender), [worker.id, primary.id]);
  assert.deepEqual(chatSnapshotOf(session({ runView: background }), "@reviewer").messages, messages);
  assert.equal(view.inputs.find((input) => input.id === "input-1")?.presentation, undefined);
});

test("primary chats retain streaming text and follow the selected primary actor", () => {
  assert.equal(chatSnapshotOf(session(), "primary").messages[0].text, "Noch nicht fertig");
  assert.equal(chatSnapshotOf(session(), "primary").messages[0].sender, primary.id);
  assert.equal(chatSnapshotOf(session(), "primary").owner, primary.id);
  assert.equal(chatSnapshotOf(session(), "primary").running, true);
  const switched = session({ runView: { ...view, primaryActorId: worker.id } });
  assert.equal(resolveChatActor(switched, "primary").actor.id, worker.id);
  assert.equal(chatSnapshotOf(switched, "primary").owner, worker.id);
  assert.equal(chatSnapshotOf(switched, "primary").messages[0].sender, worker.id);
});

test("primary actor messages retain live content while identifying human and assistant senders", () => {
  const messages: Message[] = [
    { key: "human", role: "user", text: "Prüfen", closed: true },
    { key: "thinking", role: "thinking", text: "Überlege" },
    { key: "streamed", role: "assistant", text: "Noch nicht fertig", closed: false },
  ];
  const rendered = actorChatMessages(view, primary, messages);
  assert.deepEqual(rendered, [
    { ...messages[0], sender: view.ownerId }, messages[1], { ...messages[2], sender: primary.id },
  ]);
  assert.equal(messages[0].sender, undefined);
  assert.equal(messages[2].sender, undefined);
  assert.deepEqual(actorChatMessages(view, worker, messages), actorConversation(view, worker));
});

test("chat owner suppresses only matching sender bubbles and preserves the same conversation", () => {
  const messages: Message[] = [
    { key: "human", role: "user", sender: "human", text: "Frage" },
    { key: "reviewer", role: "assistant", sender: "reviewer", text: "**Antwort**", bubble: { label: "Gleicher Name", color: "#123456", side: "end" } },
    { key: "coordinator", role: "assistant", sender: "coordinator", text: "Nachtrag", bubble: { label: "Gleicher Name", color: "#abcdef", side: "start" } },
    { key: "anonymous", role: "assistant", text: "Ohne Kennung", bubble: { label: "reviewer", color: "#654321", side: "start" } },
  ];
  const original = structuredClone(messages);
  const render = (owner?: string | null) => renderToStaticMarkup(createElement(ChatMessages, { messages, owner }));
  const defaults = render();
  assert.equal(render(null), defaults);
  assert.equal(render("Gleicher Name"), defaults);
  assert.match(defaults, /data-message="user"/);
  const reviewer = render("reviewer");
  assert.doesNotMatch(reviewer, /background:#123456/);
  assert.match(reviewer, /data-message="answer"[^>]*>(<div[^>]*>)?<p[^>]*><strong[^>]*>Antwort<\/strong>/);
  assert.match(reviewer, /background:#abcdef/);
  assert.match(reviewer, /background:#654321/);
  assert.match(reviewer, /data-message="user"/);
  const coordinator = render("coordinator");
  assert.match(coordinator, /background:#123456/);
  assert.doesNotMatch(coordinator, /background:#abcdef/);
  const human = render("human");
  assert.doesNotMatch(human, /data-message="user"/);
  assert.match(human, /background:#123456/);
  assert.equal(render(), defaults);
  assert.deepEqual(messages, original);
});

test("chat owner retains attachment-only messages and leaves special rows unchanged", () => {
  for (const role of ["user", "assistant"] as const) {
    const html = renderToStaticMarkup(createElement(ChatMessages, { owner: "reviewer", messages: [
      { key: role, role, sender: "reviewer", text: "", attachments: [{ name: "notes.txt", mediaType: "text/plain", size: 12, url: "/notes.txt" }],
        ...(role === "assistant" ? { bubble: { label: "Prüfung", color: "#123456", side: "end" as const } } : {}) },
    ] }));
    assert.match(html, /data-message="answer"/);
    assert.match(html, /download="notes.txt"/);
    assert.doesNotMatch(html, /data-message="user"|data-message="bubble"|background:#123456/);
  }
  const messages: Message[] = [
    { key: "tool", role: "tool", sender: "reviewer", text: "Liest", tool: { id: "read", name: "read", arguments: "{}", result: "Fertig" } },
    { key: "thinking", role: "thinking", sender: "reviewer", text: "Überlege" },
    { key: "system", role: "system", sender: "reviewer", text: "Unterbrochen" },
    { key: "question", role: "question", sender: "reviewer", text: "Welche Farbe?", question: { callId: "color", options: ["Blau", "Rot"] } },
  ];
  const render = (owner?: string) => renderToStaticMarkup(createElement(ChatMessages, { messages, owner, detailMode: "full" }));
  assert.equal(render("reviewer"), render());
});

test("chat targets are same-run handles; stopped or disconnected actors retain history and reject input", () => {
  assert.throws(() => resolveChatActor(session(), "worker-agent"), /Erlaubt sind primary/);
  assert.throws(() => resolveChatActor(session(), "@user"), /Erlaubt sind primary/);
  assert.throws(() => resolveChatActor(session({ runView: { ...view, id: "other-run" } }), "primary"), /Laufansicht/);
  assert.match(chatSnapshotOf(session({ connected: false }), "@reviewer").error ?? "", /unterbrochen/);
  const stopped = session({ runView: { ...view, actors: [primary, { ...worker, lifecycle: { kind: "stopped", stoppedAt: "2026-09-06T10:03:00Z", reason: "Stopp" } }] } });
  assert.match(chatSnapshotOf(stopped, "@reviewer").error ?? "", /gestoppt/);
  assert.equal(chatSnapshotOf(stopped, "@reviewer").messages.length, 3);
});

test("the chat bridge validates target and input and does not accept a caller-supplied run", () => {
  const common = { version: 1, requestId: "request-1", actor: "@reviewer" };
  assert.equal(validateRunAppBridgeRequest({ ...common, type: RUN_APP_CHAT_WATCH }).ok, true);
  assert.deepEqual(validateRunAppBridgeRequest({ ...common, type: RUN_APP_CHAT_SEND, text: " Hallo ", runId: "other-run" }), {
    ok: true, request: { ...common, type: RUN_APP_CHAT_SEND, text: "Hallo" },
  });
  for (const input of ["", " ", "x".repeat(65536), null]) {
    assert.equal(validateRunAppBridgeRequest({ ...common, type: RUN_APP_CHAT_SEND, text: input }).ok, false);
  }
  assert.equal(validateRunAppBridgeRequest({ ...common, type: RUN_APP_CHAT_WATCH, actor: "../other-run" }).ok, false);
});

test("the chat bridge accepts attachment-only input and rejects invalid or oversized files", () => {
  const common = { version: 1, requestId: "attachment-1", actor: "primary", type: RUN_APP_CHAT_SEND, text: "" };
  const attachment = { name: "notes.txt", mediaType: "text/plain", data: "aGk=" };
  assert.deepEqual(validateRunAppBridgeRequest({ ...common, attachments: [attachment] }), {
    ok: true, request: { ...common, attachments: [attachment] },
  });
  for (const attachments of [null, [null], [{ ...attachment, name: "../private.txt" }],
    [{ ...attachment, data: "not base64" }], Array(9).fill(attachment),
    [{ ...attachment, data: "A".repeat(28 * 1024 * 1024) }]]) {
    const result = validateRunAppBridgeRequest({ ...common, attachments });
    assert.equal(result.ok, false);
  }
});

test("actor history retains attachment-only inputs and run-scoped download metadata", () => {
  const artifact = { id: "document-1", title: "photo.png", mediaType: "image/png", size: 68,
    hash: "a".repeat(64), createdBy: "owner", createdAt: "2026-09-06T10:00:00Z", previousVersionId: null };
  const state = { ...view, artifacts: [artifact], inputs: [{ ...view.inputs[1], content: "", artifactIds: [artifact.id] }] };
  const message = actorConversation(state, worker)[0];
  assert.equal(message.text, "");
  assert.deepEqual(message.attachments, [{ name: "photo.png", mediaType: "image/png", size: 68,
    url: "/chat/sample-run/attachments/document-1" }]);
});


test("LLM canvas chats retain the conversation and expose the shared permanent composer", () => {
  const html = renderToStaticMarkup(createElement(ActorChatPreview, { actor: worker, view, onNavigate: () => {} }));
  assert.match(html, /Prüfe den Text/);
  assert.match(html, /Geprüft/);
  assert.match(html, /data-chat="composer"/);
  assert.match(html, /<textarea[^>]*aria-label="Nachricht an @reviewer/);
  assert.match(html, /aria-label="Dateien anhängen"/);
  assert.equal((html.match(/<textarea/g) ?? []).length, 1);
  assert.doesNotMatch(html, /Modell auswählen|Denktiefe|Anheften|<select/);
});

const renderQuestionTile = (writable: boolean, status: RunAction["status"] = "pending") => {
  const question: RunAction = { id: "review-window", askedBy: worker.id, kind: "question", title: "Welche Prüffrist gilt?",
    description: "Beide Varianten sind fachlich möglich.", question: { options: ["3 Tage", "14 Tage"], multi: false },
    parameters: {}, input: null, status, proposedAt: "now", resolvedAt: null, resolvedBy: null, response: null };
  const currentView = { ...view, actions: [question, { ...question, id: "other-question", askedBy: primary.id, title: "Fremde Frage" }] };
  const access = createAccessContext({ enabled: true, user: { id: "operator", label: "Operator", rights: writable ? ["runs.read", "runs.write"] : ["runs.read"] } });
  return renderToStaticMarkup(createElement(AccessContext.Provider, { value: { ...access, logout: async () => {} } },
    createElement(ChatStepsProvider, { policy: defaultChatDisplayPolicy }, createElement(ActorTile, {
      actor: worker, view: currentView, session: session({ runView: currentView, actorConversations: { [worker.id]: [
        { key: "message", role: "assistant", sender: worker.id, text: "Ich brauche eine Entscheidung." },
        { key: question.id, role: "question", text: question.title, question: {
          callId: question.id, options: question.question!.options, ...(status === "approved" ? { answer: "14 Tage" } : {}),
        } },
      ] } }), navigation: { activeTabId: "", openTab: () => {}, revealEntity: () => false, selectionFor: () => undefined },
      onSelect: () => {}, cardSections: [{ id: "ragents.ask.questions", order: 100, Section: QuestionSection }],
    }))));
};

test("restricted actor tiles retain chat and make their pending questions answerable through the existing card section", () => {
  const html = renderQuestionTile(true);
  assert.match(html, /Ich brauche eine Entscheidung/);
  assert.match(html, /<textarea[^>]*aria-label="Nachricht an @reviewer/);
  assert.doesNotMatch(html, /<textarea[^>]*disabled/);
  assert.match(html, /<button[^>]*data-question="option"[^>]*>3 Tage<\/button>/);
  assert.match(html, /<button[^>]*data-question="option"[^>]*>14 Tage<\/button>/);
  assert.match(html, /placeholder="\.\.\. oder frei antworten"/);
  assert.doesNotMatch(html, /Fremde Frage|Modell auswählen|Denktiefe/);
  assert.equal((html.match(/Rückfrage/g) ?? []).length, 1);
});

test("actor tile question controls respect read-only access and disappear after resolution", () => {
  const readonly = renderQuestionTile(false);
  assert.match(readonly, /Welche Prüffrist gilt/);
  assert.match(readonly, /<textarea[^>]*disabled=""/);
  assert.doesNotMatch(readonly, /data-question="option"|oder frei antworten/);
  const answered = renderQuestionTile(true, "approved");
  assert.match(answered, /data-question="answered"/);
  assert.doesNotMatch(answered, /Rückfrage|data-question="option"|oder frei antworten/);
});

test("stopped actors cannot submit and humans do not receive the actor composer", () => {
  const stopped: RunActor = { ...worker, lifecycle: { kind: "stopped", stoppedAt: "now", reason: "done" } };
  const html = renderToStaticMarkup(createElement(ActorChatControls, { actor: stopped, view, presentation: "canvas" }));
  assert.match(html, /<textarea[^>]*disabled=""/);
  assert.match(html, /<button(?=[^>]*aria-label="Dateien anhängen")(?=[^>]* disabled="")/);
  assert.match(html, /Dieser Actor ist gestoppt/);
  const human = renderToStaticMarkup(createElement(ActorChatControls, { actor: view.actors[0], view }));
  assert.doesNotMatch(human, /textarea|Dateien anhängen/);
  const hidden = renderToStaticMarkup(createElement(ActorChatControls, { actor: worker, view, composerVisible: false }));
  assert.doesNotMatch(hidden, /textarea|Dateien anhängen/);
});

test("script actor controls explain program operation without offering a chat composer", () => {
  const script = actor("program", "word-game", "script");
  const scriptView = { ...view, actors: [...view.actors, script] };
  for (const presentation of ["canvas", "inspector"] as const) {
    const html = renderToStaticMarkup(createElement(ActorChatControls, { actor: script, view: scriptView, presentation }));
    assert.doesNotMatch(html, /textarea|Dateien anhängen/);
    assert.match(html, /TypeScript/);
    assert.match(html, /Mini-App/);
  }
  const llm = chatSnapshotOf(session(), "@reviewer");
  assert.notEqual(llm.readOnly, true);
  assert.equal(llm.error, undefined);
});

test("actor traces remain with their actor after primary switches to a script", () => {
  const script = actor("list-script", "notizliste", "script");
  const changedView = { ...view, primaryActorId: script.id, actors: [...view.actors, script] };
  const conversation: Message[] = [
    { key: "thought", role: "thinking", sender: primary.id, text: "Ich prüfe die Beteiligten", closed: true },
    { key: "call", role: "tool", sender: primary.id, text: "actor_list", closed: true,
      tool: { id: "call-1", name: "actor_list", arguments: "{}", result: "coordinator, notizliste" } },
    { key: "reply", role: "assistant", sender: primary.id, text: "Ausgeführt", closed: true },
  ];
  const scriptMessages: Message[] = [{ key: "script-reply", role: "assistant", text: "Liste bereit" }];
  const context = session({ runView: changedView, messages: scriptMessages, actorConversations: { [primary.id]: conversation } });
  const snapshot = chatSnapshotOf(context, "@coordinator");
  assert.deepEqual(snapshot.messages.map((message) => message.role), ["thinking", "tool", "assistant"]);
  assert.equal(snapshot.messages[1].tool?.result, "coordinator, notizliste");
  assert.equal(snapshot.messages[2].sender, primary.id);
  assert.equal(chatSnapshotOf(context, "primary").messages[0].text, "Liste bereit");
  for (const target of ["primary", "@notizliste"]) {
    const program = chatSnapshotOf(context, target);
    assert.equal(program.messages[0].text, "Liste bereit");
    assert.equal(program.readOnly, true);
    assert.match(program.error ?? "", /TypeScript/);
  }
  const markup = renderToStaticMarkup(createElement(ChatMessages, { messages: snapshot.messages, detailMode: "compact" }));
  assert.match(markup, /data-kind="thinking"/);
  assert.match(markup, /actor_list/);
  assert.doesNotMatch(markup, /Liste bereit/);
});

test("bound mini-app chats retain script history without a composer and keep LLM chat writable", () => {
  const script = actor("program", "word-game", "script");
  const context = session({ runView: { ...view, primaryActorId: script.id, actors: [...view.actors, script] },
    messages: [{ key: "program-output", role: "assistant", text: "Spiel abgeschlossen" }],
  });
  const appGlobal = globalThis as typeof globalThis & { __ragentsAppContext?: { chat: ChatConnection } };
  const previous = appGlobal.__ragentsAppContext;
  try {
    appGlobal.__ragentsAppContext = { chat: {
      read: (target) => chatSnapshotOf(context, target), subscribe: () => () => {}, send: async () => {},
    } };
    const program = renderToStaticMarkup(createElement(AppChat, { actor: "primary", showInput: true }));
    assert.match(program, /Spiel abgeschlossen/);
    assert.match(program, /TypeScript/);
    assert.doesNotMatch(program, /textarea|Dateien anhängen/);
    const llm = renderToStaticMarkup(createElement(AppChat, { actor: "@reviewer" }));
    assert.match(llm, /textarea/);
    assert.match(llm, /Dateien anhängen/);
  } finally {
    if (previous === undefined) delete appGlobal.__ragentsAppContext;
    else appGlobal.__ragentsAppContext = previous;
  }
});


test("actor chats render show_document through the registered document presenter", () => {
  const message: Message = {
    key: "document-call", role: "tool", text: "show_document", closed: true,
    tool: { id: "document-call", name: "show_document", arguments: JSON.stringify({ title: "Prüfbericht", content: "Zeile eins\nZeile zwei", format: "markdown" }), result: "Dem Benutzer angezeigt: Prüfbericht" },
  };
  const current = session({ messages: [message] });
  const navigation: SessionNavigation = { activeTabId: "documents", openTab: () => {}, revealEntity: () => false, selectionFor: () => "document-call" };
  const registry = new PluginRegistry({
    brand: { title: "Test" }, product: { id: "test", title: "Test" }, startEntries: [],
    plugins: [{ id: "documents", toolPresenters: [{ toolName: "show_document", Inline: (props) => {
      assert.equal(props.session, current);
      assert.equal(props.navigation, navigation);
      const document = documentsFrom([{ ...message, tool: props.tool }])[0];
      return createElement(DocumentToolCall, { document, active: true, status: "ready", onOpen: () => {} });
    } }] }],
  });
  for (const actor of [primary, worker]) for (const presentation of ["canvas", "inspector"] as const) {
    const html = renderToStaticMarkup(createElement(ChatStepsProvider, {
      policy: { ...defaultChatDisplayPolicy, modes: { coordinator: "chips", agents: "chips" }, selectable: false },
    }, createElement(PluginSessionProviders, { registry, session: current, navigation },
      createElement(ActorChat, { actor, view, presentation, primaryMessages: [message], conversation: [message], onNavigate: () => {} }))));
    assert.match(html, /aria-pressed="true"/);
    assert.match(html, /Prüfbericht/);
    assert.match(html, /Markdown, 2 Zeilen/);
    assert.match(html, /Geöffnet/);
  }
});


test("document navigation includes worker histories without duplicating the primary conversation", () => {
  const documentMessage = (id: string, title: string, source: object): Message => ({
    key: id, role: "tool", text: "show_document", tool: { id, name: "show_document", arguments: JSON.stringify({ title, ...source }) },
  });
  const main = documentMessage("main-document", "Hauptbericht", { content: "Bericht" });
  const completed = { ...main, tool: { ...main.tool!, result: "Dem Benutzer angezeigt" } };
  const worker = documentMessage("worker-document", "Prüfung", { content: "Geprüft" });
  const file = documentMessage("worker-file", "Datei", { path: "ergebnis.md" });
  const messages = documentMessagesFrom([completed], { primary: [main], worker: [worker, file, { key: "answer", role: "assistant", text: "Fertig" }] });
  assert.deepEqual(messages.map((message) => message.tool?.id), ["main-document", "worker-document", "worker-file"]);
  assert.equal(messages[0], completed);
  assert.deepEqual(documentsFrom(messages).map((document) => document.title), ["Hauptbericht", "Prüfung"]);
  assert.equal(JSON.parse(messages[2].tool!.arguments).path, "ergebnis.md");
});


for (const mode of ["free", "tiled"] as const) {
  test(`canvas chat input can be hidden per actor in ${mode} mode without changing the inspector`, () => {
    const current: RunView = { ...view, pluginStates: [{ pluginId: "ragents.orchestration", scope: { kind: "run" }, updatedAt: "now",
      state: { mode, root: { entity: `@${worker.handle}` }, nodes: [{ entity: `@${worker.handle}`, chatInput: false }], shapes: [], lines: [] } }] };
    const props = { actor: worker, view: current, onNavigate: () => {} };
    const element = mode === "free" ? createElement(ActorChatPreview, props) : createElement(ActorTile, {
      actor: worker, view: current, cardSections: [], session: session(), navigation: {} as SessionNavigation, onSelect: () => {},
    });
    const html = renderToStaticMarkup(element);
    assert.match(html, /Prüfe den Text/);
    assert.match(html, /Geprüft/);
    assert.doesNotMatch(html, /data-chat="composer"|<textarea|Dateien anhängen/);
    const other = renderToStaticMarkup(createElement(ActorChatPreview, { ...props, actor: primary }));
    assert.match(other, /<textarea/);
    const inspector = renderToStaticMarkup(createElement(ActorChatControls, { actor: worker, view: current, presentation: "inspector" }));
    assert.match(inspector, /<textarea/);
    const enabled = { ...current, pluginStates: [{ ...current.pluginStates[0], state: {
      mode, root: { entity: `@${worker.handle}` }, nodes: [{ entity: `@${worker.handle}`, chatInput: true }], shapes: [], lines: [],
    } }] };
    assert.match(renderToStaticMarkup(createElement(ActorChatPreview, { ...props, view: enabled })), /<textarea/);
  });
}
