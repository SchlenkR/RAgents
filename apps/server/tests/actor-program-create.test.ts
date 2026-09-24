import assert from "node:assert/strict";
import { lstat, mkdir, mkdtemp, readdir, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import test, { type TestContext } from "node:test";
import type { NativeTypeScriptExecutor, NativeTypeScriptRequest } from "@ragents/engine";
import { setupRun } from "../../../packages/ragents/tests/support.ts";
import { runModuleTemplates, templateFiles } from "../../../plugins/ragents.actor-programs/server/templates.ts";
import { readAppPackage } from "../src/plugin-support/actor-programs/app-project.ts";
import { runtimeFor } from "./actor-runtime-fixture.ts";

const fixture = async (t: TestContext) => {
  const directory = await mkdtemp(path.join(tmpdir(), "ragents-actor-create-"));
  const setup = setupRun();
  const runtime = runtimeFor(setup, directory);
  t.after(async () => { await runtime.shutdown(); await rm(directory, { recursive: true, force: true }); });
  const executor = setup.services.nativeTypeScriptExecutor!;
  return { directory, setup, runtime, executor, runId: setup.view.id, context: { actorId: setup.view.ownerId, commandId: "activate" },
    actors: path.join(directory, "actor-workspace", "actors"), staging: path.join(directory, "actor-workspace", ".staging") };
};

const around = (executor: NativeTypeScriptExecutor, before: (request: NativeTypeScriptRequest) => Promise<void>): NativeTypeScriptExecutor => ({
  execute: async (request, binding) => { await before(request); return executor.execute(request, binding); },
  stopRun: (runId) => executor.stopRun(runId),
  stopInstance: (runId, instanceId) => executor.stopInstance(runId, instanceId),
  shutdown: () => executor.shutdown(),
});

const regularFiles = async (directory: string): Promise<string[]> => (await readdir(directory, { recursive: true, withFileTypes: true }))
  .filter((entry) => entry.isFile()).map((entry) => path.join(entry.parentPath, entry.name));

test("every template is created as a complete package without its own location and activates with typecheck, build and its tests", async (t) => {
  for (const template of runModuleTemplates) await t.test(template.id, async (t) => {
    const f = await fixture(t);
    const created = await f.runtime.scaffold(f.runId, template.id, template.id);
    const directory = path.join(f.actors, template.id);
    assert.deepEqual(created.files, [...Object.keys(templateFiles(template, template.id)), "tsconfig.client.json", "tsconfig.json", "tsconfig.server.json"]
      .sort((left, right) => left.localeCompare(right)));
    assert.deepEqual(await readAppPackage(directory), template.ragents);
    const run = [f.directory, await realpath(f.directory)];
    for (const file of await regularFiles(directory)) {
      const text = await readFile(file, "utf8");
      assert.ok(run.every((prefix) => !text.includes(prefix)), `${path.relative(directory, file)} names the folder of the package`);
    }
    assert.deepEqual(await readdir(f.staging), []);
    const activated = await f.runtime.activate(f.context, f.runId, template.id, undefined, template.ragents.backend ? undefined : `@${f.setup.agent.handle}`);
    assert.equal(activated.views, template.ragents.views?.length ?? 0);
  });
});

test("a created package reads its prompts from its final folder", async (t) => {
  const f = await fixture(t);
  await f.runtime.scaffold(f.runId, "prompted", "blank");
  const directory = path.join(f.actors, "prompted");
  await mkdir(path.join(directory, "prompts"));
  await writeFile(path.join(directory, "prompts/role.md"), "Rollenprompt");
  const prompts = await import(pathToFileURL(path.join(directory, "node_modules/@ragents/workflow/prompts.js")).href) as { readPrompt: (reference: string) => Promise<string> };
  assert.equal(await prompts.readPrompt("prompts/role.md"), "Rollenprompt");
});

test("a failed creation leaves nothing below actors, the name stays free and the next attempt is complete", async (t) => {
  const f = await fixture(t);
  f.setup.services.nativeTypeScriptExecutor = around(f.executor, async (request) => {
    assert.equal(path.dirname(request.cwd!), f.staging);
    await assert.rejects(lstat(path.join(f.actors, "counter")), { code: "ENOENT" });
    throw new Error("Vertrag nicht lesbar");
  });
  await assert.rejects(f.runtime.scaffold(f.runId, "counter", "headless-counter"), /Vertrag nicht lesbar/);
  assert.deepEqual(await readdir(f.actors), []);
  assert.deepEqual(await readdir(f.staging), []);
  f.setup.services.nativeTypeScriptExecutor = f.executor;
  await f.runtime.scaffold(f.runId, "counter", "headless-counter");
  assert.deepEqual(await f.runtime.activate(f.context, f.runId, "counter"), { name: "counter", actor: "@counter", views: 0, active: true });
});

test("an existing folder of the same name blocks the creation, even an empty one that appears during the build", async (t) => {
  const f = await fixture(t);
  await mkdir(path.join(f.actors, "taken"), { recursive: true });
  await assert.rejects(f.runtime.scaffold(f.runId, "taken", "blank"), /Das Paket taken existiert bereits/);
  f.setup.services.nativeTypeScriptExecutor = around(f.executor, () => mkdir(path.join(f.actors, "late")).then(() => undefined));
  await assert.rejects(f.runtime.scaffold(f.runId, "late", "headless-counter"), /Das Paket late existiert bereits/);
  assert.deepEqual((await readdir(f.actors)).sort(), ["late", "taken"]);
  assert.deepEqual(await readdir(path.join(f.actors, "late")), []);
  assert.deepEqual(await readdir(f.staging), []);
});

test("two simultaneous creations of one name leave exactly one complete package", async (t) => {
  const f = await fixture(t);
  const candidates = [runModuleTemplates.find((template) => template.id === "text-analysis")!, runModuleTemplates.find((template) => template.id === "headless-counter")!];
  const results = await Promise.allSettled(candidates.map((template) => f.runtime.scaffold(f.runId, "twin", template.id)));
  const winners = candidates.filter((_template, index) => results[index]!.status === "fulfilled");
  assert.equal(winners.length, 1);
  const rejected = results.find((result): result is PromiseRejectedResult => result.status === "rejected")!;
  assert.match(String(rejected.reason), /Das Paket twin (wird gerade angelegt|existiert bereits)/);
  assert.deepEqual(await readAppPackage(path.join(f.actors, "twin")), winners[0]!.ragents);
  assert.deepEqual(await readdir(f.staging), []);
  assert.equal((await f.runtime.activate(f.context, f.runId, "twin")).active, true);
});

test("leftovers of a crashed server run leave the staging area without touching a creation in progress", async (t) => {
  const f = await fixture(t);
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  t.after(() => release());
  let reached!: () => void;
  const paused = new Promise<void>((resolve) => { reached = resolve; });
  f.setup.services.nativeTypeScriptExecutor = around(f.executor, async (request) => {
    if (!path.basename(request.cwd ?? "").startsWith("slow-")) return;
    reached();
    await gate;
  });
  const slow = f.runtime.scaffold(f.runId, "slow", "headless-counter");
  await paused;
  await mkdir(path.join(f.staging, "crashed-0000/src"), { recursive: true });
  await writeFile(path.join(f.staging, "crashed-0000/package.json"), "{}");
  await f.runtime.scaffold(f.runId, "quick", "blank");
  const staged = await readdir(f.staging);
  assert.equal(staged.length, 1);
  assert.match(staged[0]!, /^slow-/);
  release();
  await slow;
  assert.deepEqual((await readdir(f.actors)).sort(), ["quick", "slow"]);
  assert.deepEqual(await readdir(f.staging), []);
});

test("an imported package appears complete and leaves nothing behind when its activation fails", async (t) => {
  const f = await fixture(t);
  const sources = (check: string) => [
    { path: "package.json", content: JSON.stringify({ name: "imported", private: true, type: "module", ragents: { title: "Import", backend: "src/server.ts" } }) },
    { path: "src/server.ts", content: 'import {Type} from "typebox"; import {defineActor} from "@ragents/server"; export default defineActor({state:Type.Object({}),functions:{}},{functions:{}});' },
    { path: "tests/program.test.ts", content: `import assert from "node:assert/strict"; import test from "node:test"; test("import", () => { ${check} });` },
  ];
  await assert.rejects(f.runtime.importPackage(f.context, f.runId, "imported", sources('assert.fail("Testfehler");')), /Tests für imported fehlgeschlagen/);
  assert.deepEqual(await readdir(f.actors), []);
  assert.deepEqual(await readdir(f.staging), []);
  assert.equal((await f.runtime.importPackage(f.context, f.runId, "imported", sources("assert.ok(true);"))).actorHandle, "imported");
});
