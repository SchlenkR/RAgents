import { unavailableActorPrograms } from "./actor-programs-fixture.ts";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { ModelRuntime } from "@ragents/agent";
import { fauxAssistantMessage, getSupportedThinkingLevels, registerFauxProvider } from "@ragents/ai";
import { AgentSessionDriver, FixedWorkspaces, Journal, LiveBus, Orchestration, PluginHost, StartOptionContributionRegistry, StaticModelCatalog, TurnScheduler, type CatalogModel } from "@ragents/engine";
import { deferred, testServices } from "../../../packages/ragents/tests/support.ts";
import { overseerContracts } from "../../../plugins/ragents.overseer/contract.ts";
import { OverseerModelSettings } from "../../../plugins/ragents.overseer/server/settings.ts";
import { createSettingsMethods } from "../../../plugins/ragents.overseer/server/settings-method.ts";
import { startRpcServer } from "./rpc-fixture.ts";
import { RunChatSession } from "../src/ragents/session.ts";
import type { Engine } from "../src/ragents/engine.ts";
import { config as coreConfig } from "../../../ragents.config.core.ts";

const initial = { provider: "test", model: "first", thinking: "off" as const };
const next = { provider: "test", model: "second", thinking: "high" as const };
const models: Array<CatalogModel & { input: string[] }> = [
  { driver: "agent", provider: "test", model: "first", label: "First", thinking: ["off"], input: ["text"] },
  { driver: "agent", provider: "test", model: "second", label: "Second", thinking: ["off", "low", "high"], input: ["text", "image"] },
];

test("the shipped core coordinator and relay use supported model reasoning capabilities", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "ragents-overseer-core-default-"));
  const product = coreConfig["ragents.product"];
  const environment = Object.fromEntries(Object.entries(product).filter(([key]) => key !== "OPENROUTER_API_KEY")
    .map(([key, value]) => [key, typeof value === "string" ? value : JSON.stringify(value)]));
  const previous = new Map(Object.keys(environment).map((key) => [key, process.env[key]]));
  Object.assign(process.env, environment);
  try {
    const runtime = ModelRuntime.create();
    const model = runtime.getModel("openrouter", product.AGENT_COORDINATOR_MODEL);
    assert.ok(model, "Das Koordinator-Modell fehlt im Modellkatalog");
    const supported = getSupportedThinkingLevels(model);
    const settings = new OverseerModelSettings(path.join(directory, "settings.json"));
    await settings.initialize([{
      driver: "agent", provider: model.provider, model: model.id, label: model.name,
      thinking: supported, input: model.input,
    }], { provider: model.provider, model: model.id, thinking: product.AGENT_COORDINATOR_THINKING }, () => []);
    assert.equal(settings.selection().thinking, product.AGENT_COORDINATOR_THINKING);
    assert.ok(supported.includes(settings.selection().thinking));
    const { plugin } = await import("../../../plugins/ragents.product/server/index.ts");
    const host = new PluginHost({ product: { id: "test", title: "Test" }, dataDirectory: directory });
    host.register(plugin.create(host));
    const profiles = host.profiles.profiles();
    const coordinator = profiles.find((profile) => profile.name === "coordinator");
    const relay = profiles.find((profile) => profile.name === "relay");
    assert.ok(coordinator && relay);
    assert.equal(relay.model, product.AGENT_COORDINATOR_MODEL);
    assert.equal(relay.model, coordinator.model);
    assert.equal(relay.thinking, product.AGENT_COORDINATOR_THINKING);
    assert.equal(relay.thinking, coordinator.thinking);
    assert.ok(supported.includes(relay.thinking));
    assert.match(relay.description, new RegExp(`Denktiefe ${relay.thinking}`));
  } finally {
    for (const [key, value] of previous) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    await rm(directory, { recursive: true, force: true });
  }
});

test("the initial overseer selection survives restart with different product defaults", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "ragents-overseer-initial-"));
  const file = path.join(directory, "settings.json");
  try {
    const settings = new OverseerModelSettings(file);
    await settings.initialize(models, initial, () => []);
    assert.deepEqual(JSON.parse(await readFile(file, "utf8")), initial);
    const restarted = new OverseerModelSettings(file);
    await restarted.initialize(models, next, () => []);
    assert.deepEqual(restarted.selection(), initial);
    assert.deepEqual(JSON.parse(await readFile(file, "utf8")), initial);
    await restarted.save(next);
    const changed = new OverseerModelSettings(file);
    await changed.initialize(models, initial, () => []);
    assert.deepEqual(changed.selection(), next);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("failed initial persistence keeps the overseer selection unavailable", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "ragents-overseer-initial-failure-"));
  const file = path.join(directory, "settings.json");
  try {
    await mkdir(`${file}.tmp`);
    const settings = new OverseerModelSettings(file);
    await assert.rejects(settings.initialize(models, initial, () => []), /EISDIR/);
    assert.throws(() => settings.selection(), /keine konfigurierte Modellauswahl/);
    await assert.rejects(readFile(file, "utf8"), { code: "ENOENT" });
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("overseer settings persist independently, reject invalid selections and retain state on write failure", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "ragents-overseer-settings-"));
  const file = path.join(directory, "settings.json");
  try {
    const settings = new OverseerModelSettings(file);
    await settings.initialize(models, initial, () => []);
    assert.equal(settings.get().models.length, 2);
    await settings.save(next);
    await assert.rejects(settings.save({ ...next, thinking: "medium" }), /Reasoning.*Gültig/);
    await assert.rejects(settings.save({ ...next, provider: "other" }), /Unbekanntes Modell/);
    assert.deepEqual(settings.selection(), next);
    const restored = new OverseerModelSettings(file);
    await restored.initialize(models, initial, () => []);
    assert.deepEqual(restored.selection(), next);
    const other = new OverseerModelSettings(path.join(directory, "another-profile.json"));
    await other.initialize(models, initial, () => []);
    assert.deepEqual(other.selection(), initial);
    await mkdir(`${file}.tmp`);
    await assert.rejects(settings.save(initial), /EISDIR/);
    assert.deepEqual(settings.selection(), next);
    assert.deepEqual(JSON.parse(await readFile(file, "utf8")), next);
    await writeFile(file, JSON.stringify({ ...next, model: "removed" }));
    await assert.rejects(new OverseerModelSettings(file).initialize(models, initial, () => []), /Unbekanntes Modell/);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("the settings methods share read and save state and reject a model incompatible with existing media", async (t) => {
  const directory = await mkdtemp(path.join(tmpdir(), "ragents-overseer-settings-methods-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const settings = new OverseerModelSettings(path.join(directory, "settings.json"));
  await settings.initialize(models, next, () => ["image"]);
  const server = await startRpcServer(t, { methods: createSettingsMethods(settings) });
  const saved = await server.call(overseerContracts.settings.save.id, { ...next, thinking: "low" });
  assert.deepEqual(saved.result, (await server.call(overseerContracts.settings.read.id, {})).result);
  const rejected = await server.call(overseerContracts.settings.save.id, initial);
  assert.equal((rejected.error?.data as { status: number }).status, 400);
  assert.match(rejected.error!.message, /image-Anhänge/);
  assert.equal(settings.get().thinking, "low");
});

test("a model change while busy applies to the next actual prompt and preserves the agent conversation", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "ragents-overseer-next-turn-"));
  const faux = registerFauxProvider({ models: [{ id: "first", reasoning: false, input: ["text"] }, { id: "second", reasoning: true, input: ["text", "image"] }] });
  const modelRuntime = ModelRuntime.create();
  const provider = faux.getModel().provider;
  modelRuntime.registerProvider(provider, { baseUrl: faux.getModel().baseUrl, apiKey: "faux-key", api: faux.api, models: faux.models.map((model) => ({ ...model })) });
  const driver = new AgentSessionDriver({ modelRuntime });
  const offered = models.map((model) => ({ ...model, provider }));
  const settings = new OverseerModelSettings(path.join(directory, "settings.json"));
  await settings.initialize(offered, { ...initial, provider }, () => []);
  const services = testServices();
  const journal = new Journal(":memory:", services);
  const runtime = new Orchestration(journal, services);
  const catalog = new StaticModelCatalog(offered, [{ name: "coordinator", description: "Coordinator", driver: "agent", provider, model: "first", thinking: "off", turnTimeoutMs: null, isolateWorkspace: false }]);
  const live = new LiveBus();
  const scheduler = new TurnScheduler(runtime, journal, {
    drivers: { agent: driver }, catalog, live, workspaces: new FixedWorkspaces(directory),
    modelSelection: (turn, actor) => settings.forTurn(runtime, actor.id, turn.turnId),
  });
  const engine = { runtime, journal, scheduler, catalog, live, catalogModels: offered, startOptions: new StartOptionContributionRegistry(), inputCapabilities: (provider: string, model: string) => driver.inputCapabilities(provider, model) } as unknown as Engine;
  const session = new RunChatSession({
    id: "overseer", engine, modelSelection: settings.selection, toolNames: [],
    coordinator: { handle: "coordinator", displayName: "Coordinator", profile: "coordinator", runTitle: "Global", ownerHandle: "owner", ownerDisplayName: "Owner" },
    prompt: () => "Test", assertUsable: () => undefined, prepare: async () => undefined, prepareWorkspace: async () => undefined,
    scriptEntryFor: () => undefined, startEntryFor: () => undefined, actorPrograms: unavailableActorPrograms,
  });
  const started = deferred();
  const release = deferred();
  const used: string[] = [];
  let priorAnswer = false;
  faux.setResponses([
    async (_context, _options, _state, model) => { used.push(model.id); started.resolve(); await release.promise; return fauxAssistantMessage("Erste Antwort bleibt erhalten."); },
    (context, _options, _state, model) => { used.push(model.id); priorAnswer = JSON.stringify(context.messages).includes("Erste Antwort bleibt erhalten."); return fauxAssistantMessage("Zweite Antwort."); },
  ]);
  try {
    assert.deepEqual(await driver.thinkingCapabilities(provider, "first"), ["off"]);
    scheduler.start();
    await session.send("Erste Frage");
    await started.promise;
    const actorId = runtime.view("overseer").primaryActorId;
    const firstTurnId = runtime.view("overseer").turns[0].id;
    await settings.save({ ...next, provider });
    assert.deepEqual(used, ["first"]);
    assert.equal(runtime.view("overseer").turns[0].id, firstTurnId);
    assert.deepEqual(await session.capabilities("primary", null), { input: ["text", "image"], model: `${provider}/second` });
    await session.send("Zweite Frage");
    release.resolve();
    await scheduler.waitForIdle();
    assert.deepEqual(used, ["first", "second"]);
    assert.equal(priorAnswer, true);
    assert.equal(runtime.view("overseer").primaryActorId, actorId);
    assert.deepEqual(runtime.view("overseer").turns.map((turn) => turn.status), ["completed", "completed"]);
    const selections = runtime.events("overseer").filter((event) => event.type === "plugin.state-replaced").map((event) => event.payload.state);
    assert.deepEqual(selections, [
      { turnId: firstTurnId, ...initial, provider },
      { turnId: runtime.view("overseer").turns[1].id, ...next, provider },
    ]);
  } finally {
    release.resolve(); await scheduler.stop(); await driver.shutdown(); session.dispose(); journal.close(); faux.unregister();
    await rm(directory, { recursive: true, force: true });
  }
});
