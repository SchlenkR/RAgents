import { unavailableActorPrograms } from "./actor-programs-fixture.ts";
import assert from "node:assert/strict";
import test from "node:test";
import { Type } from "typebox";

import {
  DomainError,
  createAccessContext,
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
import { WORKSPACE_SANDBOX_OPTION_ID } from "../../../plugins/ragents.workspace/contract.ts";
import { sandboxStartOption, securityPolicyFor } from "../../../plugins/ragents.workspace/server/security.ts";

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
    label: "Working directory",
    options: [{ value: "empty", label: "Empty" }, { value: "clone", label: "Clone" }],
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
    inputCapabilities: async () => ["text"],
  } as unknown as Engine;
  const prepared: string[] = [];
  const session = new RunChatSession({
    engine,
    id: runId,
    coordinator: {
      handle: "coordinator",
      displayName: "Coordinator",
      profile: "coordinator",
      runTitle: "New run",
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
    started: async (_id, startEntry) => {
      prepared.push(`started:${startEntry?.id ?? "free"}:${journal.stateOf(runId)?.inputs.size}`);
    },
    scriptEntryFor: (entryId) => scriptStartOf(entries.find((entry) => entry.id === entryId)),
    startEntryFor: (entryId) => entries.find((entry) => entry.id === entryId),
    actorPrograms: unavailableActorPrograms,
  });
  return { journal, runtime, session, prepared, startOptions };
};

/** A script template with its package, as the host hands it out for the start. */
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

test("a model change without thinking falls back to the preferred thinking of the new model", async () => {
  const { journal, session } = fixture("options-model", [modelStartOption(modelChoice(), "high")]);
  try {
    assert.equal(session.startOptions(null)[0].chosen, false, "a default is nobody's choice");
    const changed = await session.selectStartOption(modelStartOptionId, { model: "deep" }, null);
    assert.deepEqual(changed.value, { model: "deep", thinking: "high" });
    assert.equal(changed.chosen, true, "a template that fixes another value would refuse this choice");
    assert.deepEqual((changed.presentation as { thinkingOptions: string[] }).thinkingOptions, ["low", "high"]);
    assert.deepEqual((await session.selectStartOption(modelStartOptionId, { model: "deep", thinking: "low" }, null)).value, {
      model: "deep",
      thinking: "low",
    });
    await assert.rejects(
      () => session.selectStartOption(modelStartOptionId, { model: "deep", thinking: "off" }, null),
      (error: unknown) => error instanceof DomainError && error.code === "thinking-unknown" && error.status === 400,
    );
    await assert.rejects(
      () => session.selectStartOption(modelStartOptionId, { model: "unknown" }, null),
      (error: unknown) => error instanceof DomainError && error.code === "model-unknown" && error.status === 404,
    );
    await assert.rejects(
      () => session.selectStartOption(modelStartOptionId, { model: "deep", extra: 1 }, null),
      /Invalid value for start option ragents\.model/,
    );
  } finally {
    journal.close();
  }
});

test("system prompt selections are checked against the catalog", async () => {
  const { journal, session } = fixture("options-prompt", [systemPromptStartOption(() => catalog)]);
  try {
    assert.deepEqual(
      (await session.selectStartOption(systemPromptStartOptionId, { promptIds: ["special", "general"], shareWithAgents: true }, null)).value,
      { promptIds: ["special", "general"], shareWithAgents: true },
    );
    await assert.rejects(
      () => session.selectStartOption(systemPromptStartOptionId, { promptIds: ["missing"], shareWithAgents: false }, null),
      (error: unknown) => error instanceof DomainError && error.code === "prompt-unknown",
    );
    await assert.rejects(
      () => session.selectStartOption(systemPromptStartOptionId, { promptIds: ["general", "general"], shareWithAgents: false }, null),
      (error: unknown) => error instanceof DomainError && error.code === "prompt-duplicate",
    );
  } finally {
    journal.close();
  }
});

test("fixed options and unknown options are refused", async () => {
  const { journal, session } = fixture("options-fixed", [modelStartOption(modelChoice(false), "off")]);
  try {
    assert.equal(session.startOptions(null)[0].selectable, false);
    await assert.rejects(
      () => session.selectStartOption(modelStartOptionId, { model: "deep" }, null),
      (error: unknown) => error instanceof DomainError && error.code === "option-not-selectable" && error.status === 409,
    );
    await assert.rejects(
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
    await session.selectStartOption("test.workspace.source", "clone", null);
    session.send("Go");
    await session.drain();

    const state = journal.stateOf(runId);
    assert.ok(state);
    assert.equal(storedStartOption(state, "test.workspace.source"), "clone");
    assert.deepEqual(storedStartOption(state, modelStartOptionId), { model: "fast", thinking: "off" });
    assert.deepEqual(prepared, ["prepare", "workspace:after-run", "started:free:0"]);
    const view = runtime.view(runId);
    const primary = view.actors.find((actor) => actor.id === view.primaryActorId);
    assert.ok(primary && primary.kind === "agent");
    assert.equal(primary.execution.driver.config.model, "fast");

    const locked = session.startOptions(null);
    assert.deepEqual(locked.map((option) => [option.id, option.locked]), [["test.workspace.source", true], [modelStartOptionId, false]]);
    assert.equal(locked[0].value, "clone");
    await assert.rejects(
      () => session.selectStartOption("test.workspace.source", "empty", null),
      (error: unknown) => error instanceof DomainError && error.code === "option-locked" && error.status === 409,
    );
  } finally {
    journal.close();
  }
});

test("the model stays selectable after the start: each change lands in the journal, invalid ones are refused like before the start", async () => {
  const runId = "options-model-running";
  const { journal, runtime, session } = fixture(runId, [workspaceChoice, modelStartOption(modelChoice(), "off")]);
  try {
    session.send("Go");
    await session.drain();
    const revision = runtime.view(runId).revision;
    const changed = await session.selectStartOption(modelStartOptionId, { model: "deep", thinking: "low" }, null);
    assert.deepEqual(changed.value, { model: "deep", thinking: "low" });
    assert.equal(changed.locked, false);
    assert.equal(changed.chosen, false, "chosen applies only before the start");
    assert.deepEqual((changed.presentation as { thinkingOptions: string[] }).thinkingOptions, ["low", "high"]);
    assert.deepEqual(storedStartOption(journal.stateOf(runId), modelStartOptionId), { model: "deep", thinking: "low" });
    assert.ok(runtime.events(runId).some((event) => event.type === "plugin.state-replaced" && event.payload.pluginId === modelStartOptionId));
    assert.ok(runtime.view(runId).revision > revision, "the change is recorded as an event in the journal");
    const unchanged = runtime.view(runId).revision;
    await session.selectStartOption(modelStartOptionId, { model: "deep", thinking: "low" }, null);
    assert.equal(runtime.view(runId).revision, unchanged, "the same choice writes nothing");
    await assert.rejects(() => session.selectStartOption(modelStartOptionId, { model: "fast", thinking: "high" }, null),
      (error: unknown) => error instanceof DomainError && error.code === "thinking-unknown");
    await assert.rejects(() => session.selectStartOption(modelStartOptionId, { model: "elsewhere" }, null),
      (error: unknown) => error instanceof DomainError && error.code === "model-unknown");
    assert.deepEqual(storedStartOption(journal.stateOf(runId), modelStartOptionId), { model: "deep", thinking: "low" });
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
    defaultValue: ({ userId }) => { seen.push(`${id} default ${userId}`); return "default-value"; },
    accept: (value, { userId }) => { seen.push(`${id} accept ${userId}`); return value; },
    describe: (value, { userId }) => { seen.push(`${id} describe ${userId}`); return { kind: "text", text: String(value) }; },
  });
  const { journal, session } = fixture("options-user", [recording("test.chosen"), recording("test.default")]);
  try {
    session.startOptions("alice");
    await session.selectStartOption("test.chosen", "chosen-value", "bob");
    session.send("Go", undefined, undefined, { id: "carol", label: "Carol" });
    await session.drain();
    assert.deepEqual(seen, [
      "test.chosen default alice", "test.chosen describe alice", "test.default default alice", "test.default describe alice",
      "test.chosen accept bob", "test.chosen describe bob",
      "test.default default carol",
    ]);
    assert.equal(storedStartOption(journal.stateOf("options-user"), "test.chosen"), "chosen-value");
  } finally {
    journal.close();
  }
});

/** A source that records who chooses it; this way the test shows that the acting user arrives. */
const recordedSource = (seen: string[]): StartOptionContribution => ({
  ...workspaceChoice,
  defaultValue: ({ userId }) => { seen.push(`default ${userId}`); return "empty"; },
  accept: (value, { userId }) => { seen.push(`accept ${value} ${userId}`); return value; },
});

const alice = { id: "alice", label: "Alice" };

const sandboxAccessFor = (userId: string | null) => createAccessContext({
  enabled: true,
  user: userId === null ? null : { id: userId, label: userId, rights: userId === "admin" ? ["*"] : ["runs.read", "runs.write", "runs.create"] },
});

const sandboxFixture = (runId: string, force: boolean) => {
  const setup = fixture(runId, []);
  setup.startOptions.register("ragents.workspace", [sandboxStartOption(force, sandboxAccessFor, (id) => setup.journal.stateOf(id))]);
  return setup;
};

test("a non-administrator cannot choose an unrestricted run and the sandbox choice locks at start", async () => {
  const runId = "sandbox-employee";
  const { journal, session } = sandboxFixture(runId, false);
  try {
    const option = session.startOptions("alice")[0];
    assert.equal(option.value, true);
    assert.deepEqual(option.presentation, { kind: "process-sandbox", forced: true });
    await assert.rejects(session.selectStartOption(WORKSPACE_SANDBOX_OPTION_ID, false, "alice"),
      (error: unknown) => error instanceof DomainError && error.code === "workspace-sandbox-required" && error.status === 403);
    await session.selectStartOption(WORKSPACE_SANDBOX_OPTION_ID, true, "alice");
    session.send("Start", undefined, undefined, alice);
    await session.drain();
    assert.equal(storedStartOption(journal.stateOf(runId), WORKSPACE_SANDBOX_OPTION_ID), true);
    assert.equal(session.startOptions("admin")[0].locked, true);
    await assert.rejects(session.selectStartOption(WORKSPACE_SANDBOX_OPTION_ID, false, "admin"),
      (error: unknown) => error instanceof DomainError && error.code === "option-locked" && error.status === 409);
  } finally { journal.close(); }
});

test("an administrator may choose restriction before start unless the server forces it", async () => {
  for (const force of [false, true]) {
    const runId = `sandbox-admin-${force}`;
    const { journal, session } = sandboxFixture(runId, force);
    try {
      assert.equal(session.startOptions("admin")[0].value, force);
      assert.deepEqual(session.startOptions("admin")[0].presentation, { kind: "process-sandbox", forced: force });
      if (force) {
        await assert.rejects(session.selectStartOption(WORKSPACE_SANDBOX_OPTION_ID, false, "admin"),
          (error: unknown) => error instanceof DomainError && error.code === "workspace-sandbox-required");
      } else {
        await session.selectStartOption(WORKSPACE_SANDBOX_OPTION_ID, true, "admin");
        assert.equal(session.startOptions("admin")[0].value, true);
        await session.selectStartOption(WORKSPACE_SANDBOX_OPTION_ID, false, "admin");
      }
      session.send("Start", undefined, undefined, { id: "admin", label: "Administrator" });
      await session.drain();
      const state = journal.stateOf(runId);
      assert.equal(state?.ownerUserId, "admin");
      assert.equal(storedStartOption(state, WORKSPACE_SANDBOX_OPTION_ID), force);
      assert.equal(securityPolicyFor(force, sandboxAccessFor(state!.ownerUserId), state).restricted, force);
    } finally { journal.close(); }
  }
});

test("a manipulated stored choice or an administrator's message cannot lower an employee run's policy", async () => {
  const runId = "sandbox-owned";
  const { journal, runtime, session } = sandboxFixture(runId, false);
  try {
    session.send("Start", undefined, undefined, alice);
    await session.settle();
    runtime.replacePluginState({ actorId: runtime.state(runId).ownerId, commandId: "stored-sandbox-false" }, runId, {
      pluginId: WORKSPACE_SANDBOX_OPTION_ID, scope: { kind: "run" }, state: false,
    });
    session.send("Continue", undefined, undefined, { id: "admin", label: "Administrator" });
    await session.drain();
    const state = journal.stateOf(runId)!;
    assert.equal(state.ownerUserId, "alice");
    assert.equal(storedStartOption(state, WORKSPACE_SANDBOX_OPTION_ID), false);
    assert.equal(securityPolicyFor(false, sandboxAccessFor(state.ownerUserId), state).restricted, true);
    for (const [index, invalid] of ["false", 0, null, {}, []].entries()) {
      runtime.replacePluginState({ actorId: state.ownerId, commandId: `stored-sandbox-invalid-${index}` }, runId, {
        pluginId: WORKSPACE_SANDBOX_OPTION_ID, scope: { kind: "run" }, state: invalid,
      });
      assert.throws(() => securityPolicyFor(false, sandboxAccessFor("admin"), journal.stateOf(runId)),
        (error: unknown) => error instanceof DomainError && error.code === "workspace-sandbox-invalid" && error.status === 409);
    }
  } finally { journal.close(); }
});

test("a started run's sandbox presentation follows its owner for old and imported state, including to an administrator viewer", async () => {
  for (const ownerUserId of ["alice", "admin"]) {
    for (const choice of [undefined, false]) {
      const runId = `sandbox-view-${ownerUserId}-${choice === undefined ? "missing" : "false"}`;
      const { journal, runtime, session } = sandboxFixture(runId, false);
      try {
        runtime.createRun({ commandId: "restore" }, {
          runId, title: "Restored fixture", ownerHandle: "owner", ownerDisplayName: "Owner", ownerUserId,
          initialPluginStates: choice === undefined ? [] : [{ pluginId: WORKSPACE_SANDBOX_OPTION_ID, state: choice }],
        });
        const forced = ownerUserId === "alice";
        for (const viewer of ["admin", "alice"]) {
          const option = session.startOptions(viewer).find((entry) => entry.id === WORKSPACE_SANDBOX_OPTION_ID)!;
          assert.equal(option.locked, true);
          assert.equal(option.value, choice ?? forced);
          assert.deepEqual(option.presentation, { kind: "process-sandbox", forced });
          assert.equal((option.presentation as { forced: boolean }).forced || option.value === true,
            securityPolicyFor(false, sandboxAccessFor(ownerUserId), journal.stateOf(runId)).restricted);
        }
        await assert.rejects(session.selectStartOption(WORKSPACE_SANDBOX_OPTION_ID, false, "admin"), (error: unknown) =>
          error instanceof DomainError && error.code === "option-locked" && error.status === 409);
      } finally {
        journal.close();
      }
    }
  }
});

const cloningSkill: PublicStartEntry = {
  id: "test.cloning-skill", owner: "test.plugin", action: "skill", skill: "demo", category: "Examples",
  title: "Clone", description: "Always works in the clone.", prompt: "Go", fixedStartOptions: { "test.workspace.source": "clone" },
};

const cloningScript: PublicStartEntry = {
  id: "test.cloning-script", owner: "test.plugin", action: "script", coordinator: true,
  title: "Clone by script", description: "Always builds in the clone.", fixedStartOptions: { "test.workspace.source": "clone" },
};

test("a skill template fixes its start option: the value holds, accepted for the user who starts the run", async () => {
  const seen: string[] = [];
  const runId = "fixed-skill";
  const { journal, session } = fixture(runId, [recordedSource(seen), modelStartOption(modelChoice(), "off")], [cloningSkill]);
  try {
    await session.send("Go", undefined, undefined, alice, cloningSkill.id);
    await session.drain();
    const state = journal.stateOf(runId);
    assert.equal(storedStartOption(state, "test.workspace.source"), "clone");
    assert.equal(state?.ownerUserId, "alice");
    assert.ok(seen.includes("accept clone alice"), seen.join(", "));
    assert.ok(!seen.some((entry) => entry.startsWith("default")), "the fixed value replaces the default");
  } finally {
    journal.close();
  }
});

test("a different choice before the start is a hard error with its cause, the same choice is fine", async () => {
  const conflicting = fixture("fixed-conflict", [workspaceChoice, modelStartOption(modelChoice(), "off")], [cloningSkill]);
  try {
    await conflicting.session.selectStartOption("test.workspace.source", "empty", "alice");
    await assert.rejects(conflicting.session.send("Go", undefined, undefined, alice, cloningSkill.id), (error: unknown) =>
      error instanceof DomainError && error.code === "start-option-fixed" && error.status === 409
      && error.message.includes("Clone") && error.message.includes("test.workspace.source"));
    assert.equal(conflicting.journal.stateOf("fixed-conflict"), null, "no run is created");
  } finally {
    conflicting.journal.close();
  }
  const agreeing = fixture("fixed-agree", [workspaceChoice, modelStartOption(modelChoice(), "off")], [cloningSkill]);
  try {
    await agreeing.session.selectStartOption("test.workspace.source", "clone", "alice");
    await agreeing.session.send("Go", undefined, undefined, alice, cloningSkill.id);
    await agreeing.session.drain();
    assert.equal(storedStartOption(agreeing.journal.stateOf("fixed-agree"), "test.workspace.source"), "clone");
  } finally {
    agreeing.journal.close();
  }
});

test("a script template fixes its start option through the same place", async () => {
  const conflicting = fixture("fixed-script-conflict", [workspaceChoice, modelStartOption(modelChoice(), "off")], [cloningScript]);
  try {
    await conflicting.session.selectStartOption("test.workspace.source", "empty", "alice");
    await assert.rejects(conflicting.session.startAndWait(cloningScript.id, null, alice), (error: unknown) =>
      error instanceof DomainError && error.code === "start-option-fixed");
    assert.deepEqual(conflicting.prepared, [], "rejected before anything is prepared");
    assert.equal(conflicting.journal.stateOf("fixed-script-conflict"), null);
  } finally {
    conflicting.journal.close();
  }
  const seen: string[] = [];
  const started = fixture("fixed-script", [recordedSource(seen), modelStartOption(modelChoice(), "off")], [cloningScript]);
  try {
    await assert.rejects(started.session.startAndWait(cloningScript.id, null, alice), /Actor programs are not configured/);
    assert.equal(storedStartOption(started.journal.stateOf("fixed-script"), "test.workspace.source"), "clone", "the run is created with the fixed value");
    assert.ok(seen.includes("accept clone alice"), seen.join(", "));
  } finally {
    started.journal.close();
  }
});

test("a message names only a skill template, and a started run keeps its value against a different template", async () => {
  const { journal, session } = fixture("fixed-started", [workspaceChoice, modelStartOption(modelChoice(), "off")], [cloningSkill, cloningScript]);
  try {
    for (const entryId of ["test.unknown", cloningScript.id]) {
      await assert.rejects(session.send("Go", undefined, undefined, alice, entryId), (error: unknown) =>
        error instanceof DomainError && error.code === "entry-unknown" && error.status === 404, entryId);
    }
    await session.send("Go", undefined, undefined, alice);
    await session.drain();
    assert.equal(storedStartOption(journal.stateOf("fixed-started"), "test.workspace.source"), "empty");
  } finally {
    journal.close();
  }
  const reopened = fixture("fixed-started-again", [workspaceChoice, modelStartOption(modelChoice(), "off")], [cloningSkill]);
  try {
    await reopened.session.send("Go", undefined, undefined, alice);
    await reopened.session.settle();
    await assert.rejects(reopened.session.send("Continue", undefined, undefined, alice, cloningSkill.id), (error: unknown) =>
      error instanceof DomainError && error.code === "start-option-fixed" && /already has a different value/.test(error.message));
  } finally {
    await reopened.session.drain();
    reopened.journal.close();
  }
});
