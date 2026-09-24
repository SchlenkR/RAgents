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
  type PublicStartEntry,
  type StartOptionContribution,
} from "@ragents/engine";
import { testServices } from "../../../packages/ragents/tests/support.ts";
import type { ModelChoice } from "../src/plugin-support/model-choice.ts";
import { modelStartOption, productStartOptions, systemPromptStartOption } from "../src/plugin-support/product-start-options.ts";
import type { SystemPromptCatalog } from "../src/plugin-support/system-prompts.ts";
import type { Engine } from "../src/ragents/engine.ts";
import { RunChatSession, type RunScriptStart } from "../src/ragents/session.ts";
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

const fixture = (runId: string, contributions: readonly StartOptionContribution[], entries: readonly PublicStartEntry[] = []) => {
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
    scriptEntryFor: (entryId) => scriptStartOf(entries.find((entry) => entry.id === entryId)),
    startEntryFor: (entryId) => entries.find((entry) => entry.id === entryId),
    actorPrograms: unavailableActorPrograms,
  });
  return { journal, runtime, session, prepared };
};

/** Ein Script-Einstieg samt Paket, wie der Host ihn für den Start herausgibt. */
const scriptStartOf = (entry: PublicStartEntry | undefined): RunScriptStart | undefined => entry?.action === "script"
  ? { handle: "setup", coordinator: true, files: [{ path: "package.json", content: "{}" }], programs: [], entry }
  : undefined;

test("the empty chat sees every option with its default, presentation and selectability", () => {
  const { journal, session } = fixture("options-defaults", productStartOptions({
    modelChoice: modelChoice(),
    coordinatorThinking: "high",
    systemPrompts: () => catalog,
  }));
  try {
    const options = session.startOptions(null);
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
      chosen: false,
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
    assert.equal(session.startOptions(null)[0].chosen, false, "a default is nobody's choice");
    const changed = session.selectStartOption(modelStartOptionId, { model: "deep" }, null);
    assert.deepEqual(changed.value, { model: "deep", thinking: "high" });
    assert.equal(changed.chosen, true, "a template that fixes another value would refuse this choice");
    assert.deepEqual((changed.presentation as { thinkingOptions: string[] }).thinkingOptions, ["low", "high"]);
    assert.deepEqual(session.selectStartOption(modelStartOptionId, { model: "deep", thinking: "low" }, null).value, {
      model: "deep",
      thinking: "low",
    });
    assert.throws(
      () => session.selectStartOption(modelStartOptionId, { model: "deep", thinking: "off" }, null),
      (error: unknown) => error instanceof DomainError && error.code === "thinking-unknown" && error.status === 400,
    );
    assert.throws(
      () => session.selectStartOption(modelStartOptionId, { model: "unknown" }, null),
      (error: unknown) => error instanceof DomainError && error.code === "model-unknown" && error.status === 404,
    );
    assert.throws(
      () => session.selectStartOption(modelStartOptionId, { model: "deep", extra: 1 }, null),
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
      session.selectStartOption(systemPromptStartOptionId, { promptIds: ["special", "general"], shareWithAgents: true }, null).value,
      { promptIds: ["special", "general"], shareWithAgents: true },
    );
    assert.throws(
      () => session.selectStartOption(systemPromptStartOptionId, { promptIds: ["missing"], shareWithAgents: false }, null),
      (error: unknown) => error instanceof DomainError && error.code === "prompt-unknown",
    );
    assert.throws(
      () => session.selectStartOption(systemPromptStartOptionId, { promptIds: ["general", "general"], shareWithAgents: false }, null),
      (error: unknown) => error instanceof DomainError && error.code === "prompt-duplicate",
    );
  } finally {
    journal.close();
  }
});

test("fixed options and unknown options are refused", () => {
  const { journal, session } = fixture("options-fixed", [modelStartOption(modelChoice(false), "off")]);
  try {
    assert.equal(session.startOptions(null)[0].selectable, false);
    assert.throws(
      () => session.selectStartOption(modelStartOptionId, { model: "deep" }, null),
      (error: unknown) => error instanceof DomainError && error.code === "option-not-selectable" && error.status === 409,
    );
    assert.throws(
      () => session.selectStartOption("test.missing", "x", null),
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
    session.selectStartOption("test.workspace.source", "clone", null);
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

    const locked = session.startOptions(null);
    assert.ok(locked.every((option) => option.locked));
    assert.equal(locked[0].value, "clone");
    assert.throws(
      () => session.selectStartOption("test.workspace.source", "empty", null),
      (error: unknown) => error instanceof DomainError && error.code === "option-locked" && error.status === 409,
    );
  } finally {
    journal.close();
  }
});

test("every start option sees the user who acts: listing, choosing and the defaults written at the start", async () => {
  const seen: string[] = [];
  const recording = (id: string): StartOptionContribution => ({
    id,
    schema: Type.String(),
    selectable: () => true,
    defaultValue: ({ userId }) => { seen.push(`${id} default ${userId}`); return "vorgabe"; },
    accept: (value, { userId }) => { seen.push(`${id} accept ${userId}`); return value; },
    describe: (value, { userId }) => { seen.push(`${id} describe ${userId}`); return { kind: "text", text: String(value) }; },
  });
  const { journal, session } = fixture("options-user", [recording("test.chosen"), recording("test.default")]);
  try {
    session.startOptions("alice");
    session.selectStartOption("test.chosen", "gewählt", "bob");
    session.send("Los", undefined, undefined, { id: "carol", label: "Carol" });
    await session.drain();
    assert.deepEqual(seen, [
      "test.chosen default alice", "test.chosen describe alice", "test.default default alice", "test.default describe alice",
      "test.chosen accept bob", "test.chosen describe bob",
      "test.default default carol",
    ]);
    assert.equal(storedStartOption(journal.stateOf("options-user"), "test.chosen"), "gewählt");
  } finally {
    journal.close();
  }
});

/** Eine Quelle, die festhält, wer sie wählt; so zeigt der Test, dass der Handelnde ankommt. */
const recordedSource = (seen: string[]): StartOptionContribution => ({
  ...workspaceChoice,
  defaultValue: ({ userId }) => { seen.push(`default ${userId}`); return "empty"; },
  accept: (value, { userId }) => { seen.push(`accept ${value} ${userId}`); return value; },
});

const alice = { id: "alice", label: "Alice" };

const cloningSkill: PublicStartEntry = {
  id: "test.cloning-skill", owner: "test.plugin", action: "skill", skill: "demo", category: "Beispiele",
  title: "Klonen", description: "Arbeitet immer im Klon.", prompt: "Los", fixedStartOptions: { "test.workspace.source": "clone" },
};

const cloningScript: PublicStartEntry = {
  id: "test.cloning-script", owner: "test.plugin", action: "script", coordinator: true,
  title: "Klonen per Script", description: "Baut immer im Klon auf.", fixedStartOptions: { "test.workspace.source": "clone" },
};

test("a skill entry fixes its start option: the value holds, accepted for the user who starts the run", async () => {
  const seen: string[] = [];
  const runId = "fixed-skill";
  const { journal, session } = fixture(runId, [recordedSource(seen), modelStartOption(modelChoice(), "off")], [cloningSkill]);
  try {
    await session.send("Los", undefined, undefined, alice, cloningSkill.id);
    await session.drain();
    const state = journal.stateOf(runId);
    assert.equal(storedStartOption(state, "test.workspace.source"), "clone");
    assert.equal(state?.ownerUserId, "alice");
    assert.ok(seen.includes("accept clone alice"), seen.join(", "));
    assert.ok(!seen.some((entry) => entry.startsWith("default")), "der festgelegte Wert ersetzt die Vorgabe");
  } finally {
    journal.close();
  }
});

test("a different choice before the start is a hard error with its cause, the same choice is fine", async () => {
  const conflicting = fixture("fixed-conflict", [workspaceChoice, modelStartOption(modelChoice(), "off")], [cloningSkill]);
  try {
    conflicting.session.selectStartOption("test.workspace.source", "empty", "alice");
    await assert.rejects(conflicting.session.send("Los", undefined, undefined, alice, cloningSkill.id), (error: unknown) =>
      error instanceof DomainError && error.code === "start-option-fixed" && error.status === 409
      && error.message.includes("Klonen") && error.message.includes("test.workspace.source"));
    assert.equal(conflicting.journal.stateOf("fixed-conflict"), null, "kein Run entsteht");
  } finally {
    conflicting.journal.close();
  }
  const agreeing = fixture("fixed-agree", [workspaceChoice, modelStartOption(modelChoice(), "off")], [cloningSkill]);
  try {
    agreeing.session.selectStartOption("test.workspace.source", "clone", "alice");
    await agreeing.session.send("Los", undefined, undefined, alice, cloningSkill.id);
    await agreeing.session.drain();
    assert.equal(storedStartOption(agreeing.journal.stateOf("fixed-agree"), "test.workspace.source"), "clone");
  } finally {
    agreeing.journal.close();
  }
});

test("a run script entry fixes its start option through the same place", async () => {
  const conflicting = fixture("fixed-script-conflict", [workspaceChoice, modelStartOption(modelChoice(), "off")], [cloningScript]);
  try {
    conflicting.session.selectStartOption("test.workspace.source", "empty", "alice");
    await assert.rejects(conflicting.session.startAndWait(cloningScript.id, null, alice), (error: unknown) =>
      error instanceof DomainError && error.code === "start-option-fixed");
    assert.deepEqual(conflicting.prepared, [], "abgelehnt, bevor irgendetwas vorbereitet wird");
    assert.equal(conflicting.journal.stateOf("fixed-script-conflict"), null);
  } finally {
    conflicting.journal.close();
  }
  const seen: string[] = [];
  const started = fixture("fixed-script", [recordedSource(seen), modelStartOption(modelChoice(), "off")], [cloningScript]);
  try {
    await assert.rejects(started.session.startAndWait(cloningScript.id, null, alice), /Actor programs are not configured/);
    assert.equal(storedStartOption(started.journal.stateOf("fixed-script"), "test.workspace.source"), "clone", "der Run entsteht mit dem festgelegten Wert");
    assert.ok(seen.includes("accept clone alice"), seen.join(", "));
  } finally {
    started.journal.close();
  }
});

test("a message names only a skill entry, and a started run keeps its value against a different entry", async () => {
  const { journal, session } = fixture("fixed-started", [workspaceChoice, modelStartOption(modelChoice(), "off")], [cloningSkill, cloningScript]);
  try {
    for (const entryId of ["test.unknown", cloningScript.id]) {
      await assert.rejects(session.send("Los", undefined, undefined, alice, entryId), (error: unknown) =>
        error instanceof DomainError && error.code === "entry-unknown" && error.status === 404, entryId);
    }
    await session.send("Los", undefined, undefined, alice);
    await session.drain();
    assert.equal(storedStartOption(journal.stateOf("fixed-started"), "test.workspace.source"), "empty");
  } finally {
    journal.close();
  }
  const reopened = fixture("fixed-started-again", [workspaceChoice, modelStartOption(modelChoice(), "off")], [cloningSkill]);
  try {
    await reopened.session.send("Los", undefined, undefined, alice);
    await reopened.session.settle();
    await assert.rejects(reopened.session.send("Weiter", undefined, undefined, alice, cloningSkill.id), (error: unknown) =>
      error instanceof DomainError && error.code === "start-option-fixed" && /schon auf einem anderen Wert/.test(error.message));
  } finally {
    await reopened.session.drain();
    reopened.journal.close();
  }
});
