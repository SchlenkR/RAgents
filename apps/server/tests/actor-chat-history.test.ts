import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import type { IncomingMessage, ServerResponse } from "node:http";
import test from "node:test";
import { createAccessContext, DomainError, Journal, LiveBus, Orchestration } from "@aicontainer/ragents";
import { manualExecution } from "../../../packages/ragents/src/domain/driver.ts";
import { project, viewOf } from "../../../packages/ragents/src/domain/projection.ts";
import { allGrants, testServices } from "../../../packages/ragents/tests/support.ts";
import type { ChatSessionLike } from "../src/chat-handler.ts";
import { attachmentContentPath, coreContracts } from "../src/api/contracts.ts";
import { coreMethods } from "../src/api/core-methods.ts";
import { coreSources, methodContext } from "./rpc-fixture.ts";
import { actorChatHistoryOf } from "../src/ragents/actor-chat-history.ts";
import { chatHistoryOf } from "../src/ragents/chat-projection.ts";
import { applyEvent, type Message } from "../src/chat-events.ts";
import type { Engine } from "../src/ragents/engine.ts";
import { RunChatSession } from "../src/ragents/session.ts";
import { unavailableActorPrograms } from "./actor-programs-fixture.ts";
import { accessibleActorConversations, accessibleRunView } from "../src/access-projection.ts";

function fixture() {
  const services = testServices();
  const journal = new Journal(":memory:", services);
  const runtime = new Orchestration(journal, services);
  const initial = runtime.createRun({ commandId: "create" }, { runId: "actor-history", title: "History", ownerHandle: "human", ownerDisplayName: "Human" });
  const { id, ownerId } = initial;
  const context = (actorId = ownerId, turnId?: string) => ({ actorId, commandId: services.newId("command"), ...(turnId ? { turnId } : {}) });
  const spawn = (handle: string) => runtime.spawnAgent(context(), id, {
    handle, displayName: handle, prompt: "", execution: manualExecution(), grants: allGrants(), toolNames: [],
  }).actors.find((actor) => actor.handle === handle)!;
  const coordinator = spawn("coordinator");
  const reviewer = spawn("reviewer");
  const script = runtime.createScriptActor(context(), id, { handle: "notizliste", displayName: "Notizliste", grants: [], toolNames: [] }).actors.find((actor) => actor.kind === "script")!;
  runtime.selectPrimaryActor(context(), id, coordinator.id);
  const input = (actorId: string, text: string, from = ownerId, turnId?: string, artifactIds: string[] = []) => runtime.enqueueInput(context(from, turnId), id, { actorId, content: text, artifactIds }).inputs.at(-1)!;
  const start = (actorId: string, text: string) => {
    const queued = input(actorId, text);
    return runtime.startTurn(context(actorId), id, actorId, queued.id).turns.at(-1)!.id;
  };
  const tool = (actorId: string, turnId: string, text: string) => runtime.startToolCall(context(actorId, turnId), id, actorId, { turnId, toolCallId: "same-id", name: "read", input: { path: text } });
  const complete = (actorId: string, turnId: string, text: string) => runtime.completeToolCall(context(actorId, turnId), id, actorId, { turnId, toolCallId: "same-id", name: "read", output: { text } });
  const finish = (actorId: string, turnId: string) => runtime.finishTurn(context(actorId, turnId), id, actorId, { turnId, outcome: "completed" });
  const history = () => actorChatHistoryOf(runtime.view(id), runtime.events(id));
  const primaryHistory = (primaryActorId: string) => {
    const view = runtime.view(id);
    const events = runtime.events(id);
    return chatHistoryOf(events, {
      conversationId: events[0].eventId,
      primaryActorId,
      ownerId,
      labelOf: (actorId) => view.actors.find((actor) => actor.id === actorId)?.displayName,
      actionKindOf: (actionId) => view.actions.find((action) => action.id === actionId)?.kind,
    }).reduce(applyEvent, [] as Message[]);
  };
  const session = (runId = id) => new RunChatSession({
    engine: { journal, runtime, live: new LiveBus(), scheduler: { isRunning: () => false } } as unknown as Engine,
    id: runId, coordinator: { handle: "coordinator", displayName: "Coordinator", profile: "coordinator", runTitle: "History", ownerHandle: "human", ownerDisplayName: "Human" },
    prompt: () => "", assertUsable: () => {}, prepare: async () => {}, prepareWorkspace: async () => {}, scriptEntryFor: () => undefined, actorPrograms: unavailableActorPrograms,
  });
  return { journal, runtime, id, ownerId, context, coordinator, reviewer, script, input, start, tool, complete, finish, history, primaryHistory, session };
}

test("actor histories survive a primary switch mid-tool, parallel actors, reused call ids and fresh replay", () => {
  const f = fixture();
  try {
    const a = f.coordinator.id, b = f.reviewer.id;
    const first = f.start(a, "Erster Auftrag");
    f.runtime.appendModelReasoning(f.context(a, first), f.id, a, { turnId: first, text: "Ich prüfe die Notizen." });
    assert.equal(f.history().actors[a].at(-1)?.closed, true);
    f.tool(a, first, "first.txt");
    const other = f.start(b, "Andere Aufgabe");
    f.tool(b, other, "other.txt");
    const before = f.history();
    f.runtime.selectPrimaryActor(f.context(), f.id, f.script.id);
    assert.deepEqual(f.history().actors[a], before.actors[a]);
    f.complete(a, first, "Erstes Ergebnis");
    f.runtime.failToolCall(f.context(b, other), f.id, b, { turnId: other, toolCallId: "same-id", name: "read", error: "Fremder Fehler" });
    f.runtime.appendModelOutput(f.context(a, first), f.id, a, { turnId: first, text: "Antwort eins" });
    f.finish(a, first);
    const second = f.start(a, "Zweiter Auftrag");
    f.tool(a, second, "second.txt");
    f.complete(a, second, "Zweites Ergebnis");
    f.finish(a, second);
    const result = f.history();
    assert.deepEqual(result.actors[a].map((message) => message.role), ["user", "thinking", "tool", "assistant", "user", "tool"]);
    const calls = result.actors[a].filter((message) => message.tool);
    assert.deepEqual(calls.map((message) => JSON.parse(message.tool!.result!).text), ["Erstes Ergebnis", "Zweites Ergebnis"]);
    assert.deepEqual(calls.map((message) => JSON.parse(message.tool!.arguments).path), ["first.txt", "second.txt"]);
    assert.notEqual(calls[0].tool!.id, calls[1].tool!.id);
    assert.equal(result.actors[b].find((message) => message.tool)?.tool?.result, "Fremder Fehler");
    assert.equal(result.actors[b].find((message) => message.tool)?.tool?.isError, true);
    assert.deepEqual(result.actors[f.script.id], []);
    assert.equal(result.actors[f.ownerId], undefined);
    assert.ok(result.actors[a].every((message) => message.sender === (message.role === "user" ? f.ownerId : a)));
    const replay = project(f.runtime.events(f.id));
    assert.ok(replay);
    assert.deepEqual(actorChatHistoryOf(viewOf(replay), f.runtime.events(f.id)), result);
    assert.deepEqual(f.session().actorConversations(), result);
    assert.equal(result.revision, f.runtime.view(f.id).revision);
  } finally { f.journal.close(); }
});

test("primary and actor journals share text and tool payloads while keeping actor tool identities and interrupted results", () => {
  const f = fixture();
  try {
    const actor = f.coordinator.id;
    const first = f.start(actor, "Erster Auftrag");
    f.runtime.appendModelReasoning(f.context(actor, first), f.id, actor, { turnId: first, text: "Erster Gedanke." });
    f.runtime.appendModelReasoning(f.context(actor, first), f.id, actor, { turnId: first, text: "Zweiter Gedanke." });
    f.runtime.startToolCall(f.context(actor, first), f.id, actor, { turnId: first, toolCallId: "same-id", name: "read", input: null });
    f.complete(actor, first, "Ergebnis");
    f.runtime.appendModelOutput(f.context(actor, first), f.id, actor, { turnId: first, text: "Die Antwort." });
    f.finish(actor, first);
    const second = f.start(actor, "Zweiter Auftrag");
    f.tool(actor, second, "second.txt");
    f.runtime.stopActor(f.context(), f.id, actor, "Unterbrochen");
    const primary = f.primaryHistory(actor);
    const actorMessages = f.history().actors[actor];
    const primaryTools = primary.flatMap((message) => message.tool ? [message.tool] : []);
    const actorTools = actorMessages.flatMap((message) => message.tool ? [message.tool] : []);
    assert.deepEqual(primaryTools.map((tool) => tool.id), ["same-id", "same-id"]);
    assert.deepEqual(actorTools.map((tool) => tool.id), [JSON.stringify([first, "same-id"]), JSON.stringify([second, "same-id"])]);
    assert.equal(primaryTools[0].arguments, "null");
    assert.equal(actorTools[0].arguments, primaryTools[0].arguments);
    assert.equal(actorTools[0].result, primaryTools[0].result);
    assert.equal(primaryTools[1].result, undefined);
    assert.equal(actorTools[1].result, "Unterbrochen");
    assert.equal(actorTools[1].isError, true);
    assert.equal(primary.filter((message) => message.role === "thinking").length, 1);
    assert.equal(actorMessages.filter((message) => message.role === "thinking").length, 2);
    const primaryText = primary.find((message) => message.role === "assistant")!;
    const actorText = actorMessages.find((message) => message.role === "assistant")!;
    assert.equal(primaryText.text, actorText.text);
    assert.deepEqual(primaryText.textCursor, actorText.textCursor);
    assert.deepEqual(primary.filter((message) => message.role === "system").map((message) => message.text), ["Unterbrochen"]);
    assert.deepEqual(actorMessages.filter((message) => message.role === "system").map((message) => message.text), ["Unterbrochen", "Unterbrochen"]);
    assert.ok(primary.at(-1)?.closed && actorMessages.at(-1)?.closed);
  } finally { f.journal.close(); }
});

test("background prompts stay out of primary and actor chats while normal messages and resulting answers remain", () => {
  const f = fixture();
  try {
    const actor = f.coordinator.id;
    const first = f.start(actor, "Wie läuft die Umsetzung?");
    f.runtime.appendModelOutput(f.context(actor, first), f.id, actor, { turnId: first, text: "Ich prüfe den Fortschritt." });
    f.finish(actor, first);
    const queued = f.runtime.enqueueInput(f.context(), f.id, {
      actorId: actor, content: "Interner Prüfauftrag", presentation: "background",
    }).inputs.at(-1)!;
    const turn = f.runtime.startTurn(f.context(actor), f.id, actor, queued.id).turns.at(-1)!.id;
    f.runtime.appendModelOutput(f.context(actor, turn), f.id, actor, { turnId: turn, text: "Die Implementierung läuft weiter." });
    f.finish(actor, turn);
    const expected = ["Wie läuft die Umsetzung?", "Ich prüfe den Fortschritt.", "Die Implementierung läuft weiter."];
    assert.deepEqual(f.primaryHistory(actor).map((message) => message.text), expected);
    assert.deepEqual(f.history().actors[actor].map((message) => message.text), expected);
    assert.deepEqual(f.history().actors[actor].map((message) => message.role), ["user", "assistant", "assistant"]);
    const events = f.runtime.events(f.id);
    const replay = viewOf(project(events)!);
    assert.deepEqual(actorChatHistoryOf(replay, events), f.history());

    for (const rights of [["runs.read"], ["runs.read", "runs.inspect"]]) {
      const access = createAccessContext({ enabled: true, user: { id: "user", label: "User", rights } });
      assert.deepEqual(accessibleActorConversations(f.history(), access).actors[actor].map((message) => message.text), expected);
      const inputs = accessibleRunView(replay, access).inputs;
      assert.equal(inputs[0].content, "Wie läuft die Umsetzung?");
      assert.equal(inputs.find((input) => input.id === queued.id)?.content, access.can("runs.inspect") ? "Interner Prüfauftrag" : "");
    }
  } finally { f.journal.close(); }
});

for (const source of ["owner", "background", "actor"] as const) {
  test(`incoming ${source} inputs preserve the running actor response through completion and replay`, () => {
    const f = fixture();
    try {
      const actor = f.coordinator.id;
      const turn = f.start(actor, "Erster Auftrag");
      const senderTurn = source === "actor" ? f.start(f.reviewer.id, "Prüfe den Auftrag") : undefined;
      f.runtime.appendModelOutput(f.context(actor, turn), f.id, actor, { turnId: turn, text: "Hallo" });
      const before = f.history().actors[actor].at(-1)!;
      const incoming = source === "background"
        ? f.runtime.enqueueInput(f.context(), f.id, { actorId: actor, content: "Ergänzung", presentation: "background" }).inputs.at(-1)!
        : f.input(actor, "Ergänzung", source === "actor" ? f.reviewer.id : f.ownerId, senderTurn);
      assert.equal(f.history().actors[actor].find((message) => message.key === before.key)?.closed, before.closed);
      f.runtime.appendModelOutput(f.context(actor, turn), f.id, actor, { turnId: turn, text: " Welt" });
      const continued = f.history().actors[actor];
      assert.deepEqual(continued.map((message) => message.text), source === "background"
        ? ["Erster Auftrag", "HalloWelt"]
        : ["Erster Auftrag", "HalloWelt", "Ergänzung"]);
      assert.equal(continued[1].key, before.key);
      assert.equal(continued[1].sender, actor);
      assert.equal(continued[1].textCursor?.sequence, before.textCursor?.sequence);
      assert.equal(continued[1].textCursor?.offset, 9);
      if (source === "actor") assert.equal(continued[2].sender, f.reviewer.id);
      f.finish(actor, turn);
      assert.equal(f.history().actors[actor][1].closed, true);
      const next = f.runtime.startTurn(f.context(actor), f.id, actor, incoming.id).turns.at(-1)!.id;
      f.runtime.appendModelOutput(f.context(actor, next), f.id, actor, { turnId: next, text: "Neue Antwort" });
      f.finish(actor, next);
      const result = f.history();
      assert.deepEqual(result.actors[actor].filter((message) => message.sender === actor).map((message) => message.text), ["HalloWelt", "Neue Antwort"]);
      const events = f.runtime.events(f.id);
      assert.deepEqual(actorChatHistoryOf(viewOf(project(events)!), events), result);
    } finally { f.journal.close(); }
  });
}

test("shared question payloads preserve actor routing, primary asker labels and dismissal answers", () => {
  const f = fixture();
  try {
    const actor = f.reviewer.id;
    const turn = f.start(actor, "Prüfen");
    const question = f.runtime.proposeAction(f.context(actor, turn), f.id, {
      kind: "question", title: "Welche Farbe?", question: { options: ["Blau", "Rot"], multi: true },
    }).actions.at(-1)!;
    f.runtime.resolveAction(f.context(), f.id, question.id, { decision: "dismissed" });
    const primary = f.primaryHistory(f.coordinator.id).find((message) => message.role === "question")!;
    const actors = f.history().actors;
    const own = actors[actor].find((message) => message.role === "question")!;
    assert.equal(primary.text, "reviewer fragt: Welche Farbe?");
    assert.equal(own.text, "Welche Farbe?");
    assert.deepEqual(primary.question, own.question);
    assert.equal(own.question?.answer, "Der Benutzer hat die Frage verworfen.");
    assert.equal(actors[f.coordinator.id].length, 0);
  } finally { f.journal.close(); }
});

test("delivered inputs retain senders and attachments while questions and stops stay with their actor", () => {
  const f = fixture();
  try {
    const a = f.coordinator.id, b = f.reviewer.id;
    const turn = f.start(a, "Planung");
    const published = f.runtime.publishArtifact(f.context(a, turn), f.id, { title: "notes.txt", mediaType: "text/plain", content: "Notizen", previousVersionId: null });
    const artifact = published.artifacts[0];
    const deliveredInput = f.input(b, "Prüfe den Anhang", a, turn, [artifact.id]);
    const reviewerTurn = f.runtime.startTurn(f.context(b), f.id, b, deliveredInput.id).turns.at(-1)!.id;
    f.tool(b, reviewerTurn, "notes.txt");
    const question = f.runtime.proposeAction(f.context(a, turn), f.id, { kind: "question", title: "Welche Farbe?", question: { options: ["Blau", "Rot"] } }).actions[0];
    f.runtime.resolveAction(f.context(), f.id, question.id, { decision: "approved", response: "Blau" });
    f.runtime.stopActor(f.context(), f.id, b, "Prüfung gestoppt");
    const history = f.history();
    const delivered = history.actors[b].find((message) => message.text === "Prüfe den Anhang")!;
    assert.equal(delivered.sender, a);
    assert.equal(delivered.role, "assistant");
    assert.equal(delivered.bubble?.label, "Zugestellt von @coordinator");
    assert.deepEqual(delivered.attachments, [{ name: "notes.txt", mediaType: "text/plain", size: artifact.size, url: attachmentContentPath(f.id, artifact.id) }]);
    assert.equal(history.actors[a].find((message) => message.role === "question")?.question?.answer, "Blau");
    assert.ok(history.actors[b].every((message) => message.role !== "question"));
    assert.equal(history.actors[b].at(-1)?.text, "Prüfung gestoppt");
    assert.equal(history.actors[b].at(-1)?.sender, b);
    assert.equal(history.actors[b].find((message) => message.tool)?.tool?.result, "Prüfung gestoppt");
    assert.equal(history.actors[b].find((message) => message.tool)?.tool?.isError, true);
    assert.throws(() => actorChatHistoryOf({ ...f.runtime.view(f.id), actors: f.runtime.view(f.id).actors.filter((actor) => actor.id !== a) }, f.runtime.events(f.id)), /Actor.*fehlt/);
  } finally { f.journal.close(); }
});

test("actor history endpoint returns the run snapshot and preserves explicit unavailable and missing-run errors", async () => {
  const f = fixture();
  try {
    f.start(f.coordinator.id, "Gespeicherter Auftrag");
    const request = async (id: string, session: ChatSessionLike) => {
      const provider = { get: async (value: string) => { assert.equal(value, id); return session; }, list: async () => [], delete: async () => {} };
      const history = coreMethods(coreSources(provider))
        .find((entry) => entry.contract.id === coreContracts.chat.actorHistory.id)!;
      try {
        return { status: 200, body: await history.execute({ runId: id } as never, methodContext()) as { error?: string } };
      } catch (error) {
        assert.ok(error instanceof DomainError);
        return { status: error.status, body: { error: error.message } };
      }
    };
    const success = await request(f.id, f.session());
    assert.equal(success.status, 200);
    assert.deepEqual(success.body, f.history());
    const missing = await request("missing-run", f.session("missing-run"));
    assert.equal(missing.status, 404);
    assert.match(missing.body.error ?? "", /Run.*nicht vorhanden/);
    const unavailable = await request(f.id, { ...f.session(), running: false, subscribe: () => () => {}, send: () => {}, start: () => {}, stop: () => {} });
    assert.equal(unavailable.status, 404);
    assert.match(unavailable.body.error ?? "", /nicht verfügbar/);
    assert.throws(() => f.session("missing-run").actorConversations(), (error) => error instanceof DomainError && error.status === 404);
  } finally { f.journal.close(); }
});
