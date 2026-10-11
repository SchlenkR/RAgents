import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test, { after } from "node:test";
import type { RunCapabilityDescriptor, RunFunction } from "@ragents/engine";
import { pluginsRoot } from "../src/plugin-support/plugins-root.ts";
import { compileAppBackend, installServerSdk, prepareAppProject, typecheckServerProject } from "../src/plugin-support/actor-programs/app-project.ts";
import { programPermissionFunctions } from "../../../plugins/ragents.actor-programs/server/permissions.ts";
import { createControlsToolContributor } from "../../../plugins/ragents.actor-programs/server/controls-tool.ts";
import { actorProgramGuide, stateAwareProgramGuide } from "../../../plugins/ragents.actor-programs/server/prompts.ts";
import { nativeExecutorFixture } from "./native-executor-fixture.ts";

const directory = mkdtempSync(path.join(tmpdir(), "ragents-program-prompt-"));
const native = nativeExecutorFixture();
after(async () => {
  await native.close();
  rmSync(directory, { recursive: true, force: true });
});
const fenced = (source: string, language: string): string => {
  const match = source.match(new RegExp("```" + language + "\\n([\\s\\S]*?)\\n```"));
  assert.ok(match, `${language} source is present`);
  return match[1]!;
};
const helpers = (programPermissionFunctions({ permissionsOf: () => undefined, ownerAccess: () => { throw new Error("unused"); } }).tools({} as never) as RunFunction[])
  .map((fn): RunCapabilityDescriptor => ({ id: fn.name, label: fn.label, description: fn.description, schema: fn.schema, resultSchema: fn.resultSchema }));

test("the state-aware guide explains the principle, its guards, and one complete example that activates", async () => {
  const [tool] = await createControlsToolContributor().tools({} as never);
  const section = await stateAwareProgramGuide.render({});
  const scope = { availableFunctions: () => [{ name: "actor_program_controls" }, { name: "actor_program_status" }] };
  assert.deepEqual(await tool!.run(scope as never, "reference", { topic: "state-aware" } as never), { guide: section });
  assert.ok(section.length < 6_000, "the topic stays a short read");
  assert.match(await actorProgramGuide.render({}), /`defineProgram`: read `topic: "state-aware"`/);
  for (const expected of [
    "`defineProgram`", "`defineActor` stays for functions", "evaluates the program body completely on every wake", "slot at its position",
    "ends in the same wait changes nothing", "ctx.useState(initial, name?)", "ctx.useStateWith(create, name?)", "await ctx.step(",
    "await ctx.waitUntil(", "await ctx.receive(name, { timeoutMs? })", "await ctx.watch(path)", "ctx.elsePreserve | ctx.elseForget", "await ctx.forEach(",
    "RAG1001", "RAG1002", "RAG1003", "RAG1004", "RAG1005", "cannot be continued", "createProgramTest",
  ]) assert.ok(section.includes(expected), `the guide names ${expected}`);
  const example = fenced(section, "ts");
  for (const expected of ['ctx.waitUntil({ daily: "08:00"', "ctx.step(", 'ctx.receive("approval", { timeoutMs: 24 * 60 * 60 * 1000 })', 'ctx.useState(0, "approvals")', "ctx.when(", "ctx.elseForget", "ctx.forEach([today]"])
    assert.ok(example.includes(expected), `the example uses ${expected}`);
  const project = path.join(directory, "guide-example");
  mkdirSync(path.join(project, "src"), { recursive: true });
  writeFileSync(path.join(project, "package.json"), fenced(section, "json"));
  writeFileSync(path.join(project, "src/server.ts"), example);
  await prepareAppProject(project);
  await installServerSdk(project, helpers);
  assert.deepEqual(typecheckServerProject(project, "src/server.ts"), [], "the example passes type check and program guards");
  const backend = await compileAppBackend({ directory: project, backend: "src/server.ts", runId: "guide-example", executor: native.executor });
  assert.equal(backend.contract.program, true);
  assert.deepEqual(backend.contract.input, { capabilities: ["program_file_read", "program_file_write"] });
  assert.equal(backend.contract.functions.approval?.message, true);
  assert.equal(backend.contract.functions.approval?.tool?.name, "approve_draft");
});

test("the summary points to defineProgram and the global apps prompt builds the same example as a global app", () => {
  const summary = readFileSync(path.join(pluginsRoot, "ragents.actor-programs/summary.hbs"), "utf8");
  assert.match(summary, /`topic: "state-aware"` for a `defineProgram` that waits/);
  const global = readFileSync(path.join(pluginsRoot, "ragents.global-apps/prompt.hbs"), "utf8");
  const server = fenced(global, "ts");
  assert.match(server, /defineProgram\(/);
  assert.match(server, /ctx\.waitUntil\(\{ daily: "08:00" \}\)/);
  assert.match(server, /ctx\.receive\("approval", \{ timeoutMs: 24 \* 60 \* 60 \* 1000 \}\)/);
  assert.match(server, /approvals\.set\(approvals\.value \+ 1\)/);
  assert.match(server, /ctx\.elseForget/);
  assert.match(fenced(global, "tsx"), /context\.capabilities\.call\("approval", \{ approved \}\)/);
});
