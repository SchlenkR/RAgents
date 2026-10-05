import assert from "node:assert/strict";
import { mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { Agent } from "@ragents/agent";
import { fauxAssistantMessage, fauxToolCall, registerFauxProvider } from "@ragents/ai";
import type { PluginContext, ToolScope } from "@ragents/engine";
import { WorkspaceSandboxHost } from "../src/plugin-support/workspace-sandbox-host.ts";

const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/iZk9HQAAAABJRU5ErkJggg==", "base64");

const fixture = async () => {
  const directory = await realpath(await mkdtemp(path.join(os.tmpdir(), "ragents-read-images-")));
  const sandbox = new WorkspaceSandboxHost({
    contributorName: "test.workspace", contributions: [], workspaceFor: async () => ({
      cwd: directory, currentRoot: async () => directory, runOperation: (operation) => operation(),
    }), identFor: async () => undefined, skillPaths: async () => [], homeFor: async () => ({ home: directory }),
  });
  await writeFile(path.join(directory, "picture.png"), png);
  await writeFile(path.join(directory, "notes.txt"), "Notes.");
  const tools = await sandbox.workspaceTools().tools({ runId: "run-1" } as PluginContext);
  const read = tools.find((tool) => tool.name === "read")!;
  const scope = (actorId = "actor-1"): ToolScope => ({
    caller: { runId: "run-1", actorId, turnId: "turn-1" }, modelContext: "context-1", signal: undefined,
  }) as ToolScope;
  const contribution = sandbox.readImageContribution();
  const complete = (actorId: string, toolCallId: string, modelReadsImages: boolean) => contribution.afterToolCall!(
    { runId: "run-1", agentId: actorId, audience: "agent", workspace: directory },
    { toolName: "read", toolCallId, isError: false }, { signal: undefined, modelReadsImages },
  );
  return { directory, sandbox, read, scope, complete, close: async () => {
    await sandbox.shutdownAll();
    await rm(directory, { recursive: true, force: true });
  } };
};

for (const modelReadsImages of [false, true]) {
  test(`native read presents ${modelReadsImages ? "pixels" : "an error"} to the calling model`, async () => {
    const setup = await fixture();
    const faux = registerFauxProvider({ models: [{ id: "read-image", input: modelReadsImages ? ["text", "image"] : ["text"] }], tokensPerSecond: 100_000 });
    const results: boolean[] = [];
    const agent = new Agent({
      initialState: { model: faux.getModel(), tools: [{
        name: "read", label: "read", description: setup.read.description, parameters: setup.read.schema,
        execute: async (id, input) => ({ content: [{ type: "text", text: await setup.read.run(setup.scope(), id, input as never) as string }], details: {} }),
      }] },
      getApiKey: () => "faux-key",
      afterToolCall: ({ toolCall }) => Promise.resolve(setup.complete("actor-1", toolCall.id, modelReadsImages)),
    });
    faux.setResponses([
      fauxAssistantMessage([fauxToolCall("read", { file_path: "picture.png" }, { id: "picture-1" })], { stopReason: "toolUse" }),
      (context) => {
        const result = context.messages.at(-1)!;
        assert.equal(result.role, "toolResult");
        if (result.role !== "toolResult") throw new Error("Missing read result");
        results.push(result.isError);
        assert.equal(result.isError, !modelReadsImages);
        assert.equal(result.content.some((part) => part.type === "image"), modelReadsImages);
        if (!modelReadsImages) assert.deepEqual(result.content, [{ type: "text", text: "This model cannot see images; ask the user or use a model with image input" }]);
        return fauxAssistantMessage([fauxToolCall("read", { file_path: "picture.png" }, { id: "picture-2" })], { stopReason: "toolUse" });
      },
      (context) => {
        const result = context.messages.at(-1)!;
        assert.equal(result.role, "toolResult");
        if (result.role !== "toolResult") throw new Error("Missing repeated read result");
        results.push(result.isError);
        assert.equal(result.isError, !modelReadsImages);
        return fauxAssistantMessage("Done.");
      },
    ]);
    try {
      await agent.prompt("Read the picture.");
      assert.equal(agent.state.errorMessage, undefined);
      assert.deepEqual(results, modelReadsImages ? [false, false] : [true, true]);
      const text = await setup.read.run(setup.scope(), "text", { file_path: "notes.txt" } as never);
      assert.equal(text, "1\tNotes.");
      assert.equal(await setup.complete("actor-1", "text", false), undefined);
    } finally {
      faux.unregister();
      await setup.close();
    }
  });
}

test("parallel image reads are isolated by actor as well as call ID and are consumed once", async () => {
  const setup = await fixture();
  try {
    await Promise.all(["actor-1", "actor-2"].map((actor) => setup.read.run(setup.scope(actor), "shared", { file_path: "picture.png" } as never)));
    assert.equal((await setup.complete("actor-1", "shared", false))?.isError, true);
    const visible = await setup.complete("actor-2", "shared", true);
    const image = visible?.content.find((part) => part.type === "image");
    assert.ok(image?.type === "image");
    assert.deepEqual(Buffer.from(image.data, "base64"), png);
    assert.equal(await setup.complete("actor-2", "shared", true), undefined);
    await setup.read.run(setup.scope(), "pending", { file_path: "picture.png" } as never);
    await setup.sandbox.shutdown("run-1");
    assert.equal(await setup.complete("actor-1", "pending", false), undefined);
  } finally {
    await setup.close();
  }
});
