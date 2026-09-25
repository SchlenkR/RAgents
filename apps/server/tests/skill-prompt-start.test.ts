import { unavailableActorPrograms } from "./actor-programs-fixture.ts";
import assert from "node:assert/strict";
import test from "node:test";

import type { ChatSessionProvider } from "../src/chat-handler.ts";
import { coreContracts } from "../src/api/contracts.ts";
import { coreMethods } from "../src/api/core-methods.ts";
import { coreSources, methodContext } from "./rpc-fixture.ts";
import {
  createAccessContext,
  Journal,
  LiveBus,
  Orchestration,
  StartOptionContributionRegistry,
  StaticModelCatalog,
  type AccessContext,
  type AgentProfile,
  type CatalogModel,
  type PublicStartEntry,
  type SessionStartedContext,
} from "@ragents/engine";
import { testServices } from "../../../packages/ragents/tests/support.ts";
import type { ModelChoice } from "../src/plugin-support/model-choice.ts";
import { folderSkills, pluginFolder } from "../src/plugin-support/plugin-folder.ts";
import { productStartOptions } from "../src/plugin-support/product-start-options.ts";
import type { SystemPromptCatalog } from "../src/plugin-support/system-prompts.ts";
import type { Engine } from "../src/ragents/engine.ts";
import { RunChatSession } from "../src/ragents/session.ts";
import {
  modelStartOptionId,
  storedModel,
  storedSystemPrompt,
  storedThinking,
  systemPromptStartOptionId,
} from "../src/ragents/start-option-state.ts";

const firstReferenceCard = () => {
  const owner = "ragents.reference";
  const card = [...folderSkills(pluginFolder(owner), owner).startEntries].sort((left, right) => left.order! - right.order!)[0];
  assert.ok(card);
  assert.equal(card.title, "Hallo Welt auf der Fläche");
  return card;
};

const firstReferencePrompt = (): string => firstReferenceCard().prompt;

const createFixture = (runId: string, entries: readonly PublicStartEntry[] = []) => {
  const services = testServices();
  const journal = new Journal(":memory:", services);
  const runtime = new Orchestration(journal, services);
  const live = new LiveBus();
  const starts: Array<SessionStartedContext["startEntry"]> = [];
  const catalogModels: CatalogModel[] = [
    { driver: "agent", provider: "test", model: "other-first", label: "test/other-first", thinking: ["low", "high"] },
    { driver: "agent", provider: "test", model: "coordinator-default", label: "test/coordinator-default", thinking: ["low", "high"] },
  ];
  const profiles: AgentProfile[] = [
    {
      name: "coordinator",
      description: "Test coordinator",
      driver: "agent",
      provider: "test",
      model: "coordinator-default",
      thinking: "low",
      turnTimeoutMs: null,
      isolateWorkspace: false,
    },
  ];
  const systemPrompts: SystemPromptCatalog = {
    mode: "selectable",
    options: [
      { id: "general", label: "General", file: "general.md", text: "General prompt" },
      { id: "special", label: "Special", file: "special.md", text: "Special prompt" },
    ],
    defaultIds: ["general"],
    shareDefault: false,
  };
  const modelChoice: ModelChoice = {
    options: ["other-first", "coordinator-default"],
    defaultModel: "coordinator-default",
    provider: "test",
    selectable: true,
    thinkingOptionsFor: () => ["low", "high"],
  };
  const startOptions = new StartOptionContributionRegistry();
  startOptions.register("test.product", productStartOptions({
    modelChoice,
    coordinatorThinking: "low",
    systemPrompts: () => systemPrompts,
  }));
  const engine = {
    journal,
    runtime,
    live,
    scheduler: { isRunning: () => false },
    catalog: new StaticModelCatalog(catalogModels, profiles),
    catalogModels,
    startOptions,
  } as unknown as Engine;
  const session = new RunChatSession({
    engine,
    id: runId,
    coordinator: {
      handle: "coordinator",
      displayName: "Koordinator",
      profile: "coordinator",
      runTitle: "Neuer Run",
      ownerHandle: "owner",
      ownerDisplayName: "Owner",
    },
    prompt: () => "Coordinator prompt",
    assertUsable: () => undefined,
    prepare: async () => undefined,
    prepareWorkspace: async () => undefined,
    started: async (_id, startEntry) => {
      starts.push(startEntry);
    },
    scriptEntryFor: () => undefined,
    startEntryFor: (entryId) => entries.find((entry) => entry.id === entryId),
    actorPrograms: unavailableActorPrograms,
  });

  return { journal, runtime, session, starts };
};

const sendThroughChatHttp = async (session: RunChatSession, runId: string, text: string, entry?: string, access?: AccessContext): Promise<void> => {
  const provider: ChatSessionProvider = { get: async () => session, list: async () => [], delete: async () => undefined };
  const send = coreMethods(coreSources(provider))
    .find((contribution) => contribution.contract.id === coreContracts.chat.send.id)!;
  try {
    await send.execute({ runId, text, ...(entry ? { entry } : {}) } as never, methodContext(access));
    await session.drain();
  } finally {
    await session.drain();
  }
};

const assertCardStarted = (
  fixture: ReturnType<typeof createFixture>,
  runId: string,
  prompt: string,
  expected: {
    model?: string;
    thinking?: string;
    promptIds?: readonly string[];
    shareWithAgents?: boolean;
  } = {},
): void => {
  const expectedModel = expected.model ?? "coordinator-default";
  const expectedThinking = expected.thinking ?? "low";
  const state = fixture.journal.stateOf(runId);
  assert.ok(state);
  const view = fixture.runtime.view(runId);
  const primary = view.actors.find((actor) => actor.id === view.primaryActorId);
  assert.ok(primary && primary.kind === "agent");
  assert.equal(primary.handle, "coordinator");
  assert.equal(view.inputs.length, 1);
  assert.equal(view.inputs[0]?.actorId, primary.id);
  assert.equal(view.inputs[0]?.content, prompt);
  assert.equal(storedModel(state), expectedModel);
  assert.equal(storedThinking(state), expectedThinking);
  assert.equal(primary.execution.driver.config.model, expectedModel);
  assert.equal(primary.execution.driver.config.thinking, expectedThinking);
  assert.deepEqual(storedSystemPrompt(state), {
    promptIds: expected.promptIds ?? ["general"],
    shareWithAgents: expected.shareWithAgents ?? false,
  });

  const stateEvents = fixture.runtime.events(runId).filter((event) => event.type === "plugin.state-replaced");
  assert.deepEqual(
    stateEvents.map((event) => ({ pluginId: event.payload.pluginId, scope: event.payload.scope })),
    [
      { pluginId: systemPromptStartOptionId, scope: { kind: "run" } },
      { pluginId: modelStartOptionId, scope: { kind: "run" } },
    ],
  );
};

const assertAtomicStartup = (
  fixture: ReturnType<typeof createFixture>,
  runId: string,
  expected: readonly { pluginId: string; state: unknown }[],
): void => {
  const records = fixture.journal.records(runId);
  const creation = records[0];
  assert.ok(creation);
  assert.equal(creation.command.id, `run:${runId}`);
  assert.deepEqual(
    creation.events.map((event) => event.type),
    ["run.created", "plugin.state-replaced", "plugin.state-replaced"],
  );
  assert.deepEqual([...new Set(creation.events.map((event) => event.commandId))], [`run:${runId}`]);
  assert.deepEqual(
    creation.events
      .filter((event) => event.type === "plugin.state-replaced")
      .map((event) => ({ pluginId: event.payload.pluginId, state: event.payload.state })),
    expected,
  );
};

test("the first reference skill starts an empty run through the chat HTTP path", async () => {
  const prompt = firstReferencePrompt();
  const runId = "first-reference-card-run";
  const fixture = createFixture(runId);

  try {
    await sendThroughChatHttp(fixture.session, runId, prompt);
    assertCardStarted(fixture, runId, prompt);
    assertAtomicStartup(fixture, runId, [
      { pluginId: systemPromptStartOptionId, state: { promptIds: ["general"], shareWithAgents: false } },
      { pluginId: modelStartOptionId, state: { model: "coordinator-default", thinking: "low" } },
    ]);
    assert.deepEqual(fixture.starts, [null]);
  } finally {
    fixture.journal.close();
  }
});

test("the first reference skill completes a run left at run.created", async () => {
  const prompt = firstReferencePrompt();
  const runId = "recover-first-reference-card-run";
  const fixture = createFixture(runId);
  fixture.runtime.createRun(
    { commandId: "failed-first-start" },
    {
      runId,
      title: "Neuer Run",
      ownerHandle: "owner",
      ownerDisplayName: "Owner",
    },
  );

  try {
    assert.equal(fixture.session.attach(), false);
    await sendThroughChatHttp(fixture.session, runId, prompt);
    assertCardStarted(fixture, runId, prompt);
    const records = fixture.journal.records(runId);
    assert.deepEqual(records[0]?.events.map((event) => event.type), ["run.created"]);
    assert.deepEqual(
      records
        .flatMap((record) => record.events)
        .filter((event) => event.type === "plugin.state-replaced")
        .map((event) => event.commandId),
      [`start-option:${systemPromptStartOptionId}:${runId}`, `start-option:${modelStartOptionId}:${runId}`],
    );
  } finally {
    fixture.journal.close();
  }
});

test("explicit non-default startup selections are persisted atomically with run creation", async () => {
  const prompt = firstReferencePrompt();
  const runId = "selected-model-card-run";
  const fixture = createFixture(runId);
  await fixture.session.selectStartOption(systemPromptStartOptionId, { promptIds: ["special"], shareWithAgents: true }, null);
  await fixture.session.selectStartOption(modelStartOptionId, { model: "other-first", thinking: "high" }, null);

  try {
    await sendThroughChatHttp(fixture.session, runId, prompt);
    assertCardStarted(fixture, runId, prompt, {
      model: "other-first",
      thinking: "high",
      promptIds: ["special"],
      shareWithAgents: true,
    });
    assertAtomicStartup(fixture, runId, [
      { pluginId: systemPromptStartOptionId, state: { promptIds: ["special"], shareWithAgents: true } },
      { pluginId: modelStartOptionId, state: { model: "other-first", thinking: "high" } },
    ]);
  } finally {
    fixture.journal.close();
  }
});

test("a skill template that fixes the model starts its run through the chat HTTP path with exactly that model", async () => {
  const card = firstReferenceCard();
  const runId = "fixed-model-card-run";
  const entry: PublicStartEntry = { ...card, owner: "ragents.reference", fixedStartOptions: { [modelStartOptionId]: { model: "other-first", thinking: "high" } } };
  const fixture = createFixture(runId, [entry]);
  const operator = createAccessContext({ enabled: true, user: { id: "operator", label: "Operator", rights: ["runs.read", "runs.write", "runs.create"] } });
  try {
    await sendThroughChatHttp(fixture.session, runId, card.prompt, entry.id, operator);
    assertCardStarted(fixture, runId, card.prompt, { model: "other-first", thinking: "high" });
    assertAtomicStartup(fixture, runId, [
      { pluginId: systemPromptStartOptionId, state: { promptIds: ["general"], shareWithAgents: false } },
      { pluginId: modelStartOptionId, state: { model: "other-first", thinking: "high" } },
    ]);
    assert.equal(fixture.journal.stateOf(runId)?.ownerUserId, "operator");
    assert.deepEqual(fixture.starts, [{ id: entry.id, action: "skill" }]);
  } finally {
    fixture.journal.close();
  }
});
