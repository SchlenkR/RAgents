import assert from "node:assert/strict";
import { once } from "node:events";
import { mkdir, mkdtemp, readFile, realpath, rm } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import test, { after, type TestContext } from "node:test";
import { fileURLToPath } from "node:url";
import { inspect } from "node:util";
import { fauxAssistantMessage, fauxToolCall, registerFauxProvider, type Context } from "@ragents/ai";
import { unrestrictedAccess, type JsonValue, type PluginRegistration } from "@ragents/engine";
import { EXECUTOR_CONTRIBUTION_FILE, loadExecutorContribution } from "@ragents/workspace-executor";
import { actorChatHistoryOf } from "../src/ragents/actor-chat-history.ts";
import { RpcClient } from "../../web/src/rpc/client.ts";
import { RpcDispatcher } from "../src/rpc/dispatcher.ts";
import { RpcHttpTransport } from "../src/rpc/http-transport.ts";
import { WorkspaceClient } from "../../../plugins/ragents.workspace/client/workspace-client.ts";
import { WORKSPACE_BINDING_OPTION_ID, type WorkspaceBinding } from "../../../plugins/ragents.workspace/contract.ts";
import { processExists } from "../../../packages/workspace-executor/src/managed-process.ts";
import { ACP_STATE_ID } from "../../../plugins/ragents.acp/server/driver.ts";
import type { RuntimeAskService } from "../../../plugins/ragents.ask/server/ask-service.ts";
import { askPayloadOf } from "../../../plugins/ragents.ask/ask-payload.ts";

const directory = await mkdtemp(path.join(tmpdir(), "ragents-acp-actors-"));
const adapter = path.resolve(import.meta.dirname, "fixtures/acp/agent.mjs");
const environment = { DATA_DIR: path.join(directory, "data"), PRODUCT_PROFILE: "core", PRODUCT_ID: "test-acp-actors", PRODUCT_TITLE: "ACP actors",
  PROCESS_SANDBOX: "off", COMPACTION_MODEL: "", MODEL_ALIASES: undefined, MODEL_PROVIDERS: undefined, MCP_SERVERS: undefined, ACP_AGENTS: undefined, ACCESS_TOKEN: undefined };
const previous = new Map(Object.keys(environment).map((key) => [key, process.env[key]]));
for (const [key, value] of Object.entries(environment)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
after(async () => {
  for (const [key, value] of previous) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
  await rm(directory, { recursive: true, force: true });
});
const until = async (condition: () => boolean | Promise<boolean>, label: string): Promise<void> => {
  const deadline = Date.now() + 15_000;
  while (!await condition()) {
    assert.ok(Date.now() < deadline, `Timed out waiting for ${label}`);
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
};

const fixture = async (t: TestContext, env: Record<string, string> = {}) => {
  process.env.ACP_AGENTS = JSON.stringify({ fixture: { title: "Fixture coder", command: process.execPath, args: [adapter], env: { ACP_FIXTURE_LOG: "acp-fixture.jsonl", ...env } } });
  const { RunSessionProvider } = await import("../src/provider.ts");
  const { composeProfile } = await import("../src/profile/compose.ts");
  const { registerPluginFolder } = await import("../src/plugin-support/plugins-root.ts");
  const { productRuntimeToken } = await import("../src/ragents/product-runtime.ts");
  const { runManagementToken } = await import("../src/ragents/global-chat.ts");
  const { runtimeProviderToken, runWorkspaceProviderToken } = await import("../src/ragents/host-services.ts");
  const { askServiceToken } = await import("../../../plugins/ragents.ask/server/contract.ts");
  const { plugin: workspace } = await import("../../../plugins/ragents.workspace/server/index.ts");
  const { plugin: mcp } = await import("../../../plugins/ragents.mcp/server/index.ts");
  const { plugin: ask } = await import("../../../plugins/ragents.ask/server/index.ts");
  const { plugin: acp } = await import("../../../plugins/ragents.acp/server/index.ts");
  const root = path.resolve(import.meta.dirname, "../../..");
  const contributions = await Promise.all(["ragents.mcp", "ragents.acp"].map((plugin) => loadExecutorContribution(plugin, path.join(root, "bundles", plugin, EXECUTOR_CONTRIBUTION_FILE))));
  const faux = registerFauxProvider({ models: [{ id: "coordinator-model", reasoning: false }], tokensPerSecond: 100_000 });
  const model = faux.getModel();
  const productDirectory = path.join(directory, "test.product");
  await mkdir(productDirectory, { recursive: true });
  registerPluginFolder("test.product", productDirectory);
  const product = { create: () => ({ manifest: { id: "test.product" }, register: (host: PluginRegistration) => {
    host.provide(productRuntimeToken, {
      coordinator: { handle: "coordinator", displayName: "Coordinator", profile: "coordinator", runTitle: "New run", ownerHandle: "owner", ownerDisplayName: "Owner" },
      roleFor: (view, actor) => view.primaryActorId === actor.id ? "primary" : "worker", contract: () => "", promptComposition: "test",
      systemPrompts: () => ({ mode: "fixed", options: [], defaultIds: [], shareDefault: false }),
    });
    host.profiles({ id: "test.models", models: () => [{ driver: "agent", provider: model.provider, model: model.id, label: "Coordinator model", thinking: ["off"] }],
      providers: () => [{ id: model.provider, config: { api: faux.api, baseUrl: model.baseUrl, apiKey: "fixture-only", models: faux.models } }],
      profiles: () => [{ name: "coordinator", description: "Coordinator", driver: "agent", provider: model.provider, model: model.id, thinking: "off", turnTimeoutMs: null, isolateWorkspace: false }] });
  } }) };
  const modules = new Map([["ragents.workspace", workspace], ["test.product", product], ["ragents.ask", ask], ["ragents.mcp", mcp], ["ragents.acp", acp]]);
  const createProvider = () => new RunSessionProvider((bridges) => composeProfile({ product: { id: "test-acp-actors", title: "ACP actors" }, pluginIds: [...modules.keys()], modules,
    web: new Map(), executor: contributions }, bridges), undefined);
  let provider = createProvider();
  await provider.init();
  let closeWorkstation: (() => Promise<void>) | undefined;
  t.after(async () => { try { await closeWorkstation?.(); await provider.shutdown(); } finally { faux.unregister(); } });
  const management = () => provider.plugins.service(runManagementToken)();
  const runtime = () => provider.plugins.service(runtimeProviderToken)();
  const askService = () => provider.plugins.service(askServiceToken) as RuntimeAskService;
  const contexts: Context[] = [];
  const spawn = async (binding?: WorkspaceBinding) => {
    faux.setResponses([
      (context) => {
        contexts.push({ systemPrompt: context.systemPrompt, messages: structuredClone(context.messages) });
        const tool = context.tools?.find((entry) => entry.name === "agent_spawn");
        assert.ok(tool);
        assert.match(tool.description, /acp.fixture.*Fixture coder/);
        assert.match(JSON.stringify(tool.parameters), /acp.fixture/);
        return fauxAssistantMessage([fauxToolCall("agent_spawn", { description: "Checks the project", name: "coder", instructions: "Keep changes small.", runtime: "acp.fixture", tools: null })], { stopReason: "toolUse" });
      }, fauxAssistantMessage("Coder created."),
      ...Array.from({ length: 20 }, () => fauxAssistantMessage("Recorded.")),
    ]);
    const runId = await management().create({ title: "External coder", user: null, kind: "message", message: "Create a coder.",
      ...(binding ? { options: { [WORKSPACE_BINDING_OPTION_ID]: binding as unknown as JsonValue } } : {}) });
    await until(() => { const turn = management().view(runId).turns[0]; return turn !== undefined && turn.status !== "running"; }, "coordinator spawn");
    assert.equal(management().view(runId).turns[0]?.status, "completed", JSON.stringify(management().view(runId).turns));
    const actor = management().view(runId).actors.find((entry) => entry.kind === "external");
    assert.ok(actor, JSON.stringify(management().view(runId).turns));
    return { runId, actorId: actor.id };
  };
  let inputNumber = 0;
  const deliver = (runId: string, actorId: string, content: string) => runtime().enqueueInput({ actorId: management().view(runId).ownerId, commandId: `fixture-input-${++inputNumber}` }, runId, { actorId, content });
  const finish = (runId: string, actorId: string, count: number) => until(() => {
    const turns = management().view(runId).turns.filter((turn) => turn.actorId === actorId);
    return turns.length >= count && turns.at(-1)!.status !== "running";
  }, "external turn completion");
  const log = async (runId: string): Promise<Record<string, any>[]> => (await readFile(path.join((await provider.plugins.service(runWorkspaceProviderToken)(runId)).cwd, "acp-fixture.jsonl"), "utf8")).split("\n").filter(Boolean).map((line) => JSON.parse(line));
  const restart = async () => { await provider.shutdown(); provider = createProvider(); await provider.init(); };
  const workstation = async () => {
    const requestedFolder = await mkdtemp(path.join(directory, "workstation-project-"));
    const folder = await realpath(requestedFolder);
    const transport = new RpcHttpTransport({ dispatcher: new RpcDispatcher({ methods: provider.plugins.methods, channels: provider.plugins.channels, assertRunReachable: () => undefined }) });
    const server = createServer((request, response) => {
      void transport.handle(request, response, new URL(request.url ?? "/", "http://localhost"), unrestrictedAccess, true).then((handled) => {
        if (!handled) response.writeHead(404).end();
      }).catch((cause) => response.writeHead(500).end(String(cause)));
    });
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const address = server.address();
    assert.ok(address && typeof address !== "string");
    const origin = `http://127.0.0.1:${address.port}`;
    const rpc = new RpcClient({ baseUrl: origin });
    const client = new WorkspaceClient({ origin, rpc }, { id: "fixture-workstation", label: "Fixture workstation", hostname: "fixture-machine",
      platform: process.platform, folders: [folder], runsDirectory: path.join(directory, "workstation-runs") }, { hostRoot: () => root });
    closeWorkstation = async () => {
      try { await client.unregister(); }
      finally { rpc.close(); transport.close(); server.closeAllConnections(); await new Promise<void>((resolve) => server.close(() => resolve())); }
    };
    await client.register();
    assert.equal(client.status.kind, "registered", JSON.stringify(client.status));
    return { binding: client.binding(folder), folder, client };
  };
  return { provider: () => provider, management, runtime, askService, spawn, deliver, finish, log, contexts, restart, workstation };
};

test("a composed server spawns an external coder, journals streaming, tools and plans, and answers its permission card", { timeout: 30_000 }, async (t) => {
  const host = await fixture(t);
  const { runId, actorId } = await host.spawn();
  await (await host.provider().get(runId)).sendToActor!(actorId, "First task");
  await until(() => { const view = host.management().view(runId); return view.actions.some((action) => action.status === "pending") || view.turns.some((turn) => turn.actorId === actorId && turn.status === "failed"); }, "permission card");
  const action = host.management().view(runId).actions.find((entry) => entry.status === "pending")!;
  assert.ok(action, JSON.stringify(host.management().view(runId).turns));
  const permission = askPayloadOf(action.payload);
  assert.doesNotMatch(JSON.stringify(permission), /opaque-allow-option|opaque-reject-option|opaque-tool-call/);
  const start = host.management().events(runId).find((event) => event.actorId === actorId && event.type === "tool.call.started");
  assert.ok(start?.type === "tool.call.started");
  assert.deepEqual(start.payload.input, { title: "May the external agent update the file?", arguments: { path: "result.txt", content: "first\nsecond\nthird\n" } });
  host.askService().answer(runId, action.id, { answers: [{ selected: [permission.questions[0]!.options[0]!.label] }] });
  await host.finish(runId, actorId, 1);
  const view = host.management().view(runId);
  const events = host.management().events(runId).filter((event) => event.actorId === actorId);
  assert.deepEqual(events.filter((event) => event.type === "model.output.completed").map((event) => event.payload.text), ["First response.", "Final response"]);
  assert.match(JSON.stringify(events), /Inspecting the workspace/);
  assert.equal(events.some((event) => event.type === "model.step.completed"), false);
  assert.deepEqual(events.filter((event) => event.type.startsWith("tool.call.")).map((event) => event.type), ["tool.call.started", "tool.call.completed"]);
  assert.match(JSON.stringify(events), /Plan:.*Report the change/);
  assert.doesNotMatch(JSON.stringify(events.filter((event) => event.type !== "plugin.state.replaced")), /opaque-tool-call|opaque-allow-option/);
  const history = actorChatHistoryOf(view, host.management().events(runId)).actors[actorId]!;
  assert.match(JSON.stringify(history), /First response|Final response|Plan:|fixture_write|Inspecting/);
  const turn = view.turns.find((entry) => entry.actorId === actorId)!;
  assert.equal(turn.status, "completed", turn.failure ?? "");
  assert.deepEqual(turn.usage, { inputTokens: 10, outputTokens: 5, cacheReadTokens: 2, cacheWriteTokens: 1, costUsd: 0.05 });
  const stored = host.runtime().view(runId).pluginStates.find((entry) => entry.pluginId === ACP_STATE_ID)!;
  assert.equal(stored.scope.kind, "actor");
  assert.doesNotMatch(JSON.stringify(host.provider().runView(runId)), /sessionId/);
  assert.doesNotMatch(JSON.stringify(host.management().events(runId)), /sessionId/);
  assert.doesNotMatch(JSON.stringify(host.contexts), /sessionId|opaque-tool-call|opaque-allow-option/);
  const log = await host.log(runId);
  assert.equal(log.find((entry) => entry.type === "terminal-output")?.output.output, "Terminal output");
  await host.management().stop(runId).catch((cause) => { throw new Error(inspect(cause, { depth: 6 })); });
});

test("an external turn failure retains ACP internal error details", { timeout: 30_000 }, async (t) => {
  const host = await fixture(t);
  const { runId, actorId } = await host.spawn();
  host.deliver(runId, actorId, "fail with details");
  await host.finish(runId, actorId, 1);
  const turn = host.management().view(runId).turns.find((entry) => entry.actorId === actorId)!;
  assert.equal(turn.status, "failed");
  assert.match(turn.reason ?? "", /Internal error.*Claude Code process exited with code 1.*EPERM.*\/tmp\/claude-1000/);
  await host.management().stop(runId);
});

test("streamed ACP tool input reaches the journal once with its final title and arguments", { timeout: 30_000 }, async (t) => {
  const host = await fixture(t);
  const { runId, actorId } = await host.spawn();
  host.deliver(runId, actorId, "stream tool input");
  await host.finish(runId, actorId, 1);
  const turn = host.management().view(runId).turns.find((entry) => entry.actorId === actorId)!;
  assert.equal(turn.status, "completed", turn.reason ?? "");
  const events = host.management().events(runId).filter((event) => event.actorId === actorId && event.type.startsWith("tool.call."));
  assert.deepEqual(events.map((event) => event.type), ["tool.call.started", "tool.call.completed"]);
  const start = events[0]!;
  assert.ok(start.type === "tool.call.started");
  assert.equal(start.payload.name, "Bash");
  assert.deepEqual(start.payload.input, { title: "Print readiness", arguments: { command: "printf 'ready\\n'", description: "Print readiness", timeout: 1000 } });
  assert.doesNotMatch(JSON.stringify(events), /Terminal|streamed-tool/);
  await host.management().stop(runId);
});

for (const status of ["pending", "running"] as const) {
  test(`an external turn closes a tool left ${status} with its last input`, { timeout: 30_000 }, async (t) => {
    const host = await fixture(t);
    const { runId, actorId } = await host.spawn();
    host.deliver(runId, actorId, `leave tool ${status}`);
    await host.finish(runId, actorId, 1);
    const turn = host.management().view(runId).turns.find((entry) => entry.actorId === actorId)!;
    assert.equal(turn.status, "completed", turn.reason ?? "");
    assert.deepEqual(turn.toolCalls.map((call) => call.status), ["failed"]);
    const events = host.management().events(runId).filter((event) => event.actorId === actorId && event.type.startsWith("tool.call."));
    assert.deepEqual(events.map((event) => event.type), ["tool.call.started", "tool.call.failed"]);
    const start = events[0]!;
    assert.ok(start.type === "tool.call.started");
    assert.deepEqual(start.payload.input, { title: "Print readiness", arguments: { command: "printf 'ready\\n'", description: "Print readiness", timeout: 1000 } });
    await host.management().stop(runId);
  });
}

test("external cancellation journals partial text and a server restart loads its session without duplicating replay", { timeout: 30_000 }, async (t) => {
  const host = await fixture(t);
  const { runId, actorId } = await host.spawn();
  host.deliver(runId, actorId, "wait for cancellation");
  await until(async () => { try { return (await host.log(runId)).some((entry) => entry.type === "partial-sent"); } catch { return false; } }, "partial response sent");
  const turn = host.management().view(runId).turns.find((entry) => entry.actorId === actorId)!;
  await host.provider().engineMethods().find(({ contract }) => contract.id === "ragents.runs.interruptTurn")!.execute(
    { runId, actorId, commandId: "cancel", reason: "User cancelled" } as never, { access: unrestrictedAccess } as never);
  await host.finish(runId, actorId, 1);
  assert.ok((await host.log(runId)).some((entry) => entry.type === "cancel"));
  assert.ok(host.management().events(runId).some((event) => event.type === "model.output.interrupted" && event.payload.text === "Partial response"));
  assert.equal(host.management().view(runId).turns.find((entry) => entry.id === turn.id)?.status, "interrupted");
  await host.restart();
  host.deliver(runId, actorId, "second task");
  await host.finish(runId, actorId, 2);
  assert.ok((await host.log(runId)).some((entry) => entry.type === "load"));
  const history = JSON.stringify(actorChatHistoryOf(host.management().view(runId), host.management().events(runId)).actors[actorId]);
  assert.match(history, /Second response/);
  assert.doesNotMatch(history, /Replayed response|Replayed plan/);
  await host.management().stop(runId);
});

test("an external actor without loadSession stops with a visible cause after restart", { timeout: 30_000 }, async (t) => {
  const host = await fixture(t, { ACP_FIXTURE_LOAD: "off" });
  const { runId, actorId } = await host.spawn();
  host.deliver(runId, actorId, "second task");
  await host.finish(runId, actorId, 1);
  await host.restart();
  host.deliver(runId, actorId, "second task");
  await until(() => host.management().view(runId).actors.find((entry) => entry.id === actorId)?.lifecycle.kind === "stopped", "blocked actor");
  const events = host.management().events(runId);
  assert.match(JSON.stringify(events.filter((event) => event.type === "actor.stopped" || event.type === "turn.finished")), /loadSession.*cannot be restored/);
  await host.management().stop(runId);
});

test("a workstation carries ACP prompt progress and permission answers and cleans up its adapter and terminals on actor stop", { timeout: 30_000 }, async (t) => {
  const host = await fixture(t);
  const remote = await host.workstation();
  const { runId, actorId } = await host.spawn(remote.binding);
  host.deliver(runId, actorId, "First task");
  await until(() => host.management().view(runId).actions.some((entry) => entry.status === "pending"), "remote permission");
  const action = host.management().view(runId).actions.find((entry) => entry.status === "pending")!;
  const question = askPayloadOf(action.payload).questions[0]!;
  host.askService().answer(runId, action.id, { answers: [{ selected: [question.options[0]!.label] }] });
  await host.finish(runId, actorId, 1);
  assert.equal(await readFile(path.join(remote.folder, "result.txt"), "utf8"), "first\nsecond\nthird\n");
  host.deliver(runId, actorId, "keep terminal");
  await host.finish(runId, actorId, 2);
  const log = await host.log(runId);
  assert.equal(log.find((entry) => entry.type === "start")?.cwd, remote.folder);
  const pids = log.filter((entry) => entry.type === "start" || entry.type === "terminal").map((entry) => entry.pid);
  assert.ok(pids.every(processExists));
  host.runtime().stopActor({ actorId: host.management().view(runId).ownerId, commandId: "stop-remote-actor" }, runId, actorId, "Stopped by user");
  await until(() => pids.every((pid) => !processExists(pid)), "remote process cleanup");
  await host.management().stop(runId);
});

const image = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Zl9sAAAAASUVORK5CYII=";

test("external chat forwards declared images and embedded resources with file references resolved on the executor", { timeout: 30_000 }, async (t) => {
  const host = await fixture(t);
  const remote = await host.workstation();
  const { runId, actorId } = await host.spawn(remote.binding);
  await (await host.provider().get(runId)).sendToActor!(actorId, "second task", [
    { name: "pixel.png", mediaType: "image/png", data: image },
    { name: "notes.md", mediaType: "text/markdown", data: Buffer.from("Project notes").toString("base64") },
  ]);
  await host.finish(runId, actorId, 1);
  const prompt = (await host.log(runId)).find((entry) => entry.type === "prompt")!.prompt;
  assert.ok(prompt.some((part: any) => part.type === "image" && part.data === image));
  const resource = prompt.find((part: any) => part.type === "resource");
  assert.equal(resource?.resource.text, "Project notes");
  assert.match(resource?.resource.uri, /^file:\/\/\/.*\/attachments\/notes.md$/);
  assert.equal(fileURLToPath(resource.resource.uri), path.join(remote.folder, "attachments", "notes.md"));
  await host.management().stop(runId);
});

test("an external actor fails explicitly when its adapter does not support an attached image", { timeout: 30_000 }, async (t) => {
  const host = await fixture(t, { ACP_FIXTURE_IMAGE: "off" });
  const { runId, actorId } = await host.spawn();
  await (await host.provider().get(runId)).sendToActor!(actorId, "second task", [{ name: "pixel.png", mediaType: "image/png", data: image }]);
  await host.finish(runId, actorId, 1);
  const turn = host.management().view(runId).turns.find((entry) => entry.actorId === actorId)!;
  assert.equal(turn.status, "failed");
  assert.match(turn.reason ?? "", /does not advertise image prompts/);
  assert.equal((await host.log(runId)).some((entry) => entry.type === "prompt"), false);
  await host.management().stop(runId);
});
