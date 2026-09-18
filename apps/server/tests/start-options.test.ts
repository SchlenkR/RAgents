import { unavailableActorPrograms } from "./actor-programs-fixture.ts";
import assert from "node:assert/strict";
import test from "node:test";
import { Type } from "typebox";

import {
  DomainError,
  Journal,
  LiveBus,
  Orchestration,
  StartOptionContributionRegistry,
  StaticModelCatalog,
  type AgentProfile,
  type CatalogModel,
  type StartOptionContribution,
} from "@aicontainer/ragents";
import { testServices } from "../../../packages/ragents/tests/support.ts";
import type { ModelChoice } from "../src/plugin-support/model-choice.ts";
import { modelStartOption, productStartOptions, systemPromptStartOption } from "../src/plugin-support/product-start-options.ts";
import type { SystemPromptCatalog } from "../src/plugin-support/system-prompts.ts";
import type { Engine } from "../src/ragents/engine.ts";
import { RunChatSession } from "../src/ragents/session.ts";
import {
  modelStartOptionId,
  storedStartOption,
  systemPromptStartOptionId,
} from "../src/ragents/start-option-state.ts";

const modelChoice = (selectable = true): ModelChoice => ({
  options: ["fast", "deep"],
  defaultModel: "fast",
  provider: "test",
  selectable,
  thinkingOptionsFor: (model) => model === "deep" ? ["low", "high"] : ["off"],
});

const catalog: SystemPromptCatalog = {
  mode: "selectable",
  options: [
    { id: "general", label: "General", file: "general.md", text: "General prompt" },
    { id: "special", label: "Special", file: "special.md", text: "Special prompt" },
  ],
  defaultIds: ["general"],
  shareDefault: false,
};

const workspaceChoice: StartOptionContribution = {
  id: "test.workspace.source",
  schema: Type.Union([Type.Literal("empty"), Type.Literal("clone")]),
  selectable: () => true,
  defaultValue: () => "empty",
  accept: (value) => value,
  describe: () => ({
    kind: "choice",
    label: "Arbeitsverzeichnis",
    options: [{ value: "empty", label: "Leer" }, { value: "clone", label: "Klon" }],
  }),
};

const fixture = (runId: string, contributions: readonly StartOptionContribution[]) => {
  const services = testServices();
  const journal = new Journal(":memory:", services);
  const runtime = new Orchestration(journal, services);
  const catalogModels: CatalogModel[] = [
    { driver: "agent", provider: "test", model: "fast", label: "test/fast", thinking: ["off"] },
    { driver: "agent", provider: "test", model: "deep", label: "test/deep", thinking: ["low", "high"] },
  ];
  const profiles: AgentProfile[] = [{
    name: "coordinator",
    description: "Test coordinator",
    driver: "agent",
    provider: "test",
    model: "fast",
    thinking: "off",
    turnTimeoutMs: null,
    isolateWorkspace: false,
  }];
  const startOptions = new StartOptionContributionRegistry();
  startOptions.register("test.product", contributions);
  const engine = {
    journal,
    runtime,
    live: new LiveBus(),
    scheduler: { isRunning: () => false },
    catalog: new StaticModelCatalog(catalogModels, profiles),
    catalogModels,
    startOptions,
  } as unknown as Engine;
  const prepared: string[] = [];
  const session = new RunChatSession({
    engine,
    id: runId,
    coordinator: {
      handle: "coordinator",
      displayName: "Koordinator",
      profile: "coordinator",
      runTitle: "Neue Unterhaltung",
      ownerHandle: "owner",
      ownerDisplayName: "Owner",
    },
    prompt: () => "Coordinator prompt",
    assertUsable: () => undefined,
    prepare: async () => {
      prepared.push("prepare");
    },
    prepareWorkspace: async () => {
      prepared.push(`workspace:${journal.stateOf(runId) === null ? "before-run" : "after-run"}`);
    },
    scriptEntryFor: () => undefined,
    actorPrograms: unavailableActorPrograms,
  });
  return { journal, runtime, session, prepared };
};

test("the empty chat sees every option with its default, presentation and selectability", () => {
  const { journal, session } = fixture("options-defaults", productStartOptions({
    modelChoice: modelChoice(),
    coordinatorThinking: "high",
    systemPrompts: () => catalog,
  }));
  try {
    const options = session.startOptions();
    assert.deepEqual(options.map((option) => option.id), [systemPromptStartOptionId, modelStartOptionId]);
    assert.deepEqual(options[0], {
      id: systemPromptStartOptionId,
      owner: "test.product",
      value: { promptIds: ["general"], shareWithAgents: false },
      presentation: {
        kind: "system-prompt",
        mode: "selectable",
        options: [
          { id: "general", label: "General", text: "General prompt" },
          { id: "special", label: "Special", text: "Special prompt" },
        ],
      },
      selectable: true,
      locked: false,
    });
    assert.deepEqual(options[1].value, { model: "fast", thinking: "off" });
    assert.deepEqual(options[1].presentation, {
      kind: "model",
      provider: "test",
      options: ["fast", "deep"],
      thinkingOptions: ["off"],
    });
  } finally {
    journal.close();
  }
});

test("a model change without thinking falls back to the preferred thinking of the new model", () => {
  const { journal, session } = fixture("options-model", [modelStartOption(modelChoice(), "high")]);
  try {
    const changed = session.selectStartOption(modelStartOptionId, { model: "deep" });
    assert.deepEqual(changed.value, { model: "deep", thinking: "high" });
    assert.deepEqual((changed.presentation as { thinkingOptions: string[] }).thinkingOptions, ["low", "high"]);
    assert.deepEqual(session.selectStartOption(modelStartOptionId, { model: "deep", thinking: "low" }).value, {
      model: "deep",
      thinking: "low",
    });
    assert.throws(
      () => session.selectStartOption(modelStartOptionId, { model: "deep", thinking: "off" }),
      (error: unknown) => error instanceof DomainError && error.code === "thinking-unknown" && error.status === 400,
    );
    assert.throws(
      () => session.selectStartOption(modelStartOptionId, { model: "unknown" }),
      (error: unknown) => error instanceof DomainError && error.code === "model-unknown" && error.status === 404,
    );
    assert.throws(
      () => session.selectStartOption(modelStartOptionId, { model: "deep", extra: 1 }),
      /Ungültiger Wert für Startoption ragents\.model/,
    );
  } finally {
    journal.close();
  }
});

test("system prompt selections are checked against the catalog", () => {
  const { journal, session } = fixture("options-prompt", [systemPromptStartOption(() => catalog)]);
  try {
    assert.deepEqual(
      session.selectStartOption(systemPromptStartOptionId, { promptIds: ["special", "general"], shareWithAgents: true }).value,
      { promptIds: ["special", "general"], shareWithAgents: true },
    );
    assert.throws(
      () => session.selectStartOption(systemPromptStartOptionId, { promptIds: ["missing"], shareWithAgents: false }),
      (error: unknown) => error instanceof DomainError && error.code === "prompt-unknown",
    );
    assert.throws(
      () => session.selectStartOption(systemPromptStartOptionId, { promptIds: ["general", "general"], shareWithAgents: false }),
      (error: unknown) => error instanceof DomainError && error.code === "prompt-duplicate",
    );
  } finally {
    journal.close();
  }
});

test("fixed options and unknown options are refused", () => {
  const { journal, session } = fixture("options-fixed", [modelStartOption(modelChoice(false), "off")]);
  try {
    assert.equal(session.startOptions()[0].selectable, false);
    assert.throws(
      () => session.selectStartOption(modelStartOptionId, { model: "deep" }),
      (error: unknown) => error instanceof DomainError && error.code === "option-not-selectable" && error.status === 409,
    );
    assert.throws(
      () => session.selectStartOption("test.missing", "x"),
      (error: unknown) => error instanceof DomainError && error.code === "option-unknown" && error.status === 404,
    );
  } finally {
    journal.close();
  }
});

test("a plugin option travels into the journal at start and is locked afterwards", async () => {
  const runId = "options-plugin";
  const { journal, runtime, session, prepared } = fixture(runId, [workspaceChoice, modelStartOption(modelChoice(), "off")]);
  try {
    session.selectStartOption("test.workspace.source", "clone");
    session.send("Los");
    await session.drain();

    const state = journal.stateOf(runId);
    assert.ok(state);
    assert.equal(storedStartOption(state, "test.workspace.source"), "clone");
    assert.deepEqual(storedStartOption(state, modelStartOptionId), { model: "fast", thinking: "off" });
    assert.deepEqual(prepared, ["prepare", "workspace:after-run"]);
    const view = runtime.view(runId);
    const primary = view.actors.find((actor) => actor.id === view.primaryActorId);
    assert.ok(primary && primary.kind === "agent");
    assert.equal(primary.execution.driver.config.model, "fast");

    const locked = session.startOptions();
    assert.ok(locked.every((option) => option.locked));
    assert.equal(locked[0].value, "clone");
    assert.throws(
      () => session.selectStartOption("test.workspace.source", "empty"),
      (error: unknown) => error instanceof DomainError && error.code === "option-locked" && error.status === 409,
    );
  } finally {
    journal.close();
  }
});
