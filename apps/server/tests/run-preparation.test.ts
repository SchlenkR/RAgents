import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import fs from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
import { syncBuiltinESMExports } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import test, { after, type TestContext } from "node:test";
import type { ModelRuntime } from "@ragents/agent";
import { fauxAssistantMessage, fauxToolCall, type AssistantMessage } from "@ragents/ai";
import { createFauxCore } from "../../../packages/ai/src/providers/faux.ts";
import { preparationPrompt } from "../../../plugins/ragents.overseer/server/coordinator-prompt.ts";
import { ChannelContributionRegistry, DomainError, Journal, LiveBus, MethodContributionRegistry, Orchestration, RPC_ERROR_CODES, RpcError, RpcPeer, SessionMetadataContributionRegistry, StartOptionContributionRegistry, StaticModelCatalog, unrestrictedAccess,
  type AgentProfile, type CatalogModel } from "@ragents/engine";
import { executionFor, testServices } from "../../../packages/ragents/tests/support.ts";
import { unavailableActorPrograms } from "./actor-programs-fixture.ts";
import { productStartOptions } from "../src/plugin-support/product-start-options.ts";
import type { Engine } from "../src/ragents/engine.ts";
import { RunChatSession } from "../src/ragents/session.ts";
import { parseRunPreparationRequest, prepareRunMessage } from "../src/run-preparation.ts";
import { coreContracts } from "../src/api/contracts.ts";
import { coreMethods } from "../src/api/core-methods.ts";
import { RpcConnection, RpcDispatcher } from "../src/rpc/dispatcher.ts";
import { coreSources, methodContext } from "./rpc-fixture.ts";
import { MAX_RUN_PREPARATION_TEXT_CHARS, type RunPreparationResponse } from "../src/run-preparation-contract.ts";

const directory = await mkdtemp(path.join(tmpdir(), "ragents-preparation-"));
process.env.DATA_DIR = directory;
process.env.PRODUCT_PROFILE = "core";
process.env.PRODUCT_ID = "test";
process.env.PRODUCT_TITLE = "Test";
const { RunSessionProvider, SESSION_METADATA_TIMEOUT_MS } = await import("../src/provider.ts");
after(() => rm(directory, { recursive: true, force: true }));

const request = () => parseRunPreparationRequest({ messages: [{ role: "user", text: "Erstelle eine kleine Textanalyse." }] });
const attachment = (name = "note.txt", mediaType = "text/plain", text = "Ergebnis: Wörter zählen.") => ({ name, mediaType, data: Buffer.from(text).toString("base64") });
const isDomain = (status: number, code?: string) => (error: unknown) => error instanceof DomainError && error.status === status && (!code || error.code === code);
const model = { id: "selected", provider: "test", api: "faux", name: "Selected model", baseUrl: "http://localhost:0", reasoning: true,
  input: ["text", "image", "video", "file"] as ("text" | "image" | "video" | "file")[], contextWindow: 100_000, maxTokens: 20_000,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } };
const runtimeFixture = (t: TestContext, complete: (...args: Parameters<ModelRuntime["completeSimple"]>) => Promise<AssistantMessage> = async () => fauxAssistantMessage("Welche Kennzahlen soll die Analyse zeigen?")) => {
  const faux = createFauxCore({ models: [model] });
  faux.setResponses(Array.from({ length: 8 }, () => (context, settings, _state, selected) => complete(selected, context, settings)));
  const streamSimple = t.mock.fn(faux.streamSimple);
  const runtime = { getModel: (provider: string, id: string) => provider === model.provider && id === model.id ? model : undefined,
    checkAuth: async () => ({ type: "api_key" }), streamSimple } as unknown as ModelRuntime;
  return { runtime, streamSimple, options: { runtime, prompt: preparationPrompt,
    selection: { provider: model.provider, model: model.id, thinking: "high" as const },
    request: request(), signal: new AbortController().signal } };
};

const sessionFixture = () => {
  const services = testServices();
  const journal = new Journal(":memory:", services);
  const runtime = new Orchestration(journal, services);
  const models: CatalogModel[] = ["selected", "default"].map((id) => ({ driver: "agent", provider: "test", model: id, label: id, thinking: ["off", "low", "high"] }));
  const profiles: AgentProfile[] = [{ name: "coordinator", description: "Test coordinator", driver: "agent", provider: "test", model: "default",
    thinking: "low", turnTimeoutMs: null, isolateWorkspace: false }];
  const startOptions = new StartOptionContributionRegistry();
  startOptions.register("test.product", productStartOptions({ modelChoice: {
    options: ["selected", "default"], defaultModel: "default", provider: "test", selectable: true, thinkingOptionsFor: () => ["off", "low", "high"],
  }, coordinatorThinking: "low", systemPrompts: () => ({ mode: "fixed", options: [], defaultIds: [], shareDefault: false }) }));
  const engine = { journal, runtime, live: new LiveBus(), scheduler: { isRunning: () => false }, catalog: new StaticModelCatalog(models, profiles),
    startOptions } as unknown as Engine;
  const unused = async () => { throw new Error("Preparation must not create a workspace or run."); };
  const session = new RunChatSession({ engine, id: "draft", coordinator: { handle: "coordinator", displayName: "Koordinator", profile: "coordinator",
    runTitle: "Neuer Run", ownerHandle: "owner", ownerDisplayName: "Owner" }, prompt: () => "", assertUsable: () => {},
    prepare: unused, prepareWorkspace: unused, scriptEntryFor: () => undefined, startEntryFor: () => undefined, actorPrograms: unavailableActorPrograms });
  return { engine, session, journal };
};

test("preparation uses the same coordinator model selection before start and creates no journal or workspace", async (t) => {
  const { session, journal } = sessionFixture();
  t.after(() => journal.close());
  assert.deepEqual(session.preparationSelection(null), { provider: "test", model: "default", thinking: "low" });
  session.selectStartOption("ragents.model", { model: "selected", thinking: "high" }, null);
  const { options, streamSimple } = runtimeFixture(t);
  const result = await prepareRunMessage({ ...options, selection: session.preparationSelection(null) });
  assert.deepEqual(result, { kind: "reply", text: "Welche Kennzahlen soll die Analyse zeigen?" });
  assert.equal(streamSimple.mock.calls[0]!.arguments[0].id, "selected");
  assert.equal(streamSimple.mock.calls[0]!.arguments[2]?.reasoning, "high");
  assert.deepEqual(journal.runIds(), []);
  assert.deepEqual(await readdir(directory), []);
  assert.equal(session.started, false);
  assert.equal(session.startLocked, false);
  session.dispose();
  assert.throws(() => session.preparationSelection(null), isDomain(409));
});

test("preparation forwards the full conversation and native attachments with only the start tool and without reasoning fallback", async (t) => {
  const { options, streamSimple } = runtimeFixture(t);
  options.request = parseRunPreparationRequest({ messages: [
    { role: "user", text: "Baue eine Textanalyse", attachments: [attachment()] },
    { role: "assistant", text: "Welche Ausgabe soll sie zeigen?" },
    { role: "user", text: "Wörter und dieses Bild.", attachments: [attachment("photo.png", "image/png", "image"),
      attachment("clip.mp4", "video/mp4", "video"), attachment("note.pdf", "application/pdf", "pdf")] },
  ] });
  await prepareRunMessage(options);
  const [selected, context, settings] = streamSimple.mock.calls[0]!.arguments;
  assert.equal(selected, model);
  assert.equal(context.messages.length, 3);
  assert.match(context.messages[0]!.content as string, /Angehängte Textdatei.*note.txt/);
  assert.match(context.messages[0]!.content as string, /Ergebnis: Wörter zählen/);
  assert.equal(context.messages[1]!.role, "assistant");
  assert.deepEqual(context.messages[1]!.content, [{ type: "text", text: "Welche Ausgabe soll sie zeigen?" }]);
  assert.deepEqual((context.messages[2]!.content as { type: string }[]).map((part) => part.type), ["text", "image", "video", "file"]);
  assert.deepEqual(context.tools?.map((tool) => tool.name), ["start_run"]);
  assert.deepEqual(context.tools?.[0]?.parameters.properties, {});
  assert.match(context.systemPrompt!, /sinngemäßen Go/);
  assert.equal(settings?.maxRetries, 0);
  assert.equal(settings?.timeoutMs, 120_000);
  await prepareRunMessage({ ...options, selection: { ...options.selection, thinking: "off" } });
  assert.equal(streamSimple.mock.calls[1]!.arguments[2]?.reasoning, undefined);
});

test("start tool hands off original conversation, selected skill and attachments once after the completed turn", async (t) => {
  const responses = [
    fauxAssistantMessage([fauxToolCall("start_run", {}, { id: "start-one" }), fauxToolCall("start_run", {}, { id: "start-two" })]),
    fauxAssistantMessage("Der Auftrag wird übergeben."),
  ];
  const { options, streamSimple } = runtimeFixture(t, async () => responses.shift()!);
  options.request = parseRunPreparationRequest({ skillName: "agent-discussion", messages: [
    { role: "user", text: "Diskutiere das Thema.", attachments: [attachment()] },
    { role: "assistant", text: "Ich schlage zwei Runden vor." },
    { role: "user", text: "Ja, leg damit los." },
  ] });
  const result = await prepareRunMessage(options);
  assert.equal(result.kind, "start");
  if (result.kind !== "start") throw new Error("Start expected");
  assert.match(result.input.text, /^Nutze den Skill agent-discussion/);
  for (const message of options.request.messages) assert.ok(result.input.text.includes(message.text));
  assert.deepEqual(result.input.attachments, [attachment()]);
  assert.equal(streamSimple.mock.callCount(), 2);
  const toolResults = streamSimple.mock.calls[1]!.arguments[1].messages.filter((message) => message.role === "toolResult");
  assert.equal(toolResults.length, 2);
  assert.ok(toolResults.every((message) => message.role === "toolResult" && !message.isError));
  assert.deepEqual(await readdir(directory), []);
});

test("a textual start claim without a tool call stays a reply", async (t) => {
  const { options } = runtimeFixture(t, async () => fauxAssistantMessage("Ich starte den Run jetzt."));
  assert.deepEqual(await prepareRunMessage(options), { kind: "reply", text: "Ich starte den Run jetzt." });
});

test("a failed turn discards an already requested start", async (t) => {
  for (const stopReason of ["error", "length"] as const) {
    const responses = [fauxAssistantMessage([fauxToolCall("start_run", {})]),
      fauxAssistantMessage("Unvollständig", { stopReason, errorMessage: "Synthetic failure" })];
    const { options, streamSimple } = runtimeFixture(t, async () => responses.shift()!);
    await assert.rejects(prepareRunMessage(options), isDomain(502, "preparation-model-failed"));
    assert.equal(streamSimple.mock.callCount(), 2);
  }
});

test("abort after the start tool discards its pending handoff and a late final reply", async (t) => {
  const finalReply = Promise.withResolvers<AssistantMessage>();
  const started = Promise.withResolvers<void>();
  const { options, streamSimple } = runtimeFixture(t, async (_model, context) => {
    if (!context.messages.some((message) => message.role === "toolResult")) return fauxAssistantMessage([fauxToolCall("start_run", {})]);
    started.resolve();
    return finalReply.promise;
  });
  const controller = new AbortController();
  const pending = prepareRunMessage({ ...options, signal: controller.signal });
  await started.promise;
  controller.abort();
  finalReply.resolve(fauxAssistantMessage("Jetzt geht es los."));
  await assert.rejects(pending, isDomain(499, "preparation-aborted"));
  assert.equal(streamSimple.mock.callCount(), 2);
});

test("invalid histories and a split attachment budget are rejected before model work", () => {
  for (const invalid of [null, {}, { messages: [] }, { messages: [{ role: "system", text: "System" }] },
    { messages: [{ role: "assistant", text: "Antwort" }] }, { messages: [{ role: "user", text: " " }] },
    { messages: [{ role: "user", text: "x".repeat(MAX_RUN_PREPARATION_TEXT_CHARS + 1) }] },
    { messages: [{ role: "user", text: "Auftrag" }, { role: "user", text: "Nachtrag" }, { role: "user", text: "Weiter" }] },
    { messages: [{ role: "user", text: "Auftrag" }, { role: "assistant", text: "Antwort", attachments: [] }, { role: "user", text: "Weiter" }] },
    { messages: [{ role: "user", text: "Auftrag", attachments: Array.from({ length: 5 }, () => attachment()) },
      { role: "assistant", text: "Antwort" }, { role: "user", text: "Weiter", attachments: Array.from({ length: 4 }, () => attachment()) }] },
  ]) assert.throws(() => parseRunPreparationRequest(invalid), isDomain(400));
  const large = attachment("large.txt", "text/plain", "x".repeat(11 * 1024 * 1024));
  assert.throws(() => parseRunPreparationRequest({ messages: [
    { role: "user", text: "Auftrag", attachments: [large] }, { role: "assistant", text: "Antwort" },
    { role: "user", text: "Weiter", attachments: [large] },
  ] }), isDomain(400));
});

test("unsupported attachments and invalid text encodings fail without calling the model or writing files", async (t) => {
  const { options, streamSimple } = runtimeFixture(t);
  const mkdir = t.mock.method(fs, "mkdir", async () => { throw new Error("Preparation must not create directories"); });
  const write = t.mock.method(fs, "writeFile", async () => { throw new Error("Preparation must not write files"); });
  syncBuiltinESMExports();
  try {
    for (const file of [attachment("archive.zip", "application/zip"), { ...attachment(), data: "/w==" }]) {
      await assert.rejects(prepareRunMessage({ ...options, request: parseRunPreparationRequest({ messages: [{ role: "user", text: "", attachments: [file] }] }) }), isDomain(400, "preparation-attachment-unsupported"));
    }
    assert.equal(mkdir.mock.callCount(), 0);
    assert.equal(write.mock.callCount(), 0);
  } finally {
    mkdir.mock.restore();
    write.mock.restore();
    syncBuiltinESMExports();
  }
  const textRuntime = { ...options.runtime, getModel: () => ({ ...model, input: ["text"] }) } as unknown as ModelRuntime;
  await assert.rejects(prepareRunMessage({ ...options, runtime: textRuntime, request: parseRunPreparationRequest({ messages: [
    { role: "user", text: "Bild beschreiben", attachments: [attachment("photo.png", "image/png")] },
  ] }) }), isDomain(400, "preparation-attachment-unsupported"));
  assert.equal(streamSimple.mock.callCount(), 0);
  assert.deepEqual(await readdir(directory), []);
});

test("missing models and failed completions fail explicitly without a second call, empty text after one nudge", async (t) => {
  const { options, streamSimple } = runtimeFixture(t);
  await assert.rejects(prepareRunMessage({ ...options, selection: { ...options.selection, model: "missing" } }), isDomain(400));
  assert.equal(streamSimple.mock.callCount(), 0);
  for (const response of [fauxAssistantMessage("x".repeat(MAX_RUN_PREPARATION_TEXT_CHARS + 1)), fauxAssistantMessage("", { stopReason: "error", errorMessage: "Synthetic failure" }),
    fauxAssistantMessage("partial", { stopReason: "length" }), fauxAssistantMessage("tool", { stopReason: "toolUse" })]) {
    const failing = runtimeFixture(t, async () => response);
    await assert.rejects(prepareRunMessage(failing.options), isDomain(502));
    assert.equal(failing.streamSimple.mock.callCount(), 1);
  }
  const empty = runtimeFixture(t, async () => fauxAssistantMessage(" "));
  await assert.rejects(prepareRunMessage(empty.options), (error: unknown) => isDomain(502)(error) && /zweimal eine leere Antwort/.test((error as Error).message));
  assert.equal(empty.streamSimple.mock.callCount(), 2);
});

test("abort reaches the model and discards a late response", async (t) => {
  const response = Promise.withResolvers<AssistantMessage>();
  const started = Promise.withResolvers<void>();
  const { options, streamSimple } = runtimeFixture(t, async () => { started.resolve(); return response.promise; });
  const controller = new AbortController();
  const pending = prepareRunMessage({ ...options, signal: controller.signal });
  await started.promise;
  assert.equal(streamSimple.mock.callCount(), 1);
  controller.abort();
  assert.equal(streamSimple.mock.calls[0]!.arguments[2]?.signal?.aborted, true);
  response.resolve(fauxAssistantMessage("Late reply"));
  await assert.rejects(pending, isDomain(499));
  await assert.rejects(prepareRunMessage({ ...options, signal: controller.signal }), isDomain(499));
  assert.equal(streamSimple.mock.callCount(), 1);
});

const prepareMethod = (prepare: (request: unknown, signal: AbortSignal) => Promise<RunPreparationResponse>) => {
  const provider = { get: async () => { throw new Error("nicht gefragt"); }, list: async () => [], delete: async () => undefined };
  const sources = coreSources(provider);
  return coreMethods({ ...sources, sessions: { ...sources.sessions, prepareRunMessage: (_runId, request, signal) => prepare(request, signal) } });
};

test("the preparation method hands the request body through, maps errors and rejects malformed input", async () => {
  const good = prepareMethod(async (body, signal) => {
    assert.equal(signal.aborted, false);
    assert.deepEqual(body, request());
    return { kind: "reply", text: "Rückfrage" };
  }).find((entry) => entry.contract.id === coreContracts.prepare.id)!;
  assert.deepEqual(await good.execute({ runId: "run", ...request() } as never, methodContext()), { kind: "reply", text: "Rückfrage" });

  const methods = new MethodContributionRegistry();
  methods.register("test", prepareMethod(async (body) => { parseRunPreparationRequest(body); throw new Error("Must not be called"); }));
  const dispatcher = new RpcDispatcher({ methods, channels: new ChannelContributionRegistry() });
  const connection = new RpcConnection({ id: "test", access: unrestrictedAccess, local: true, peer: new RpcPeer({ send: () => undefined }), streamless: true }, dispatcher);
  const handlerContext = { id: 1, signal: new AbortController().signal, progress: () => undefined };
  await assert.rejects(dispatcher.dispatch(connection, coreContracts.prepare.id, "broken", handlerContext), (error: unknown) => error instanceof RpcError && error.code === RPC_ERROR_CODES.invalidParams);
  await assert.rejects(dispatcher.dispatch(connection, coreContracts.prepare.id, { runId: "run", messages: "nicht" }, handlerContext), isDomain(400));

  const failed = prepareMethod(async () => { throw new DomainError("preparation-busy", "Busy", 409); }).find((entry) => entry.contract.id === coreContracts.prepare.id)!;
  await assert.rejects(failed.execute({ runId: "run", ...request() } as never, methodContext()), isDomain(409));
});

test("aborting the request signal aborts a pending completion", async () => {
  const started = Promise.withResolvers<AbortSignal>();
  const finish = Promise.withResolvers<RunPreparationResponse>();
  const method = prepareMethod(async (_body, signal) => { started.resolve(signal); return finish.promise; }).find((entry) => entry.contract.id === coreContracts.prepare.id)!;
  const controller = new AbortController();
  const pending = method.execute({ runId: "run", ...request() } as never, { ...methodContext(), signal: controller.signal });
  const signal = await started.promise;
  assert.equal(signal.aborted, false);
  controller.abort();
  assert.equal(signal.aborted, true);
  finish.resolve({ kind: "reply", text: "Late" });
  assert.deepEqual(await pending, { kind: "reply", text: "Late" });
});

const providerFixture = (t: TestContext) => {
  const { engine, session, journal } = sessionFixture();
  t.after(() => { session.dispose(); journal.close(); });
  session.selectStartOption("ragents.model", { model: "selected", thinking: "high" }, null);
  const response = Promise.withResolvers<AssistantMessage>();
  const started = Promise.withResolvers<void>();
  const { runtime, streamSimple } = runtimeFixture(t, async () => { started.resolve(); return response.promise; });
  const provider = Object.create(RunSessionProvider.prototype) as InstanceType<typeof RunSessionProvider>;
  const preparations = new Map<string, { controller: AbortController; done: Promise<unknown> }>();
  Object.assign(provider, { sessions: new Map([["draft", session]]), runPreparations: preparations, deleted: new Set(), deleteRequested: new Set(),
    deleting: new Map(), plugins: { optionalService: () => ({ preparationPrompt }) }, engine, modelRuntime: Promise.resolve(runtime),
    titleCompactor: { shutdown: async () => {}, cancel: async () => {} }, listListeners: new Set(), sessionWorkspaces: new Map() });
  return { provider, response, started, streamSimple, session, engine, preparations };
};

test("provider rejects concurrent preparation and a response after a run begins", async (t) => {
  const fixture = providerFixture(t);
  const pending = fixture.provider.prepareRunMessage("draft", request(), new AbortController().signal, null);
  await fixture.started.promise;
  await assert.rejects(fixture.provider.prepareRunMessage("draft", request(), new AbortController().signal, null), isDomain(409, "preparation-busy"));
  Object.defineProperty(fixture.session, "startLocked", { get: () => true });
  fixture.response.resolve(fauxAssistantMessage("Late response"));
  await assert.rejects(pending, isDomain(409, "preparation-unavailable"));
  assert.equal(fixture.streamSimple.mock.callCount(), 1);
  assert.equal(fixture.preparations.size, 0);
});

test("provider shutdown aborts pending preparation before disposing the runtime", async (t) => {
  const fixture = providerFixture(t);
  Object.assign(fixture.engine, { shutdown: async () => {} });
  const pending = fixture.provider.prepareRunMessage("draft", request(), new AbortController().signal, null);
  await fixture.started.promise;
  const closing = fixture.provider.shutdown();
  assert.equal(fixture.streamSimple.mock.calls[0]!.arguments[2]?.signal?.aborted, true);
  fixture.response.resolve(fauxAssistantMessage("Late response"));
  await assert.rejects(pending, isDomain(499));
  await closing;
  assert.equal(fixture.preparations.size, 0);
});

test("delete aborts preparation as soon as deletion is requested", async (t) => {
  const fixture = providerFixture(t);
  Object.assign(fixture.provider, { persistDeleteIntent: async () => {}, deleteInner: async () => {} });
  const pending = fixture.provider.prepareRunMessage("draft", request(), new AbortController().signal, null);
  await fixture.started.promise;
  const deleting = fixture.provider.delete("draft");
  assert.equal(fixture.streamSimple.mock.calls[0]!.arguments[2]?.signal?.aborted, true);
  fixture.response.resolve(fauxAssistantMessage("Late response"));
  await assert.rejects(pending, isDomain(499));
  await deleting;
  await assert.rejects(fixture.provider.prepareRunMessage("draft", request(), new AbortController().signal, null), isDomain(409, "run-deleting"));
});

test("provider describes only visible runs, in parallel, and a silent or failing contribution only loses its value", async (t) => {
  const { engine, session, journal } = sessionFixture();
  t.after(() => { session.dispose(); journal.close(); });
  for (const runId of ["visible-a", "visible-b", "hidden"]) {
    engine.runtime.createRun({ commandId: `create-${runId}` }, { runId, title: runId, ownerHandle: "owner", ownerDisplayName: "Owner" });
  }
  const metadata = new SessionMetadataContributionRegistry();
  const described: string[] = [];
  metadata.register("test.silent", [{ id: "test.silent", describe: ({ runId }) => { described.push(runId); return new Promise(() => {}); } }]);
  metadata.register("test.fast", [{ id: "test.fast", describe: ({ runId }) => ({ runId }) }]);
  metadata.register("test.failing", [{ id: "test.failing", describe: () => { throw new Error("kaputt"); } }]);
  const provider = Object.create(RunSessionProvider.prototype) as InstanceType<typeof RunSessionProvider>;
  Object.assign(provider, {
    engine,
    sessions: new Map(),
    deleteRequested: new Set(), deleted: new Set(),
    plugins: { optionalService: () => undefined, service: () => ({ coordinator: { runTitle: "New" } }), sessionMetadata: metadata },
  });

  const started = performance.now();
  const listed = await provider.list({ visible: (runId) => runId !== "hidden", workspaceAccessible: () => true });
  const elapsed = performance.now() - started;

  assert.deepEqual(listed.map((entry) => entry.id).sort(), ["visible-a", "visible-b"]);
  assert.deepEqual(described.sort(), ["visible-a", "visible-b"], "a run the caller may not see is never described");
  assert.ok(elapsed < 1.8 * SESSION_METADATA_TIMEOUT_MS, `two silent contributions must wait side by side, not one after the other (${Math.round(elapsed)} ms)`);
  const entry = listed.find((candidate) => candidate.id === "visible-a")!;
  assert.deepEqual(entry.metadata, { "test.fast": { runId: "visible-a" } });
  assert.deepEqual(entry.metadataUnavailable, {
    "test.silent": `keine Antwort nach ${SESSION_METADATA_TIMEOUT_MS} ms`,
    "test.failing": "kaputt",
  });
});

test("provider lists the current journal revision and leaves preparing sessions without one", async (t) => {
  const { engine, session, journal } = sessionFixture();
  t.after(() => { session.dispose(); journal.close(); });
  const run = engine.runtime.createRun({ commandId: "create-listed-run" }, {
    runId: "listed-run", title: "Listed", ownerHandle: "owner", ownerDisplayName: "Owner",
  });
  const provider = Object.create(RunSessionProvider.prototype) as InstanceType<typeof RunSessionProvider>;
  Object.assign(provider, {
    engine,
    sessions: new Map([["preparing", { started: true, running: true }]]),
    deleteRequested: new Set(), deleted: new Set(),
    plugins: {
      optionalService: () => undefined,
      service: () => ({ coordinator: { runTitle: "New" } }),
      sessionMetadata: { describe: async () => ({ values: {}, unavailable: {} }) },
      startOptions: new StartOptionContributionRegistry(),
    },
  });
  const listed = (await provider.list()).find((entry) => entry.id === run.id)!;
  assert.equal(listed.revision, journal.stateOf(run.id)!.revision);
  assert.notEqual(listed.revision, listed.updatedAt);
  engine.runtime.retitleRun({ commandId: "rename-listed-run", actorId: run.ownerId }, run.id, "Renamed");
  const next = await provider.list();
  assert.equal(next.find((entry) => entry.id === run.id)!.revision, journal.stateOf(run.id)!.revision);
  assert.ok(next.find((entry) => entry.id === run.id)!.revision! > listed.revision!);
  assert.equal(next.find((entry) => entry.id === "preparing")!.revision, undefined);
  assert.equal(next.find((entry) => entry.id === "preparing")!.running, true);

  for (const handle of ["primary", "worker"]) {
    engine.runtime.spawnAgent({ commandId: `spawn-${handle}`, actorId: run.ownerId }, run.id, {
      handle, displayName: handle, prompt: "Test", execution: executionFor(handle, { profile: "agent" }), grants: [], toolNames: [],
    });
  }
  const actors = engine.runtime.view(run.id).actors;
  const primary = actors.find((actor) => actor.handle === "primary")!;
  const worker = actors.find((actor) => actor.handle === "worker")!;
  engine.runtime.selectPrimaryActor({ commandId: "select-primary", actorId: run.ownerId }, run.id, primary.id);
  let workerRunning = true;
  const queried: string[] = [];
  t.mock.method(engine.scheduler, "isRunning", (runId: string, actorId: string) => {
    assert.equal(runId, run.id);
    queried.push(actorId);
    return actorId === worker.id && workerRunning;
  });
  assert.equal((await provider.list()).find((entry) => entry.id === run.id)!.running, true);
  assert.ok(queried.includes(primary.id));
  assert.ok(queried.includes(worker.id));
  assert.ok(!queried.includes(run.ownerId));
  workerRunning = false;
  assert.equal((await provider.list()).find((entry) => entry.id === run.id)!.running, false);
});
