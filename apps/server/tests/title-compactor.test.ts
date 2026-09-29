import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test, { type TestContext } from "node:test";

import { ModelRuntime } from "@ragents/agent";
import { fauxAssistantMessage, registerFauxProvider } from "@ragents/ai";
import { createTitleCompactor } from "../src/title-compactor.ts";
import type { TitleModelSelection } from "../src/title-settings-contract.ts";

const eventually = async (probe: () => Promise<boolean>, label: string): Promise<void> => {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (await probe()) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(label);
};

const fauxModelRuntime = async (directory: string, id: string | string[], responses: string[]) => {
  const faux = registerFauxProvider({ models: (typeof id === "string" ? [id] : id).map((id) => ({ id, reasoning: false })) });
  faux.setResponses(responses.map((response) => fauxAssistantMessage(response)));
  const modelRuntime = ModelRuntime.create();
  const model = faux.getModel();
  modelRuntime.registerProvider(model.provider, {
    baseUrl: model.baseUrl,
    apiKey: "faux-key",
    api: faux.api,
    models: faux.models.map((entry) => ({
      id: entry.id,
      name: entry.name,
      api: entry.api,
      reasoning: entry.reasoning,
      input: entry.input,
      cost: entry.cost,
      contextWindow: entry.contextWindow,
      maxTokens: entry.maxTokens,
      baseUrl: entry.baseUrl,
    })),
  });
  return { provider: model.provider, model: model.id, modelRuntime, unregister: faux.unregister };
};

const fixture = async (t: TestContext) => {
  const directory = await mkdtemp(path.join(tmpdir(), "ragents-title-regression-"));
  t.mock.method(globalThis, "fetch", () => { throw new Error("Title compactor tests must not access the network"); });
  const faux = await fauxModelRuntime(directory, ["first", "second"], []);
  t.after(async () => { faux.unregister(); await rm(directory, { recursive: true, force: true }); });
  const sessionsDir = path.join(directory, "sessions");
  return { directory, sessionsDir, faux,
    options: { sessionsDir, modelRuntime: () => Promise.resolve(faux.modelRuntime) },
    selection: { provider: faux.provider, model: "first" },
  };
};

test("the title compactor summarizes the first prompt and persists the result", async (t) => {
  const directory = await mkdtemp(path.join(tmpdir(), "ragents-title-compactor-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const sessionsDir = path.join(directory, "sessions");
  const faux = await fauxModelRuntime(directory, "compactor", ['"Two models chat briefly."']);
  t.after(faux.unregister);
  const errors: unknown[] = [];
  const compactor = createTitleCompactor({
    selection: () => ({ provider: faux.provider, model: faux.model }),
    sessionsDir,
    modelRuntime: () => Promise.resolve(faux.modelRuntime),
    onError: (error) => errors.push(error),
  });

  const prompt = "Let's see, spawn two models, they should chat with each other, and always only very briefly.";
  assert.equal(await compactor.titleFor("run-1", prompt), undefined);
  const titleFile = path.join(sessionsDir, "run-1", "title.json");
  await eventually(
    () => readFile(titleFile, "utf8").then(() => true, () => false),
    "The compacted title was not persisted.",
  );
  assert.deepEqual(errors, []);
  assert.equal(await compactor.titleFor("run-1", prompt), "Two models chat briefly");

  const reloaded = createTitleCompactor({
    selection: () => ({ provider: faux.provider, model: faux.model }),
    sessionsDir,
    modelRuntime: () => Promise.resolve(faux.modelRuntime),
  });
  assert.equal(await reloaded.titleFor("run-1", prompt), "Two models chat briefly");
});

test("without a configured compaction model the title stays untouched", async (t) => {
  const directory = await mkdtemp(path.join(tmpdir(), "ragents-title-compactor-off-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const compactor = createTitleCompactor({
    selection: () => null,
    sessionsDir: path.join(directory, "sessions"),
    modelRuntime: () => Promise.reject(new Error("Without a compaction model no model runtime is needed.")),
  });

  assert.equal(await compactor.titleFor("run-1", "Some task."), undefined);
  await new Promise((resolve) => setTimeout(resolve, 50));
  assert.equal(await compactor.titleFor("run-1", "Some task."), undefined);
});

test("concurrent title requests share one bounded model call and publish only the persisted title", { timeout: 5_000 }, async (t) => {
  const { faux, options, sessionsDir } = await fixture(t);
  const selection = { provider: "openrouter", model: "google/gemini-3.1-flash-lite" };
  const originalModel = structuredClone(faux.modelRuntime.getModel(selection.provider, selection.model));
  const response = Promise.withResolvers<ReturnType<typeof fauxAssistantMessage>>();
  const started = Promise.withResolvers<void>();
  const published = Promise.withResolvers<void>();
  const errors: unknown[] = [];
  const notifications: { runId: string; title: string; stored: unknown }[] = [];
  const complete = t.mock.method(faux.modelRuntime, "completeSimple", async () => {
    started.resolve();
    return response.promise;
  });
  const compactor = createTitleCompactor({ ...options, selection: () => selection,
    onError: (error) => errors.push(error),
    onTitle: (runId, title) => {
      notifications.push({ runId, title, stored: JSON.parse(readFileSync(path.join(sessionsDir, runId, "title.json"), "utf8")) });
      published.resolve();
    },
  });
  try {
    const prompt = "A synthetic test task ".repeat(200);
    assert.deepEqual(await Promise.all(Array.from({ length: 12 }, () => compactor.titleFor("concurrent", prompt))), Array(12).fill(undefined));
    await started.promise;
    assert.equal(complete.mock.callCount(), 1);
    const [model, context, requestOptions] = complete.mock.calls[0]!.arguments;
    assert.ok(model && context);
    assert.equal(model.id, selection.model);
    assert.equal(model.compat?.openRouterRouting?.sort, "latency");
    assert.deepEqual(faux.modelRuntime.getModel(selection.provider, selection.model), originalModel);
    assert.match(context.systemPrompt!, /three to eight words/);
    assert.equal(context.messages.length, 1);
    assert.equal(context.messages[0]!.content, prompt.slice(0, 4_000));
    assert.equal(requestOptions?.reasoning, undefined);
    assert.equal(requestOptions?.maxTokens, 48);
    assert.equal(requestOptions?.temperature, 0);
    assert.equal(requestOptions?.maxRetries, 0);
    assert.equal(requestOptions?.timeoutMs, 8_000);
    assert.ok(requestOptions?.signal instanceof AbortSignal);
    assert.equal(requestOptions.signal.aborted, false);
    assert.deepEqual(notifications, []);
    response.resolve(fauxAssistantMessage('"A short test title."\nAdditional text'));
    await published.promise;
    assert.deepEqual(errors, []);
    assert.deepEqual(notifications, [{ runId: "concurrent", title: "A short test title", stored: { title: "A short test title" } }]);
    assert.equal(await compactor.titleFor("concurrent", "Another task"), "A short test title");
    assert.equal(complete.mock.callCount(), 1);
  } finally { response.resolve(fauxAssistantMessage("Finished")); await compactor.shutdown(); }
});

test("new runs resolve the latest title model while existing titles survive model changes and disabling", { timeout: 5_000 }, async (t) => {
  const { faux, options, selection: initial } = await fixture(t);
  let selection: TitleModelSelection | null = initial;
  const notices: string[] = [];
  const complete = t.mock.method(faux.modelRuntime, "completeSimple", async (model: Parameters<ModelRuntime["completeSimple"]>[0]) => fauxAssistantMessage(`Title from ${model.id}`));
  const compactor = createTitleCompactor({ ...options, selection: () => selection, onTitle: (runId) => notices.push(runId) });
  try {
    assert.equal(await compactor.titleFor("old", "First task"), undefined);
    await eventually(async () => notices.includes("old"), "First title was not published");
    selection = { ...initial, model: "second" };
    assert.equal(await compactor.titleFor("old", "Different task"), "Title from first");
    assert.equal(await compactor.titleFor("new", "Second task"), undefined);
    await eventually(async () => notices.includes("new"), "Second title was not published");
    assert.deepEqual(complete.mock.calls.map((call) => call.arguments[0].id), ["first", "second"]);
    selection = null;
    assert.equal(await compactor.titleFor("disabled", "Third task"), undefined);
    assert.equal(await compactor.titleFor("old", "First task"), "Title from first");
    const reloaded = createTitleCompactor({ ...options, selection: () => null });
    assert.equal(await reloaded.titleFor("new", undefined), "Title from second");
    assert.equal(complete.mock.callCount(), 2);
    await reloaded.shutdown();
  } finally { await compactor.shutdown(); }
});

test("a failed title model is tried again only after a different model is selected", { timeout: 5_000 }, async (t) => {
  const { faux, options, selection: initial } = await fixture(t);
  let selection = initial;
  const failed = Promise.withResolvers<void>();
  const published = Promise.withResolvers<void>();
  const errors: unknown[] = [];
  const complete = t.mock.method(faux.modelRuntime, "completeSimple", async (model: Parameters<ModelRuntime["completeSimple"]>[0]) => {
    if (model.id === "first") throw new Error("Synthetic model failure");
    return fauxAssistantMessage("Title after the model change");
  });
  const compactor = createTitleCompactor({ ...options, selection: () => selection,
    onError: (error) => { errors.push(error); failed.resolve(); }, onTitle: () => published.resolve(),
  });
  try {
    await compactor.titleFor("retry", "Task");
    await failed.promise;
    await compactor.titleFor("retry", "Task");
    assert.equal(complete.mock.callCount(), 1);
    selection = { ...initial, model: "second" };
    await compactor.titleFor("retry", "Task");
    await published.promise;
    assert.equal(await compactor.titleFor("retry", "Task"), "Title after the model change");
    assert.deepEqual(complete.mock.calls.map((call) => call.arguments[0].id), ["first", "second"]);
    assert.equal(errors.length, 1);
    assert.match(String(errors[0]), /Synthetic model failure/);
  } finally { await compactor.shutdown(); }
});

for (const operation of ["cancel", "shutdown"] as const) {
  test(`${operation} aborts in-flight title work without callback or resurrecting deleted run files`, { timeout: 5_000 }, async (t) => {
    const { faux, options, sessionsDir, selection } = await fixture(t);
    const response = Promise.withResolvers<ReturnType<typeof fauxAssistantMessage>>();
    const started = Promise.withResolvers<void>();
    const notifications: unknown[] = [];
    const errors: unknown[] = [];
    const complete = t.mock.method(faux.modelRuntime, "completeSimple", async () => { started.resolve(); return response.promise; });
    const compactor = createTitleCompactor({ ...options, selection: () => selection,
      onTitle: (...args) => notifications.push(args), onError: (error) => errors.push(error),
    });
    try {
      const runDir = path.join(sessionsDir, "deleted");
      await mkdir(runDir, { recursive: true });
      await compactor.titleFor("deleted", "Task before deletion");
      await started.promise;
      const closing = operation === "cancel" ? compactor.cancel("deleted") : compactor.shutdown();
      const requestOptions = complete.mock.calls[0]!.arguments[2];
      assert.equal(requestOptions?.signal?.aborted, true);
      await rm(runDir, { recursive: true });
      response.resolve(fauxAssistantMessage("Late title after deletion"));
      await closing;
      assert.deepEqual(notifications, []);
      assert.deepEqual(errors, []);
      await assert.rejects(readFile(path.join(runDir, "title.json"), "utf8"), /ENOENT/);
      assert.equal(await compactor.titleFor("deleted", "Repeated call"), undefined);
      assert.equal(complete.mock.callCount(), 1);
    } finally { response.resolve(fauxAssistantMessage("Finished")); await compactor.shutdown(); }
  });
}

test("cancellation while the model runtime is loading prevents the later model call", { timeout: 5_000 }, async (t) => {
  const { faux, options, sessionsDir, selection } = await fixture(t);
  const loading = Promise.withResolvers<ModelRuntime>();
  const notifications: unknown[] = [];
  const complete = t.mock.method(faux.modelRuntime, "completeSimple", async () => fauxAssistantMessage("Title started too late"));
  const compactor = createTitleCompactor({ ...options, modelRuntime: loading.promise, selection: () => selection,
    onTitle: (...args) => notifications.push(args),
  });
  try {
    await compactor.titleFor("loading", "Task");
    const closing = compactor.cancel("loading");
    loading.resolve(faux.modelRuntime);
    await closing;
    assert.equal(complete.mock.callCount(), 0);
    assert.deepEqual(notifications, []);
    await assert.rejects(readFile(path.join(sessionsDir, "loading", "title.json"), "utf8"), /ENOENT/);
  } finally { loading.resolve(faux.modelRuntime); await compactor.shutdown(); }
});

test("corrupt stored titles fail visibly without generating replacement titles", async (t) => {
  const { faux, options, sessionsDir, selection } = await fixture(t);
  const complete = t.mock.method(faux.modelRuntime, "completeSimple", async () => fauxAssistantMessage("Replacement title"));
  const compactor = createTitleCompactor({ ...options, selection: () => selection });
  try {
    for (const [runId, content] of [["invalid-json", "broken"], ["empty-title", '{"title":" "}']]) {
      const runDir = path.join(sessionsDir, runId!);
      await mkdir(runDir, { recursive: true });
      await writeFile(path.join(runDir, "title.json"), content!);
      await assert.rejects(compactor.titleFor(runId!, "Task"));
      assert.equal(await readFile(path.join(runDir, "title.json"), "utf8"), content);
    }
    assert.equal(complete.mock.callCount(), 0);
  } finally { await compactor.shutdown(); }
});
