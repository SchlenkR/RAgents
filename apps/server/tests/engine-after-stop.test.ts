import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import test, { after } from "node:test";
import { LifecycleContributionRegistry, PluginHost, type AgentDriver } from "@aicontainer/ragents";
import { deferred } from "../../../packages/ragents/tests/support.ts";
import { emptyUsage } from "../../../packages/ragents/src/domain/model.ts";
import { productRuntimeToken } from "../src/ragents/product-runtime.ts";
import { workspaceRuntimeToken } from "../src/ragents/workspace-runtime.ts";

const directory = await mkdtemp(path.join(tmpdir(), "ragents-engine-after-stop-"));
process.env.DATA_DIR = directory;
process.env.PRODUCT_PROFILE = "core";
process.env.PRODUCT_ID = "ragents";
process.env.PRODUCT_TITLE = "RAgents";
const { createEngine, SessionWorkspaces } = await import("../src/ragents/engine.ts");
after(() => rm(directory, { recursive: true, force: true }));
const tick = () => new Promise<void>((resolve) => setImmediate(resolve));
const eventually = async (check: () => boolean) => {
  for (let i = 0; i < 100; i++) {
    if (check()) return;
    await new Promise<void>((resolve) => setTimeout(resolve, 5));
  }
  assert.ok(check(), "expected lifecycle state was not reached");
};

const fixture = async (runId: string, hooks: {
  settlement: () => Promise<void>; early: () => Promise<void>;
  final: (signal: AbortSignal) => Promise<void>; timeoutMs?: number;
}) => {
  let turns = 0;
  const driver: AgentDriver<"script"> = {
    kind: "script", runTurn: async () => { turns++; return { failure: null, usage: emptyUsage() }; },
    waitForRunSettlement: hooks.settlement,
  };
  const plugins = new PluginHost({ product: { id: "ragents", title: "RAgents" }, dataDirectory: directory,
    storageModes: { session: 0o700, sessionsRoot: 0o700 } });
  Object.defineProperty(plugins, "lifecycle", { value: new LifecycleContributionRegistry({ stopTimeoutMs: hooks.timeoutMs ?? 1000 }) });
  plugins.provideHost(productRuntimeToken, {
    coordinator: { handle: "primary", displayName: "Primary", profile: "unused", runTitle: "Test", ownerHandle: "owner", ownerDisplayName: "Owner" },
    roleFor: (view, actor) => view.primaryActorId === actor.id ? "primary" : "worker",
    contract: () => "", promptComposition: "",
    systemPrompts: () => ({ mode: "fixed", options: [], defaultIds: [], shareDefault: false }),
  });
  plugins.provideHost(workspaceRuntimeToken, {
    resolve: async () => { throw new Error("test uses remembered workspace"); },
    describe: () => ({ mode: "test", directoryPattern: directory }),
  });
  plugins.register({ manifest: { id: "test.cleanup" }, register: (host) => {
    host.script({ id: "test.script", create: () => ({ driver }) });
    host.lifecycle({ id: "test.cleanup", stopSession: hooks.early, afterStopSession: ({ signal }) => hooks.final(signal) });
  } });
  const workspaces = new SessionWorkspaces();
  workspaces.remember(runId, directory);
  const engine = await createEngine({ plugins, workspaces, assertAvailable: () => {}, assertRunUsable: () => {}, onChatSessionPersisted: () => {} });
  let view = engine.runtime.createRun({ commandId: `create:${runId}` }, { runId, title: "Test", ownerHandle: "owner", ownerDisplayName: "Owner" });
  view = engine.runtime.createScriptActor({ actorId: view.ownerId, commandId: "install" }, runId, {
    handle: "primary", displayName: "Primary", grants: [], toolNames: [],
  });
  const actor = view.actors.find((entry) => entry.kind === "script")!;
  engine.runtime.selectPrimaryActor({ actorId: view.ownerId, commandId: "primary" }, runId, actor.id);
  engine.start();
  let command = 0;
  return { engine, actorId: actor.id, turns: () => turns,
    input: () => engine.runtime.enqueueInput({ actorId: view.ownerId, commandId: `input:${++command}` }, runId, { actorId: actor.id, content: "next" }),
    stop: () => engine.stopRun(runId, { commandId: `stop:${++command}`, reason: "Test" }),
  };
};

const withEngineHttp = async (engine: Awaited<ReturnType<typeof createEngine>>, use: (base: string) => Promise<void>) => {
  const server = createServer((request, response) => { void engine.routes(request, response); });
  try {
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", resolve);
    });
    const address = server.address();
    assert.ok(address && typeof address !== "string");
    await use(`http://127.0.0.1:${address.port}`);
  } finally {
    server.closeAllConnections();
    if (server.listening) await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
};

test("an HTTP input accepted during quarantine starts after release without replaying an old input", async () => {
  const settled = deferred();
  let early = false;
  const runId = "queued-cleanup";
  const f = await fixture(runId, {
    settlement: () => settled.promise, early: async () => { early = true; }, final: async () => {},
  });
  try {
    f.input();
    await eventually(() => f.turns() === 1);
    await f.engine.scheduler.waitForIdle();
    const stopped = f.stop();
    await eventually(() => early);
    await withEngineHttp(f.engine, async (base) => {
      const response = await fetch(`${base}/api/runs/${runId}/actors/${f.actorId}/inputs`, {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ commandId: "http-during-cleanup", content: "new message" }),
      });
      assert.equal(response.status, 201);
      assert.equal(f.turns(), 1);
      assert.equal(f.engine.runtime.view(runId).inputs.at(-1)?.lifecycle.kind, "pending");
      settled.resolve();
      await stopped;
      await eventually(() => f.turns() === 2);
      await f.engine.scheduler.waitForIdle();
      assert.equal(f.turns(), 2);
      assert.deepEqual(f.engine.runtime.view(runId).inputs.map((input) => input.lifecycle.kind), ["claimed", "claimed"]);
    });
  } finally { settled.resolve(); await f.engine.shutdown(); }
});

test("the engine sweeps late driver work before releasing the primary actor", async () => {
  const settled = deferred(); const releaseFinal = deferred();
  let childAlive = false; let early = 0; let final = 0;
  const f = await fixture("late-cleanup", {
    settlement: () => settled.promise, early: async () => { early++; childAlive = false; },
    final: async () => { final++; assert.equal(childAlive, true); await releaseFinal.promise; childAlive = false; },
  });
  try {
    let responded = false;
    const stopped = f.stop().then(() => { responded = true; });
    await eventually(() => early === 1);
    assert.equal(final, 0);
    assert.equal(responded, false);
    f.input(); await tick(); assert.equal(f.turns(), 0);
    childAlive = true; settled.resolve();
    await eventually(() => final === 1);
    assert.equal(childAlive, true); assert.equal(f.turns(), 0);
    releaseFinal.resolve(); await stopped;
    assert.equal(childAlive, false);
    f.input(); await eventually(() => f.turns() > 0);
  } finally { settled.resolve(); releaseFinal.resolve(); await f.engine.shutdown(); }
});

test("a failed final sweep quarantines the run until a successful retry", async () => {
  let fail = true; let final = 0;
  const f = await fixture("failed-cleanup", {
    settlement: async () => {}, early: async () => {},
    final: async () => { final++; if (fail) throw new Error("cleanup failed"); },
  });
  try {
    await assert.rejects(f.stop(), /cleanup failed/);
    assert.equal(final, 1); await tick();
    f.input(); await tick(); assert.equal(f.turns(), 0);
    fail = false; await f.stop(); await eventually(() => final === 2); await tick();
    f.input(); await eventually(() => f.turns() > 0);
  } finally { fail = false; await f.engine.shutdown(); }
});

test("retrying a failed sweep still waits for the current driver settlement", async () => {
  const retrySettled = deferred(); let retry = false; let final = 0;
  const f = await fixture("retry-settlement", {
    settlement: () => retry ? retrySettled.promise : Promise.resolve(), early: async () => {},
    final: async () => { final++; if (!retry) throw new Error("first sweep failed"); },
  });
  try {
    await assert.rejects(f.stop(), /first sweep failed/);
    assert.equal(final, 1); await tick();
    retry = true;
    const stopped = f.stop(); await tick();
    assert.equal(final, 1, "retry must await new driver settlement despite rejected previous quarantine");
    retrySettled.resolve(); await stopped;
    assert.equal(final, 2);
  } finally { retry = true; retrySettled.resolve(); await f.engine.shutdown(); }
});

test("a final-hook timeout keeps the run quarantined while ignored abort work is pending", async () => {
  const finish = deferred();
  let aborted = false;
  const f = await fixture("timeout-cleanup", {
    timeoutMs: 10, settlement: async () => {}, early: async () => {},
    final: async (signal) => {
      signal.addEventListener("abort", () => { aborted = true; }, { once: true });
      await finish.promise;
    },
  });
  try {
    const stopped = assert.rejects(f.stop(), /afterStopSession.*10 ms/);
    await eventually(() => aborted);
    await stopped;
    f.input(); await tick(); assert.equal(f.turns(), 0);
    finish.resolve(); await tick();
    f.input(); await eventually(() => f.turns() > 0);
  } finally { finish.resolve(); await f.engine.shutdown(); }
});

test("the engine bounds the stop response while an unsettled driver keeps the run quarantined", async (t) => {
  const settled = deferred();
  let final = 0;
  const f = await fixture("bounded-cleanup", {
    settlement: () => settled.promise, early: async () => {}, final: async () => { final++; },
  });
  try {
    t.mock.timers.enable({ apis: ["setTimeout"] });
    const stopped = assert.rejects(f.stop(), /15000 ms.*gesperrt/);
    await tick(); await tick();
    t.mock.timers.tick(15_000);
    await stopped;
    assert.equal(final, 0);
    f.input(); await tick(); assert.equal(f.turns(), 0);
    t.mock.timers.reset();
    settled.resolve(); await eventually(() => final === 1); await tick();
    f.input(); await eventually(() => f.turns() > 0);
  } finally { t.mock.timers.reset(); settled.resolve(); await f.engine.shutdown(); }
});
