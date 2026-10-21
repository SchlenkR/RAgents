import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { monitorEventLoopDelay } from "node:perf_hooks";
import path from "node:path";
import test, { type TestContext } from "node:test";
import { setupRun } from "../../../packages/ragents/tests/support.ts";
import { typecheckServerProject } from "../src/plugin-support/actor-programs/app-project.ts";
import { ProgramBuildCache } from "../src/plugin-support/actor-programs/build-cache.ts";
import { ACTOR_PROGRAMS_STATE_ID, ACTOR_SCRIPT_STATE_ID } from "../src/plugin-support/actor-programs/contract.ts";
import { appFiles, invocationResult, pingOperations, runtimeFor, sourcesOf } from "./actor-runtime-fixture.ts";

const limits = { entries: 64, bytes: 64 * 1024 * 1024 };
const script = { entryId: "test.rpc", handle: "rpc" } as const;

const fleet = async (t: TestContext, count: number, options: { cacheDirectory?: string; refreshSlots?: number } = {}) => {
  const root = await mkdtemp(path.join(tmpdir(), "ragents-build-cache-runs-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const base = path.basename(root).toLowerCase();
  const setup = setupRun({ runId: `${base}-0` });
  const owners = new Map<string, string>([[setup.view.id, setup.view.ownerId]]);
  for (let index = 1; index < count; index += 1) {
    const view = setup.runtime.createRun({ commandId: `create-${index}` }, { runId: `${base}-${index}`, title: `Run ${index}`, ownerHandle: "owner", ownerDisplayName: "Owner" });
    owners.set(view.id, view.ownerId);
  }
  const runIds = [...owners.keys()];
  const ping = pingOperations();
  const cache = new ProgramBuildCache(options.cacheDirectory ?? path.join(root, "cache"), limits);
  let current: Record<string, string> = {};
  let installs = 0;
  const runtime = runtimeFor(setup, root, ping.operations, undefined, (entryId, name) => entryId === script.entryId && name === script.handle ? sourcesOf(current) : undefined,
    undefined, undefined, (runId) => path.join(root, runId), undefined, undefined, undefined, { buildCache: cache, ...(options.refreshSlots ? { refreshSlots: options.refreshSlots } : {}) });
  t.after(async () => { await runtime.shutdown(); await setup.services.nativeTypeScriptExecutor!.shutdown(); setup.journal.close(); });
  const install = (runId: string, files: Record<string, string>) => {
    current = files;
    return runtime.installScript({ actorId: owners.get(runId)!, commandId: `install-${installs += 1}` }, runId, { ...script, files: sourcesOf(files), programs: [], sharedPrograms: [] }, null);
  };
  const call = async (runId: string, requestId: string) => {
    const app = runtime.apps(runId).find((entry) => entry.id === "rpc.rpc--main")!;
    const invocation = runtime.startInvocation(runId, app.id, app.revision, "run", requestId, {}, runtime.invocationPermit(runId));
    return invocationResult(runtime, runId, "rpc.rpc--main", invocation.id);
  };
  return { root, setup, runtime, cache, ping, runIds, install, call, publish: (files: Record<string, string>) => { current = files; } };
};

const records = Array.from({ length: 100 }, (_, index) => `export const record${index} = Type.Object({ ${Array.from({ length: 24 }, (_, field) => `field${field}: Type.Optional(Type.Union([Type.String(), Type.Number(), Type.Array(Type.Object({ inner${field}: Type.Boolean() }))]))`).join(", ")} });
export type Record${index} = Static<typeof record${index}>;`).join("\n");
const pinging = (version: string) => `const text: string = await context.functions.native_ping({value: "ping"}); const { record0 } = await import("./records.js"); return "${version}:" + text + (record0 ? "" : "?");`;
const packageOf = (body: string) => ({ ...appFiles(body), "src/records.ts": `import { Type, type Static } from "typebox";\n${records}\n` });
const v1 = packageOf(pinging("v1"));
const v2 = packageOf(pinging("v2"));
const mistyped = packageOf(`const count: number = "no"; ${pinging("v3")}`);

test("twenty runs with one script package check and build it once, also after a restart, and stay responsive when the package changes", { timeout: 240_000 }, async (t) => {
  const f = await fleet(t, 20);
  await Promise.all(f.runIds.map((runId) => f.install(runId, v1)));
  for (const kind of ["typecheck", "backend", "client"]) {
    const stats = f.cache.stats(kind);
    assert.equal(stats.builds, 1, `${kind} built once`);
    assert.equal(stats.hits + stats.shared, 19, `${kind} reused 19 times`);
  }

  const installed = path.join(f.root, f.runIds[0]!, "actor-workspace", "actors", "rpc.rpc");
  const started = performance.now();
  assert.deepEqual(typecheckServerProject(installed, "src/server.ts"), []);
  const blocking = performance.now() - started;

  f.publish(v2);
  f.ping.widenInput();
  const delay = monitorEventLoopDelay({ resolution: 10 });
  delay.enable();
  const results = await Promise.all(f.runIds.map((runId, index) => f.call(runId, `refresh-${index}`)));
  delay.disable();
  for (const result of results) assert.deepEqual(result.status === "succeeded" ? result.result : result, "v2:pong");
  assert.equal(f.cache.stats("typecheck").builds, 2, "the changed sources were checked once for all runs");
  assert.equal(f.cache.stats("backend").builds, 2);
  assert.ok(delay.max / 1e6 < blocking / 2, `The event loop stood still for ${(delay.max / 1e6).toFixed(0)} ms; a type check on it takes ${blocking.toFixed(0)} ms`);

  const restarted = await fleet(t, 3, { cacheDirectory: path.join(f.root, "cache") });
  await Promise.all(restarted.runIds.map((runId) => restarted.install(runId, v1)));
  for (const kind of ["typecheck", "backend", "client"]) {
    const stats = restarted.cache.stats(kind);
    assert.equal(stats.builds, 0, `${kind} read from the store`);
    assert.equal(stats.hits + stats.shared, 3);
  }
});

test("sources or capability declarations that differ are never served from the checks of others", { timeout: 120_000 }, async (t) => {
  const f = await fleet(t, 4);
  const [first, second, third, fourth] = f.runIds as [string, string, string, string];
  await f.install(first, v1);
  assert.equal(f.cache.stats("typecheck").builds, 1);
  await f.install(second, v1);
  assert.deepEqual(f.cache.stats("typecheck"), { hits: 1, shared: 0, builds: 1 });

  for (const attempt of [2, 3]) {
    await assert.rejects(f.install(third, mistyped), /Typecheck of rpc\.rpc: 1 errors\.\nsrc\/server\.ts:\d+:\d+ TS2322/);
    assert.equal(f.cache.stats("typecheck").builds, attempt, "a failing check is repeated, not remembered");
  }
  await f.install(third, v2);
  assert.equal(f.cache.stats("typecheck").builds, 4, "other sources are checked afresh");

  f.ping.breakResult();
  await assert.rejects(f.install(fourth, v1), /Typecheck of rpc\.rpc: \d+ errors\.\nsrc\/server\.ts:\d+:\d+ TS2322/);
  assert.equal(f.cache.stats("typecheck").builds, 5, "the same sources against another capability declaration are checked afresh");
  const drifted = await f.call(first, "after-the-break");
  assert.equal(drifted.status, "failed");
  if (drifted.status === "failed") assert.match(drifted.error, /capability contract of rpc\.rpc has changed and the reactivation failed/);
});

test("reactivations after a contract drift run at most as many at a time as there are refresh slots", { timeout: 120_000 }, async (t) => {
  const f = await fleet(t, 6, { refreshSlots: 2 });
  await Promise.all(f.runIds.map((runId) => f.install(runId, v1)));
  f.ping.widenInput();
  let open = 0;
  let most = 0;
  let finished = 0;
  const stop = f.setup.runtime.subscribe((events) => {
    for (const event of events) {
      if (event.type !== "plugin.state-replaced" && event.type !== "plugin.state-patched") continue;
      if (event.payload.pluginId === ACTOR_SCRIPT_STATE_ID) most = Math.max(most, open += 1);
      if (event.payload.pluginId === ACTOR_PROGRAMS_STATE_ID) { open -= 1; finished += 1; }
    }
  });
  const results = await Promise.all(f.runIds.map((runId, index) => f.call(runId, `refresh-${index}`)));
  stop();
  assert.ok(results.every((result) => result.status === "succeeded"), JSON.stringify(results));
  assert.equal(finished, 6);
  assert.equal(most, 2);
});
