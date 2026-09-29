import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, mkdir, writeFile, readFile, rm, symlink } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import path from "node:path";
import { build } from "esbuild";
import { defineWorkflow, workflowGraph, workflowInstructions, type WorkflowDefinition } from "../../../apps/server/src/plugin-support/actor-programs/workflow/index.ts";
import { createPromptReader } from "../../../apps/server/src/plugin-support/actor-programs/workflow/prompt-reader.ts";
import { prepareAppProject, typecheckServerProject } from "../../../apps/server/src/plugin-support/actor-programs/app-project.ts";
import { installClientSdk, compileClientProject } from "../../../apps/server/src/plugin-support/actor-programs/client-compiler.ts";

const definition = (): WorkflowDefinition => ({
  id: "delivery", title: "Delivery", roles: { worker: { title: "Implementer", prompt: "prompts/worker.md" }, reviewer: { title: "Reviewer", prompt: "prompts/reviewer.hbs" } },
  steps: [
    { id: "implement", title: "Implement", role: "worker", goal: "Meet acceptance criteria", prompt: "prompts/implement.md", completion: { source: "agent", description: "Changes reported" }, freedom: { mode: "extend", description: "Plan own work steps", maxItems: 3, allowSkip: true } },
    { id: "review", title: "Review", role: "reviewer", goal: "Check every rule", prompt: "prompts/review.md", completion: { source: "service", description: "All rules passed" }, freedom: { mode: "fixed", description: "Rule catalog complete" }, expansion: { source: "rules", role: "reviewer", mode: "parallel", maxConcurrent: 3 } },
    { id: "accept", title: "Accept", role: "worker", goal: "Enable acceptance", completion: { source: "operator", description: "Operator confirmed" }, freedom: { mode: "fixed", description: "Wait for acceptance" } },
  ],
  transitions: [{ from: "implement", to: "review" }, { from: "review", to: "accept", condition: "All rules passed" }, { from: "review", to: "implement", condition: "Correction required", kind: "return" }],
});

test("workflow validates roles, references, limits and forward DAG while retaining returns", () => {
  const valid = definition(); assert.equal(defineWorkflow(valid), valid);
  const invalid: Array<(def: any) => void> = [
    def => def.steps.push(def.steps[0]), def => def.steps[0].role = "missing", def => def.steps[0].prompt = "../outside.md",
    def => def.roles.worker.prompt = "/absolute.md", def => def.roles.worker.prompt = "https://example.org/prompt.md",
    def => def.roles.worker.prompt = "prompts/file.txt", def => def.steps[0].freedom.maxItems = 0,
    def => def.steps[1].expansion.maxConcurrent = 1.5, def => def.steps[1].expansion.role = "missing",
    def => def.transitions.push({ from: "accept", to: "implement" }), def => def.transitions.push({ from: "missing", to: "review" }),
    def => def.transitions[0].kind = "other", def => def.transitions[0].from = "review", def => def.steps[0].completion.source = "model",
  ];
  for (const change of invalid) { const def = definition(); change(def); assert.throws(() => defineWorkflow(def)); }
});

test("role instructions combine owned prompts with goals, completion and bounded freedom", async () => {
  const loaded: string[] = [];
  const result = await workflowInstructions(definition(), "worker", async reference => { loaded.push(reference); return `Content ${reference}`; });
  assert.deepEqual(loaded, ["prompts/worker.md", "prompts/implement.md"]);
  for (const value of ["Meet acceptance criteria", "Changes reported", "Plan own work steps", "At most 3", "required steps remain mandatory", "Wait for acceptance", "All rules passed", "Correction required", "return path"]) assert.ok(result.includes(value), value);
  assert.doesNotMatch(result, /Content prompts\/review/);
  await assert.rejects(workflowInstructions(definition(), "missing", async () => "text"), /Unknown role/);
  await assert.rejects(workflowInstructions(definition(), "worker", async () => "  "), /Prompt/);
  await assert.rejects(workflowInstructions(definition(), "worker", async () => { throw new Error("missing file"); }), /missing file/);
});

test("graph expands live groups between owning step and next target and keeps returns on owning step", () => {
  const def = definition();
  const group = { id: "types", title: "Types", status: "active" as const, items: [{ label: "Null values", status: "pending" as const }] };
  const graph = workflowGraph(def, { steps: { implement: { status: "done", detail: "", items: [{ label: "Check desktop", status: "skipped", detail: "" }] } }, expansions: { rules: [group] } });
  const node = graph.nodes.find(node => node.label === "Types")!;
  assert.equal(node.status, "active"); assert.deepEqual(node.items, group.items);
  assert.equal(graph.nodes.find(node => node.id === "review")!.status, "pending");
  assert.ok(graph.edges.some(edge => edge.source === "review" && edge.target === node.id));
  assert.ok(graph.edges.some(edge => edge.source === node.id && edge.target === "accept"));
  assert.ok(graph.edges.some(edge => edge.source === "review" && edge.target === "implement" && edge.kind === "return"));
  assert.ok(!graph.edges.some(edge => edge.source === "review" && edge.target === "accept"));
  const expanded = workflowGraph(def, { steps: {}, expansions: { rules: [group, { ...group, id: "async", title: "Async" }] } });
  assert.equal(expanded.nodes.length, 5);
  const empty = workflowGraph(def, { steps: {}, expansions: { rules: [] } });
  assert.ok(empty.edges.some(edge => edge.source === "review" && edge.target === "accept"));
});

test("graph rejects unknown state, missing expansion sources and duplicated groups", () => {
  for (const state of [
    { steps: { wrong: { status: "pending" } }, expansions: { rules: [] } }, { steps: {} },
    { steps: {}, expansions: { rules: [], wrong: [] } }, { steps: { review: { status: "skipped" } }, expansions: { rules: [] } },
    { steps: {}, expansions: { rules: [{ id: "same", title: "A", items: [] }, { id: "same", title: "B", items: [] }] } },
  ]) assert.throws(() => workflowGraph(definition(), state as any));
});

test("prompt reader rejects missing, empty, traversal and escaping symlinks", async context => {
  const directory = await mkdtemp("/private/tmp/ragents-workflow-prompts-");
  context.after(() => rm(directory, { recursive: true, force: true }));
  const root = path.join(directory, "actor"); await mkdir(root);
  await writeFile(path.join(root, "good.md"), "Binding prompt"); await writeFile(path.join(root, "empty.hbs"), " \n");
  await writeFile(path.join(directory, "outside.md"), "outside"); await symlink(path.join(directory, "outside.md"), path.join(root, "escape.md"));
  const read = createPromptReader(root); assert.equal(await read("good.md"), "Binding prompt");
  for (const reference of ["missing.md", "empty.hbs", "../outside.md", "escape.md", "/absolute.md", "good.txt"]) await assert.rejects(read(reference));
});

test("installed canonical SDK compiles server and browser consumers and binds prompt files to actor root", async context => {
  const directory = await mkdtemp("/private/tmp/ragents-workflow-sdk-");
  context.after(() => rm(directory, { recursive: true, force: true }));
  await mkdir(path.join(directory, "src")); await mkdir(path.join(directory, "prompts"));
  await writeFile(path.join(directory, "package.json"), JSON.stringify({ type: "module", ragents: { title: "Test", backend: "src/server.ts", views: [{ id: "main", client: "src/client.tsx" }] } }));
  const source = `import { defineWorkflow, workflowGraph, workflowInstructions, type WorkflowState } from "@ragents/workflow";\nexport const definition = defineWorkflow(${JSON.stringify(definition())});\nexport const state: WorkflowState = {steps:{},expansions:{rules:[]}};\nexport const graph = workflowGraph(definition,state);\n`;
  await writeFile(path.join(directory, "src/server.ts"), source + 'import {readPrompt} from "@ragents/workflow/prompts"; export const instructions = () => workflowInstructions(definition,"worker",readPrompt);');
  await writeFile(path.join(directory, "src/client.tsx"), source + 'export const render = () => graph.nodes.map(node => node.label).join(", ");');
  await writeFile(path.join(directory, "prompts/worker.md"), "Role prompt"); await writeFile(path.join(directory, "prompts/implement.md"), "Step prompt");
  await prepareAppProject(directory);
  const contracts = { stateSchema: { type: "object" }, actions: [] };
  await installClientSdk(directory, contracts);
  assert.deepEqual(typecheckServerProject(directory), []);
  const compiled = await compileClientProject({ directory, entryPoint: "src/client.tsx", ...contracts });
  assert.equal(compiled.valid, true, JSON.stringify(compiled.diagnostics)); assert.ok(compiled.javaScript.length > 0);
  const exported = await import(pathToFileURL(path.join(directory, "node_modules/@ragents/workflow/index.js")).href);
  assert.deepEqual(exported.workflowGraph(definition(), { steps: {}, expansions: { rules: [] } }), workflowGraph(definition(), { steps: {}, expansions: { rules: [] } }));
  const prompts = await import(pathToFileURL(path.join(directory, "node_modules/@ragents/workflow/prompts.js")).href);
  assert.equal(await prompts.readPrompt("prompts/worker.md"), "Role prompt"); await assert.rejects(prompts.readPrompt("prompts/missing.md"));
  const result = await build({ entryPoints: [path.join(directory, "src/server.ts")], bundle: true, packages: "external", write: false, platform: "node", format: "esm" });
  await writeFile(path.join(directory, "server.mjs"), result.outputFiles[0]!.text);
  const server = await import(pathToFileURL(path.join(directory, "server.mjs")).href);
  assert.match(await server.instructions(), /Role prompt/);
  assert.match(await readFile(path.join(directory, "node_modules/@ragents/workflow/index.d.ts"), "utf8"), /declare function defineWorkflow/);
  await writeFile(path.join(directory, "src/client.tsx"), source + 'workflowGraph(definition,{steps:{unknown:{status:"skipped"}}});');
  assert.equal((await compileClientProject({ directory, entryPoint: "src/client.tsx", ...contracts })).valid, false);
});
