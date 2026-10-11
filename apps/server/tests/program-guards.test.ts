import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test, { after } from "node:test";
import { Type } from "typebox";
import { installServerSdk, prepareAppProject, typecheckServerProject } from "../src/plugin-support/actor-programs/app-project.ts";
import { compileClientSource } from "./client-project-fixture.ts";

const root = await mkdtemp(path.join(tmpdir(), "ragents-program-guards-"));
after(() => rm(root, { recursive: true, force: true }));
let packages = 0;
const capabilities = [{ id: "notify", label: "Notify", description: "Notify.", schema: Type.Object({ text: Type.String() }), resultSchema: Type.Null() }];

/** The guard lines of a server program, without TypeScript errors, which the cases avoid. */
const guards = async (server: string, extra: Record<string, string> = {}): Promise<string[]> => {
  const directory = path.join(root, `package-${++packages}`);
  await mkdir(path.join(directory, "src"), { recursive: true });
  await writeFile(path.join(directory, "package.json"), JSON.stringify({ name: "guarded", private: true, type: "module", ragents: { title: "Guarded", backend: "src/server.ts" } }));
  await writeFile(path.join(directory, "src/server.ts"), server);
  for (const [file, content] of Object.entries(extra)) {
    await mkdir(path.dirname(path.join(directory, file)), { recursive: true });
    await writeFile(path.join(directory, file), content);
  }
  await prepareAppProject(directory);
  await installServerSdk(directory, capabilities);
  const lines = typecheckServerProject(directory, "src/server.ts");
  assert.deepEqual(lines.filter((line) => / TS\d+:/.test(line)), [], "the case compiles");
  return lines;
};
const program = (body: string, imports = "") => `import { defineProgram } from "@ragents/server";
import { Type } from "typebox";
${imports}
export default defineProgram({ capabilities: ["notify"], messages: { go: { label: "Go", input: Type.Object({ ok: Type.Boolean() }) } } }, async (ctx) => {
${body}
});
`;
const codes = (lines: readonly string[]) => lines.map((line) => line.replace(/^src\/server\.ts:(\d+):\d+ (RAG\d+):.*$/, "$1 $2"));

test("primitives at the top level of the body and in when and forEach callbacks pass", async () => {
  assert.deepEqual(await guards(program(`  const count = ctx.useState(0);
  const items = ctx.useStateWith(() => ["a", "b"]);
  if (await ctx.step(() => true)) ctx.log("condition only");
  await ctx.waitUntil({ afterMs: 1000 });
  const answer = await ctx.receive("go", { timeoutMs: 1000 });
  await ctx.when(answer.kind === "message", () => ctx.step(() => ctx.functions.notify({ text: "go" })), ctx.elseForget);
  await ctx.forEach(items.value, (item) => item, async (item) => {
    const seen = await ctx.step(() => new Date(item.length).toISOString());
    await ctx.when(seen.length > 0, async () => { count.set(count.value + 1); }, ctx.elsePreserve);
  });
  for (const value of await ctx.step(() => [1, 2])) ctx.log(value);
  return ctx.watch("/srv/inbox/report.txt");`)), []);
});

test("RAG1001 names every primitive outside the top level of a body or a when or forEach callback", async () => {
  const lines = await guards(program(`  const flag = ctx.useState(false);
  if (flag.value) await ctx.step(() => 1);
  else { await ctx.receive("go"); }
  const value = flag.value ? await ctx.step(() => 2) : 0;
  const other = flag.value && await ctx.step(() => 3);
  switch (value) { case 1: await ctx.waitUntil({ afterMs: 1 }); }
  for (let index = 0; index < 2; index += 1) await ctx.step(() => index);
  while (flag.value) { await ctx.step(() => 4); }
  try { await ctx.step(() => 5); } catch { ctx.log("failed"); }
  const helper = async () => ctx.step(() => 6);
  await ctx.step(async () => ctx.useState(7));
  await ctx.forEach([1], (item) => String(ctx.useState(item).value), async () => undefined);
  ctx.step(() => 8);
  await Promise.all([ctx.step(() => 9)]);
  ctx.log([other, helper]);`));
  assert.deepEqual(codes(lines), ["6 RAG1001", "7 RAG1001", "8 RAG1001", "9 RAG1001", "10 RAG1001", "11 RAG1001", "12 RAG1001", "13 RAG1001", "14 RAG1001", "15 RAG1001", "16 RAG1001", "17 RAG1001", "18 RAG1001"]);
  assert.match(lines[0]!, /^src\/server\.ts:6:25 RAG1001: ctx\.step is inside an if statement; use ctx\.when\(condition, \(\) => \.\.\., ctx\.elsePreserve or ctx\.elseForget\)\.$/);
  assert.match(lines[5]!, /inside a loop; use ctx\.forEach/);
  assert.match(lines[7]!, /inside try\/catch\/finally/);
  assert.match(lines[8]!, /inside a nested function/);
  assert.match(lines[9]!, /inside a ctx\.step callback/);
  assert.match(lines[10]!, /inside the forEach key function/);
  assert.match(lines[11]!, /ctx\.step\(\.\.\.\) is not awaited/);
});

test("RAG1002 names clocks, randomness, timers, network and file access and run functions outside ctx.step", async () => {
  const lines = await guards(program(`  const now = Date.now();
  const today = new Date();
  const chance = Math.random();
  const id = crypto.randomUUID();
  const other = randomUUID();
  setTimeout(() => undefined, 1);
  const text = readFileSync("/etc/hosts", "utf8");
  await ctx.when(true, async () => { await ctx.functions.notify({ text: "now" }); }, ctx.elseForget);
  await ctx.step(async () => [Date.now(), new Date(), Math.random(), randomUUID(), readFileSync("/etc/hosts", "utf8"), await fetch("http://localhost"), await ctx.functions.notify({ text: "once" })]);
  ctx.log([now, today, chance, id, other, text, new Date(0)]);`, `import { readFileSync } from "node:fs";\nimport { randomUUID } from "node:crypto";`));
  assert.deepEqual(codes(lines), ["6 RAG1002", "7 RAG1002", "8 RAG1002", "9 RAG1002", "10 RAG1002", "11 RAG1002", "12 RAG1002", "13 RAG1002"]);
  assert.match(lines[0]!, /RAG1002: Date\.now\(\) reads the clock; a re-evaluation must compute the same values, so do it inside ctx\.step\.$/);
  assert.match(lines[6]!, /readFileSync from node:fs reaches files, processes or the network/);
  assert.match(lines[7]!, /ctx\.functions\.notify\(\.\.\.\) is an effect; run it inside ctx\.step/);
});

test("RAG1003 names module state and its changes in the files of a state-aware program, not in tests or defineActor packages", async () => {
  const helper = `export let visits = 0;\nexport const cache = new Map<string, number>();\nexport const list: string[] = [];\nexport const config = { retries: 1 };\nexport const remember = (key: string) => { cache.set(key, 1); list.push(key); config.retries += 1; Object.assign(config, { retries: 2 }); visits++; };\nexport const fixed = Object.freeze({ name: "fixed" });\n`;
  const lines = await guards(program(`  await ctx.step(() => remember(fixed.name));`, `import { fixed, remember } from "./helper.js";`), { "src/helper.ts": helper, "tests/program.test.ts": "let counter = 0;\ncounter += 1;\nexport {};\n" });
  assert.deepEqual(lines.map((line) => line.replace(/ RAG1003:.*$/, "")), ["src/helper.ts:1:12", "src/helper.ts:5:44", "src/helper.ts:5:63", "src/helper.ts:5:79", "src/helper.ts:5:100"]);
  assert.match(lines[0]!, /RAG1003: let visits is module state that no re-evaluation restores; keep program state in ctx\.useState\.$/);
  assert.match(lines[1]!, /set\(\) changes module-level cache/);
  assert.deepEqual(await guards(`import { defineActor } from "@ragents/server";\nimport { Type } from "typebox";\nlet calls = 0;\nexport default defineActor({ state: Type.Object({}), functions: {} }, { functions: {} });\nexport const count = () => calls++;\n`), [], "defineActor programs keep their module freedom");
});

test("RAG1004 and RAG1005 report the rules of hooks and missing effect dependencies of a view", async () => {
  const contracts = { stateSchema: { type: "object" }, actions: [] };
  const compiled = await compileClientSource({ ...contracts, source: `import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
function App({ label }: { label: string }) {
  if (label) { const [value] = useState(0); console.log(value); }
  useEffect(() => { console.log(label); }, []);
  return <p>{label}</p>;
}
createRoot(document.getElementById("root")!).render(<App label="x" />);
` });
  assert.equal(compiled.valid, false);
  assert.deepEqual(compiled.diagnostics.map((item) => `${item.fileName}:${item.start?.line}:${item.start?.column} ${item.message}`), [
    'src/client.tsx:4:32 RAG1004: React Hook "useState" is called conditionally. React Hooks must be called in the exact same order in every component render.',
    "src/client.tsx:5:44 RAG1005: React Hook useEffect has a missing dependency: 'label'. Either include it or remove the dependency array.",
  ]);
  const fixed = await compileClientSource({ ...contracts, source: `import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
function App({ label }: { label: string }) {
  const [value] = useState(0);
  useEffect(() => { console.log(label, value); }, [label, value]);
  return <p>{label}</p>;
}
createRoot(document.getElementById("root")!).render(<App label="x" />);
` });
  assert.equal(fixed.valid, true, JSON.stringify(fixed.diagnostics));
});
