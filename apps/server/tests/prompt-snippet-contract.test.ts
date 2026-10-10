import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test, { after } from "node:test";
import { agentTools, compileTypeScriptSnippet, Journal, Orchestration, TypeScriptSnippetCompilationError, type PluginContext, type PluginHost, type RunCapabilityDescriptor, type RunFunction } from "@ragents/engine";
import { testServices } from "../../../packages/ragents/tests/support.ts";
import { pluginsRoot } from "../src/plugin-support/plugins-root.ts";
import { nativeExecutorFixture } from "./native-executor-fixture.ts";
import { compileAppBackend, installServerSdk, prepareAppProject, typecheckServerProject } from "../src/plugin-support/actor-programs/app-project.ts";
import { compileClientProject, installClientSdk } from "../src/plugin-support/actor-programs/client-compiler.ts";
import { compositionEnvironment, showcaseFixture, type CompositionFixture } from "./fixtures/profile-composition/profiles.ts";

const temporaryDirectory = mkdtempSync(path.join(tmpdir(), "ragents-prompt-snippets-"));
const workspaceDirectory = path.join(temporaryDirectory, "workspace");
mkdirSync(workspaceDirectory);
const environment = { ...compositionEnvironment, DATA_DIR: path.join(temporaryDirectory, "data") };
const previousEnvironment = new Map(Object.keys(environment).map((key) => [key, process.env[key]]));
for (const [key, value] of Object.entries(environment)) {
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
}
const hosts: PluginHost[] = [];
const native = nativeExecutorFixture();
const services = { ...testServices(), nativeTypeScriptExecutor: native.executor };
const journal = new Journal(":memory:", services);
const runtime = new Orchestration(journal, services);
after(async () => {
  try { await Promise.all(hosts.map((host) => host.lifecycle.shutdown())); }
  finally {
    for (const [key, value] of previousEnvironment) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    journal.close();
    await native.close();
    rmSync(temporaryDirectory, { recursive: true, force: true });
  }
});

const { loadPlugins } = await import("../src/profile/plugin-discovery.ts");
const { composeProfile } = await import("../src/profile/compose.ts");

export interface PromptSnippet { file: string; line: number; code: string; kind: "fence" | "inline" }

const statementStart = /^(const|let|return|await|if|for|while|throw|try|context\.)\b/;
const inlineStart = /(?:(?:const|let)\s+\w+\s*=\s*|return\s+)?await context\.functions\.\w+\(/g;

const statementEnd = (text: string, from: number): number => {
  let depth = 0;
  let quote: string | undefined;
  for (let index = from; index < text.length; index += 1) {
    const char = text[index]!;
    if (quote) {
      if (char === "\\") index += 1;
      else if (char === quote) quote = undefined;
      continue;
    }
    if (char === "'" || char === "\"" || char === "`") quote = char;
    else if ("([{".includes(char)) depth += 1;
    else if (")]}".includes(char)) depth -= 1;
    else if (char === ";" && depth <= 0) return index + 1;
    else if (char === "\n" && depth <= 0) return -1;
  }
  return -1;
};

export const neutralizeHandlebars = (text: string): string => text
  .replace(/\{\{[#/^][^}]*\}\}/g, "")
  .replace(/\{\{else\}\}/g, "")
  .replace(/\{\{[^}]*\}\}/g, "x");

export const promptSnippetsOf = (file: string, source: string): PromptSnippet[] => {
  const text = neutralizeHandlebars(source);
  const lines = text.split("\n");
  const snippets: PromptSnippet[] = [];
  let fence: { line: number; code: string[] } | undefined;
  lines.forEach((raw, index) => {
    if (fence) {
      if (raw.trimEnd() === "```") {
        const code = fence.code.join("\n");
        if (code.includes("context.")) snippets.push({ file, line: fence.line, code, kind: "fence" });
        fence = undefined;
      } else fence.code.push(raw);
      return;
    }
    if (/^```(ts|typescript)\s*$/.test(raw.trim())) { fence = { line: index + 1, code: [] }; return; }
    inlineStart.lastIndex = 0;
    for (let match = inlineStart.exec(raw); match; match = inlineStart.exec(raw)) {
      const statements: string[] = [];
      let cursor = match.index;
      for (;;) {
        const end = statementEnd(raw, cursor);
        if (end < 0) break;
        statements.push(raw.slice(cursor, end));
        cursor = end;
        const rest = raw.slice(cursor).replace(/^\s+/, "");
        if (!statementStart.test(rest)) break;
        cursor = raw.length - rest.length;
      }
      if (statements.length === 0) break;
      snippets.push({ file, line: index + 1, code: statements.join("\n"), kind: "inline" });
      inlineStart.lastIndex = cursor;
    }
  });
  if (fence) throw new Error(`${file}:${fence.line}: unclosed TypeScript fence.`);
  return snippets;
};

const collect = (directory: string, into: string[], match: (name: string) => boolean): void => {
  if (!statSync(directory, { throwIfNoEntry: false })?.isDirectory()) return;
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) collect(full, into, match);
    else if (match(entry.name)) into.push(full);
  }
};

export const promptFilesOf = (pluginDirectory: string): string[] => {
  const files: string[] = [];
  for (const entry of readdirSync(pluginDirectory)) if (entry.endsWith(".hbs")) files.push(path.join(pluginDirectory, entry));
  collect(path.join(pluginDirectory, "prompts"), files, (name) => name.endsWith(".md") || name.endsWith(".hbs"));
  collect(path.join(pluginDirectory, "skills"), files, (name) => name.endsWith(".md"));
  const runScripts = path.join(pluginDirectory, "run-scripts");
  if (statSync(runScripts, { throwIfNoEntry: false })?.isDirectory()) {
    for (const script of readdirSync(runScripts)) {
      const runFile = path.join(runScripts, script, "RUN.md");
      if (statSync(runFile, { throwIfNoEntry: false })?.isFile()) files.push(runFile);
      collect(path.join(runScripts, script, "prompts"), files, (name) => name.endsWith(".md"));
    }
  }
  return files.sort();
};

const composed = async (profile: CompositionFixture): Promise<PluginHost> => {
  const loaded = await loadPlugins(profile.plugins);
  const host = composeProfile(
    { product: profile.product, pluginIds: profile.plugins, modules: loaded.modules, web: loaded.web, executor: loaded.executor },
    {
      ensureSession: () => {},
      ensureWorkspaceAccess: () => {},
      runtime: () => runtime,
      sessionWorkspaceFor: () => Promise.resolve({
        cwd: workspaceDirectory,
        currentRoot: () => Promise.resolve(workspaceDirectory),
        runOperation: <T>(operation: () => Promise<T>) => operation(),
      }),
    },
  );
  hosts.push(host);
  return host;
};

const metaTools = new Set(["typescript_api", "typescript_eval"]);

const capabilitiesOf = async (profile: CompositionFixture): Promise<RunCapabilityDescriptor[]> => {
  const run = runtime.createRun({ commandId: `snippet-run-${profile.product.id}` }, { title: "Snippets", ownerHandle: "user", ownerDisplayName: "User" });
  const view = runtime.view(run.id);
  const actor = view.actors.find((candidate) => candidate.id === run.ownerId)!;
  const context: PluginContext = { runId: run.id, actorId: actor.id, turnId: null, actor, view, workspace: workspaceDirectory };
  const byName = new Map<string, RunFunction>();
  for (const fn of agentTools) byName.set(fn.name, fn);
  const host = await composed(profile);
  for (const contributor of host.tools.entries()) {
    for (const fn of await contributor.tools(context)) byName.set(fn.name, fn);
  }
  return [...byName.values()].filter((fn) => !metaTools.has(fn.name)).sort((left, right) => left.name.localeCompare(right.name))
    .map((fn) => ({ id: fn.name, label: fn.label, description: fn.description, schema: fn.schema, resultSchema: fn.resultSchema }));
};

test("the extractor finds fenced and inline context.functions examples and neutralizes handlebars", () => {
  const source = [
    "{{#if linked}}Intro {{name}}{{/if}}",
    "Example: const s = await context.functions.status({}); if (!s.ok) throw new Error('no'); return await context.functions.read({file_path:s.path}); Then continue.",
    "```typescript",
    "return await context.functions.status({ name: \"{{name}}\" });",
    "```",
    "```ts",
    "export interface Unrelated { name: string }",
    "```",
    "Briefly: await context.functions.status({}); and done.",
  ].join("\n");
  const snippets = promptSnippetsOf("fixture.md", source);
  assert.deepEqual(snippets, [
    { file: "fixture.md", line: 2, kind: "inline", code: "const s = await context.functions.status({});\nif (!s.ok) throw new Error('no');\nreturn await context.functions.read({file_path:s.path});" },
    { file: "fixture.md", line: 3, kind: "fence", code: "return await context.functions.status({ name: \"x\" });" },
    { file: "fixture.md", line: 9, kind: "inline", code: "await context.functions.status({});" },
  ]);
  assert.throws(() => promptSnippetsOf("broken.md", "```ts\nreturn 1;\n"), /unclosed/);
});

test("every TypeScript example in plugin prompts, skills and run-script prompts compiles against the run context of its profile", async () => {
  const covered = new Set<string>(showcaseFixture.plugins);
  const failures: string[] = [];
  const capabilities = await capabilitiesOf(showcaseFixture);
  assert.ok(capabilities.length > 20, `Only ${capabilities.length} functions in profile ${showcaseFixture.product.id}`);
  const files = showcaseFixture.plugins.flatMap((pluginId) => promptFilesOf(path.join(pluginsRoot, pluginId)));
  assert.ok(files.length >= 20, `Only ${files.length} prompt files found; the search no longer works`);
  for (const file of files) {
    for (const snippet of promptSnippetsOf(path.relative(pluginsRoot, file), readFileSync(file, "utf8"))) {
      try {
        if (/^export default /m.test(snippet.code)) {
          const directory = mkdtempSync(path.join(temporaryDirectory, "actor-example-"));
          mkdirSync(path.join(directory, "src"));
          writeFileSync(path.join(directory, "package.json"), JSON.stringify({ name: "prompt-example", private: true, type: "module", ragents: { title: "Prompt example", backend: "src/server.ts" } }));
          writeFileSync(path.join(directory, "src/server.ts"), snippet.code);
          await prepareAppProject(directory);
          await installServerSdk(directory, capabilities);
          assert.deepEqual(typecheckServerProject(directory, "src/server.ts"), []);
          await compileAppBackend({ directory, backend: "src/server.ts", runId: "prompt-example", executor: native.executor });
        } else await compileTypeScriptSnippet({ code: snippet.code, capabilities });
      }
      catch (error) {
        const message = error instanceof TypeScriptSnippetCompilationError ? error.message : `Unexpected error: ${error instanceof Error ? error.message : String(error)}`;
        failures.push(`${snippet.file}:${snippet.line} (${showcaseFixture.product.id}, ${snippet.kind})\n${snippet.code}\n${message}`);
      }
    }
  }
  const uncovered = readdirSync(pluginsRoot, { withFileTypes: true }).filter((entry) => entry.isDirectory()).map((entry) => entry.name)
    .filter((pluginId) => !covered.has(pluginId) && promptFilesOf(path.join(pluginsRoot, pluginId)).some((file) => promptSnippetsOf(file, readFileSync(file, "utf8")).length > 0));
  assert.deepEqual(uncovered, [], "plugins with TypeScript examples belong in the profile fixture");
  assert.deepEqual(failures, [], `TypeScript examples in prompts do not match the contract:\n\n${failures.join("\n\n")}`);
});

test("the complete global mini-app prompt builds its backend and React view together", async () => {
  const source = readFileSync(path.join(pluginsRoot, "ragents.global-apps/prompt.hbs"), "utf8");
  const code = (language: string) => {
    const match = source.match(new RegExp("```" + language + "\\n([\\s\\S]*?)\\n```"));
    assert.ok(match, `${language} source is present`);
    return match[1]!;
  };
  const directory = mkdtempSync(path.join(temporaryDirectory, "global-app-example-"));
  mkdirSync(path.join(directory, "src"));
  writeFileSync(path.join(directory, "package.json"), code("json"));
  writeFileSync(path.join(directory, "src/server.ts"), code("ts"));
  writeFileSync(path.join(directory, "src/client.tsx"), code("tsx"));
  await prepareAppProject(directory);
  await installServerSdk(directory, await capabilitiesOf(showcaseFixture));
  assert.deepEqual(typecheckServerProject(directory, "src/server.ts"), []);
  const backend = await compileAppBackend({ directory, backend: "src/server.ts", runId: "global-app-example", executor: native.executor });
  const contracts = { stateSchema: backend.contract.state, actions: [] };
  await installClientSdk(directory, contracts);
  const client = await compileClientProject({ directory, entryPoint: "src/client.tsx", ...contracts });
  assert.equal(client.valid, true, JSON.stringify(client.diagnostics));
});
