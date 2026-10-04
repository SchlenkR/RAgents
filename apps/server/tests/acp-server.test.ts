import assert from "node:assert/strict";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { once } from "node:events";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { Readable, Writable } from "node:stream";
import test, { after, type TestContext } from "node:test";
import { ClientSideConnection, ndJsonStream, PROTOCOL_VERSION, type Client, type SessionNotification, type SessionUpdate } from "@agentclientprotocol/sdk";
import { fauxAssistantMessage, fauxThinking, fauxToolCall, registerFauxProvider, type Context } from "@ragents/ai";
import { createAccessContext, type PluginRegistration } from "@ragents/engine";
import { EXECUTOR_CONTRIBUTION_FILE, loadExecutorContribution } from "@ragents/workspace-executor";
import { coreChannels, coreMethods } from "../src/api/core-methods.ts";
import { coreContracts } from "../src/api/contracts.ts";
import { runContracts } from "../../../packages/ragents/src/http/contracts.ts";
import { attachmentContentRoute } from "../src/api/delivery.ts";
import { assertRunAccess } from "../src/api/rights.ts";
import { RpcDispatcher } from "../src/rpc/dispatcher.ts";
import { RpcHttpTransport } from "../src/rpc/http-transport.ts";
import { mcpContracts } from "../../../plugins/ragents.mcp/contract.ts";
import { WORKSPACE_BINDING_OPTION_ID, workspaceContracts } from "../../../plugins/ragents.workspace/contract.ts";
import { hostClient } from "../../../scripts/agent/host.ts";
import { EditorWorkspaces } from "../../../scripts/acp/workspaces.ts";
import { httpFixture } from "./fixtures/mcp/http.mjs";

const root = path.resolve(import.meta.dirname, "../../..");
const directory = await mkdtemp(path.join(tmpdir(), "ragents-acp-server-"));
const environment = { DATA_DIR: path.join(directory, "data"), PRODUCT_PROFILE: "core", PRODUCT_ID: "test-acp", PRODUCT_TITLE: "ACP fixture",
  PROCESS_SANDBOX: "off", COMPACTION_MODEL: "", MODEL_ALIASES: undefined, MODEL_PROVIDERS: undefined, MCP_SERVERS: undefined, ACCESS_TOKEN: undefined };
const previous = new Map(Object.keys(environment).map((key) => [key, process.env[key]]));
for (const [key, value] of Object.entries(environment)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
after(async () => {
  for (const [key, value] of previous) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
  await rm(directory, { recursive: true, force: true });
});

const until = async (test: () => boolean | Promise<boolean>, label: string): Promise<void> => {
  const deadline = Date.now() + 15_000;
  while (!await test()) {
    if (Date.now() >= deadline) throw new Error(`Timed out waiting for ${label}`);
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
};

const fixture = async (t: TestContext) => {
  const { RunSessionProvider } = await import("../src/provider.ts");
  const { composeProfile } = await import("../src/profile/compose.ts");
  const { registerPluginFolder } = await import("../src/plugin-support/plugins-root.ts");
  const { productRuntimeToken } = await import("../src/ragents/product-runtime.ts");
  const { productStartOptions } = await import("../src/plugin-support/product-start-options.ts");
  const { plugin: workspace } = await import("../../../plugins/ragents.workspace/server/index.ts");
  const { plugin: mcp } = await import("../../../plugins/ragents.mcp/server/index.ts");
  const { plugin: todo } = await import("../../../plugins/ragents.todo/server/index.ts");
  const { plugin: ask } = await import("../../../plugins/ragents.ask/server/index.ts");
  const faux = registerFauxProvider({ provider: "acp-fixture", models: [{ id: "acp-fast", reasoning: true }, { id: "acp-deep", reasoning: true }], tokensPerSecond: 100_000 });
  const model = faux.getModel();
  const productDirectory = path.join(directory, "test.product");
  await mkdir(productDirectory, { recursive: true });
  const skillDirectory = path.join(productDirectory, "skills", "review");
  await mkdir(skillDirectory, { recursive: true });
  await writeFile(path.join(skillDirectory, "SKILL.md"), '---\nname: review\ndescription: Review the project\ncategory: Project\ndisable-model-invocation: true\n---\n\nReview the project.\n');
  registerPluginFolder("test.product", productDirectory);
  const product = { create: () => ({ manifest: { id: "test.product" }, register: (host: PluginRegistration) => {
    host.provide(productRuntimeToken, {
      coordinator: { handle: "coordinator", displayName: "Coordinator", profile: "coordinator", runTitle: "New run", ownerHandle: "owner", ownerDisplayName: "Owner" },
      roleFor: (view, actor) => view.primaryActorId === actor.id ? "primary" : "worker", contract: () => "", promptComposition: "test",
      systemPrompts: () => ({ mode: "fixed", options: [], defaultIds: [], shareDefault: false }),
    });
    host.profiles({ id: "test.models", models: () => faux.models.map((model) => ({ driver: "agent", provider: model.provider, model: model.id, label: model.id, thinking: ["off"] })),
      providers: () => [{ id: model.provider, config: { api: faux.api, baseUrl: model.baseUrl, apiKey: "faux-only-key", models: faux.models } }],
      profiles: () => [{ name: "coordinator", description: "Coordinator", driver: "agent", provider: model.provider, model: model.id, thinking: "off", turnTimeoutMs: null, isolateWorkspace: false }] });
    host.startOptions(...productStartOptions({ modelChoice: { options: faux.models.map(({ id }) => id), defaultModel: model.id, provider: model.provider, selectable: true, thinkingOptionsFor: () => ["off"] },
      coordinatorThinking: "off", systemPrompts: () => ({ mode: "fixed", options: [], defaultIds: [], shareDefault: false }) }));
    host.startEntries({ id: "test.product.review", title: "Review", description: "Review the project", action: "skill", skill: "review", category: "Project", prompt: "Review the project." });
  } }) };
  const modules = new Map([["ragents.workspace", workspace], ["test.product", product], ["ragents.mcp", mcp], ["ragents.todo", todo], ["ragents.ask", ask]]);
  const contribution = await loadExecutorContribution("ragents.mcp", path.join(root, "bundles/ragents.mcp", EXECUTOR_CONTRIBUTION_FILE));
  const provider = new RunSessionProvider((bridges) => composeProfile({ product: { id: "test-acp", title: "ACP fixture" }, pluginIds: [...modules.keys()], modules, web: new Map(), executor: [contribution] }, bridges), undefined);
  await provider.init();
  const policy = provider.runAccess();
  const sources = { sessions: provider, plugins: provider.plugins, version: "1.0.0", global: undefined,
    runOwner: (runId: string) => provider.runOwner(runId), runOwnerOnly: (runId: string) => provider.runOwnerOnly(runId), runSharing: (runId: string) => provider.runSharing(runId),
    settingsGuarded: () => false, external: { open: () => false, set: async () => undefined } };
  provider.plugins.methods.register("host", [...provider.engineMethods(), ...coreMethods(sources)]);
  provider.plugins.channels.register("host", coreChannels(sources));
  const transport = new RpcHttpTransport({ dispatcher: new RpcDispatcher({ methods: provider.plugins.methods, channels: provider.plugins.channels,
    assertRunReachable: (access, runId, operates) => assertRunAccess(access, runId, operates, policy) }) });
  const access = createAccessContext({ enabled: true, user: { id: "alice", label: "User", rights: ["*"] } });
  const otherAccess = createAccessContext({ enabled: true, user: { id: "bob", label: "Other user",
    rights: ["runs.read", "runs.write", "runs.create", "runs.inspect", "ragents.workspace.read", "ragents.workspace.write", "ragents.mcp.read"] } });
  const attachments = attachmentContentRoute(provider, policy);
  const server = createServer((request, response) => {
    void (async () => {
      const url = new URL(request.url ?? "/", "http://localhost");
      if (url.pathname === "/health") { response.writeHead(200).end(JSON.stringify({ ok: true, pid: process.pid })); return; }
      const user = request.headers.authorization === "Bearer test-user-token" ? access
        : request.headers.authorization === "Bearer fixture-other-user-token" ? otherAccess : undefined;
      if (!user) { response.writeHead(401).end("Sign-in required"); return; }
      if (await transport.handle(request, response, url, user, true)) return;
      if (attachments.matches(request, url)) { await attachments.handle({ request, response, url, access: user }); return; }
      response.writeHead(404).end();
    })().catch((cause) => { response.writeHead(500).end(String(cause)); });
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const url = `http://127.0.0.1:${address.port}`;
  const folder = path.join(directory, "project");
  await mkdir(folder, { recursive: true });
  const profile = path.join(directory, "ragents.config.fixture.ts");
  await writeFile(profile, 'console.log("ACP fixture profile loaded");\nexport const config = { host: { PORT: 4710 } };\n');
  t.after(async () => {
    try { await provider.shutdown(); }
    finally { faux.unregister(); transport.close(); server.closeAllConnections(); await new Promise<void>((resolve) => server.close(() => resolve())); }
  });
  return { provider, faux, url, folder, profile };
};

const clientProcess = async (t: TestContext, host: Awaited<ReturnType<typeof fixture>>, options: {
  token?: string; client?: Partial<Client>; checkout?: boolean; address?: string;
} = {}) => {
  const entry = options.checkout ? ["--import", "tsx", "../../scripts/agent/agent-cli.ts", "acp"] : ["../../scripts/package/ragents.mjs", "acp"];
  const child: ChildProcessWithoutNullStreams = spawn(process.execPath, [...entry, "--profile", host.profile, "--data-dir", path.join(directory, "client")], {
    cwd: path.join(root, "apps/server"), stdio: "pipe", env: { ...process.env, PORT: "4710", RAGENTS_URL: options.address ?? host.url, RAGENTS_TOKEN: options.token ?? "test-user-token" },
  });
  const stdout: string[] = [];
  const stderr: string[] = [];
  const updates: SessionNotification[] = [];
  child.stdout.on("data", (chunk: Buffer) => stdout.push(chunk.toString()));
  child.stderr.on("data", (chunk: Buffer) => stderr.push(chunk.toString()));
  const connection = new ClientSideConnection(() => ({ sessionUpdate: async (update) => { updates.push(update); }, ...options.client }),
    ndJsonStream(Writable.toWeb(child.stdin), Readable.toWeb(child.stdout) as ReadableStream<Uint8Array>));
  let closing: Promise<void> | undefined;
  const close = (): Promise<void> => closing ??= (async () => {
    const exit = child.exitCode !== null ? Promise.resolve([child.exitCode]) : once(child, "exit");
    child.stdin.end();
    const force = setTimeout(() => child.kill("SIGKILL"), 10_000);
    try { const [code] = await exit; assert.equal(code, 0, stderr.join("")); }
    finally { clearTimeout(force); }
  })();
  t.after(() => close());
  return { child, connection, updates, stderr, close, messages: () => stdout.join("").trim().split("\n").filter(Boolean).map((line) => {
    const message = JSON.parse(line) as { jsonrpc?: string };
    assert.equal(message.jsonrpc, "2.0", line);
    return message;
  }) };
};

const chunks = (updates: readonly SessionNotification[], kind: SessionUpdate["sessionUpdate"]): string => updates.flatMap(({ update }) =>
  update.sessionUpdate === kind && "content" in update && !Array.isArray(update.content) && update.content?.type === "text" ? [update.content.text] : [],
).join("");

test("ragents acp serves editor sessions, streams real native/MCP tools, plans, cancel, and history over clean stdio", { timeout: 60_000 }, async (t) => {
  const host = await fixture(t);
  const mcp = await httpFixture("modern", { authorization: "Bearer fixture-mcp-private" });
  t.after(() => mcp.close());
  const editor = await clientProcess(t, host);
  const initialized = await editor.connection.initialize({ protocolVersion: PROTOCOL_VERSION, clientCapabilities: {} });
  assert.equal(initialized.protocolVersion, 1);
  assert.equal(initialized.agentCapabilities?.loadSession, true);
  assert.deepEqual(initialized.agentCapabilities?.sessionCapabilities?.list, {});
  assert.deepEqual(initialized.agentCapabilities?.mcpCapabilities, { http: true, sse: true });
  assert.deepEqual(initialized.authMethods, []);
  const definitions = [{ name: "fixture", type: "http" as const, url: mcp.url, headers: [{ name: "Authorization", value: "Bearer fixture-mcp-private" }] },
    { name: "process", command: process.execPath, args: [path.join(root, "apps/server/tests/fixtures/mcp/stdio.mjs"), "legacy-strict", path.join(directory, "stdio.log")], env: [{ name: "MCP_TEST_VALUE", value: "fixture-env-private" }] }];
  const session = await editor.connection.newSession({ cwd: host.folder, mcpServers: definitions });
  assert.ok(session.sessionId);
  assert.equal(session.configOptions?.[0]?.currentValue, "acp-fast");
  assert.ok(editor.updates.some(({ update }) => update.sessionUpdate === "available_commands_update" && update.availableCommands[0]?.name === "test.product.review"));
  const config = await editor.connection.setSessionConfigOption({ sessionId: session.sessionId, configId: "ragents.model", value: "acp-deep" });
  assert.equal(config.configOptions[0]?.currentValue, "acp-deep");
  const contexts: Context[] = [];
  host.faux.setResponses([
    (context) => { contexts.push({ systemPrompt: context.systemPrompt, messages: structuredClone(context.messages) }); return fauxAssistantMessage([fauxThinking("Checking tools."),
      fauxToolCall("write", { file_path: "result.txt", content: "Created through ACP" }, { id: "file-call" }),
      fauxToolCall("todo_write", { todos: [{ content: "Create the output", status: "completed", activeForm: "Creating output" }] }, { id: "plan-call" }),
      fauxToolCall("mcp__fixture__echo", { text: "MCP through ACP" }, { id: "mcp-call" }),
      fauxToolCall("mcp__process__echo", { text: "Stdio through ACP" }, { id: "stdio-call" })], { stopReason: "toolUse" }); },
    (context) => { contexts.push({ systemPrompt: context.systemPrompt, messages: structuredClone(context.messages) });
      assert.ok(context.messages.some((message) => message.role === "toolResult" && message.toolName === "write" && !message.isError), JSON.stringify(context.messages));
      return fauxAssistantMessage("The editor task is complete."); },
  ]);
  const result = await editor.connection.prompt({ sessionId: session.sessionId, prompt: [{ type: "text", text: "Create output and call the editor MCP servers." },
    { type: "resource_link", name: "Guide", uri: "https://example.com/guide" }, { type: "resource", resource: { uri: "demo://notes", text: "Embedded context" } }] });
  assert.equal(result.stopReason, "end_turn");
  assert.ok(contexts.length >= 2, JSON.stringify(editor.updates));
  assert.ok(!editor.updates.some(({ update }) => update.sessionUpdate === "tool_call_update" && update.status === "failed"), JSON.stringify(editor.updates));
  assert.equal(await readFile(path.join(host.folder, "result.txt"), "utf8"), "Created through ACP");
  assert.match(chunks(editor.updates, "agent_message_chunk"), /The editor task is complete\./);
  assert.match(chunks(editor.updates, "agent_thought_chunk"), /Checking tools\./);
  assert.ok(editor.updates.some(({ update }) => update.sessionUpdate === "tool_call" && update.toolCallId === "file-call" && update.locations?.[0]?.path === path.join(host.folder, "result.txt")));
  for (const id of ["file-call", "plan-call", "mcp-call", "stdio-call"]) {
    assert.deepEqual(editor.updates.filter(({ update }) => (update.sessionUpdate === "tool_call" || update.sessionUpdate === "tool_call_update") && update.toolCallId === id)
      .map(({ update }) => "status" in update ? update.status : undefined), ["pending", "in_progress", "completed"]);
  }
  assert.ok(editor.updates.some(({ update }) => update.sessionUpdate === "plan" && update.entries[0]?.status === "completed"));
  assert.match(JSON.stringify(contexts), /Embedded context/);
  assert.doesNotMatch(JSON.stringify(contexts), /fixture-mcp-private|fixture-env-private/);
  const options = host.provider.startOptions(session.sessionId, "alice");
  assert.deepEqual(options.find(({ id }) => id === WORKSPACE_BINDING_OPTION_ID)?.value, { machine: "server", folder: { path: host.folder } });
  assert.equal(host.provider.runOwner(session.sessionId), "alice");
  const events = await host.provider.engineMethods().find(({ contract }) => contract.id === "ragents.runs.events")!.execute({ runId: session.sessionId } as never, { access: createAccessContext({ enabled: true, user: { id: "alice", label: "User", rights: ["*"] } }) } as never);
  assert.doesNotMatch(JSON.stringify(events), /fixture-mcp-private|fixture-env-private|Authorization|mcpServers/);
  const privateFile = path.join(environment.DATA_DIR, "sessions", session.sessionId, "plugins/ragents.mcp/servers.json");
  assert.equal((await stat(privateFile)).mode & 0o777, 0o600);

  host.faux.setResponses([fauxAssistantMessage(fauxToolCall("mcp__fixture__wait", {}, { id: "wait-call" }), { stopReason: "toolUse" })]);
  const waiting = editor.connection.prompt({ sessionId: session.sessionId, prompt: [{ type: "text", text: "Wait for cancellation." }] });
  await until(() => mcp.log.some((entry: { type: string }) => entry.type === "wait.started"), "MCP waiting tool");
  const replace = await fetch(`${host.url}/rpc`, { method: "POST", headers: { authorization: "Bearer test-user-token", "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: mcpContracts.setServers.id, params: { runId: session.sessionId, servers: {} } }) });
  assert.match(JSON.stringify(await replace.json()), /only be replaced while the run is idle/);
  await editor.connection.cancel({ sessionId: session.sessionId });
  assert.equal((await waiting).stopReason, "cancelled");

  const replayStart = editor.updates.length;
  await editor.connection.loadSession({ sessionId: session.sessionId, cwd: host.folder, mcpServers: [] });
  const replay = editor.updates.slice(replayStart);
  assert.match(chunks(replay, "user_message_chunk"), /Create output.*Wait for cancellation/s);
  assert.match(chunks(replay, "agent_message_chunk"), /The editor task is complete/);
  assert.ok(replay.some(({ update }) => update.sessionUpdate === "plan"));
  assert.ok(replay.some(({ update }) => update.sessionUpdate === "tool_call" && update.toolCallId === "file-call"));
  const listed = await editor.connection.listSessions({ cwd: host.folder });
  assert.ok(listed.sessions.some(({ sessionId }) => sessionId === session.sessionId));
  assert.deepEqual((await editor.connection.listSessions({ cwd: path.join(host.folder, "other") })).sessions, []);
  host.faux.setResponses([fauxAssistantMessage("Continued after cancellation.")]);
  assert.equal((await editor.connection.prompt({ sessionId: session.sessionId, prompt: [{ type: "text", text: "Continue." }] })).stopReason, "end_turn");
  const other = await clientProcess(t, host, { token: "fixture-other-user-token" });
  await other.connection.initialize({ protocolVersion: 1, clientCapabilities: {} });
  await assert.rejects(other.connection.loadSession({ sessionId: session.sessionId, cwd: host.folder, mcpServers: [] }), /access|belong|visible|exist/i);
  assert.ok(!(await other.connection.listSessions({ cwd: host.folder })).sessions.some(({ sessionId }) => sessionId === session.sessionId));
  await other.close();
  other.messages();
  await editor.close();
  assert.ok(editor.messages().length > 15);
  assert.match(editor.stderr.join(""), /ACP fixture profile loaded/);
});

test("ACP uses declared stable forms for questions and continues the run after the answer", { timeout: 30_000 }, async (t) => {
  const host = await fixture(t);
  const forms: unknown[] = [];
  const editor = await clientProcess(t, host, { checkout: true, client: { createElicitation: async (request) => {
    forms.push(request); return { action: "accept", content: { answer_1: "Blue" } };
  } } });
  await editor.connection.initialize({ protocolVersion: 1, clientCapabilities: { elicitation: { form: {} } } }).catch((cause: unknown) => { throw new Error(`${String(cause)}\n${editor.stderr.join("")}`); });
  const session = await editor.connection.newSession({ cwd: host.folder, mcpServers: [] });
  host.faux.setResponses([fauxAssistantMessage(fauxToolCall("ask_user", { questions: [{ question: "Which color?", header: "Color", multiSelect: false,
    options: [{ label: "Red", description: "Warm" }, { label: "Blue", description: "Cool" }] }] }, { id: "question-call" }), { stopReason: "toolUse" }),
  fauxAssistantMessage("Blue selected.")]);
  assert.equal((await editor.connection.prompt({ sessionId: session.sessionId, prompt: [{ type: "text", text: "Ask for a color." }] })).stopReason, "end_turn");
  assert.equal(forms.length, 1, JSON.stringify(editor.updates));
  assert.match(JSON.stringify(forms), /Blue: Cool/);
  assert.match(chunks(editor.updates, "agent_message_chunk"), /Blue selected/);
  assert.doesNotMatch(chunks(editor.updates, "agent_message_chunk"), /Which color/);
  await editor.close();
  editor.messages();
});

test("ACP returns clear errors for missing auth, folders, sessions, and incompatible protocol versions", { timeout: 30_000 }, async (t) => {
  const host = await fixture(t);
  const noAuth = await clientProcess(t, host, { token: "" });
  await assert.rejects(noAuth.connection.initialize({ protocolVersion: 1, clientCapabilities: {} }), /RAGENTS_TOKEN/);
  const missingHost = await clientProcess(t, host, { address: `${host.url}/missing-host` });
  await assert.rejects(missingHost.connection.initialize({ protocolVersion: 1, clientCapabilities: {} }), /No RAgents server responds.*RAGENTS_URL/);
  const editor = await clientProcess(t, host);
  assert.equal((await editor.connection.initialize({ protocolVersion: 99, clientCapabilities: {} })).protocolVersion, 1);
  await assert.rejects(editor.connection.newSession({ cwd: host.folder, mcpServers: [] }), /Initialize/);
  await editor.connection.initialize({ protocolVersion: 1, clientCapabilities: {} });
  await assert.rejects(editor.connection.newSession({ cwd: path.join(host.folder, "missing"), mcpServers: [] }), /does not exist/);
  await assert.rejects(editor.connection.loadSession({ sessionId: "missing-session", cwd: host.folder, mcpServers: [] }), /does not exist/);
  const session = await editor.connection.newSession({ cwd: host.folder, mcpServers: [] });
  await assert.rejects(editor.connection.setSessionConfigOption({ sessionId: session.sessionId, configId: "ragents.model", value: "missing-model" }), /not available/);
  await assert.rejects(editor.connection.loadSession({ sessionId: session.sessionId, cwd: directory, mcpServers: [] }), /different folder/);
  host.faux.setResponses([(context) => {
    assert.match(context.systemPrompt ?? "", /preloaded_skill name="review"/);
    assert.match(JSON.stringify(context.messages), /Review the project.*Focus on tests/s);
    return fauxAssistantMessage("Review completed.");
  }]);
  assert.equal((await editor.connection.prompt({ sessionId: session.sessionId, prompt: [{ type: "text", text: "/test.product.review Focus on tests." }] })).stopReason, "end_turn");
});

test("ACP falls back to question text, replays authenticated images, and loads history after reconnect", { timeout: 30_000 }, async (t) => {
  const host = await fixture(t);
  const editor = await clientProcess(t, host);
  await editor.connection.initialize({ protocolVersion: 1, clientCapabilities: {} });
  const session = await editor.connection.newSession({ cwd: host.folder, mcpServers: [] });
  const image = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Zl9sAAAAASUVORK5CYII=";
  host.faux.setResponses([(context) => {
    assert.ok(context.messages.some((message) => message.role === "user" && Array.isArray(message.content) && message.content.some((block) => block.type === "image" && block.data === image)));
    return fauxAssistantMessage(fauxToolCall("ask_user", { questions: [{ question: "Choose a color", header: "Color", multiSelect: false,
      options: [{ label: "Red", description: "Warm" }, { label: "Blue", description: "Cool" }] }] }, { id: "text-question" }), { stopReason: "toolUse" });
  }]);
  assert.equal((await editor.connection.prompt({ sessionId: session.sessionId, prompt: [{ type: "text", text: "Look at this image and ask a question." },
    { type: "image", data: image, mimeType: "image/png" }] })).stopReason, "end_turn");
  assert.match(chunks(editor.updates, "agent_message_chunk"), /Color: Choose a color.*Red: Warm.*Blue: Cool/s);
  host.faux.setResponses([(context) => {
    assert.match(JSON.stringify(context.messages), /Blue please/);
    return fauxAssistantMessage("The answer is Blue.");
  }]);
  assert.equal((await editor.connection.prompt({ sessionId: session.sessionId, prompt: [{ type: "text", text: "Blue please." }] })).stopReason, "end_turn");
  await editor.close();
  editor.messages();
  const resumed = await clientProcess(t, host);
  await resumed.connection.initialize({ protocolVersion: 1, clientCapabilities: {} });
  await resumed.connection.loadSession({ sessionId: session.sessionId, cwd: host.folder, mcpServers: [] });
  assert.match(chunks(resumed.updates, "user_message_chunk"), /Look at this image.*Blue please/s);
  assert.match(chunks(resumed.updates, "agent_message_chunk"), /The answer is Blue/);
  assert.ok(resumed.updates.some(({ update }) => update.sessionUpdate === "user_message_chunk" && update.content.type === "image" && update.content.data === image));
  const listed = await resumed.connection.listSessions({ cwd: host.folder });
  assert.ok(listed.sessions.some(({ sessionId }) => sessionId === session.sessionId));
  await resumed.close();
  resumed.messages();
});

test("ACP cancels a pending question form without leaving its prompt open", { timeout: 30_000 }, async (t) => {
  const host = await fixture(t);
  const form = Promise.withResolvers<void>();
  const editor = await clientProcess(t, host, { client: { createElicitation: async () => { form.resolve(); return new Promise(() => undefined); } } });
  await editor.connection.initialize({ protocolVersion: 1, clientCapabilities: { elicitation: { form: {} } } });
  const session = await editor.connection.newSession({ cwd: host.folder, mcpServers: [] });
  host.faux.setResponses([fauxAssistantMessage(fauxToolCall("ask_user", { questions: [{ question: "Choose", header: "Option", multiSelect: false,
    options: [{ label: "One", description: "First" }, { label: "Two", description: "Second" }] }] }, { id: "cancel-question" }), { stopReason: "toolUse" })]);
  const prompt = editor.connection.prompt({ sessionId: session.sessionId, prompt: [{ type: "text", text: "Ask a question." }] });
  await form.promise;
  await editor.connection.cancel({ sessionId: session.sessionId });
  assert.equal((await prompt).stopReason, "cancelled");
  await editor.close();
  editor.messages();
});

test("ACP workstations offer independent folders, execute MCP on their machine, and reconnect with the same binding", { timeout: 30_000 }, async (t) => {
  const host = await fixture(t);
  const token = process.env.RAGENTS_TOKEN;
  process.env.RAGENTS_TOKEN = "test-user-token";
  const rpc = hostClient(host.url);
  const workspaces = new EditorWorkspaces(host.url, true, path.join(directory, "workstation-data"));
  t.after(async () => { await workspaces.close(); rpc.close(); if (token === undefined) delete process.env.RAGENTS_TOKEN; else process.env.RAGENTS_TOKEN = token; });
  const other = path.join(directory, "other-project");
  await mkdir(other, { recursive: true });
  const first = await workspaces.binding(host.folder);
  const second = await workspaces.binding(other);
  assert.notEqual(first.machine, "server");
  assert.notEqual(second.machine, "server");
  assert.ok(typeof first.machine === "object" && typeof second.machine === "object");
  assert.notEqual(first.machine.client, second.machine.client);
  assert.deepEqual((await rpc.call(workspaceContracts.clients.list, {})).map(({ id }) => id).sort(), [first.machine.client, second.machine.client].sort());
  const runId = "acp-workstation-run";
  await rpc.call(coreContracts.startOptions.select, { runId, optionId: WORKSPACE_BINDING_OPTION_ID, value: first });
  await rpc.call(mcpContracts.setServers, { runId, servers: { remote: { command: process.execPath,
    args: [path.join(root, "apps/server/tests/fixtures/mcp/stdio.mjs"), "modern", path.join(directory, "remote-stdio.log")] } } });
  host.faux.setResponses([fauxAssistantMessage([fauxToolCall("write", { file_path: "remote.txt", content: "Written by the editor workstation" }, { id: "remote-write" }),
    fauxToolCall("mcp__remote__echo", { text: "Workstation MCP" }, { id: "remote-mcp" })], { stopReason: "toolUse" }), fauxAssistantMessage("Workstation complete.")]);
  await rpc.call(coreContracts.chat.send, { runId, text: "Write a file on the workstation and call its MCP server." });
  await until(async () => (await rpc.call(runContracts.view, { runId }))?.turns.at(-1)?.status === "completed", "workstation turn");
  assert.equal(await readFile(path.join(host.folder, "remote.txt"), "utf8"), "Written by the editor workstation");
  assert.match(await readFile(path.join(directory, "remote-stdio.log"), "utf8"), /tool.called.*echo/);
  await rpc.call(mcpContracts.closeConnections, { runId });
  await rpc.call(mcpContracts.closeConnections, { runId });
  assert.match(await readFile(path.join(environment.DATA_DIR, "sessions", runId, "plugins/ragents.mcp/servers.json"), "utf8"), /remote-stdio/);
  await workspaces.close();
  const reconnected = new EditorWorkspaces(host.url, true, path.join(directory, "workstation-data"));
  try { assert.deepEqual(await reconnected.binding(host.folder), first); }
  finally { await reconnected.close(); }
});
