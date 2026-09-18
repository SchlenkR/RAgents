import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test, { after } from "node:test";
import { agentTools, compileTypeScriptSnippet, Journal, Orchestration, TypeScriptSnippetCompilationError, type PluginContext, type PluginHost, type RunCapabilityDescriptor, type RunFunction } from "@aicontainer/ragents";
import { testServices } from "../../../packages/ragents/tests/support.ts";
import { pluginsRoot } from "../src/plugin-support/plugins-root.ts";
import { nativeExecutorFixture } from "./native-executor-fixture.ts";
import { compositionEnvironment, coreFixture, type CompositionFixture } from "./fixtures/profile-composition/profiles.ts";

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
  if (fence) throw new Error(`${file}:${fence.line}: nicht geschlossener TypeScript-Zaun.`);
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
    { product: profile.product, pluginIds: profile.plugins, modules: loaded.modules },
    {
      ensureSession: () => {},
      runtime: () => runtime,
      sessionWorkspaceFor: () => Promise.resolve({
        cwd: workspaceDirectory,
        currentRoot: () => Promise.resolve(workspaceDirectory),
        ensureWritable: () => Promise.resolve(workspaceDirectory),
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
    "Beispiel: const s = await context.functions.status({}); if (!s.ok) throw new Error('nein'); return await context.functions.read({path:s.path}); Danach weiter.",
    "```typescript",
    "return await context.functions.status({ name: \"{{name}}\" });",
    "```",
    "```ts",
    "export interface Unrelated { name: string }",
    "```",
    "Kurz: await context.functions.status({}); und fertig.",
  ].join("\n");
  const snippets = promptSnippetsOf("fixture.md", source);
  assert.deepEqual(snippets, [
    { file: "fixture.md", line: 2, kind: "inline", code: "const s = await context.functions.status({});\nif (!s.ok) throw new Error('nein');\nreturn await context.functions.read({path:s.path});" },
    { file: "fixture.md", line: 3, kind: "fence", code: "return await context.functions.status({ name: \"x\" });" },
    { file: "fixture.md", line: 9, kind: "inline", code: "await context.functions.status({});" },
  ]);
  assert.throws(() => promptSnippetsOf("broken.md", "```ts\nreturn 1;\n"), /nicht geschlossener/);
});

test("every TypeScript example in plugin prompts, skills and run-script prompts compiles against the run context of its profile", async () => {
  const covered = new Set<string>(coreFixture.plugins);
  const failures: string[] = [];
  const capabilities = await capabilitiesOf(coreFixture);
  assert.ok(capabilities.length > 20, `Nur ${capabilities.length} Funktionen im Profil ${coreFixture.product.id}`);
  const files = coreFixture.plugins.flatMap((pluginId) => promptFilesOf(path.join(pluginsRoot, pluginId)));
  assert.ok(files.length >= 20, `Nur ${files.length} Promptdateien gefunden; die Suche greift nicht mehr`);
  for (const file of files) {
    for (const snippet of promptSnippetsOf(path.relative(pluginsRoot, file), readFileSync(file, "utf8"))) {
      try { await compileTypeScriptSnippet({ code: snippet.code, capabilities }); }
      catch (error) {
        const message = error instanceof TypeScriptSnippetCompilationError ? error.message : `Unerwarteter Fehler: ${error instanceof Error ? error.message : String(error)}`;
        failures.push(`${snippet.file}:${snippet.line} (${coreFixture.product.id}, ${snippet.kind})\n${snippet.code}\n${message}`);
      }
    }
  }
  const uncovered = readdirSync(pluginsRoot, { withFileTypes: true }).filter((entry) => entry.isDirectory()).map((entry) => entry.name)
    .filter((pluginId) => !covered.has(pluginId) && promptFilesOf(path.join(pluginsRoot, pluginId)).some((file) => promptSnippetsOf(file, readFileSync(file, "utf8")).length > 0));
  assert.deepEqual(uncovered, [], "Plugins mit TypeScript-Beispielen gehören in die Profil-Fixture");
  assert.deepEqual(failures, [], `TypeScript-Beispiele in Prompts passen nicht zum Vertrag:\n\n${failures.join("\n\n")}`);
});
