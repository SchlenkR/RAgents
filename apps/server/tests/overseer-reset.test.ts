import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fauxAssistantMessage, fauxToolCall, registerFauxProvider } from "@aicontainer/ai";
import { PluginHost } from "@aicontainer/ragents";
import { deferred } from "../../../packages/ragents/tests/support.ts";
import { plugin } from "../../../plugins/ragents.overseer/server/index.ts";
import { WorkspaceSandboxHost, sandboxServicesToken } from "../src/plugin-support/workspace-sandbox-host.ts";
import { globalChatToken, sessionManagementToken, type SessionManagement } from "../src/ragents/global-chat.ts";
import { productRuntimeToken } from "../src/ragents/product-runtime.ts";
import { workspaceRuntimeToken } from "../src/ragents/workspace-runtime.ts";
import { createChatHandler } from "../src/chat-handler.ts";
import type { ChatEvent } from "../src/chat-events.ts";
import type { Engine } from "../src/ragents/engine.ts";

const directory = await mkdtemp(path.join(tmpdir(), "ragents-overseer-reset-"));
const agentHome = path.join(directory, "agent-home");
process.env.DATA_DIR = directory;
process.env.AGENT_HOME_DIR = agentHome;
process.env.PRODUCT_PROFILE = "core";
process.env.PRODUCT_ID = "test";
process.env.PRODUCT_TITLE = "Test";
process.env.COMPACTION_MODEL = "";
process.env.ACCESS_TOKEN = "reset-test-only-token";
const { RunSessionProvider } = await import("../src/provider.ts");

const until = async (condition: () => boolean) => {
  const timeout = Date.now() + 10000;
  while (!condition()) {
    assert.ok(Date.now() < timeout, "Die erwartete Zustandsänderung blieb aus");
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
};

test("confirmed reset recovers durably and isolates unavailable journals across server restarts", { timeout: 30000 }, async () => {
  const faux = registerFauxProvider({ models: [{ id: "reset-model", reasoning: true }] });
  const model = faux.getModel();
  await mkdir(agentHome);
  await writeFile(path.join(agentHome, "models.json"), JSON.stringify({ providers: { [model.provider]: { api: faux.api, baseUrl: model.baseUrl, apiKey: "faux-test-key", models: faux.models } } }));
  let management: SessionManagement;
  const resolvedWorkspaces: string[] = [];
  const createProvider = () => new RunSessionProvider((bridges) => {
    management = bridges.sessions!();
    const host = new PluginHost({ product: { id: "test", title: "Test" }, dataDirectory: directory });
    host.provideHost(sessionManagementToken, () => management);
    const sandbox = new WorkspaceSandboxHost({ contributorName: "test.workspace", workspaceFor: bridges.sessionWorkspaceFor,
      identFor: async () => undefined, homeFor: async () => ({ home: directory }), skillPaths: async () => [], filesFor: async () => undefined });
    host.register({ manifest: { id: "test.product" }, register: (registration) => {
      registration.provide(sandboxServicesToken, sandbox);
      registration.functions(sandbox.workspaceTools());
      registration.lifecycle({ id: "test.sandbox", shutdown: () => sandbox.shutdownAll() });
      registration.provide(productRuntimeToken, {
        coordinator: { handle: "coordinator", displayName: "Coordinator", profile: "coordinator", runTitle: "New", ownerHandle: "owner", ownerDisplayName: "Owner" },
        roleFor: (view, actor) => view.primaryActorId === actor.id ? "primary" : "worker",
        contract: () => "", promptComposition: "test", systemPrompts: () => ({ mode: "fixed", options: [], defaultIds: [], shareDefault: false }),
      });
      registration.provide(workspaceRuntimeToken, {
        describe: () => ({ mode: "test", directoryPattern: directory }),
        resolve: async (runId) => {
          resolvedWorkspaces.push(runId);
          return { cwd: directory, currentRoot: async () => directory, ensureWritable: async () => directory, runOperation: (operation) => operation() };
        },
      });
      registration.profiles({ id: "models", models: () => [{ driver: "agent", provider: model.provider, model: model.id, label: "Reset Model", thinking: ["off", "high"] }],
        profiles: () => [{ name: "coordinator", description: "Coordinator", driver: "agent", provider: model.provider, model: model.id, thinking: "off", turnTimeoutMs: null, isolateWorkspace: false }] });
    } });
    host.register(plugin.create(host));
    host.seal();
    return host;
  });
  let provider = createProvider();
  const handler = createChatHandler({ manager: { get: (id) => provider.get(id), list: () => provider.list(), delete: (id) => provider.delete(id) } });
  const server = createServer(async (request, response) => {
    const url = new URL(request.url!, "http://test");
    if (!await provider.pluginRoutes(request, response, url)) await handler(request, response);
  });
  const normalStarted = deferred();
  const releaseNormal = deferred();
  const globalStarted = deferred();
  const globalAborted = deferred();
  const releaseGlobal = deferred();
  const freshContexts: string[] = [];
  faux.setResponses([
    (context) => {
      assert.deepEqual(context.tools?.map((tool) => tool.name).sort(), ["typescript_api", "typescript_eval"]);
      assert.doesNotMatch(context.systemPrompt ?? "", /reset-test-only-token/);
      return fauxAssistantMessage([fauxToolCall("typescript_eval", { code: `return await context.functions.write(${JSON.stringify({ path: "request.json", content: '{"title":"Test"}' })});` }, { id: "global-write" })]);
    },
    () => fauxAssistantMessage([fauxToolCall("typescript_eval", { code: `return await context.functions.read(${JSON.stringify({ path: "$RAGENTS_JOURNAL_DIR/overseer/journal.jsonl" })});` }, { id: "global-read" })]),
    () => fauxAssistantMessage([fauxToolCall("typescript_eval", { code: `return await context.functions.bash(${JSON.stringify({ command: 'test -n "$RAGENTS_API_TOKEN" && test -n "$RAGENTS_API_BASE_URL" && rg -l "Altes Gespräch" "$RAGENTS_JOURNAL_DIR"', timeout: 5 })});` }, { id: "global-bash" })]),
    (context) => {
      const results = context.messages.filter((message) => message.role === "toolResult");
      assert.equal(results.length, 3);
      assert.ok(results.every((result) => !result.isError));
      assert.match(JSON.stringify(results), /Altes Gespräch/);
      assert.doesNotMatch(JSON.stringify(results), /reset-test-only-token/);
      return fauxAssistantMessage("Alte Antwort");
    },
    async () => { normalStarted.resolve(); await releaseNormal.promise; return fauxAssistantMessage("Normal abgeschlossen"); },
    async (_context, options) => { globalStarted.resolve(); options?.signal?.addEventListener("abort", globalAborted.resolve, { once: true }); await releaseGlobal.promise; return fauxAssistantMessage("Veraltete späte Antwort"); },
    (context) => { freshContexts.push(JSON.stringify(context.messages)); return fauxAssistantMessage("Frischer Anfang"); },
    (context) => { freshContexts.push(JSON.stringify(context.messages)); return fauxAssistantMessage("Frischer Neustart"); },
  ]);
  try {
    await provider.init();
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    assert.ok(address && typeof address === "object");
    const base = `http://127.0.0.1:${address.port}`;
    const resetUrl = `${base}/api/plugins/ragents.overseer/reset`;
    const settingsUrl = `${base}/api/plugins/ragents.overseer/settings`;
    const global = await provider.get("overseer");
    const observed: ChatEvent[] = [];
    const unsubscribe = global.subscribe((event) => observed.push(event));
    await global.send("Altes Gespräch");
    await until(() => management!.view("overseer").turns[0]?.status === "completed");
    const toolPolicy = provider.plugins.service(globalChatToken);
    const currentTools = toolPolicy.toolNames;
    toolPolicy.toolNames = ["legacy-management-tool"];
    assert.equal(await provider.get("overseer"), global);
    await assert.rejects(async () => global.send("Veraltete Werkzeugauswahl"), /Werkzeuge.*zurück/);
    toolPolicy.toolNames = currentTools;
    const denied = await fetch(resetUrl, { method: "POST", body: JSON.stringify({ confirm: false }) });
    assert.equal(denied.status, 400);
    await denied.json();
    const malformed = await fetch(resetUrl, { method: "POST", body: "{" });
    assert.equal(malformed.status, 400);
    await malformed.json();
    const readonlyReset = await fetch(resetUrl);
    assert.equal(readonlyReset.status, 405);
    await readonlyReset.json();
    assert.equal(provider.hasRun("overseer"), true);
    const selection = { provider: model.provider, model: model.id, thinking: "high" };
    const saved = await fetch(settingsUrl, { method: "PUT", body: JSON.stringify(selection) });
    assert.equal(saved.status, 200);
    const settingsBefore = await saved.json();
    const normalId = await management!.create({ title: "Normal bleibt", kind: "message", message: "Normaler laufender Auftrag" });
    await normalStarted.promise;
    const normalBefore = management!.view(normalId);
    await global.send("Globaler laufender Auftrag " + "mit vielen Einzelheiten. ".repeat(300));
    await globalStarted.promise;
    assert.ok((await readdir(path.join(directory, "runs", "overseer", "payloads"))).length > 0);
    const oldActor = management!.view("overseer").primaryActorId;
    assert.ok(existsSync(path.join(directory, "sessions", "overseer", "chat", oldActor!)));
    const reset = management!.resetGlobal();
    assert.equal(management!.resetGlobal(), reset);
    await assert.rejects(provider.get("overseer"), /zurückgesetzt/);
    await assert.rejects(async () => global.send("Gleichzeitige Nachricht"), /zurückgesetzt/);
    await globalAborted.promise;
    let finished = false;
    void reset.then(() => { finished = true; });
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.equal(finished, false);
    assert.deepEqual(management!.view(normalId), normalBefore);
    const duringReset = await fetch(`${base}/chat/overseer/actors/history`);
    assert.equal(duringReset.status, 409);
    await duringReset.json();
    releaseGlobal.resolve();
    await reset;
    assert.equal(provider.hasRun("overseer"), false);
    assert.equal(existsSync(path.join(directory, "sessions", "overseer")), false);
    assert.equal(existsSync(path.join(directory, "runs", "overseer")), false);
    assert.deepEqual(management!.view(normalId), normalBefore);
    assert.deepEqual(await (await fetch(settingsUrl)).json(), settingsBefore);
    assert.equal(observed.filter((event) => event.kind === "reset" && event.reason === "conversation-reset").length, 1);
    assert.equal(await provider.get("overseer"), global);
    const replay: ChatEvent[] = [];
    global.subscribe((event) => replay.push(event))();
    assert.deepEqual(replay, [{ kind: "reset", conversationId: null }, { kind: "status", running: false }, { kind: "replay-end", conversationId: null }]);
    const workspace = provider.plugins.service(globalChatToken).workspaceDirectory;
    assert.equal(existsSync(path.join(workspace, "reference.md")), false);
    await global.send("Neue Frage");
    await until(() => management!.view("overseer").turns[0]?.status === "completed");
    assert.notEqual(management!.view("overseer").primaryActorId, oldActor);
    assert.match(await readFile(path.join(workspace, "reference.md"), "utf8"), /api\/plugins\/ragents.overseer/);
    assert.ok(JSON.parse(await readFile(path.join(workspace, "openapi.json"), "utf8")).paths);
    assert.ok(observed.some((event) => event.kind === "text" && event.delta.includes("Frischer")));
    assert.ok(freshContexts[0].includes("Neue Frage"));
    assert.doesNotMatch(freshContexts[0], /Altes Gespräch|Alte Antwort|Globaler laufender Auftrag|Veraltete späte Antwort/);
    releaseNormal.resolve();
    await until(() => management!.view(normalId).turns[0]?.status === "completed");
    unsubscribe();
    const intent = provider.plugins.service(globalChatToken).resetIntentFile!;
    await provider.shutdown();
    await writeFile(intent, JSON.stringify({ version: 1, runId: "overseer" }));
    provider = createProvider();
    await provider.init();
    assert.equal(provider.hasRun("overseer"), false);
    assert.equal(existsSync(intent), false);
    assert.ok(provider.hasRun(normalId));
    assert.deepEqual(await (await fetch(settingsUrl)).json(), settingsBefore);
    await (await provider.get("overseer")).send("Nach dem Neustart");
    await until(() => management!.view("overseer").turns[0]?.status === "completed");
    assert.doesNotMatch(freshContexts[1], /Neue Frage|Frischer Anfang|Altes Gespräch/);
    const current = await provider.get("overseer");
    const policy = provider.plugins.service(globalChatToken);
    const blocker = path.join(directory, "blocked-marker-parent");
    await writeFile(blocker, "file");
    policy.resetIntentFile = path.join(blocker, "reset.json");
    const persistenceFailure = await fetch(resetUrl, { method: "POST", body: JSON.stringify({ confirm: true }) });
    assert.equal(persistenceFailure.status, 500);
    await persistenceFailure.json();
    assert.equal(await provider.get("overseer"), current);
    assert.equal(provider.hasRun("overseer"), true);
    policy.resetIntentFile = intent;
    const engine = (provider as unknown as { engine: Engine }).engine;
    const halt = engine.scheduler.haltRun.bind(engine.scheduler);
    engine.scheduler.haltRun = async () => { throw new Error("Test: Laufzeit lässt sich noch nicht stoppen"); };
    const stopFailure = await fetch(resetUrl, { method: "POST", body: JSON.stringify({ confirm: true }) });
    assert.equal(stopFailure.status, 500);
    assert.match((await stopFailure.json() as { error: string }).error, /noch nicht stoppen/);
    assert.equal(provider.hasRun("overseer"), true);
    assert.ok(existsSync(intent));
    assert.ok(provider.hasRun(normalId));
    await assert.rejects(provider.get("overseer"), /wiederhole den Reset/);
    await assert.rejects(async () => current.send("Nach gescheitertem Reset"), /zurückgesetzt/);
    engine.scheduler.haltRun = halt;
    const confirmed = await fetch(resetUrl, { method: "POST", body: JSON.stringify({ confirm: true }) });
    assert.equal(confirmed.status, 200);
    assert.deepEqual(await confirmed.json(), { ok: true });
    assert.equal(provider.hasRun("overseer"), false);
    assert.ok((await readFile(path.join(directory, "runs", normalId, "journal.jsonl"), "utf8")).includes("Normaler laufender Auftrag"));
    await provider.shutdown();
    const firstRecord = JSON.parse((await readFile(path.join(directory, "runs", normalId, "journal.jsonl"), "utf8")).split("\n")[0]);
    const legacyId = randomUUID();
    const corruptId = randomUUID();
    const malformedId = randomUUID();
    const unavailable = new Map([
      [legacyId, JSON.stringify({ ...firstRecord, runId: legacyId, formatVersion: 3 }) + "\n"],
      [corruptId, JSON.stringify({ ...firstRecord, runId: corruptId }) + '\n{"formatVersion":4}\n'],
      [malformedId, "{invalid JSON}\n"],
      ["overseer", JSON.stringify({ ...firstRecord, runId: "overseer", formatVersion: 3 }) + "\n"],
    ]);
    for (const [id, content] of unavailable) {
      await mkdir(path.join(directory, "runs", id), { recursive: true });
      await writeFile(path.join(directory, "runs", id, "journal.jsonl"), content);
    }
    for (let restart = 0; restart < 2; restart++) {
      resolvedWorkspaces.length = 0;
      provider = createProvider();
      await provider.init();
      assert.equal(provider.hasRun(normalId), true);
      assert.ok((await provider.list()).some((run) => run.id === normalId));
      assert.ok(await provider.get(normalId));
      for (const [id, content] of unavailable) {
        assert.equal(provider.hasRun(id), false);
        assert.equal(resolvedWorkspaces.includes(id), false);
        assert.equal((provider as unknown as { sessions: Map<string, unknown> }).sessions.has(id), false);
        await assert.rejects(provider.get(id), { code: "journal-unavailable", status: 409 });
        const stream = await fetch(`${base}/chat/${id}/stream`);
        assert.equal(stream.status, 409);
        await stream.json();
        assert.equal(await readFile(path.join(directory, "runs", id, "journal.jsonl"), "utf8"), content);
      }
      assert.equal((provider as unknown as { engine: Engine }).engine.journal.loadFailures().length, unavailable.size);
      if (restart === 0) await provider.shutdown();
    }
    faux.setResponses([
      () => fauxAssistantMessage("Gesunder Lauf nach beschädigten Journalen"),
      () => fauxAssistantMessage("Neuer Lauf nach beschädigten Journalen"),
      () => fauxAssistantMessage("Global nach ausdrücklichem Reset"),
    ]);
    await (await provider.get(normalId)).send("Bestehenden Lauf fortsetzen");
    await until(() => management!.view(normalId).turns.length === 2 && management!.view(normalId).turns.every((turn) => turn.status === "completed"));
    const freshId = await management!.create({ title: "Neuer gesunder Lauf", kind: "message", message: "Trotz alter Journale starten" });
    await until(() => management!.view(freshId).turns[0]?.status === "completed");
    const recoverGlobal = await fetch(resetUrl, { method: "POST", body: JSON.stringify({ confirm: true }) });
    assert.equal(recoverGlobal.status, 200);
    await recoverGlobal.json();
    await (await provider.get("overseer")).send("Nach Reset des alten Journals");
    await until(() => management!.view("overseer").turns[0]?.status === "completed");
    assert.equal(provider.hasRun(normalId), true);
    assert.equal(provider.hasRun(freshId), true);
    for (const [id, content] of unavailable) {
      if (id === "overseer") continue;
      assert.equal(await readFile(path.join(directory, "runs", id, "journal.jsonl"), "utf8"), content);
    }
  } finally {
    releaseGlobal.resolve(); releaseNormal.resolve();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await provider.shutdown(); faux.unregister(); await rm(directory, { recursive: true, force: true });
  }
});
