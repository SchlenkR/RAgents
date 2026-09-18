import assert from "node:assert/strict";
import { cp, mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import test from "node:test";
import { prepareAppProject, typecheckServerProject } from "../../plugins/ragents.actor-programs/server/app-project.ts";

const repoRoot = fileURLToPath(new URL("../../", import.meta.url));
const scriptsRoot = path.join(repoRoot, "plugins/ragents.reference/run-scripts");
const declarations = () => readFile(path.join(repoRoot, "docs/homepage/run-api.d.ts"), "utf8");
const entries = (await readdir(scriptsRoot, { withFileTypes: true })).filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort();

assert.ok(entries.length > 0, "Es müssen veröffentlichte Run-Script-Beispiele vorhanden sein.");

async function preparePublishedSdk(directory: string) {
  await prepareAppProject(directory);
  await writeFile(path.join(directory, "node_modules/@ragents/server/index.d.ts"), await declarations());
}

for (const entry of entries) {
  test(`published server API compiles and tests the complete ${entry} package`, async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "homepage-run-api-"));
    try {
      await cp(path.join(scriptsRoot, entry), directory, { recursive: true });
      await preparePublishedSdk(directory);
      assert.deepEqual(typecheckServerProject(directory), []);
      await promisify(execFile)(process.execPath, ["--import", "tsx", "--test", "tests/program.test.ts"], { cwd: directory });
    } finally { await rm(directory, { recursive: true, force: true }); }
  });
}

async function probe(body: string): Promise<string[]> {
  const directory = await mkdtemp(path.join(tmpdir(), "homepage-run-probe-"));
  try {
    await mkdir(path.join(directory, "src"));
    await writeFile(path.join(directory, "package.json"), JSON.stringify({ name: "probe", private: true, type: "module", ragents: { title: "Probe", backend: "src/server.ts" } }));
    await writeFile(path.join(directory, "src/server.ts"), `import { defineActor } from "@ragents/server";
import { Type } from "typebox";
export default defineActor({state: Type.Object({}), functions: {}, input: {capabilities: ["actor_input", "model_list"]}}, {
  functions: {}, onInput: async (input, context) => { ${body} }
});`);
    await preparePublishedSdk(directory);
    return typecheckServerProject(directory);
  } finally { await rm(directory, { recursive: true, force: true }); }
}

test("published server API accepts a correctly typed capability call", async () => {
  assert.deepEqual(await probe('await context.functions.actor_input({ actor: "@coordinator", content: input.content });'), []);
});

for (const example of [
  { name: "unknown capability", source: 'await context.functions.not_a_real_capability({});', message: /not_a_real_capability/ },
  { name: "wrong parameter type", source: 'await context.functions.actor_input({ actor: "@coordinator", content: 42 });', message: /number.*string|string.*number/s },
  { name: "wrong result type", source: 'const result = await context.functions.model_list({}); const profiles: number = result.profiles;', message: /number/ },
]) {
  test(`published server API rejects ${example.name} instead of accepting any`, async () => {
    const diagnostics = await probe(example.source);
    assert.ok(diagnostics.some((diagnostic) => diagnostic.startsWith("src/server.ts:")
      && /TS(?:2322|2339|2345|2769):/.test(diagnostic)
      && example.message.test(diagnostic)), JSON.stringify(diagnostics, null, 2));
  });
}

test("published setup guide contains every complete RUN, setup, test and actor source", async () => {
  const guide = await readFile(path.join(repoRoot, "docs/homepage/run-setup.md"), "utf8");
  const published = new Map<string, string>();
  let packageName: string | undefined;
  let fileName: string | undefined;
  let fence: string | undefined;
  let content: string[] = [];
  for (const line of guide.split("\n")) {
    if (fence) {
      if (line === fence) {
        if (packageName && fileName) {
          const key = `${packageName}/${fileName}`;
          assert.equal(published.has(key), false, `Doppelte veröffentlichte Quelle: ${key}`);
          published.set(key, `${content.join("\n")}\n`);
        }
        fence = undefined;
        fileName = undefined;
      } else content.push(line);
      continue;
    }
    const opening = /^(`{3,})[^`]*$/.exec(line);
    if (opening) { fence = opening[1]!; content = []; continue; }
    const packageHeading = /^### ragents\.reference\.(.+)$/.exec(line);
    if (packageHeading) { packageName = packageHeading[1]!; continue; }
    const fileHeading = /^#### (.+)$/.exec(line);
    if (fileHeading) fileName = fileHeading[1]!;
    else if (line.startsWith("## ")) { packageName = undefined; fileName = undefined; }
  }
  assert.equal(fence, undefined, "Die veröffentlichte Anleitung enthält einen offenen Codeblock.");
  const expected = new Map<string, string>();
  const visit = async (relative: string): Promise<void> => {
    for (const entry of await readdir(path.join(scriptsRoot, relative), { withFileTypes: true })) {
      const name = path.posix.join(relative, entry.name);
      if (entry.isDirectory()) await visit(name);
      else if (entry.isFile()) {
        const source = await readFile(path.join(scriptsRoot, name), "utf8");
        expected.set(name, source.endsWith("\n") ? source : `${source}\n`);
      }
    }
  };
  for (const entry of entries) await visit(entry);
  assert.deepEqual([...published.keys()].sort(), [...expected.keys()].sort());
  for (const [name, source] of expected) assert.equal(published.get(name), source, `Unvollständige oder veraltete Paketquelle: ${name}`);
});
