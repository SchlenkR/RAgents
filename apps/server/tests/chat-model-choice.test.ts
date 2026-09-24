import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test, { after } from "node:test";
import {
  AgentSessionDriver,
  createAccessContext,
  DomainError,
  MethodContributionRegistry,
  PluginHost,
  type AgentProfile,
  type CatalogModel,
  type ModelSelection,
  type TurnRequest,
} from "@ragents/engine";
import { noUsage } from "../../../packages/ragents/tests/support.ts";
import { coreContracts } from "../src/api/contracts.ts";
import { coreMethods } from "../src/api/core-methods.ts";
import { productStartOptions } from "../src/plugin-support/product-start-options.ts";
import type { StartOptionState } from "../src/plugin-support/start-options-contract.ts";
import { productRuntimeToken } from "../src/ragents/product-runtime.ts";
import { RunChatSession } from "../src/ragents/session.ts";
import { modelStartOptionId } from "../src/ragents/start-option-state.ts";
import { workspaceRuntimeToken } from "../src/ragents/workspace-runtime.ts";
import { unavailableActorPrograms } from "./actor-programs-fixture.ts";
import { coreSources, dispatchMethod } from "./rpc-fixture.ts";

const directory = await mkdtemp(path.join(tmpdir(), "ragents-chat-model-"));
process.env.DATA_DIR = directory;
process.env.PRODUCT_PROFILE = "core";
process.env.PRODUCT_ID = "ragents";
process.env.PRODUCT_TITLE = "RAgents";
const { createEngine, SessionWorkspaces } = await import("../src/ragents/engine.ts");
after(() => rm(directory, { recursive: true, force: true }));

const thinking = { fast: ["off"], deep: ["low", "high"], foreign: ["off"] } as const;
const models: CatalogModel[] = (["fast", "deep", "foreign"] as const).map((model) => ({
  driver: "agent", provider: "test", model, label: `test/${model}`, thinking: [...thinking[model]],
}));
const profiles: AgentProfile[] = [{
  name: "coordinator", description: "Test", driver: "agent", provider: "test", model: "fast", thinking: "off", turnTimeoutMs: null, isolateWorkspace: false,
}];
const coordinator = { handle: "coordinator", displayName: "Koordinator", profile: "coordinator", runTitle: "Neuer Run", ownerHandle: "owner", ownerDisplayName: "Owner" };
const as = (rights: readonly string[]) => createAccessContext({ enabled: true, user: { id: "alice", label: "alice", rights: [...rights] } });
const developer = as(["runs.read", "runs.write", "runs.create"]);
const inspector = as(["runs.read", "runs.write", "runs.create", "runs.inspect"]);
const denied = (error: unknown) => error instanceof DomainError && error.code === "access-denied" && error.status === 403;

test("the chat chooses model and thinking with runs.inspect only: before the first message for the first turn, later for the next one", async (t) => {
  const selections: ModelSelection[] = [];
  t.mock.method(AgentSessionDriver.prototype, "thinkingCapabilities", async (_provider: string, model: string) => thinking[model as keyof typeof thinking]);
  t.mock.method(AgentSessionDriver.prototype, "inputCapabilities", async () => ["text"]);
  t.mock.method(AgentSessionDriver.prototype, "runTurn", async (request: TurnRequest<"agent">) => {
    selections.push(request.selection);
    return { failure: null, usage: noUsage() };
  });
  const plugins = new PluginHost({ product: { id: "ragents", title: "RAgents" }, dataDirectory: directory });
  plugins.provideHost(productRuntimeToken, {
    coordinator, roleFor: (view, actor) => view.primaryActorId === actor.id ? "primary" : "worker",
    contract: () => "", promptComposition: "test", systemPrompts: () => ({ mode: "fixed", options: [], defaultIds: [], shareDefault: false }),
  });
  plugins.provideHost(workspaceRuntimeToken, {
    resolve: async () => { throw new Error("test uses remembered workspace"); },
    describe: () => ({ mode: "test", directoryPattern: directory }),
  });
  plugins.register({ manifest: { id: "test.product" }, register: (host) => {
    host.profiles({ id: "test.profiles", models: () => models, profiles: () => profiles });
    host.startOptions(...productStartOptions({
      modelChoice: { options: ["fast", "deep"], defaultModel: "fast", provider: "test", selectable: true, thinkingOptionsFor: (model) => thinking[(model ?? "fast") as "fast" | "deep"] },
      coordinatorThinking: "off",
      systemPrompts: () => ({ mode: "fixed", options: [], defaultIds: [], shareDefault: false }),
    }));
  } });
  const workspaces = new SessionWorkspaces(() => ({
    execute: () => Promise.reject(new Error("Der Test legt keine Anhänge ab")),
    serverProcessContextFor: async (runId: string) => ({ runId, cwd: directory }) as never,
  }));
  const runId = "chat-model";
  workspaces.remember(runId, directory);
  const engine = await createEngine({ plugins, workspaces, assertAvailable: () => {}, assertRunUsable: () => {} });
  const session = new RunChatSession({
    engine, id: runId, coordinator, prompt: () => "", assertUsable: () => undefined,
    prepare: async () => undefined, prepareWorkspace: async () => undefined,
    scriptEntryFor: () => undefined, startEntryFor: () => undefined, actorPrograms: unavailableActorPrograms,
  });
  const methods = coreMethods(coreSources({
    startOptions: (_runId, userId) => session.startOptions(userId),
    selectStartOption: (_runId, optionId, value, userId) => session.selectStartOption(optionId, value, userId),
  }, { plugins: { startOptions: engine.startOptions } as unknown as PluginHost }));
  const registry = new MethodContributionRegistry();
  registry.register("host", methods);
  const list = async (access: ReturnType<typeof as>) =>
    await dispatchMethod(registry, coreContracts.startOptions.list.id, { runId }, access) as StartOptionState[];
  const select = (access: ReturnType<typeof as>, value: unknown) =>
    dispatchMethod(registry, coreContracts.startOptions.select.id, { runId, optionId: modelStartOptionId, value }, access) as Promise<StartOptionState>;
  const turn = async (text: string) => {
    await session.send(text);
    await engine.scheduler.waitForIdle();
    return selections.at(-1);
  };
  engine.start();
  try {
    assert.deepEqual((await list(developer)).map((option) => option.id), [], "ohne runs.inspect keine Modellwahl");
    await assert.rejects(select(developer, { model: "deep", thinking: "high" }), denied);

    const offered = (await list(inspector)).find((option) => option.id === modelStartOptionId);
    assert.deepEqual(offered?.presentation, { kind: "model", provider: "test", options: ["fast", "deep"], thinkingOptions: ["off"] });
    await assert.rejects(select(inspector, { model: "foreign" }), (error: unknown) => error instanceof DomainError && error.code === "model-unknown",
      "ein Modell des Katalogs, das die Modellwahl nicht nennt, steht nicht zur Wahl");
    await assert.rejects(select(inspector, { model: "deep", thinking: "off" }), (error: unknown) => error instanceof DomainError && error.code === "thinking-unknown");
    const chosen = await select(inspector, { model: "deep", thinking: "high" });
    assert.deepEqual(chosen.presentation, { kind: "model", provider: "test", options: ["fast", "deep"], thinkingOptions: ["low", "high"] });

    assert.deepEqual(await turn("Erste Nachricht"), { provider: "test", model: "deep", thinking: "high" }, "die Wahl vor der ersten Nachricht gilt für den ersten Turn");
    assert.equal((await list(inspector)).find((option) => option.id === modelStartOptionId)?.locked, false);

    await assert.rejects(select(developer, { model: "fast", thinking: "off" }), denied);
    assert.deepEqual(await turn("Zweite Nachricht"), { provider: "test", model: "deep", thinking: "high" }, "die abgelehnte Wahl ändert nichts");
    await select(inspector, { model: "fast", thinking: "off" });
    assert.deepEqual(await turn("Dritte Nachricht"), { provider: "test", model: "fast", thinking: "off" }, "ein Wechsel gilt ab dem nächsten Turn");
    assert.deepEqual(await session.capabilities("primary", null), { model: "test/fast", input: ["text"] });
  } finally {
    session.dispose();
    await engine.shutdown();
  }
});
