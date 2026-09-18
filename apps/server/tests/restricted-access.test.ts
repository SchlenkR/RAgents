import assert from "node:assert/strict";
import { createServer } from "node:http";
import test from "node:test";
import { createAccessContext, emptyUsage, PluginHost, unrestrictedAccess, type RunView } from "@aicontainer/ragents";
import { createChatHandler } from "../src/chat-handler.ts";
import { enforceHostAccess } from "../src/access-policy.ts";
import { accessibleActorConversations, accessibleChatEvent, accessibleRunView } from "../src/access-projection.ts";
import { createManagementApi } from "../../../plugins/ragents.overseer/server/http-api.ts";
import { RunDirectory } from "../../../plugins/ragents.overseer/server/run-directory.ts";
import { applyEvent, type ChatEvent, type Message } from "../src/chat-events.ts";

const operator = createAccessContext({ enabled: false, user: {
  id: "operator", label: "Operator", rights: ["runs.read", "runs.write"], startEntries: ["example.allowed"],
} });

test("startup status retains preparation but exposes failure details only with inspection rights", () => {
  const preparing: ChatEvent = { kind: "status", running: false, startup: { status: "preparing", message: "Oberfläche wird vorbereitet." } };
  assert.equal(accessibleChatEvent(preparing, operator), preparing);
  const failed: ChatEvent = { kind: "status", running: false, startup: { status: "failed", message: "Private provider at /private/workspace rejected model hidden-model" } };
  assert.deepEqual(accessibleChatEvent(failed, operator), {
    kind: "status", running: false,
    startup: { status: "failed", message: "Der Start konnte nicht abgeschlossen werden. Bitte wende Dich an den zuständigen Betreuer." },
  });
  assert.equal(accessibleChatEvent(failed, unrestrictedAccess), failed);
  const idle: ChatEvent = { kind: "status", running: false };
  assert.equal(accessibleChatEvent(idle, operator), idle);
});

test("direkte Requests erlauben nur freigegebene Setups und Nachrichten an vorhandene Runs", async () => {
  const runs = new Set(["existing"]);
  const starts: string[] = [];
  const messages: string[] = [];
  const opened: string[] = [];
  const handler = createChatHandler({ manager: {
    hasRun: (id) => runs.has(id),
    list: async () => [],
    delete: async () => {},
    get: async (id) => {
      opened.push(id);
      return {
        running: false,
        subscribe: () => () => {},
        send: (text) => { runs.add(id); messages.push(text); },
        sendToActor: async (_actor, text) => { messages.push(text); },
        capabilities: async () => ({ model: "private-provider/private-model", input: ["text"] }),
        start: (entry) => { runs.add(id); starts.push(entry); },
        stop: () => {},
      };
    },
  } });
  const host = new PluginHost({ product: { id: "test", title: "Test" }, dataDirectory: "/private/tmp/ragents-access-tests" });
  const management = createManagementApi(host, () => { throw new Error("Restricted request reached management"); }, new RunDirectory("/private/tmp/ragents-access-tests/unused-references.json"));
  const server = createServer(async (request, response) => {
    const url = new URL(request.url!, "http://localhost");
    const access = request.headers["x-test-admin"] ? unrestrictedAccess : operator;
    if (enforceHostAccess(request, response, url, access)) return;
    if (management.matches(request, url)) { await management.handle({ request, response, url, access }); return; }
    if (await handler(request, response, access)) return;
    response.writeHead(404).end();
  });
  await new Promise<void>((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const call = (route: string, body?: unknown, admin = false) => fetch(`http://127.0.0.1:${address.port}${route}`, {
    method: body === undefined ? "GET" : "POST",
    headers: { "content-type": "application/json", ...(admin ? { "x-test-admin": "yes" } : {}) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  try {
    assert.equal((await call("/chat/new/send", { text: "Free run" })).status, 403);
    assert.equal((await call("/chat/new/actors/helper/send", { text: "Free actor" })).status, 403);
    assert.equal((await call("/chat/new/start", { entry: "example.other" })).status, 403);
    assert.deepEqual(opened, []);
    assert.equal((await call("/chat/new/prepare", { text: "Prepare" })).status, 403);
    assert.equal((await call("/chat/new/options")).status, 403);
    assert.equal((await call("/ragents/api/runs/existing/events")).status, 403);
    assert.equal((await call("/api/settings")).status, 403);
    assert.equal((await call("/api/plugins/ragents.overseer/runs", { title: "Escape", message: "Create freely" })).status, 403);
    assert.equal((await call("/api/plugins/ragents.overseer/catalog")).status, 403);
    assert.equal((await call("/chat/new/start", { entry: "example.allowed", input: {} })).status, 202);
    assert.equal((await call("/chat/new/send", { text: "Continue" })).status, 202);
    assert.equal((await call("/chat/existing/actors/helper/send", { text: "Help" })).status, 202);
    assert.equal((await call("/chat/admin-created/send", { text: "Free run" }, true)).status, 202);
    assert.deepEqual(starts, ["example.allowed"]);
    assert.deepEqual(messages, ["Continue", "Help", "Free run"]);
    assert.deepEqual(await (await call("/chat/existing/capabilities")).json(), { input: ["text"], model: "" });
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test("Bootstrap liefert eingeschränkten Benutzern ausschließlich erlaubte Scripts", () => {
  const host = new PluginHost({ product: { id: "test", title: "Test" }, dataDirectory: "/private/tmp/ragents-access-tests" });
  host.register({ manifest: { id: "example" }, register: (registration) => {
    for (const id of ["example.allowed", "example.other"]) registration.startEntries({
      id, action: "script", title: id, description: "Setup",
      script: { handle: "setup", coordinator: false, files: [{ path: "package.json", content: '{"private":true}' }, { path: "src/server.ts", content: "export const program = {};" }], programs: [] },
    });
    registration.startEntries({ id: "example.skill", action: "skill", title: "Skill", description: "Skill", category: "Examples", skill: "example-skill", prompt: "A free task" });
  } });
  assert.deepEqual(host.publicProfile(operator).startEntries.map((entry) => entry.id), ["example.allowed"]);
  assert.equal(host.publicProfile(unrestrictedAccess).startEntries.length, 3);
});

test("Canvas-Projektion behält Ansichten und Fachzustand ohne Modelle, Prompts oder Programme", () => {
  const view = {
    id: "example", revision: 7, title: "Example", ownerId: "owner", primaryActorId: "helper", createdAt: "now", forkedFrom: null,
    actors: [{ id: "helper", handle: "helper", displayName: "Helper", kind: "agent", createdAt: "now", createdBy: "owner",
      execution: { driver: { kind: "agent", config: { model: "hidden-model", provider: "hidden-provider", thinking: "high" } }, workspacePath: "/private/path", turnTimeoutMs: 100 },
      lifecycle: { kind: "idle", since: "now" }, grants: [{ capability: "hidden-grant", scope: { kind: "run" }, delegable: true }],
      prompt: "hidden-prompt", toolNames: ["hidden-tool"], openedToolNames: [], usage: emptyUsage(),
    }],
    inputs: [], turns: [], subscriptions: [], actions: [], artifacts: [],
    pluginStates: [
      { pluginId: "ragents.model", scope: { kind: "run" }, state: { model: "hidden-model" }, updatedAt: "now" },
      { pluginId: "ragents.system-prompt", scope: { kind: "run" }, state: { prompt: "hidden-prompt" }, updatedAt: "now" },
      { pluginId: "ragents.actor-state", scope: { kind: "actor", actorId: "helper" }, state: { progress: 2 }, updatedAt: "now" },
      { pluginId: "ragents.actor-programs", scope: { kind: "actor", actorId: "helper" }, updatedAt: "now", state: { version: 1, program: {
        name: "helper", title: "Helper", actorId: "helper", actorHandle: "helper", revision: "revision", backendFile: "hidden-source", directory: "hidden-directory",
        functions: [{ id: "hidden-function" }], views: [{ id: "board", key: "board", title: "Board", visible: true, placements: [], html: "hidden-html" }],
      } } },
    ],
  } as RunView;
  const visible = accessibleRunView(view, operator);
  assert.equal(JSON.stringify(visible).includes("hidden-"), false);
  assert.equal(visible.actors[0].id, "helper");
  assert.equal(visible.primaryActorId, "helper");
  assert.ok(JSON.stringify(visible).includes('"progress":2'));
  assert.ok(JSON.stringify(visible).includes('"id":"board"'));
  assert.equal(accessibleRunView(view, unrestrictedAccess), view);
  assert.equal(accessibleChatEvent({ kind: "thinking", delta: "hidden-reasoning" }, operator)?.kind, "thinking");
  assert.equal(accessibleChatEvent({ kind: "tool-result", id: "tool", result: "hidden-output" }, operator)?.kind, "tool-result");
  assert.equal(accessibleChatEvent({ kind: "extension", pluginId: "ragents.model", type: "state-replaced", payload: { model: "hidden-model" } }, operator), undefined);
  const history = accessibleActorConversations({ revision: 1, actors: { helper: [
    { key: "1", role: "user", text: "Hello" },
    { key: "2", role: "assistant", sender: "builder", text: "hidden-setup-input" },
    { key: "3", role: "tool", text: "hidden-tool" },
    { key: "4", role: "assistant", sender: "helper", text: "Ready" },
  ] } }, operator);
  assert.deepEqual(history.actors.helper.map((message) => message.text), ["Hello", "", "Ready"]);
});

test("restricted streams preserve current activity transitions without technical content", () => {
  const events: ChatEvent[] = [
    { kind: "thinking", delta: "hidden-reasoning", at: "now" },
    { kind: "thinking", delta: "hidden-continuation" },
    { kind: "tool", id: "call", name: "hidden-name", arguments: "hidden-arguments", label: "hidden-source", at: "later" },
    { kind: "tool-result", id: "call", result: "hidden-error", isError: true },
    { kind: "turn-done" },
  ];
  let messages: Message[] = [];
  for (const [index, event] of events.entries()) {
    const marker = accessibleChatEvent(event, operator);
    assert.ok(marker);
    assert.equal(JSON.stringify(marker).includes("hidden-"), false);
    assert.equal(accessibleChatEvent(event, unrestrictedAccess), event);
    messages = applyEvent(messages, marker);
    if (index === 1) {
      assert.equal(messages.length, 1);
      assert.equal(messages[0].role, "thinking");
      assert.notEqual(messages[0].closed, true);
    }
    if (index === 2) {
      assert.equal(messages[0].closed, true);
      assert.equal(messages.at(-1)?.tool?.result, undefined);
    }
    if (index === 3) assert.equal(messages.at(-1)?.tool?.result, "");
  }
  assert.equal(JSON.stringify(messages).includes("hidden-"), false);
});

test("restricted actor history keeps only status fields for tool and thinking markers", () => {
  const history = { revision: 4, actors: { helper: [
    { key: "1", role: "thinking", sender: "helper", text: "hidden-thinking", closed: true,
      attachments: [{ name: "hidden-file", url: "hidden-url", size: 1, mediaType: "text/plain" }] },
    { key: "2", role: "tool", sender: "helper", text: "hidden-label", tool: { id: "done", name: "hidden-name", arguments: "hidden-input", result: "hidden-result" } },
    { key: "3", role: "tool", sender: "helper", text: "hidden-label", tool: { id: "active", name: "hidden-name", arguments: "hidden-input" } },
  ] as Message[] } };
  const visible = accessibleActorConversations(history, operator);
  assert.equal(JSON.stringify(visible).includes("hidden-"), false);
  assert.equal(visible.actors.helper[0].closed, true);
  assert.equal(visible.actors.helper[1].tool?.result, "");
  assert.equal(visible.actors.helper[2].tool?.result, undefined);
  assert.equal(accessibleActorConversations(history, unrestrictedAccess), history);
});

test("runs.trace zeigt Denk- und Werkzeugschritte mit Inhalt, verbirgt aber technische Startfehler weiterhin", () => {
  const tracer = createAccessContext({ enabled: false, user: { id: "tracer", label: "Tracer", rights: ["runs.read", "runs.write", "runs.trace"] } });
  const events: ChatEvent[] = [
    { kind: "thinking", delta: "visible-reasoning", at: "now" },
    { kind: "tool", id: "call", name: "visible-name", arguments: "visible-arguments", label: "visible-source", at: "later" },
    { kind: "tool-result", id: "call", result: "visible-result", isError: false },
  ];
  for (const event of events) assert.equal(accessibleChatEvent(event, tracer), event);
  const failed: ChatEvent = { kind: "status", running: false, startup: { status: "failed", message: "Private provider rejected model" } };
  assert.equal(JSON.stringify(accessibleChatEvent(failed, tracer)).includes("Private provider"), false);
  const history = { revision: 1, actors: { helper: [
    { key: "1", role: "thinking", sender: "helper", text: "visible-thinking", closed: true },
    { key: "2", role: "tool", sender: "helper", text: "visible-label", tool: { id: "done", name: "visible-name", arguments: "visible-input", result: "visible-result" } },
    { key: "3", role: "system", sender: "helper", text: "hidden-system" },
  ] as Message[] } };
  const visible = accessibleActorConversations(history, tracer);
  assert.deepEqual(visible.actors.helper, history.actors.helper.slice(0, 2));
});
