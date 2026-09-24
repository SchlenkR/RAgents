import assert from "node:assert/strict";
import test from "node:test";
import { RpcClient } from "../src/rpc/client.ts";
import type { TitleModelSelection, TitleModelSettings } from "../../server/src/title-settings-contract.ts";
import { requestTitleModelSettings, titleModelOptions, titleModelSettingsFrom, titleSelectionFromKey, titleSelectionKey } from "../src/title-model-settings.ts";

const settings: TitleModelSettings = {
  selection: { provider: "openrouter", model: "model-a" },
  models: [
    { provider: "openrouter", id: "model-b", label: "Empfohlenes Modell" },
    { provider: "openrouter", id: "model-a", label: "Bisheriges Modell" },
    { provider: "other", id: "model-a", label: "Anderer Anbieter" },
  ],
};
interface TitleCall { id: number; method: string; params: { value?: { selection?: TitleModelSelection | null } } }

const callOf = (init: RequestInit | undefined): TitleCall => JSON.parse(String(init?.body)) as TitleCall;
const result = (call: TitleCall, value: unknown) => Response.json({ jsonrpc: "2.0", id: call.id, result: value });
const failure = (call: TitleCall, message: string) => Response.json({ jsonrpc: "2.0", id: call.id, error: { code: -32000, message } });
const clientWith = (respond: typeof fetch) => new RpcClient({ fetch: respond });

test("title settings use their own methods and save a selection or explicit null without reasoning fields", async () => {
  const calls: TitleCall[] = [];
  const controller = new AbortController();
  const client = clientWith(async (_url, init) => {
    const call = callOf(init);
    calls.push(call);
    return result(call, call.params.value === undefined ? settings : { ...settings, ...call.params.value });
  });
  assert.deepEqual(await requestTitleModelSettings({ client, signal: controller.signal }), settings);
  const selection = { provider: "other", model: "model-a" };
  assert.deepEqual((await requestTitleModelSettings({ client, selection })).selection, selection);
  assert.equal((await requestTitleModelSettings({ client, selection: null })).selection, null);
  assert.deepEqual(calls.map((call) => call.method), [
    "ragents.settings.titles.read", "ragents.settings.titles.save", "ragents.settings.titles.save",
  ]);
  assert.deepEqual(calls[0]!.params, {});
  assert.deepEqual(calls[1]!.params, { value: { selection } });
  assert.deepEqual(calls[2]!.params, { value: { selection: null } });
});

test("disabled titles are valid without a model catalog while missing or inconsistent selections are rejected", () => {
  assert.deepEqual(titleModelSettingsFrom({ selection: null, models: [] }), { selection: null, models: [] });
  assert.deepEqual(titleModelSettingsFrom(settings), settings);
  for (const invalid of [
    {}, { models: [] }, { selection: false, models: [] }, { ...settings, selection: {} },
    { ...settings, selection: { provider: "absent", model: "model-a" } },
    { ...settings, selection: { provider: "openrouter", model: "missing" } },
    { ...settings, models: [{ provider: "openrouter", id: "model-a", label: "" }] },
    { ...settings, models: [settings.models[0], ...settings.models] },
  ]) assert.throws(() => titleModelSettingsFrom(invalid), /ungültige|Modellkatalog/);
});

test("selection keys distinguish providers and reject stale choices instead of silently disabling titles", () => {
  for (const model of settings.models) {
    const selection = { provider: model.provider, model: model.id };
    assert.deepEqual(titleSelectionFromKey(titleSelectionKey(selection), settings.models), selection);
  }
  assert.notEqual(titleSelectionKey({ provider: "openrouter", model: "model-a" }), titleSelectionKey({ provider: "other", model: "model-a" }));
  assert.equal(titleSelectionFromKey(titleSelectionKey(null), settings.models), null);
  assert.throws(() => titleSelectionFromKey("missing", settings.models), /nicht verfügbar/);
  assert.throws(() => titleSelectionFromKey(titleSelectionKey(settings.selection), []), /nicht verfügbar/);
});

test("local search preserves catalog order, the selected model and the disable option", () => {
  const options = titleModelOptions(settings.models, settings.selection, "");
  assert.deepEqual(options.map(({ label }) => label), ["Keine automatischen Überschriften", ...settings.models.map(({ label }) => label)]);
  assert.deepEqual(titleModelOptions(settings.models, settings.selection, "  EMPFOHLEN  ").map(({ label }) => label), [
    "Keine automatischen Überschriften", "Empfohlenes Modell", "Bisheriges Modell",
  ]);
  assert.deepEqual(titleModelOptions(settings.models, null, "model-a").map(({ label }) => label), [
    "Keine automatischen Überschriften", "Bisheriges Modell", "Anderer Anbieter",
  ]);
  assert.deepEqual(titleModelOptions(settings.models, settings.selection, "no results").map(({ label }) => label), [
    "Keine automatischen Überschriften", "Bisheriges Modell",
  ]);
  assert.deepEqual(titleModelOptions(settings.models, null, "no results"), [{ value: "null", label: "Keine automatischen Überschriften" }]);
});

test("failed saves expose the API error and preserve the local selection", async () => {
  const selection = Object.freeze({ provider: "openrouter", model: "model-a" });
  await assert.rejects(requestTitleModelSettings({ selection, client: clientWith(async (_url, init) => failure(callOf(init), "Keine Berechtigung zum Speichern")) }), /Keine Berechtigung zum Speichern/);
  assert.deepEqual(selection, { provider: "openrouter", model: "model-a" });
  await assert.rejects(requestTitleModelSettings({ client: clientWith(async () => new Response("Unavailable", { status: 503 })) }), /Der Server antwortete mit 503/);
  await assert.rejects(requestTitleModelSettings({ client: clientWith(async (_url, init) => result(callOf(init), { models: [] })) }), /ungültige/);
});
