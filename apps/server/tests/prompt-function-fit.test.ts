import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
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
for (const [key, value] of Object.entries({ ...compositionEnvironment, DATA_DIR: directory, PROCESS_SANDBOX: "off", MCP_SERVERS: "{}", ACP_AGENTS: "{}",
  MODEL_ALIASES: JSON.stringify(coreConfig.host.MODEL_ALIASES) })) {
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

/** A capability list declares what a program may call, not a function offered to the reader. */
const withoutDeclarations = (text: string): string => text.replace(/capabilities:\s*\[[^\]]*\]/g, "");

/** Names with an underscore count wherever they stand; a plain word such as read only in code form. */
const mentioned = (prompt: string): string[] => {
  const text = withoutDeclarations(prompt);
  return registered.filter((name) => name.includes("_")
    ? new RegExp(`(?<![A-Za-z0-9_])${name}(?![A-Za-z0-9_])`).test(text)
    : new RegExp(`\`${name}\`|functions\\.${name}(?![A-Za-z0-9_])|(?<![A-Za-z0-9_.])${name}\\(`).test(text));
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
});

test("available holds when the reader has every named function, and without a known set for all", async () => {
  const file = path.join(directory, "available.hbs");
  writeFileSync(file, '{{#if (available "read" "bash")}}both{{else}}not both{{/if}}');
  const prompt = handlebarsPrompt("test.available", 0, file);
  assert.equal(await prompt.render({ functions: ["read", "bash"] }), "both");
  assert.equal(await prompt.render({ functions: ["read"] }), "not both");
  assert.equal(await prompt.render({}), "both");
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
