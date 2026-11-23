import assert from "node:assert/strict";
import test from "node:test";
import { orchestrationToolContributor } from "../../../plugins/ragents.orchestration/server/functions.ts";
import { getSettings, type SettingsResponse } from "../src/api.ts";

const answer = (init: RequestInit | undefined, result: unknown) =>
  Response.json({ jsonrpc: "2.0", id: (JSON.parse(String(init?.body)) as { id: number }).id, result });

const contributor = orchestrationToolContributor();

const settings = (): SettingsResponse => ({
  version: 2,
  product: { id: "test", title: "Test" },
  runtime: {
    profile: "test", configFile: null, workspaceMode: "per-run",
    host: { mode: "native", platform: "darwin", workingDirectory: "/tmp" },
    dataDirectory: "/tmp/data", workspace: { directoryPattern: "/tmp/runs" }, documents: null,
  },
  models: [], profiles: [], promptContributions: [], plugins: [], agentHooks: [], skills: [],
  systemPrompt: {
    scope: "product", content: "", finalPromptIsRunSpecific: true,
    composition: "", runtimeContracts: [],
  },
  tools: contributor.descriptors.map((tool) => ({
    ...tool, id: `plugin:ragents.orchestration:${contributor.name}:${tool.name}`, owner: "ragents.orchestration", source: contributor.name,
    kind: "plugin",
  })),
});

test("settings accept the orchestration tool descriptors, including required capabilities", async (context) => {
  const body = settings();
  assert.ok(contributor.descriptors.some((tool) => tool.requiredCapabilities?.length));
  assert.ok(contributor.descriptors.some((tool) => tool.requiredCapabilities === undefined));
  context.mock.method(globalThis, "fetch", async (_url: string, init: RequestInit) => answer(init, body));
  assert.deepEqual(await getSettings(), body);
});

test("settings accept native tool metadata for the shared function catalog", async (context) => {
  const body = settings();
  body.tools = [
    { ...body.tools[0], nativeTool: false },
    { ...body.tools[1], nativeTool: true },
    body.tools[2],
  ];
  context.mock.method(globalThis, "fetch", async (_url: string, init: RequestInit) => answer(init, body));
  assert.deepEqual(await getSettings(), body);
});

test("settings still reject malformed capabilities, missing fields and unknown tool fields", async (context) => {
  const body = settings();
  let tools: unknown[] = [];
  context.mock.method(globalThis, "fetch", async (_url: string, init: RequestInit) => answer(init, { ...body, tools }));
  const { name: _name, ...missingName } = body.tools[0];
  for (const invalid of [
    { ...body.tools[0], requiredCapabilities: "actor.spawn" },
    { ...body.tools[0], requiredCapabilities: [42] },
    { ...body.tools[0], requiredCapabilities: null },
    { ...body.tools[0], nativeTool: "true" },
    { ...body.tools[0], nativeTool: null },
    { ...body.tools[0], visibility: "indexed" },
    { ...body.tools[0], unknownField: true },
    missingName,
  ]) {
    tools = [invalid];
    await assert.rejects(getSettings(), /The settings do not match the expected format/);
  }
});
