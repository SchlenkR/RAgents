import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test, { after } from "node:test";
import { PluginHost, resolveExecution, type AgentProfile, type CatalogModel } from "@ragents/engine";
import { fauxAssistantMessage } from "@ragents/ai";
import { fauxModelRuntime } from "../../../packages/ragents/tests/agent-runtime-fixture.ts";
import { ProductModelSettingsStore } from "../src/plugin-support/product-model-settings.ts";
import { productStartOptions } from "../src/plugin-support/product-start-options.ts";
import { productRuntimeToken } from "../src/ragents/product-runtime.ts";
import { workspaceRuntimeToken } from "../src/ragents/workspace-runtime.ts";
import { globalChatToken } from "../src/ragents/global-chat.ts";
import { RunChatSession } from "../src/ragents/session.ts";
import { modelStartOptionId } from "../src/ragents/start-option-state.ts";
import { OverseerModelSettings } from "../../../plugins/ragents.overseer/server/settings.ts";
import { unavailableActorPrograms } from "./actor-programs-fixture.ts";

const directory = await mkdtemp(path.join(tmpdir(), "ragents-stored-models-"));
process.env.DATA_DIR = directory;
process.env.PRODUCT_PROFILE = "core";
process.env.PRODUCT_ID = "ragents";
process.env.PRODUCT_TITLE = "RAgents";
const { createEngine, SessionWorkspaces } = await import("../src/ragents/engine.ts");
after(() => rm(directory, { recursive: true, force: true }));

for (const stale of [{ model: "removed", thinking: "off" }, { model: "current", thinking: "max" }]) {
  test(`engine startup retains a stored coordinator ${stale.model}/${stale.thinking} and an explicit valid run can answer`, async (t) => {
    const dataDirectory = await mkdtemp(path.join(directory, "product-"));
    const setup = fauxModelRuntime("current");
    t.after(setup.faux.unregister);
    setup.faux.setResponses([fauxAssistantMessage("The explicit model answered."), fauxAssistantMessage("The frozen model answered.")]);
    const provider = setup.selection.provider;
    const profiles: AgentProfile[] = ["coordinator", "standard"].map((name) => ({
      name, description: name, driver: "agent", provider, model: "current", thinking: "off", turnTimeoutMs: null, isolateWorkspace: false,
    }));
    const file = path.join(dataDirectory, "model-settings.json");
    await writeFile(file, JSON.stringify({ profiles: profiles.map(({ name }) => ({ name, ...stale })) }));
    const settings = new ProductModelSettingsStore(file, {
      provider, options: ["current"], defaultModel: "current", selectable: true, thinkingOptionsFor: () => ["off"],
    }, profiles);
    const models: CatalogModel[] = [{ driver: "agent", provider, model: "current", label: "Current model", thinking: ["off"] }];
    const coordinator = { handle: "coordinator", displayName: "Coordinator", profile: "coordinator", runTitle: "Test", ownerHandle: "owner", ownerDisplayName: "Owner" };
    const plugins = new PluginHost({ product: { id: "test", title: "Test" }, dataDirectory });
    const prompts = () => ({ mode: "fixed" as const, options: [], defaultIds: [], shareDefault: false });
    plugins.provideHost(productRuntimeToken, { coordinator, roleFor: () => "primary", contract: () => "", promptComposition: "", systemPrompts: prompts });
    plugins.provideHost(workspaceRuntimeToken, { resolve: async () => { throw new Error("The workspace is remembered"); }, describe: () => ({ mode: "test", directoryPattern: dataDirectory }) });
    const globalFile = path.join(dataDirectory, "settings.json");
    const globalSettings = new OverseerModelSettings(globalFile);
    plugins.provideHost(globalChatToken, {
      runIdFor: () => "global", isCoordinator: (id) => id === "global", title: "Global coordinator", prompt: "Answer", toolNames: [],
      workspaceDirectory: () => dataDirectory,
      model: { initialize: globalSettings.initialize, selection: globalSettings.selection, forTurn: () => globalSettings.selection() },
    });
    plugins.register({ manifest: { id: "test.product" }, register: (host) => {
      host.profiles({ id: "models", models: () => models, profiles: settings.profiles });
      host.startOptions(...productStartOptions({ modelChoice: settings.modelChoice, coordinatorThinking: settings.coordinatorThinking, systemPrompts: prompts }));
    } });
    const workspaces = new SessionWorkspaces(() => ({
      execute: () => Promise.reject(new Error("The test stores no attachments")),
      serverProcessContextFor: async (runId: string) => ({ runId, cwd: dataDirectory }) as never,
    }));
    const engine = await createEngine({ plugins, workspaces, modelRuntime: Promise.resolve(setup.modelRuntime), assertAvailable: () => {}, assertRunUsable: () => {} });
    t.after(() => engine.shutdown());
    await assert.rejects(readFile(globalFile, "utf8"), { code: "ENOENT" });
    assert.equal(globalSettings.get().model, stale.model);
    assert.throws(globalSettings.selection, /stored model selection.*model settings/);
    assert.equal(engine.catalog.profiles().length, 2);
    assert.throws(() => resolveExecution(engine.catalog, { profile: "standard" }, "helper", models), /role standard.*stored default.*Settings, Models/);
    const session = (runId: string, global = false) => {
      workspaces.remember(runId, dataDirectory);
      return new RunChatSession({
        engine, id: runId, coordinator, prompt: () => "Answer the task.", toolNames: [],
        assertUsable: () => {}, prepare: async () => {}, prepareWorkspace: async () => {}, started: async () => {},
        scriptEntryFor: () => undefined, startEntryFor: () => undefined, actorPrograms: unavailableActorPrograms,
        ...(global ? { modelSelection: globalSettings.selection } : {}),
      });
    };
    const blocked = session(`blocked-${stale.model}`);
    const option = blocked.startOptions(null).find((option) => option.id === modelStartOptionId)!;
    assert.deepEqual(option.value, stale);
    await assert.rejects(blocked.send("Use the default"), /role coordinator.*stored default.*Settings, Models/);
    const chosen = session(`explicit-${stale.model}`);
    await chosen.selectStartOption(modelStartOptionId, { model: "current" }, null);
    engine.start();
    await chosen.send("Use the explicit model");
    await engine.scheduler.waitForIdle();
    const first = engine.runtime.view(chosen.id);
    assert.equal(first.turns.at(-1)?.status, "completed");
    assert.ok(engine.runtime.events(chosen.id).some((event) => event.type === "model.output.completed" && event.payload.text === "The explicit model answered."));
    const execution = first.actors.find((actor) => actor.kind === "agent")!.execution;
    await globalSettings.save({ provider, model: "current", thinking: "off" });
    const globalSession = session("global", true);
    assert.doesNotThrow(() => globalSession.preparationSelection(null));
    await settings.save({ profiles: profiles.map(({ name }) => ({ name, model: "current", thinking: "off" })) });
    assert.deepEqual(engine.runtime.view(chosen.id).actors.find((actor) => actor.kind === "agent")!.execution, execution);
    await chosen.send("Keep the frozen execution");
    await engine.scheduler.waitForIdle();
    assert.equal(engine.runtime.view(chosen.id).turns.at(-1)?.status, "completed");
    await chosen.dispose();
    await blocked.dispose();
    await globalSession.dispose();
  });
}
