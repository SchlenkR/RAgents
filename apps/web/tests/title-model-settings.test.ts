import assert from "node:assert/strict";
import test from "node:test";
import type { TitleModelSettings } from "../../server/src/title-settings-contract.ts";
import { requestTitleModelSettings, titleModelOptions, titleModelSettingsFrom, titleSelectionFromKey, titleSelectionKey } from "../src/title-model-settings.ts";

const settings: TitleModelSettings = {
  selection: { provider: "openrouter", model: "model-a" },
  models: [
    { provider: "openrouter", id: "model-b", label: "Empfohlenes Modell" },
    { provider: "openrouter", id: "model-a", label: "Bisheriges Modell" },
    { provider: "other", id: "model-a", label: "Anderer Anbieter" },
  ],
};
const reply = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status });

test("title settings load from their own endpoint and save a selection or explicit null without reasoning fields", async () => {
  const requests: { url: string; init?: RequestInit }[] = [];
  const controller = new AbortController();
  const request: typeof fetch = async (url, init) => {
    requests.push({ url: String(url), init });
    return reply(init?.body ? { ...settings, ...JSON.parse(String(init.body)) } : settings);
  };
  assert.deepEqual(await requestTitleModelSettings({ request, signal: controller.signal }), settings);
  const selection = { provider: "other", model: "model-a" };
  assert.deepEqual((await requestTitleModelSettings({ request, selection })).selection, selection);
  assert.equal((await requestTitleModelSettings({ request, selection: null })).selection, null);
  assert.ok(requests.every((entry) => entry.url === "/api/settings/titles" && entry.init?.cache === "no-store"));
  assert.equal(requests[0]!.init?.method, undefined);
  assert.equal(requests[0]!.init?.body, undefined);
  assert.equal(requests[0]!.init?.signal, controller.signal);
  assert.equal(requests[1]!.init?.method, "PUT");
  assert.deepEqual(JSON.parse(String(requests[1]!.init?.body)), { selection });
  assert.equal(requests[2]!.init?.method, "PUT");
  assert.deepEqual(JSON.parse(String(requests[2]!.init?.body)), { selection: null });
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
  await assert.rejects(requestTitleModelSettings({ selection, request: async () => reply({ error: "Keine Berechtigung zum Speichern" }, 403) }), /Keine Berechtigung zum Speichern/);
  assert.deepEqual(selection, { provider: "openrouter", model: "model-a" });
  await assert.rejects(requestTitleModelSettings({ request: async () => new Response("Unavailable", { status: 503 }) }), /konnten nicht geladen oder gespeichert werden/);
  await assert.rejects(requestTitleModelSettings({ request: async () => reply({ models: [] }) }), /ungültige/);
});
