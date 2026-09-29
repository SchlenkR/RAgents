import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test, { after } from "node:test";
import { Type } from "typebox";
import {
  AgentLoopDriver,
  PluginHost,
  defineRunFunction,
  type JsonValue,
  type TurnRequest,
} from "@ragents/engine";
import { allGrants, executionFor, noUsage } from "../../../packages/ragents/tests/support.ts";
import { boundToTools, systemPromptSelectionPrompt } from "../src/plugin-support/prompt.ts";
import type { SystemPromptCatalog } from "../src/plugin-support/system-prompts.ts";
import { productRuntimeToken } from "../src/ragents/product-runtime.ts";
import { systemPromptStartOptionId, startOptionScope } from "../src/ragents/start-option-state.ts";
import { workspaceRuntimeToken } from "../src/ragents/workspace-runtime.ts";
import { registerTypeScriptFunctions } from "../src/ragents/typescript-tools.ts";

const directory = await mkdtemp(path.join(tmpdir(), "ragents-run-condition-"));
process.env.DATA_DIR = directory;
process.env.PRODUCT_PROFILE = "core";
process.env.PRODUCT_ID = "ragents";
process.env.PRODUCT_TITLE = "RAgents";
const { createEngine, SessionWorkspaces } = await import("../src/ragents/engine.ts");
after(() => rm(directory, { recursive: true, force: true }));

const probe = (name: string) => defineRunFunction({
  name,
  label: name,
  description: `Purpose of ${name}.`,
  schema: Type.Object({}, { additionalProperties: false }),
  resultSchema: Type.String(),
  available: () => true,
  run: () => name,
});

test("a plugin's run condition and a per-run override leave out its prompts, chapters, functions and the chosen system prompt", async (t) => {
  const requests = new Map<string, TurnRequest<"agent">>();
  const results = new Map<string, JsonValue>();
  t.mock.method(AgentLoopDriver.prototype, "runTurn", async (request: TurnRequest<"agent">) => {
    const key = `${request.runId}:${request.input.content}`;
    requests.set(key, request);
    if (request.input.content === "listing") results.set(key, (await request.invoke("listing", "typescript_api", {})).output);
    if (request.input.content === "guide") results.set(key, (await request.invoke("guide", "typescript_api", { names: ["open_probe"] })).output);
    return { failure: null, usage: noUsage() };
  });
  const promptFile = path.join(directory, "domain.md");
  await writeFile(promptFile, "# Domain\nDomain system prompt.");
  const catalog: SystemPromptCatalog = {
    mode: "selectable",
    options: [{ id: "domain", label: "Domain", file: promptFile, text: "# Domain\nDomain system prompt." }],
    defaultIds: ["domain"],
    shareDefault: true,
  };
  const plugins = new PluginHost({ product: { id: "ragents", title: "RAgents" }, dataDirectory: directory });
  plugins.provideHost(productRuntimeToken, {
    coordinator: { handle: "primary", displayName: "Primary", profile: "unused", runTitle: "Test", ownerHandle: "owner", ownerDisplayName: "Owner" },
    roleFor: (view, actor) => view.primaryActorId === actor.id ? "primary" : "worker",
    contract: () => "", promptComposition: "test",
    systemPrompts: () => catalog,
  });
  plugins.provideHost(workspaceRuntimeToken, {
    resolve: async () => { throw new Error("test uses remembered workspace"); },
    describe: () => ({ mode: "test", directoryPattern: directory }),
  });
  const foreign = (runId: string): boolean => runId === "foreign";
  plugins.register({ manifest: { id: "test.product" }, register: (host) => {
    host.prompts(
      { id: "product.preamble", order: 0, render: () => "Product preamble." },
      { ...systemPromptSelectionPrompt("test.product.selected-prompt", 50, catalog), renderForRun: (runId) => foreign(runId) ? "" : undefined },
    );
  } });
  plugins.register({ manifest: { id: "test.open" }, register: (host) => {
    host.functions(probe("open_probe"));
    host.prompts(boundToTools({ id: "open.guide", order: 10, render: () => "Open guide." }, "open_probe"));
  } });
  plugins.register({ manifest: { id: "test.domain" }, register: (host) => {
    host.functions(probe("domain_probe"));
    host.prompts(
      { id: "domain.rules", order: 20, render: () => "Domain rules." },
      boundToTools({ id: "domain.on-open", order: 21, render: () => "Domain chapter on the open probe." }, "open_probe"),
      boundToTools({ id: "domain.shared", order: 22, delivery: "initial", render: () => "Domain hint for agents." }, "open_probe"),
    );
    host.runCondition((runId) => !foreign(runId));
  } });
  registerTypeScriptFunctions(plugins);
  const workspaces = new SessionWorkspaces(() => ({
    execute: () => Promise.reject(new Error("The test stores no attachments")),
    serverProcessContextFor: async (runId: string) => ({ runId, cwd: directory }) as never,
  }));
  const engine = await createEngine({ plugins, workspaces, assertAvailable: () => {}, assertRunUsable: () => {} });
  try {
    const setUp = (runId: string) => {
      workspaces.remember(runId, directory);
      let view = engine.runtime.createRun({ commandId: `create:${runId}` }, { runId, title: runId, ownerHandle: "owner", ownerDisplayName: "Owner" });
      engine.runtime.replacePluginState({ actorId: view.ownerId, commandId: `prompt:${runId}` }, runId, {
        pluginId: systemPromptStartOptionId, scope: startOptionScope, state: { promptIds: ["domain"], shareWithAgents: true },
      });
      for (const handle of ["primary", "worker"]) {
        view = engine.runtime.view(runId);
        const commandId = handle === "primary" ? `coordinator:${runId}:${view.revision}` : `spawn:${runId}:${handle}`;
        view = engine.runtime.spawnAgent({ actorId: view.ownerId, commandId }, runId, {
          handle, displayName: handle, prompt: `Own ${handle} prompt.`,
          execution: executionFor(handle, { profile: "agent", isolateWorkspace: false }),
          grants: allGrants(), toolNames: handle === "primary" ? null : ["open_probe"],
        });
      }
      const actor = (handle: string) => view.actors.find((item) => item.handle === handle)!;
      engine.runtime.selectPrimaryActor({ actorId: view.ownerId, commandId: `primary:${runId}` }, runId, actor("primary").id);
      return async (handle: string, content: string) => {
        engine.runtime.enqueueInput({ actorId: view.ownerId, commandId: `input:${runId}:${handle}:${content}` }, runId, { actorId: actor(handle).id, content });
        await engine.scheduler.waitForIdle();
        assert.equal(engine.runtime.view(runId).turns.at(-1)?.status, "completed");
        return requests.get(`${runId}:${content}`)!;
      };
    };
    const own = setUp("own");
    const other = setUp("foreign");
    engine.start();

    assert.match(engine.systemPromptFor("own"), /Product preamble\.[\s\S]*Domain rules\.[\s\S]*Domain system prompt\./);
    assert.match(engine.systemPromptFor("foreign"), /Product preamble\./);
    assert.doesNotMatch(engine.systemPromptFor("foreign"), /Domain/);

    const ownWorker = await own("worker", "work");
    assert.match(ownWorker.systemPrompt, /Domain system prompt\.[\s\S]*Own worker prompt\.[\s\S]*Domain hint for agents\./);
    const otherWorker = await other("worker", "work");
    assert.match(otherWorker.systemPrompt, /Own worker prompt\./);
    assert.doesNotMatch(otherWorker.systemPrompt, /Domain/);

    await own("primary", "listing");
    await other("primary", "listing");
    const names = (runId: string) => (results.get(`${runId}:listing`) as { functions: { name: string }[] }).functions.map((entry) => entry.name);
    assert.ok(names("own").includes("domain_probe"));
    assert.ok(names("foreign").includes("open_probe"));
    assert.ok(!names("foreign").includes("domain_probe"));

    await own("primary", "guide");
    await other("primary", "guide");
    const guidance = (runId: string) => (results.get(`${runId}:guide`) as { guidance?: string }).guidance ?? "";
    assert.match(guidance("own"), /Open guide\.[\s\S]*Domain chapter on the open probe\./);
    assert.match(guidance("foreign"), /Open guide\./);
    assert.doesNotMatch(guidance("foreign"), /Domain/);
  } finally {
    await engine.shutdown();
  }
});
