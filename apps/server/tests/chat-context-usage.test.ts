import assert from "node:assert/strict";
import test from "node:test";
import { Journal, LiveBus, Orchestration, StaticModelCatalog, StartOptionContributionRegistry, createAccessContext } from "@ragents/engine";
import type { Engine } from "../src/ragents/engine.ts";
import { RunChatSession } from "../src/ragents/session.ts";
import { coreContracts } from "../src/api/contracts.ts";
import { coreMethods } from "../src/api/core-methods.ts";
import type { ChatSessionLike } from "../src/chat-handler.ts";
import { allGrants, testServices, textStep } from "../../../packages/ragents/tests/support.ts";
import { unavailableActorPrograms } from "./actor-programs-fixture.ts";
import { coreSources, methodContext } from "./rpc-fixture.ts";

test("context usage follows the addressed actor, counts cache tokens and resets after compaction", async () => {
  const services = testServices();
  const journal = new Journal(":memory:", services);
  const runtime = new Orchestration(journal, services);
  const models = [{ driver: "agent" as const, provider: "test", model: "example", label: "Example", thinking: ["off" as const] }];
  const catalog = new StaticModelCatalog(models, [{ name: "coordinator", description: "Test", driver: "agent", provider: "test", model: "example", turnTimeoutMs: null, isolateWorkspace: false }]);
  const limits = { contextWindow: 200_000, compactionThreshold: 160_000 };
  const engine = { journal, runtime, catalog, live: new LiveBus(), scheduler: { isRunning: () => false },
    startOptions: new StartOptionContributionRegistry(), contextLimits: async () => limits } as unknown as Engine;
  const session = new RunChatSession({ id: "context-run", engine,
    coordinator: { handle: "coordinator", displayName: "Coordinator", profile: "coordinator", runTitle: "Context", ownerHandle: "owner", ownerDisplayName: "Owner" },
    prompt: () => "Test", assertUsable: () => undefined, prepare: async () => undefined, prepareWorkspace: async () => undefined,
    started: async () => undefined, scriptEntryFor: () => undefined, startEntryFor: () => undefined, actorPrograms: unavailableActorPrograms });
  try {
    assert.deepEqual(await session.contextUsage("primary", null), { ...limits, tokens: 0, estimated: true });
    const run = runtime.createRun({ commandId: "create" }, { runId: "context-run", title: "Context", ownerHandle: "owner", ownerDisplayName: "Owner" });
    const context = (actorId = run.ownerId, turnId?: string) => ({ actorId, commandId: services.newId("command"), ...(turnId ? { turnId } : {}) });
    const actor = runtime.spawnAgent(context(), run.id, { handle: "worker", displayName: "Worker", prompt: "Test", grants: allGrants(), toolNames: [],
      execution: { driver: { kind: "agent", config: { provider: "test", model: "example", thinking: "off" } }, workspacePath: null, turnTimeoutMs: null } }).actors.find((entry) => entry.handle === "worker")!;
    runtime.selectPrimaryActor(context(), run.id, actor.id);
    const input = runtime.enqueueInput(context(), run.id, { actorId: actor.id, content: "Task" }).inputs.at(-1)!;
    const turn = runtime.startTurn(context(actor.id), run.id, actor.id, input.id).turns.at(-1)!;
    runtime.presentModelInput(context(actor.id, turn.id), run.id, actor.id, { turnId: turn.id, inputId: input.id, content: "Task" });
    const firstInput = runtime.events(run.id).findLast((entry) => entry.type === "model.input.presented")!.eventId;
    const step = textStep("Answer");
    runtime.completeModelStep(context(actor.id, turn.id), run.id, actor.id, { turnId: turn.id,
      step: { ...step, provider: "test", model: "example", usage: { ...step.usage, input: 100, output: 20, cacheRead: 80, cacheWrite: 10, totalTokens: 210 } } });
    assert.deepEqual(await session.contextUsage("primary", null), { ...limits, tokens: 210, estimated: false });
    assert.deepEqual(await session.contextUsage("@worker", null), await session.contextUsage(actor.id, null));
    runtime.compactContext(context(actor.id, turn.id), run.id, actor.id, { turnId: turn.id, summary: "Summary", firstKeptEventId: firstInput,
      tokensBefore: 210, model: "example", provider: "test", readFiles: [], modifiedFiles: [] });
    const compacted = await session.contextUsage(actor.id, null);
    assert.ok(compacted && compacted.estimated && compacted.tokens < 210);
    runtime.finishTurn(context(actor.id, turn.id), run.id, actor.id, { turnId: turn.id, outcome: "completed" });
    assert.equal(runtime.heldModelContexts(), 0);
    assert.deepEqual(await session.contextUsage(actor.id, null), compacted);
    assert.equal(runtime.heldModelContexts(), 0);
    const script = runtime.createScriptActor(context(), run.id, { handle: "notes", displayName: "Notes", grants: [], toolNames: [] }).actors.find((entry) => entry.kind === "script")!;
    assert.equal(await session.contextUsage(script.id, null), null);
    await assert.rejects(session.contextUsage("missing", null), /not available/);
  } finally { session.dispose(); journal.close(); }
});

test("context usage checks run access and returns only numeric context metadata", async () => {
  const usage = { tokens: 8_000, contextWindow: 200_000, compactionThreshold: 160_000, estimated: false };
  const methods = coreMethods(coreSources({ get: async () => ({ contextUsage: async () => usage } as unknown as ChatSessionLike) }));
  const method = methods.find((entry) => entry.contract.id === coreContracts.chat.contextUsage.id)!;
  const reader = createAccessContext({ enabled: true, user: { id: "alice", label: "Reader", rights: ["runs.read"] } });
  assert.deepEqual(await method.execute({ runId: "test-run" }, methodContext(reader)), usage);
  const denied = createAccessContext({ enabled: true, user: { id: "bob", label: "Viewer", rights: [] } });
  await assert.rejects(async () => method.execute({ runId: "test-run" }, methodContext(denied)), /access|right|permission/i);
});
