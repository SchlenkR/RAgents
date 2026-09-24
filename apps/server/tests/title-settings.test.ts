import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test, { type TestContext } from "node:test";
import { ModelRuntime } from "@ragents/agent";
import { DomainError } from "@ragents/engine";
import { TitleSettingsStore } from "../src/title-settings.ts";

const initial = { provider: "openrouter", model: "google/gemma-4-26b-a4b-it" };
const next = { provider: "openrouter", model: "qwen/qwen3.8-flash" };
const fixture = async (t: TestContext) => {
  const directory = await mkdtemp(path.join(tmpdir(), "ragents-title-settings-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  t.mock.method(globalThis, "fetch", () => { throw new Error("Title settings tests must not access the network"); });
  const runtime = ModelRuntime.create();
  const file = path.join(directory, "settings.json");
  const store = await TitleSettingsStore.create(file, runtime, initial, "openrouter");
  return { directory, file, runtime, store };
};

test("title settings offer actual text models with reasoning off and prioritize the small title models", async (t) => {
  const { store } = await fixture(t);
  const settings = store.get();
  assert.deepEqual(settings.selection, initial);
  assert.deepEqual(settings.models.slice(0, 2).map((model) => model.id), [initial.model, next.model]);
  assert.ok(settings.models.every((model) => model.provider === "openrouter" && model.label));
  assert.equal(settings.models.some((model) => model.id === "z-ai/glm-5.3-flash"), false);
  settings.selection!.model = "mutated";
  settings.models[0]!.id = "mutated";
  const selection = store.selection()!;
  selection.provider = "mutated";
  assert.deepEqual(store.selection(), initial);
  assert.equal(store.get().models[0]!.id, initial.model);
});

test("a changed or disabled title model survives reload independently of new defaults", async (t) => {
  const { store, file, runtime } = await fixture(t);
  assert.deepEqual((await store.save({ selection: next })).selection, next);
  assert.deepEqual(JSON.parse(await readFile(file, "utf8")), { selection: next });
  const reloaded = await TitleSettingsStore.create(file, runtime, initial, "openrouter");
  assert.deepEqual(reloaded.selection(), next);
  assert.equal((await reloaded.save({ selection: null })).selection, null);
  assert.deepEqual(JSON.parse(await readFile(file, "utf8")), { selection: null });
  assert.equal((await TitleSettingsStore.create(file, runtime, initial, "openrouter")).selection(), null);
});

test("invalid title settings reject unknown models, mandatory thinking, other providers and unexpected body fields", async (t) => {
  const { store, file, runtime } = await fixture(t);
  assert.ok(runtime.getModel("openrouter", "z-ai/glm-5.3-flash"), "The mandatory-thinking regression must use an existing model");
  await store.save({ selection: initial });
  const invalid = [
    undefined, null, [], {}, { selection: initial, extra: true }, { selection: initial, models: [] },
    { selection: undefined }, { selection: [] }, { selection: "disabled" }, { selection: {} },
    { selection: { model: initial.model } }, { selection: { provider: initial.provider } },
    { selection: { ...initial, provider: 7 } }, { selection: { ...initial, model: false } },
    { selection: { ...initial, model: "missing-model" } },
    { selection: { ...initial, model: "z-ai/glm-5.3-flash" } },
    { selection: { ...initial, provider: "google" } },
    { selection: { ...initial, thinking: "off" } }, { selection: { ...initial, label: "Titel" } },
  ];
  for (const value of invalid) {
    await assert.rejects(store.save(value), (error) => error instanceof DomainError && error.code === "title-model-invalid");
  }
  assert.deepEqual(store.selection(), initial);
  assert.deepEqual(JSON.parse(await readFile(file, "utf8")), { selection: initial });
});

test("corrupt persisted title settings and unavailable provider catalogs fail immediately", async (t) => {
  const { file, runtime, directory } = await fixture(t);
  await writeFile(file, "not-json");
  await assert.rejects(TitleSettingsStore.create(file, runtime, initial, "openrouter"), SyntaxError);
  for (const value of [{}, { selection: { ...initial, model: "missing-model" } }, { selection: initial, extra: true }]) {
    await writeFile(file, JSON.stringify(value));
    await assert.rejects(TitleSettingsStore.create(file, runtime, initial, "openrouter"), /selection|steht nicht zur Wahl/);
  }
  await assert.rejects(TitleSettingsStore.create(directory, runtime, initial, "openrouter"), /EISDIR/);
  await assert.rejects(TitleSettingsStore.create(path.join(directory, "new.json"), runtime, initial, "unknown-provider"), /steht nicht zur Wahl/);
  await assert.rejects(TitleSettingsStore.create(path.join(directory, "new.json"), runtime, { ...initial, model: "z-ai/glm-5.3-flash" }, "openrouter"), /steht nicht zur Wahl/);
});

test("an empty catalog only fails the start with a configured title model, otherwise titles stay switched off", async (t) => {
  const { directory, runtime } = await fixture(t);
  const file = path.join(directory, "disabled.json");
  const store = await TitleSettingsStore.create(file, runtime, null, "unknown-provider");
  assert.deepEqual(store.get(), { selection: null, models: [] });
  await assert.rejects(store.save({ selection: initial }), (error) => error instanceof DomainError && error.code === "title-model-invalid");
  assert.equal((await store.save({ selection: null })).selection, null);
  assert.equal((await TitleSettingsStore.create(file, runtime, initial, "unknown-provider")).selection(), null);
});

test("failed title settings writes preserve the active selection and later serialized writes still succeed", async (t) => {
  const { store, file } = await fixture(t);
  await store.save({ selection: initial });
  await mkdir(`${file}.tmp`);
  await assert.rejects(store.save({ selection: next }), /EISDIR/);
  assert.deepEqual(store.selection(), initial);
  assert.deepEqual(JSON.parse(await readFile(file, "utf8")), { selection: initial });
  await rm(`${file}.tmp`, { recursive: true });
  const saved = await Promise.all([
    store.save({ selection: next }), store.save({ selection: null }), store.save({ selection: initial }),
  ]);
  assert.deepEqual(saved.map((value) => value.selection), [next, null, initial]);
  assert.deepEqual(store.selection(), initial);
  assert.deepEqual(JSON.parse(await readFile(file, "utf8")), { selection: initial });
});
