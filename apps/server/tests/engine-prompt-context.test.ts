import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test, { after } from "node:test";
import { Type } from "typebox";
import {
  AgentSessionDriver,
  PluginHost,
  defineRunFunction,
  defineToolAvailability,
  type JsonValue,
  type TurnRequest,
} from "@aicontainer/ragents";
import { allGrants, executionFor, noUsage } from "../../../packages/ragents/tests/support.ts";
import { toolDescriptorFrom } from "../src/plugin-support/agent-tool.ts";
import { boundToTools } from "../src/plugin-support/prompt.ts";
import { productRuntimeToken } from "../src/ragents/product-runtime.ts";
import { workspaceRuntimeToken } from "../src/ragents/workspace-runtime.ts";

const directory = await mkdtemp(path.join(tmpdir(), "ragents-context-composition-"));
process.env.DATA_DIR = directory;
process.env.PRODUCT_PROFILE = "core";
process.env.PRODUCT_ID = "ragents";
process.env.PRODUCT_TITLE = "RAgents";
const { createEngine, SessionWorkspaces } = await import("../src/ragents/engine.ts");
after(() => rm(directory, { recursive: true, force: true }));

test("coordinator prompts survive primary handover while dynamic guides remain explicit", async (t) => {
  const requests: TurnRequest<"agent">[] = [];
  const results: JsonValue[] = [];
  let revision = 1;
  let guideRenders = 0;
  let unrelatedRenders = 0;
  t.mock.method(AgentSessionDriver.prototype, "runTurn", async (request: TurnRequest<"agent">) => {
    requests.push(request);
    if (request.input.content === "open") {
      results.push((await request.invoke("open", "typescript_api", {})).output);
    } else if (request.input.content === "detail") {
      results.push((await request.invoke("detail", "typescript_api", { names: ["build_demo", "allowed_probe"] })).output);
    } else if (request.input.content === "blocked") {
      results.push((await request.invoke("allowed", "typescript_api", { names: ["agent_spawn"] })).output);
    }
    return { failure: null, usage: noUsage() };
  });
  const plugins = new PluginHost({ product: { id: "ragents", title: "RAgents" }, dataDirectory: directory });
  plugins.provideHost(productRuntimeToken, {
    coordinator: { handle: "primary", displayName: "Primary", profile: "unused", runTitle: "Test", ownerHandle: "owner", ownerDisplayName: "Owner" },
    roleFor: (view, actor) => view.primaryActorId === actor.id ? "primary" : "worker",
    contract: () => "", promptComposition: "test",
    systemPrompts: () => ({ mode: "fixed", options: [], defaultIds: [], shareDefault: false }),
  });
  plugins.provideHost(workspaceRuntimeToken, {
    resolve: async () => { throw new Error("test uses remembered workspace"); },
    describe: () => ({ mode: "test", directoryPattern: directory }),
  });
  const available = defineToolAvailability({ availability: "always", availabilityDetail: "Test capability." }, () => true);
  const metadata = ["build_demo", "allowed_probe", "blocked_probe"].map((name) => ({ name, label: name, description: `Purpose of ${name}.` }));
  plugins.register({ manifest: { id: "test.prompt" }, register: (host) => {
    host.functions({
      name: "test.prompt.tools",
      descriptors: metadata.map((item) => toolDescriptorFrom(item, available)),
      tools: () => metadata.map((item) => defineRunFunction({
        ...item, available,
        schema: Type.Object({ revision: Type.Literal(revision) }, { additionalProperties: false }),
        resultSchema: Type.String(), run: async () => item.name,
      })),
    });
    host.prompts(
      { id: "preamble", order: 0, render: () => "Coordinator setup preamble." },
      boundToTools({ id: "hint", order: 1, delivery: "initial", render: () => "Initial build hint." }, "build_demo"),
      boundToTools({ id: "guide", order: 2, render: () => {
        guideRenders++;
        return `Detailed build guide. Guide revision: ${revision}`;
      } }, "build_demo", "allowed_probe"),
      boundToTools({ id: "unrelated", order: 3, render: () => {
        unrelatedRenders++;
        return "Unrelated private guide.";
      } }, "blocked_probe"),
    );
  } });
  const workspaces = new SessionWorkspaces();
  const runId = "prompt-context";
  workspaces.remember(runId, directory);
  const engine = await createEngine({ plugins, workspaces, assertAvailable: () => {}, assertRunUsable: () => {}, onChatSessionPersisted: () => {} });
  try {
    let view = engine.runtime.createRun({ commandId: "create" }, { runId, title: "Test", ownerHandle: "owner", ownerDisplayName: "Owner" });
    for (const handle of ["primary", "worker", "plain"]) {
      const commandId = handle === "primary" ? `coordinator:${runId}:${view.revision}` : `spawn:${handle}`;
      view = engine.runtime.spawnAgent({ actorId: view.ownerId, commandId }, runId, {
        handle, displayName: handle, prompt: `Own ${handle} prompt.`,
        execution: executionFor(handle, { profile: "agent", isolateWorkspace: false }),
        grants: allGrants(), toolNames: handle === "plain" ? [] : ["build_demo", "allowed_probe", "agent_spawn"],
      });
    }
    const actor = (handle: string) => view.actors.find((item) => item.handle === handle)!;
    engine.runtime.selectPrimaryActor({ actorId: view.ownerId, commandId: "primary" }, runId, actor("primary").id);
    let input = 0;
    const send = async (handle: string, content: string) => {
      engine.runtime.enqueueInput({ actorId: view.ownerId, commandId: `input:${++input}` }, runId, { actorId: actor(handle).id, content });
      await engine.scheduler.waitForIdle();
      assert.equal(engine.runtime.view(runId).turns.at(-1)?.status, "completed");
      return requests.at(-1)!;
    };
    guideRenders = 0;
    unrelatedRenders = 0;
    assert.doesNotMatch(engine.systemPromptFor(runId), /Detailed build guide|Unrelated private guide/);
    engine.start();
    const first = await send("primary", "open");
    assert.match(first.systemPrompt, /Coordinator setup preamble/);
    assert.match(first.systemPrompt, /Initial build hint/);
    assert.doesNotMatch(first.systemPrompt, /Detailed build guide|Unrelated private guide/);
    assert.equal(guideRenders, 0);
    assert.equal((results[0] as { guidance?: string }).guidance, undefined);
    await send("primary", "detail");
    const primaryGuide = (results.at(-1) as { guidance: string }).guidance;
    assert.equal(primaryGuide.match(/Detailed build guide/g)?.length, 1);
    assert.ok(JSON.stringify(results.at(-1)).includes("allowed_probe"));
    assert.doesNotMatch(primaryGuide, /type Handler|interface RunContext/);
    assert.doesNotMatch(primaryGuide, /blocked_probe|"tool_open"|Unrelated private guide/);
    assert.match(primaryGuide, /Guide revision: 1/);
    assert.equal(guideRenders, 1);
    assert.doesNotMatch((await send("primary", "next")).systemPrompt, /Detailed build guide/);
    revision = 2;
    const worker = await send("worker", "detail");
    assert.match(worker.systemPrompt, /Own worker prompt/);
    assert.match(worker.systemPrompt, /Initial build hint/);
    assert.doesNotMatch(worker.systemPrompt, /Coordinator setup preamble|Detailed build guide/);
    assert.match((results.at(-1) as { guidance: string }).guidance, /Guide revision: 2/);
    assert.equal(guideRenders, 2);
    assert.equal(unrelatedRenders, 0);
    const plain = await send("plain", "next");
    assert.equal(plain.systemPrompt, "Own plain prompt.");
    assert.deepEqual(plain.tools, []);
    engine.runtime.selectPrimaryActor({ actorId: view.ownerId, commandId: "handover" }, runId, actor("worker").id);
    const specialist = await send("worker", "next");
    assert.match(specialist.systemPrompt, /Own worker prompt/);
    assert.doesNotMatch(specialist.systemPrompt, /Coordinator setup preamble/);
    assert.match(specialist.systemPrompt, /Dein Modelltext wird im Chat mit dem Benutzer angezeigt/);
    const builder = await send("primary", "next");
    assert.match(builder.systemPrompt, /Coordinator setup preamble/);
    assert.doesNotMatch(builder.systemPrompt, /Dein Modelltext wird im Chat mit dem Benutzer angezeigt/);
    assert.equal(specialist.tools.some((tool) => tool.name === "agent_spawn"), false);
    assert.deepEqual(specialist.tools.map(tool=>tool.name).sort(), ["typescript_api", "typescript_eval"]);
    assert.equal(builder.tools.some((tool) => tool.name === "agent_spawn"), false);
    await send("primary", "blocked");
    assert.ok(JSON.stringify(results.at(-1)).includes("agent_spawn"));

    const source = engine.runtime.view(runId);
    const fork = engine.runtime.forkRun({ commandId: "fork-after-handover" }, runId, source.revision);
    workspaces.remember(fork.id, directory);
    for (const handle of ["worker", "primary"]) {
      engine.runtime.enqueueInput({ actorId: fork.ownerId, commandId: `fork-input:${handle}` }, fork.id, { actorId: actor(handle).id, content: "next" });
      await engine.scheduler.waitForIdle();
      const request = requests.at(-1)!;
      assert.equal(request.runId, fork.id);
      if (handle === "worker") {
        assert.match(request.systemPrompt, /Own worker prompt/);
        assert.doesNotMatch(request.systemPrompt, /Coordinator setup preamble/);
      } else assert.match(request.systemPrompt, /Coordinator setup preamble/);
    }
  } finally {
    await engine.shutdown();
  }
});
