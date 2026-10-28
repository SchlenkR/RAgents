import { noScriptParameters, unavailableActorPrograms } from "./actor-programs-fixture.ts";
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
  type JsonValue,
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
import { WORKSPACE_ACCESS_OPTION_ID, WORKSPACE_BINDING_OPTION_ID } from "../../../plugins/ragents.workspace/contract.ts";
import { accessDescription, accessNoteContribution, accessStartOption, securityPolicyFor } from "../../../plugins/ragents.workspace/server/security.ts";

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
    actorPrograms: { ...unavailableActorPrograms, scriptParameters: async () => noScriptParameters },
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
    assert.deepEqual(options.map((option) => option.id), [systemPromptStartOptionId, modelStartOptionId, "ragents.resume-after-restart"]);
    assert.equal(options[2].value, "on");
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
    await session.send("Go");
    await session.settle();

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
    await session.send("Go");
    await session.settle();
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
    await session.send("Go", undefined, undefined, { id: "carol", label: "Carol" });
    await session.settle();
    assert.deepEqual(seen, [
      "test.chosen default alice", "test.chosen describe alice", "test.default default alice", "test.default describe alice",
      "test.chosen accept bob", "test.chosen describe bob",
      "test.default default carol", "test.chosen accept carol",
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

const accessFor = (userId: string | null) => createAccessContext({
  enabled: true,
  user: userId === null ? null : { id: userId, label: userId, rights: userId === "admin" ? ["*"] : ["runs.read", "runs.write", "runs.create"] },
});

const workstationBinding = { machine: { client: "client-one", label: "Development" }, folder: { path: "/home/user/project" } };

const accessFixture = (runId: string, force: boolean, changed?: (runId: string) => Promise<void>, entries: readonly PublicStartEntry[] = []) => {
  const setup = fixture(runId, [], entries);
  setup.startOptions.register("ragents.workspace", [{
    id: WORKSPACE_BINDING_OPTION_ID,
    schema: Type.Any(),
    selectable: () => true,
    defaultValue: () => ({ machine: "server", folder: "fresh" }),
    accept: (value) => value,
    describe: () => ({}),
  }, accessStartOption(force, accessFor, (id) => setup.journal.stateOf(id), changed)]);
  return setup;
};

const accessOptionOf = (session: RunChatSession, userId: string) => session.startOptions(userId)
  .find((option) => option.id === WORKSPACE_ACCESS_OPTION_ID)!;

test("every owner defaults to isolated and only an administrator may request full server access", async () => {
  for (const force of [false, true]) {
    for (const owner of [alice, { id: "admin", label: "Administrator" }]) {
      const runId = `access-server-${owner.id}-${force}`;
      const { journal, session } = accessFixture(runId, force);
      try {
        assert.equal(accessOptionOf(session, owner.id).value, "isolated");
        const allowed = owner.id === "admin" && !force;
        assert.deepEqual(accessOptionOf(session, owner.id).presentation, {
          kind: "workspace-access", machine: "server", commandIsolation: "isolated",
          fullAccessDisabledReason: force ? "The server requires isolated access (PROCESS_SANDBOX=on)."
            : allowed ? null : "Full access on the server requires administrator permissions.",
        });
        if (allowed) {
          await session.selectStartOption(WORKSPACE_ACCESS_OPTION_ID, "full", owner.id);
        } else {
          await assert.rejects(session.selectStartOption(WORKSPACE_ACCESS_OPTION_ID, "full", owner.id),
            (error: unknown) => error instanceof DomainError && error.code === "workspace-access-forbidden" && error.status === 403);
        }
        await session.send("Start", undefined, undefined, owner);
        await session.settle();
        assert.equal(storedStartOption(journal.stateOf(runId), WORKSPACE_ACCESS_OPTION_ID), allowed ? "full" : "isolated");
        assert.deepEqual(securityPolicyFor(force, accessFor(owner.id), journal.stateOf(runId)), {
          level: allowed ? "full" : "isolated", restricted: !allowed,
        });
        assert.equal(accessOptionOf(session, owner.id).locked, false);
      } finally { journal.close(); }
    }
  }
});

test("a workstation owner may request full access regardless of server permissions and forced server isolation", async () => {
  for (const force of [false, true]) {
    const runId = `access-workstation-${force}`;
    const { journal, session, startOptions } = accessFixture(runId, force);
    try {
      await session.selectStartOption(WORKSPACE_BINDING_OPTION_ID, workstationBinding, "alice");
      assert.deepEqual(accessOptionOf(session, "alice").presentation, {
        kind: "workspace-access", machine: "workstation", commandIsolation: "unknown", fullAccessDisabledReason: null,
      });
      await session.selectStartOption(WORKSPACE_ACCESS_OPTION_ID, "full", "alice");
      await session.send("Start", undefined, undefined, alice);
      await session.settle();
      assert.deepEqual(securityPolicyFor(force, accessFor("alice"), journal.stateOf(runId)), { level: "full", restricted: false });
      assert.equal(startOptions.entry(WORKSPACE_ACCESS_OPTION_ID)?.option.ownerOnly?.("full"), true);
      assert.equal(startOptions.entry(WORKSPACE_ACCESS_OPTION_ID)?.option.ownerOnly?.("isolated"), false);
    } finally { journal.close(); }
  }
});

test("only the owner can change access of a shared run, even an administrator cannot change it", async () => {
  const runId = "access-owner";
  const { journal, session } = accessFixture(runId, false);
  try {
    await session.selectStartOption(WORKSPACE_BINDING_OPTION_ID, workstationBinding, "alice");
    await session.send("Start", undefined, undefined, alice);
    await session.settle();
    for (const value of ["isolated", "full"]) {
      for (const viewer of ["bob", "admin"]) {
        assert.deepEqual(accessOptionOf(session, viewer).presentation, {
          kind: "workspace-access", machine: "workstation", commandIsolation: "unknown", fullAccessDisabledReason: "Only the run's owner may change its access.",
        });
        await assert.rejects(session.selectStartOption(WORKSPACE_ACCESS_OPTION_ID, value, viewer),
          (error: unknown) => error instanceof DomainError && error.code === "workspace-access-owner" && error.status === 403);
      }
    }
    assert.equal(storedStartOption(journal.stateOf(runId), WORKSPACE_ACCESS_OPTION_ID), "isolated");
    await session.selectStartOption(WORKSPACE_ACCESS_OPTION_ID, "full", "alice");
    assert.equal(storedStartOption(journal.stateOf(runId), WORKSPACE_ACCESS_OPTION_ID), "full");
  } finally { journal.close(); }
});

test("access chosen for a workstation is revalidated if the binding changes to the server before start", async () => {
  const runId = "access-binding-change";
  const { journal, session } = accessFixture(runId, false);
  try {
    await session.selectStartOption(WORKSPACE_BINDING_OPTION_ID, workstationBinding, "alice");
    await session.selectStartOption(WORKSPACE_ACCESS_OPTION_ID, "full", "alice");
    await session.selectStartOption(WORKSPACE_BINDING_OPTION_ID, { machine: "server", folder: "fresh" }, "alice");
    await assert.rejects(session.send("Start", undefined, undefined, alice), (error: unknown) =>
      error instanceof DomainError && error.code === "workspace-access-forbidden" && /Isolated|workstation/.test(error.message));
    await session.settle();
    assert.equal(journal.stateOf(runId), null);
    await session.selectStartOption(WORKSPACE_ACCESS_OPTION_ID, "isolated", "alice");
    await session.send("Start", undefined, undefined, alice);
    await session.settle();
    assert.equal(storedStartOption(journal.stateOf(runId), WORKSPACE_ACCESS_OPTION_ID), "isolated");
  } finally { journal.close(); }
});

test("a fixed workstation binding validates full access against the complete candidate values", async () => {
  const runId = "access-fixed-binding";
  const entry: PublicStartEntry = {
    id: "test.workstation", owner: "test.plugin", action: "skill", skill: "demo", category: "Examples",
    title: "Local work", description: "Works on the workstation.", prompt: "Go",
    fixedStartOptions: { [WORKSPACE_ACCESS_OPTION_ID]: "full", [WORKSPACE_BINDING_OPTION_ID]: workstationBinding },
  };
  const setup = accessFixture(runId, true, undefined, [entry]);
  try {
    await setup.session.send("Start", undefined, undefined, alice, entry.id);
    await setup.session.settle();
    assert.equal(storedStartOption(setup.journal.stateOf(runId), WORKSPACE_ACCESS_OPTION_ID), "full");
    assert.deepEqual(storedStartOption(setup.journal.stateOf(runId), WORKSPACE_BINDING_OPTION_ID), workstationBinding);
  } finally { setup.journal.close(); }
});

test("missing access is isolated for restored runs and invalid stored access fails clearly", () => {
  for (const ownerUserId of ["alice", "admin", null]) {
    const runId = `access-restored-${ownerUserId ?? "unknown"}`;
    const { journal, runtime, session } = accessFixture(runId, false);
    try {
      runtime.createRun({ commandId: "restore" }, {
        runId, title: "Restored fixture", ownerHandle: "owner", ownerDisplayName: "Owner", ...(ownerUserId === null ? {} : { ownerUserId }),
      });
      assert.deepEqual(securityPolicyFor(false, accessFor(ownerUserId), journal.stateOf(runId)), { level: "isolated", restricted: true });
      assert.equal(accessOptionOf(session, "admin").value, "isolated");
      for (const [index, invalid] of [false, true, "false", 0, null, {}, []].entries()) {
        runtime.replacePluginState({ actorId: runtime.state(runId).ownerId, commandId: `stored-access-invalid-${index}` }, runId, {
          pluginId: WORKSPACE_ACCESS_OPTION_ID, scope: { kind: "run" }, state: invalid,
        });
        assert.throws(() => securityPolicyFor(false, accessFor(ownerUserId), journal.stateOf(runId)),
          (error: unknown) => error instanceof DomainError && error.code === "workspace-access-invalid" && error.status === 409);
      }
    } finally { journal.close(); }
  }
});

test("a changed access value is stored before its awaited cleanup hook and an unchanged choice writes nothing", async () => {
  const runId = "access-cleanup";
  const calls: string[] = [];
  const releases: (() => void)[] = [];
  const completed: string[] = [];
  const cleanup = new Promise<void>((resolve) => { releases.push(resolve); });
  const setup = accessFixture(runId, false, async (id) => {
    calls.push(`${id}:${storedStartOption(setup.journal.stateOf(id), WORKSPACE_ACCESS_OPTION_ID)}`);
    await cleanup;
    calls.push("cleaned");
  });
  try {
    await setup.session.send("Start", undefined, undefined, { id: "admin", label: "Administrator" });
    await setup.session.settle();
    const selected = setup.session.selectStartOption(WORKSPACE_ACCESS_OPTION_ID, "full", "admin").then(() => { completed.push("selected"); });
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.deepEqual(calls, [`${runId}:full`]);
    assert.deepEqual(completed, []);
    releases[0]!();
    await selected;
    assert.deepEqual(completed, ["selected"]);
    assert.deepEqual(calls, [`${runId}:full`, "cleaned"]);
    const revision = setup.runtime.state(runId).revision;
    await setup.session.selectStartOption(WORKSPACE_ACCESS_OPTION_ID, "full", "admin");
    assert.equal(setup.runtime.state(runId).revision, revision);
    await setup.session.selectStartOption(WORKSPACE_ACCESS_OPTION_ID, "isolated", "admin");
    assert.equal(calls.at(-2), `${runId}:isolated`);
    assert.equal(calls.at(-1), "cleaned");
  } finally { setup.journal.close(); }
});

test("an access cleanup failure keeps the isolated value and retry awaits cleanup without another journal change", async () => {
  const runId = "access-cleanup-retry";
  const cleanup: string[] = [];
  const setup = accessFixture(runId, false, async (id) => {
    if (storedStartOption(setup.journal.stateOf(id), WORKSPACE_ACCESS_OPTION_ID) !== "isolated") return;
    cleanup.push(id);
    if (cleanup.length === 1) throw new Error("Cleanup failed");
    await Promise.resolve();
    cleanup.push("finished");
  });
  try {
    await setup.session.send("Start", undefined, undefined, { id: "admin", label: "Administrator" });
    await setup.session.settle();
    await setup.session.selectStartOption(WORKSPACE_ACCESS_OPTION_ID, "full", "admin");
    await assert.rejects(setup.session.selectStartOption(WORKSPACE_ACCESS_OPTION_ID, "isolated", "admin"), /Cleanup failed/);
    assert.equal(storedStartOption(setup.journal.stateOf(runId), WORKSPACE_ACCESS_OPTION_ID), "isolated");
    const revision = setup.runtime.state(runId).revision;
    await setup.session.selectStartOption(WORKSPACE_ACCESS_OPTION_ID, "isolated", "admin");
    assert.equal(setup.runtime.state(runId).revision, revision);
    assert.deepEqual(cleanup, [runId, runId, "finished"]);
  } finally { setup.journal.close(); }
});

test("the access note appears once after a change and keeps its delivery marker across a fresh hook", async () => {
  const runId = "access-note";
  const { journal, runtime, session } = accessFixture(runId, false);
  const kept: JsonValue[] = [];
  const agent = { runId, agentId: "coordinator", audience: "coordinator" as const, workspace: "/unused" };
  const hook = () => accessNoteContribution((id) => journal.stateOf(id), (id) => runtime.events(id)
    .filter((event) => (event.type === "plugin.state-replaced" || event.type === "plugin.state-patched")
      && event.payload.pluginId === WORKSPACE_ACCESS_OPTION_ID).at(-1)?.sequence ?? 0).beforeModelCall!;
  const call = () => ({ signal: undefined, modelReadsImages: false, kept: kept.at(-1), keep: (value: JsonValue) => { kept.push(value); } });
  try {
    await session.send("Start", undefined, undefined, { id: "admin", label: "Administrator" });
    await session.settle();
    assert.equal(await hook()(agent, call()), undefined);
    await session.selectStartOption(WORKSPACE_ACCESS_OPTION_ID, "full", "admin");
    assert.match((await hook()(agent, call()))!, /Run access changed.*Full access on the server/);
    assert.equal(await hook()(agent, call()), undefined);
    await session.selectStartOption(WORKSPACE_ACCESS_OPTION_ID, "isolated", "admin");
    assert.match((await hook()(agent, call()))!, /Run access changed.*Isolated access on the server/);
    assert.equal(await hook()(agent, call()), undefined);
    await session.selectStartOption(WORKSPACE_ACCESS_OPTION_ID, "full", "admin");
    await session.selectStartOption(WORKSPACE_ACCESS_OPTION_ID, "isolated", "admin");
    assert.match((await hook()(agent, call()))!, /Run access changed.*Isolated access on the server/);
  } finally { journal.close(); }
});

test("access descriptions name the machine's actual file, command and environment limits", () => {
  assert.match(accessDescription("isolated", true), /read and write rule/);
  assert.match(accessDescription("isolated", true, "darwin"), /Secrets are removed/);
  for (const platform of ["darwin", "linux"]) assert.match(accessDescription("isolated", true, platform), /Commands are isolated by the workstation OS sandbox/);
  assert.match(accessDescription("isolated", true, "win32"), /Commands are not isolated on this machine/);
  assert.match(accessDescription("isolated", true), /platform is unavailable/);
  assert.match(accessDescription("full", true), /including secrets.*local confirmation/);
  assert.match(accessDescription("isolated", false), /server process sandbox.*safe environment allowlist/);
  assert.match(accessDescription("full", false), /every path.*safe allowlist/);
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
    await assert.rejects(conflicting.session.startAndWait(cloningScript.id, {}, alice), (error: unknown) =>
      error instanceof DomainError && error.code === "start-option-fixed");
    assert.deepEqual(conflicting.prepared, [], "rejected before anything is prepared");
    assert.equal(conflicting.journal.stateOf("fixed-script-conflict"), null);
  } finally {
    conflicting.journal.close();
  }
  const seen: string[] = [];
  const started = fixture("fixed-script", [recordedSource(seen), modelStartOption(modelChoice(), "off")], [cloningScript]);
  try {
    await assert.rejects(started.session.startAndWait(cloningScript.id, {}, alice), /Actor programs are not configured/);
    assert.equal(storedStartOption(started.journal.stateOf("fixed-script"), "test.workspace.source"), "clone", "the run is created with the fixed value");
    assert.ok(seen.includes("accept clone alice"), seen.join(", "));
  } finally {
    started.journal.close();
  }
});

test("an option chosen in the start request of a script template follows the same rule as a separate choice", async () => {
  const conflicting = fixture("fixed-script-request-conflict", [workspaceChoice, modelStartOption(modelChoice(), "off")], [cloningScript]);
  try {
    await assert.rejects(conflicting.session.startAndWait(cloningScript.id, { options: { "test.workspace.source": "empty" } }, alice), (error: unknown) =>
      error instanceof DomainError && error.code === "start-option-fixed" && error.status === 409);
    assert.deepEqual(conflicting.prepared, [], "rejected before anything is prepared");
    assert.equal(conflicting.journal.stateOf("fixed-script-request-conflict"), null);
  } finally {
    conflicting.journal.close();
  }
  const agreeing = fixture("fixed-script-request-agree", [workspaceChoice, modelStartOption(modelChoice(), "off")], [cloningScript]);
  try {
    await assert.rejects(agreeing.session.startAndWait(cloningScript.id, { options: { "test.workspace.source": "clone" } }, alice), /Actor programs are not configured/);
    assert.equal(storedStartOption(agreeing.journal.stateOf("fixed-script-request-agree"), "test.workspace.source"), "clone");
  } finally {
    agreeing.journal.close();
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

test("the access presentation describes the bound workstation platform for its owner", () => {
  const runId = "platform-access";
  const { journal } = fixture(runId, []);
  try {
    for (const [platform, isolation] of [["darwin", "isolated"], ["linux", "isolated"], ["win32", "unsupported"], [undefined, "unknown"]] as const) {
      const option = accessStartOption(false, accessFor, (id) => journal.stateOf(id), undefined, (binding, owner) => {
        assert.deepEqual(binding, workstationBinding);
        assert.equal(owner, "alice");
        return platform;
      });
      assert.deepEqual(option.describe("isolated", { runId, userId: "alice", values: { [WORKSPACE_BINDING_OPTION_ID]: workstationBinding } }), {
        kind: "workspace-access", machine: "workstation", commandIsolation: isolation, fullAccessDisabledReason: null,
      });
    }
  } finally { journal.close(); }
});
