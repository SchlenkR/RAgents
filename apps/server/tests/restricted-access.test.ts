import assert from "node:assert/strict";
import test from "node:test";
import { createAccessContext, emptyUsage, PluginHost, unrestrictedAccess, type AccessContext, type PluginState, type RunView } from "@ragents/engine";
import { coreContracts } from "../src/api/contracts.ts";
import { coreMethods } from "../src/api/core-methods.ts";
import { accessibleActorConversations, accessibleChatEvent as projectedChatEvent, accessibleRunView as projectedRunView } from "../src/access-projection.ts";
import { productStartOptions } from "../src/plugin-support/product-start-options.ts";
import { actorProgramAccessProjections } from "../../../plugins/ragents.actor-programs/server/access-projections.ts";
import { applyEvent, type ChatEvent, type Message } from "quassel/events";
import { coreSources, startRpcServer } from "./rpc-fixture.ts";

const operator = createAccessContext({ enabled: false, user: {
  id: "operator", label: "Operator", rights: ["runs.read", "runs.write"], startEntries: ["example.allowed"],
} });

/** Like a profile with product and actor programs: model and system prompt require runs.inspect, the programs bring their projection. */
const profileHost = (): PluginHost => {
  const host = new PluginHost({ product: { id: "test", title: "Test" }, dataDirectory: "/private/tmp/ragents-access-tests" });
  host.register({ manifest: { id: "test.product" }, register: (registration) => registration.startOptions(...productStartOptions({
    modelChoice: { options: ["hidden-model"], defaultModel: "hidden-model", provider: "hidden-provider", selectable: true, thinkingOptionsFor: () => ["off"] },
    coordinatorThinking: "off",
    systemPrompts: () => ({ mode: "selectable", options: [{ id: "general", label: "General", file: "general.md", text: "hidden-prompt" }], defaultIds: ["general"], shareDefault: false }),
  })) });
  host.register({ manifest: { id: "test.programs" }, register: (registration) => registration.accessProjections(...actorProgramAccessProjections) });
  return host;
};

const projections = profileHost().accessProjections;
const accessibleRunView = (view: RunView, access: AccessContext): RunView => projectedRunView(view, access, projections);
const accessibleChatEvent = (event: ChatEvent, access: AccessContext): ChatEvent | undefined => projectedChatEvent(event, access, projections);

test("startup status retains preparation but exposes failure details only with inspection rights", () => {
  const preparing: ChatEvent = { kind: "status", running: false, startup: { status: "preparing", message: "Preparing UI." } };
  assert.equal(accessibleChatEvent(preparing, operator), preparing);
  const failed: ChatEvent = { kind: "status", running: false, startup: { status: "failed", message: "Private provider at /private/workspace rejected model hidden-model" } };
  assert.deepEqual(accessibleChatEvent(failed, operator), {
    kind: "status", running: false,
    startup: { status: "failed", message: "The start could not be completed. Please contact the person responsible." },
  });
  assert.equal(accessibleChatEvent(failed, unrestrictedAccess), failed);
  const idle: ChatEvent = { kind: "status", running: false };
  assert.equal(accessibleChatEvent(idle, operator), idle);
});

test("direct requests allow only released setups and messages to existing runs", async (t) => {
  const runs = new Set(["existing"]);
  const starts: string[] = [];
  const messages: string[] = [];
  const opened: string[] = [];
  const provider = {
    hasRun: (id: string) => runs.has(id),
    list: async () => [],
    delete: async () => {},
    get: async (id: string) => {
      opened.push(id);
      return {
        running: false,
        subscribe: () => () => {},
        send: (text: string) => { runs.add(id); messages.push(text); },
        sendToActor: async (_actor: string, text: string) => { messages.push(text); },
        capabilities: async () => ({ model: "private-provider/private-model", input: ["text"] }),
        start: (entry: string) => { runs.add(id); starts.push(entry); },
        stop: () => {},
      };
    },
  };
  const server = await startRpcServer(t, {
    methods: coreMethods(coreSources(provider, { settingsGuarded: () => true })),
    accessFor: (request) => request.headers["x-test-admin"] ? unrestrictedAccess : operator,
    local: false,
  });
  const denied = async (method: string, params: unknown, admin = false) => {
    const reply = await server.call(method, params, admin ? { "x-test-admin": "yes" } : {});
    return (reply.error?.data as { code?: string; status?: number } | undefined)?.status;
  };
  assert.equal(await denied(coreContracts.chat.send.id, { runId: "new", text: "Free run" }), 403);
  assert.equal(await denied(coreContracts.chat.sendToActor.id, { runId: "new", actorId: "helper", text: "Free actor" }), 403);
  assert.equal(await denied(coreContracts.chat.start.id, { runId: "new", entry: "example.other" }), 403);
  assert.deepEqual(opened, []);
  assert.equal(await denied(coreContracts.prepare.id, { runId: "new", messages: [{ role: "user", text: "Prepare" }] }), 403);
  assert.equal(await denied(coreContracts.startOptions.list.id, { runId: "new" }), 403);
  assert.equal(await denied(coreContracts.settings.read.id, {}), 403);
  assert.equal((await server.call(coreContracts.chat.start.id, { runId: "new", entry: "example.allowed", input: {} })).result, null);
  assert.equal((await server.call(coreContracts.chat.send.id, { runId: "new", text: "Continue" })).result, null);
  assert.equal((await server.call(coreContracts.chat.sendToActor.id, { runId: "existing", actorId: "helper", text: "Help" })).result, null);
  assert.equal((await server.call(coreContracts.chat.send.id, { runId: "admin-created", text: "Free run" }, { "x-test-admin": "yes" })).result, null);
  assert.deepEqual(starts, ["example.allowed"]);
  assert.deepEqual(messages, ["Continue", "Help", "Free run"]);
  assert.deepEqual((await server.call(coreContracts.chat.capabilities.id, { runId: "existing" })).result, { input: ["text"], model: "" });
});

const exampleHost = (defaultStartEntry?: string): PluginHost => {
  const host = new PluginHost({ product: { id: "test", title: "Test" }, dataDirectory: "/private/tmp/ragents-access-tests", ...(defaultStartEntry === undefined ? {} : { defaultStartEntry }) });
  host.register({ manifest: { id: "example" }, register: (registration) => {
    for (const id of ["example.allowed", "example.other"]) registration.startEntries({
      id, action: "script", title: id, description: "Setup",
      script: { handle: "setup", coordinator: false, files: [{ path: "package.json", content: '{"private":true}' }, { path: "src/server.ts", content: "export const program = {};" }], programs: [] },
    });
    registration.startEntries({ id: "example.skill", action: "skill", title: "Skill", description: "Skill", category: "Examples", skill: "example-skill", prompt: "A free task" });
  } });
  return host;
};

test("bootstrap delivers only allowed scripts to restricted users", () => {
  const host = exampleHost();
  assert.deepEqual(host.publicProfile(operator).startEntries.map((entry) => entry.id), ["example.allowed"]);
  assert.equal(host.publicProfile(unrestrictedAccess).startEntries.length, 3);
  assert.equal("defaultStartEntry" in host.publicProfile(unrestrictedAccess), false);
});

test("besides the profile, the bootstrap names the RAgents version of the server, against which a UI checks its own", async (t) => {
  const host = exampleHost();
  const server = await startRpcServer(t, { methods: coreMethods(coreSources({}, { plugins: host, version: "0.1.8" })), accessFor: () => operator, local: false });
  const reply = await server.call(coreContracts.plugins.bootstrap.id, {});
  assert.deepEqual(reply.result, { ...host.publicProfile(operator), version: "0.1.8" });
});

test("the default template appears in the bootstrap only if the user may start it; an unknown one breaks the start", () => {
  assert.equal(exampleHost("example.allowed").publicProfile(operator).defaultStartEntry, "example.allowed");
  assert.equal(exampleHost("example.allowed").publicProfile(unrestrictedAccess).defaultStartEntry, "example.allowed");
  const withheld = exampleHost("example.other").publicProfile(operator);
  assert.equal("defaultStartEntry" in withheld, false, "without release the default is missing, the templates stay");
  assert.deepEqual(withheld.startEntries.map((entry) => entry.id), ["example.allowed"]);
  assert.equal(exampleHost("example.other").publicProfile(unrestrictedAccess).defaultStartEntry, "example.other");
  assert.throws(() => exampleHost("example.missing").seal(), /defaultStartEntry example\.missing is not a registered template; registered are example\.allowed, example\.other, example\.skill/);
  assert.throws(() => new PluginHost({ product: { id: "test", title: "Test" }, dataDirectory: "/private/tmp/ragents-access-tests", defaultStartEntry: "example.missing" }).seal(), /no plugin of this profile registers templates/);
});

test("surface projection keeps views and domain state without models, prompts or programs", () => {
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
  assert.equal(accessibleChatEvent({ kind: "plugin", pluginId: "ragents.model", type: "state-replaced", payload: { model: "hidden-model" } }, operator), undefined);
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

test("runs.trace shows thinking and tool steps with content, but still hides technical startup errors", () => {
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

const stateEntry = (pluginId: string, state: PluginState["state"], scope: PluginState["scope"] = { kind: "run" }): PluginState =>
  ({ pluginId, scope, state, updatedAt: "2026-09-29T10:00:00.000Z" });

test("without runs.inspect every plugin projects its own states; without a projection and without rights of a start option the state stays as it is", () => {
  const program = stateEntry("ragents.actor-programs", { version: 1, program: {
    name: "board", title: "Board", actorId: "helper", actorHandle: "helper", revision: "r1", directory: "hidden-directory", backendFile: "hidden-source",
    functions: [{ id: "hidden-function" }], views: [{ id: "board", key: "main", title: "Board", visible: true, placements: [], html: "hidden-html", clientFile: "hidden-client" }],
  } }, { kind: "actor", actorId: "helper" });
  assert.deepEqual(projections.state(program, operator), { ...program, state: { version: 1, program: {
    name: "board", title: "Board", actorId: "helper", actorHandle: "helper", revision: "r1", views: [{ id: "board", key: "main", title: "Board", visible: true, placements: [] }],
  } } });
  const empty = stateEntry("ragents.actor-programs", { version: 1, program: null }, { kind: "actor", actorId: "helper" });
  assert.equal(projections.state(empty, operator)?.state, empty.state);
  const invocations = stateEntry("ragents.actor-programs.invocations", { version: 1, invocations: [{ input: "hidden-input" }] }, { kind: "actor", actorId: "helper" });
  assert.deepEqual(projections.state(invocations, operator), { ...invocations, state: { version: 1, revision: invocations.updatedAt } });
  for (const pluginId of ["ragents.model", "ragents.system-prompt"]) assert.equal(projections.state(stateEntry(pluginId, { value: "hidden" }), operator), undefined, pluginId);
  for (const kept of [
    stateEntry("ragents.actor-programs.script", { version: 1, entryId: "example.setup" }),
    stateEntry("ragents.actor-state", { progress: 2 }, { kind: "actor", actorId: "helper" }),
    stateEntry("acme.binding", { machine: "server", folder: "fresh" }),
  ]) assert.equal(projections.state(kept, operator), kept, kept.pluginId);
  for (const entry of [program, invocations, stateEntry("ragents.model", { model: "visible-model" })]) assert.equal(projections.state(entry, unrestrictedAccess), entry);
});

test("chat events for plugin states follow the same projection: programs and start options with rights are missing without runs.inspect, others stay", () => {
  const event = (pluginId: string): ChatEvent => ({ kind: "plugin", pluginId, type: "state-replaced", payload: { scope: { kind: "run" }, state: { value: "hidden" } }, at: "now" });
  for (const pluginId of ["ragents.actor-programs", "ragents.actor-programs.invocations", "ragents.model", "ragents.system-prompt"]) {
    const hidden = event(pluginId);
    assert.equal(accessibleChatEvent(hidden, operator), undefined, pluginId);
    assert.equal(accessibleChatEvent(hidden, unrestrictedAccess), hidden, pluginId);
  }
  for (const pluginId of ["ragents.actor-programs.script", "ragents.actor-state", "acme.binding"]) {
    const kept = event(pluginId);
    assert.equal(accessibleChatEvent(kept, operator), kept, pluginId);
  }
});

test("the server knows no projection of a plugin: without its contribution even restricted access sees the whole program state", () => {
  const bare = new PluginHost({ product: { id: "test", title: "Test" }, dataDirectory: "/private/tmp/ragents-access-tests" }).accessProjections;
  const program = stateEntry("ragents.actor-programs", { version: 1, program: { name: "board", directory: "visible-directory" } });
  assert.equal(bare.state(program, operator), program);
  const event: ChatEvent = { kind: "plugin", pluginId: "ragents.actor-programs", type: "state-replaced", payload: { state: program.state } };
  assert.equal(projectedChatEvent(event, operator, bare), event);
});
