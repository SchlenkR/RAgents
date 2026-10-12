import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test, { after } from "node:test";
import { PluginHost } from "@ragents/engine";
import { fauxAssistantMessage } from "@ragents/ai";
import { executionFor } from "../../../packages/ragents/tests/support.ts";
import { isSummary, scriptedRuntime, withTokens } from "../../../packages/ragents/tests/agent-runtime-fixture.ts";
import { productRuntimeToken } from "../src/ragents/product-runtime.ts";
import { workspaceRuntimeToken } from "../src/ragents/workspace-runtime.ts";

const directory = await mkdtemp(path.join(tmpdir(), "ragents-compaction-log-"));
process.env.DATA_DIR = directory;
process.env.PRODUCT_PROFILE = "core";
process.env.PRODUCT_ID = "ragents";
process.env.PRODUCT_TITLE = "RAgents";
const { createEngine, SessionWorkspaces } = await import("../src/ragents/engine.ts");
after(() => rm(directory, { recursive: true, force: true }));

test("failed compaction reaches the server log with run and actor and the turn with a readable reason", async (t) => {
  const setup = scriptedRuntime("server-summary-failure", (context) => isSummary(context)
    ? fauxAssistantMessage("Incomplete checkpoint.", { stopReason: "length" })
    : withTokens(fauxAssistantMessage("First answer."), 2_000));
  t.after(() => setup.faux.unregister());
  const logs: string[] = [];
  t.mock.method(console, "warn", (message: string) => logs.push(message));
  const plugins = new PluginHost({ product: { id: "ragents", title: "RAgents" }, dataDirectory: directory });
  plugins.provideHost(productRuntimeToken, {
    coordinator: { handle: "primary", displayName: "Primary", profile: "unused", runTitle: "Test", ownerHandle: "owner", ownerDisplayName: "Owner" },
    roleFor: () => "worker", contract: () => "", promptComposition: "",
    systemPrompts: () => ({ mode: "fixed", options: [], defaultIds: [], shareDefault: false }),
  });
  plugins.provideHost(workspaceRuntimeToken, {
    resolve: async () => { throw new Error("Test uses a remembered workspace."); },
    describe: () => ({ mode: "test", directoryPattern: directory }),
  });
  const workspaces = new SessionWorkspaces(() => ({
    execute: () => Promise.reject(new Error("The test stores no attachments.")),
    serverProcessContextFor: async (runId: string) => ({ runId, cwd: directory }) as never,
  }));
  const runId = "compaction-log";
  workspaces.remember(runId, directory);
  const engine = await createEngine({ plugins, workspaces, modelRuntime: setup.modelRuntime, assertAvailable: () => {}, assertRunUsable: () => {} });
  try {
    const run = engine.runtime.createRun({ commandId: "create" }, { runId, title: "Test", ownerHandle: "owner", ownerDisplayName: "Owner" });
    const spawned = engine.runtime.spawnAgent({ actorId: run.ownerId, commandId: "spawn" }, runId, {
      handle: "worker", displayName: "Worker", prompt: "Work.", toolNames: [], grants: [],
      execution: { ...executionFor("worker", { profile: "agent", isolateWorkspace: false }),
        driver: { kind: "agent", config: { ...setup.selection, thinking: "off" } } },
    });
    const actor = spawned.actors.find((entry) => entry.kind === "agent")!;
    engine.start();
    for (const [index, content] of ["Initial task.", "x".repeat(5_000)].entries()) {
      engine.runtime.enqueueInput({ actorId: run.ownerId, commandId: `input-${index}` }, runId, { actorId: actor.id, content });
      await engine.scheduler.waitForIdle();
    }
    assert.ok(logs.some((message) => message.includes(`${runId}/${actor.id}`) && message.includes("incomplete response (length)")));
    const turn = engine.runtime.view(runId).turns.at(-1)!;
    assert.equal(turn.status, "failed");
    assert.match(JSON.stringify(turn), /summary reached the output token limit \(length\)/);
    assert.equal(engine.runtime.events(runId).filter((event) => event.type === "model.step.completed").length, 1);
  } finally {
    await engine.shutdown();
  }
});
