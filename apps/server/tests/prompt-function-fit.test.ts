import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test, { after } from "node:test";
import { AgentLoopDriver, agentTools, type TurnRequest } from "@ragents/engine";
import { noUsage } from "../../../packages/ragents/tests/support.ts";
import { config as coreConfig } from "../../../ragents.config.core.ts";
import { coordinatorRunId } from "../../../plugins/ragents.overseer/server/coordinator.ts";
import { compositionEnvironment } from "./fixtures/profile-composition/profiles.ts";
import type { Engine } from "../src/ragents/engine.ts";

const directory = await mkdtemp(path.join(tmpdir(), "ragents-prompt-function-fit-"));
const selectableDirectory = path.join(directory, "prompts");
mkdirSync(selectableDirectory);
writeFileSync(path.join(selectableDirectory, "reader.hbs"), 'Reader-specific rules.{{#if (available "event_query")}} Use event_query for history.{{/if}}');
for (const [key, value] of Object.entries({ ...compositionEnvironment, DATA_DIR: directory, PROCESS_SANDBOX: "off", MCP_SERVERS: "{}", ACP_AGENTS: "{}",
  SYSTEM_PROMPTS_DIR: selectableDirectory, SYSTEM_PROMPT_DEFAULT: "reader", SYSTEM_PROMPT_SHARE_DEFAULT: "1",
  MODEL_ALIASES: JSON.stringify(coreConfig.host.MODEL_ALIASES), MODEL_PROVIDERS: JSON.stringify(coreConfig.host.MODEL_PROVIDERS),
  OPENROUTER_API_KEY: "test-key" })) {
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
}
const { RunSessionProvider } = await import("../src/provider.ts");
const { loadPlugins } = await import("../src/profile/plugin-discovery.ts");
const { composeProfile } = await import("../src/profile/compose.ts");
const { pluginsRoot } = await import("../src/plugin-support/plugins-root.ts");
const { handlebarsPrompt } = await import("../src/plugin-support/prompt.ts");
const pluginIds = coreConfig.host.PLUGINS;
const loaded = await loadPlugins(pluginIds);
const provider = new RunSessionProvider((bridges) => composeProfile(
  { product: { id: coreConfig.host.PRODUCT_ID, title: coreConfig.host.PRODUCT_TITLE }, pluginIds, modules: loaded.modules, web: loaded.web, executor: loaded.executor },
  bridges,
), undefined);
await provider.init();
after(async () => {
  await provider.shutdown();
  await rm(directory, { recursive: true, force: true });
});
const engine = (provider as unknown as { engine: Engine }).engine;
const registered = [...new Set([...agentTools.map((tool) => tool.name), ...provider.plugins.tools.describe().map((tool) => tool.name)])];

const workerTools = ["read", "write", "edit", "bash", "actor_program_create", "actor_program_diagnostics"];

/** Names with an underscore count wherever they stand; a plain word such as read only in code form. */
const mentioned = (prompt: string): string[] => {
  return registered.filter((name) => name.includes("_")
    ? new RegExp(`(?<![A-Za-z0-9_])${name}(?![A-Za-z0-9_])`).test(prompt)
    : new RegExp(`\`${name}\`|"${name}"|functions\\.${name}(?![A-Za-z0-9_])|(?<![A-Za-z0-9_.])${name}\\(`).test(prompt));
};

const templatesOf = (pluginDirectory: string): string[] => readdirSync(pluginDirectory, { recursive: true, encoding: "utf8" })
  .filter((entry) => entry.endsWith(".hbs"))
  .map((entry) => path.join(pluginDirectory, entry))
  .filter((file) => statSync(file).isFile());

test("the system prompts of the core coordinator, an ordinary agent and the global coordinator name only functions of their selection", { timeout: 120000 }, async (t) => {
  const requests: TurnRequest<"agent">[] = [];
  t.mock.method(AgentLoopDriver.prototype, "runTurn", async (request: TurnRequest<"agent">) => {
    requests.push(request);
    if (request.input.content === "Spawn the worker.") {
      await request.invoke("spawn", "agent_spawn", {
        description: "checks the files", name: "worker", tools: workerTools, model: process.env.AGENT_MODEL!, prompt: "Check the files.",
      });
    }
    return { failure: null, usage: noUsage() };
  });
  const runId = randomUUID();
  await (await provider.get(runId)).send("Spawn the worker.");
  await engine.scheduler.waitForIdle();
  const global = coordinatorRunId(null);
  await (await provider.get(global)).send("Show my runs.");
  await engine.scheduler.waitForIdle();

  const actorOf = (request: TurnRequest<"agent">) => engine.runtime.view(request.runId).actors.find((actor) => actor.id === request.agentId)!;
  const cases = [
    { label: "core coordinator", request: requests.find((request) => request.runId === runId && actorOf(request).handle === "coordinator") },
    { label: "ordinary agent", request: requests.find((request) => request.runId === runId && actorOf(request).handle === "worker") },
    { label: "global coordinator", request: requests.find((request) => request.runId === global) },
  ];
  const violations = cases.flatMap(({ label, request }) => {
    assert.ok(request, `${label} took a turn`);
    const outside = mentioned(request.systemPrompt).filter((name) => !request.functionNames.includes(name));
    return outside.length > 0 ? [`${label}: ${outside.join(", ")}`] : [];
  });
  assert.deepEqual(violations, [], "every function a system prompt names belongs to its reader");
  const worker = cases[1]!.request!;
  assert.deepEqual(worker.functionNames.filter((name) => !name.startsWith("typescript_")).sort(), [...workerTools].sort());
  assert.match(worker.systemPrompt, /## Actor programs/);
  assert.match(worker.systemPrompt, /Reader-specific rules/);
  assert.doesNotMatch(worker.systemPrompt, /event_query/);
  assert.match(cases[0]!.request!.systemPrompt, /Use event_query for history/);
  const coordinator = cases[2]!.request!;
  assert.ok(coordinator.functionNames.includes("actor_program_controls"), "the global coordinator reads the authoring guide");
  assert.equal(coordinator.functionNames.includes("actor_program_activate"), false, "it activates through global_app_create");
  assert.match(coordinator.systemPrompt, /You activate a package only through global_app_create/);
  assert.match(coordinator.systemPrompt, /see actor_program_controls with topic guide/);
  assert.match(coordinator.systemPrompt, /an app that always shows the latest run[^\n]*run_list\(\{ limit: 1 \}\)[^\n]*capabilities: \["run_list"\]/);
});

test("the guard includes capability declarations and exact function references", () => {
  assert.deepEqual(mentioned('input: { capabilities: ["program_file_read", "run_list"] }').sort(), ["program_file_read", "run_list"]);
  assert.deepEqual(mentioned('context.functions.read({}); `bash`; "copy"; write({}); bread; run_list_extra').sort(), ["bash", "copy", "read", "write"]);
});

test("available requires the reader's functions or an explicit catalog", async () => {
  const file = path.join(directory, "available.hbs");
  writeFileSync(file, '{{#if (available "read" "bash")}}both{{else}}not both{{/if}}');
  const prompt = handlebarsPrompt("test.available", 0, file);
  assert.equal(await prompt.render({ functions: ["read", "bash"] }), "both");
  assert.equal(await prompt.render({ functions: ["read"] }), "not both");
  assert.equal(await prompt.render({ functions: [] }), "not both");
  assert.equal(await prompt.render({ functions: "all" }), "both");
  await assert.rejects(prompt.render({}), /requires the reader's functions/);
  const misuse = path.join(directory, "misuse.hbs");
  writeFileSync(misuse, "{{#if (available)}}x{{/if}}");
  await assert.rejects(handlebarsPrompt("test.misuse", 0, misuse).render({}), /takes one or more function names/);
});

test("every function a prompt template asks for with available is registered in the core profile", () => {
  const asked = pluginIds.flatMap((pluginId) => templatesOf(path.join(pluginsRoot, pluginId))).flatMap((file) =>
    [...readFileSync(file, "utf8").matchAll(/\(available((?:\s+"[^"]+")+)\)/g)].flatMap((match) =>
      [...match[1]!.matchAll(/"([^"]+)"/g)].map((name) => ({ file: path.relative(pluginsRoot, file), name: name[1]! }))));
  assert.ok(asked.length > 10, "the templates ask for functions");
  assert.deepEqual(asked.filter(({ name }) => !registered.includes(name)), []);
});
