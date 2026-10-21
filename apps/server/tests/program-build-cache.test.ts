import assert from "node:assert/strict";
import { mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test, { type TestContext } from "node:test";
import { ProgramBuildCache, type BuildCacheLimits } from "../src/plugin-support/actor-programs/build-cache.ts";

const limits: BuildCacheLimits = { entries: 16, bytes: 1024 * 1024 };

const fixture = async (t: TestContext, bounds: BuildCacheLimits = limits) => {
  const directory = await mkdtemp(path.join(tmpdir(), "ragents-build-cache-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  return { directory, cache: new ProgramBuildCache(path.join(directory, "cache"), bounds) };
};

const built = <T>(value: T, reusable = true) => async () => ({ value, reusable });

const later = (milliseconds = 15) => new Promise((resolve) => setTimeout(resolve, milliseconds));

test("a reusable result is built once, stays after a restart, and is handed out as a copy", async (t) => {
  const { directory, cache } = await fixture(t);
  let builds = 0;
  const build = async () => { builds += 1; return { value: { contract: { functions: ["add"] } }, reusable: true }; };
  const first = await cache.through("backend", "k1", build);
  first.contract.functions.push("changed by the caller");
  assert.deepEqual(await cache.through("backend", "k1", build), { contract: { functions: ["add"] } });
  const restarted = new ProgramBuildCache(path.join(directory, "cache"), limits);
  assert.deepEqual(await restarted.through("backend", "k1", build), { contract: { functions: ["add"] } });
  assert.equal(builds, 1);
  assert.deepEqual(cache.stats("backend"), { hits: 1, shared: 0, builds: 1 });
  assert.deepEqual(restarted.stats("backend"), { hits: 1, shared: 0, builds: 0 });
});

test("another key or another kind is built on its own", async (t) => {
  const { cache } = await fixture(t);
  await cache.through("backend", "k1", built(1));
  assert.equal(await cache.through("backend", "k2", built(2)), 2);
  assert.equal(await cache.through("typecheck", "k1", built(3)), 3);
  assert.equal(await cache.through("backend", "k1", built(4)), 1);
});

test("runs that ask for the same key while it is built wait for one build", async (t) => {
  const { cache } = await fixture(t);
  let builds = 0;
  const release = Promise.withResolvers<void>();
  const build = async () => { builds += 1; await release.promise; return { value: "checked", reusable: true }; };
  const asking = Array.from({ length: 5 }, () => cache.through("typecheck", "same", build));
  await later(50);
  release.resolve();
  assert.deepEqual(await Promise.all(asking), Array(5).fill("checked"));
  assert.equal(builds, 1);
  assert.deepEqual(cache.stats("typecheck"), { hits: 0, shared: 4, builds: 1 });
});

test("a result that may not be reused is neither stored nor shared", async (t) => {
  const { directory, cache } = await fixture(t);
  let builds = 0;
  const build = async () => { builds += 1; return { value: ["error"], reusable: false }; };
  assert.deepEqual(await Promise.all([cache.through("typecheck", "failing", build), cache.through("typecheck", "failing", build)]), [["error"], ["error"]]);
  await cache.through("typecheck", "failing", build);
  assert.equal(builds, 3);
  assert.deepEqual(await readdir(path.join(directory, "cache")).catch(() => []), []);
});

test("a failed build is not stored and does not fail the runs waiting for it", async (t) => {
  const { cache } = await fixture(t);
  const release = Promise.withResolvers<void>();
  const failing = cache.through("typecheck", "k", async () => { await release.promise; throw new Error("run stopped"); });
  const waiting = cache.through("typecheck", "k", built("own build"));
  release.resolve();
  await assert.rejects(failing, /run stopped/);
  assert.equal(await waiting, "own build");
});

test("a run that stops waiting leaves the build to the others", async (t) => {
  const { cache } = await fixture(t);
  const release = Promise.withResolvers<void>();
  const leader = cache.through("typecheck", "k", async () => { await release.promise; return { value: "done", reusable: true }; });
  const controller = new AbortController();
  const impatient = cache.through("typecheck", "k", built("unused"), controller.signal);
  controller.abort(new Error("run stopped"));
  await assert.rejects(impatient, /run stopped/);
  release.resolve();
  assert.equal(await leader, "done");
});

test("the stored entries stay within the entry and byte limits and the least recently used go first", async (t) => {
  const { directory, cache } = await fixture(t, { entries: 3, bytes: 1024 * 1024 });
  for (const key of ["a", "b", "c"]) {
    await cache.through("backend", key, built(key));
    await later();
  }
  await cache.through("backend", "a", built("again"));
  await later();
  await cache.through("backend", "d", built("d"));
  assert.deepEqual((await readdir(path.join(directory, "cache"))).sort(), ["backend-a.json", "backend-c.json", "backend-d.json"]);
  assert.equal(await cache.through("backend", "b", built("rebuilt")), "rebuilt");

  const small = await fixture(t, { entries: 100, bytes: 4000 });
  for (const key of ["x", "y", "z"]) {
    await small.cache.through("client", key, built(key.repeat(1500)));
    await later();
  }
  const names = await readdir(path.join(small.directory, "cache"));
  assert.deepEqual(names.sort(), ["client-y.json", "client-z.json"]);
});

test("a changed host file that a result was built from invalidates it", async (t) => {
  const { directory, cache } = await fixture(t);
  const source = path.join(directory, "ui.tsx");
  await writeFile(source, "export const a = 1;");
  const build = (value: string) => async () => ({ value, reusable: true, dependencies: [source] });
  assert.equal(await cache.through("client", "k", build("first")), "first");
  assert.equal(await cache.through("client", "k", build("second")), "first");
  await writeFile(source, "export const a = 2;");
  assert.equal(await cache.through("client", "k", build("third")), "third");
  assert.equal(await cache.through("client", "k", build("fourth")), "third");
});

test("a damaged entry counts as missing and is replaced", async (t) => {
  const { directory, cache } = await fixture(t);
  await cache.through("backend", "k", built("good"));
  await writeFile(path.join(directory, "cache", "backend-k.json"), "{ not json");
  assert.equal(await cache.through("backend", "k", built("replaced")), "replaced");
  assert.equal(await cache.through("backend", "k", built("unused")), "replaced");
  await writeFile(path.join(directory, "cache", "backend-k.json"), JSON.stringify({ version: 1, key: "other", dependencies: {}, value: "foreign" }));
  assert.equal(await cache.through("backend", "k", built("rebuilt")), "rebuilt");
});
