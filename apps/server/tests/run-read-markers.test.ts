import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test, { after } from "node:test";
import { PluginHost } from "@ragents/engine";
import { productRuntimeToken } from "../src/ragents/product-runtime.ts";
import { workspaceRuntimeToken } from "../src/ragents/workspace-runtime.ts";
import { sandboxServicesToken } from "../src/plugin-support/workspace-sandbox-host.ts";
import type { HostBridges } from "../src/ragents/host-services.ts";

const dataDirectory = await mkdtemp(path.join(tmpdir(), "ragents-read-markers-"));
process.env.DATA_DIR = dataDirectory;
process.env.PRODUCT_PROFILE = "core";
process.env.PRODUCT_ID = "test";
process.env.PRODUCT_TITLE = "Test";
process.env.COMPACTION_MODEL = "";
const { RunSessionProvider, READ_MARKER_NOTICE_INTERVAL_MS } = await import("../src/provider.ts");
const { RunReadMarkers, READ_MARKERS_WRITE_DELAY_MS } = await import("../src/run-read-markers.ts");
const { layout } = await import("../src/layout.ts");
after(() => rm(dataDirectory, { recursive: true, force: true }));

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

test("the marker file keeps the highest revision per user and run, written together and read back by a new instance", async () => {
  const file = path.join(dataDirectory, "unit", "markers.json");
  const markers = await RunReadMarkers.load(file);
  assert.equal(markers.markViewed("alice", "run-a", 3), true);
  assert.equal(markers.markViewed("alice", "run-a", 2), false, "a lower revision changes nothing");
  assert.equal(markers.markViewed("alice", "run-a", 3), false);
  assert.equal(markers.markViewed(null, "run-a", 1), true, "the user without sign-in has markers of its own");
  assert.equal(markers.markViewed("bob", "run-b", 7), true);
  assert.equal(existsSync(file), false, "changes wait to be written together");
  await sleep(READ_MARKERS_WRITE_DELAY_MS + 200);
  assert.equal(existsSync(file), true);

  markers.forgetRuns(new Set(["run-b"]));
  await markers.flush();
  const reloaded = await RunReadMarkers.load(file);
  assert.equal(reloaded.seenRevision("alice", "run-a"), 3);
  assert.equal(reloaded.seenRevision(null, "run-a"), 1);
  assert.equal(reloaded.seenRevision("bob", "run-a"), undefined);
  assert.equal(reloaded.seenRevision("bob", "run-b"), undefined, "a forgotten run keeps no marker");
  assert.deepEqual(JSON.parse(await readFile(file, "utf8")), {
    version: 1,
    markers: [{ userId: "alice", runId: "run-a", revision: 3 }, { userId: null, runId: "run-a", revision: 1 }],
  });

  await writeFile(file, "{\"version\":1,\"markers\":[{\"userId\":\"alice\",\"runId\":\"run-a\",\"revision\":-1}]}");
  await assert.rejects(RunReadMarkers.load(file), /read markers in .* are invalid .*delete the file/);
});

const createProvider = () => new RunSessionProvider((bridges: HostBridges) => {
  const host = new PluginHost({ product: { id: "test", title: "Test" }, dataDirectory });
  host.register({
    manifest: { id: "test.product" },
    register: (registration) => {
      registration.provide(productRuntimeToken, {
        coordinator: { handle: "coordinator", displayName: "Coordinator", profile: "manual", runTitle: "New run", ownerHandle: "owner", ownerDisplayName: "Owner" },
        roleFor: (view, actor) => view.primaryActorId === actor.id ? "primary" : "worker",
        contract: () => "",
        promptComposition: "test",
        systemPrompts: () => ({ mode: "fixed", options: [], defaultIds: [], shareDefault: false }),
      });
      registration.provide(workspaceRuntimeToken, {
        describe: () => ({ mode: "test", directoryPattern: dataDirectory }),
        resolve: async () => ({ cwd: dataDirectory, currentRoot: async () => dataDirectory, runOperation: (operation) => operation() }),
      });
      registration.provide(sandboxServicesToken, {
        serverProcessContextFor: async (runId) => ({ runId, cwd: dataDirectory, root: dataDirectory, home: dataDirectory, env: { ...process.env } }),
        registerWorkspaceRoot: () => {},
        execute: async () => null,
        shutdown: async () => {},
      });
      registration.profiles({
        id: "test.profiles", models: () => [],
        profiles: () => [{ name: "manual", description: "Manual", driver: "manual", turnTimeoutMs: null, isolateWorkspace: false }],
      });
    },
  });
  host.seal();
  runtimeOf = bridges.runtime;
  return host;
}, undefined);

let runtimeOf: HostBridges["runtime"] = () => { throw new Error("The provider has no runtime yet"); };

const scope = (userId: string | null) => ({ visible: () => true, workspaceAccessible: () => true, operable: () => true, sharing: () => ({}), userId });

test("the server keeps read markers across a restart, tells only the same user, coalesced, and forgets a deleted run", { timeout: 30_000 }, async () => {
  let provider = createProvider();
  try {
    await provider.init();
    for (const runId of ["run-kept", "run-gone"]) {
      runtimeOf().createRun({ commandId: `create-${runId}` }, { runId, title: runId, ownerHandle: "owner", ownerDisplayName: "Owner" });
    }
    const revision = (runId: string) => runtimeOf().state(runId).revision;
    const heard = { alice: 0, bob: 0 };
    provider.subscribeList(() => { heard.alice += 1; }, "alice");
    provider.subscribeList(() => { heard.bob += 1; }, "bob");

    provider.markViewed("run-kept", revision("run-kept"), "alice");
    assert.deepEqual(heard, { alice: 1, bob: 0 }, "the first change reaches the user at once");
    runtimeOf().proposeAction({ actorId: runtimeOf().state("run-kept").ownerId, commandId: "ask" }, "run-kept", { owner: "ragents.ask", title: "Continue?" });
    provider.markViewed("run-kept", revision("run-kept"), "alice");
    provider.markViewed("run-gone", revision("run-gone"), "alice");
    assert.deepEqual(heard, { alice: 1, bob: 0 }, "further changes within the interval wait");
    await sleep(READ_MARKER_NOTICE_INTERVAL_MS + 200);
    assert.deepEqual(heard, { alice: 2, bob: 0 }, "and arrive together at its end");
    await sleep(READ_MARKER_NOTICE_INTERVAL_MS + 200);
    assert.deepEqual(heard, { alice: 2, bob: 0 }, "without a change nothing follows");
    provider.markViewed("run-kept", revision("run-kept") - 1, "alice");
    assert.deepEqual(heard, { alice: 2, bob: 0 }, "a lower revision is no change");

    const listed = await provider.list(scope("alice"));
    assert.equal(listed.find((entry) => entry.id === "run-kept")?.seenRevision, revision("run-kept"));
    assert.equal(listed.find((entry) => entry.id === "run-kept")?.state, "waiting");
    assert.equal(listed.find((entry) => entry.id === "run-kept")?.pendingActions, 1);
    assert.equal((await provider.list(scope("bob"))).find((entry) => entry.id === "run-kept")?.seenRevision, undefined);
    assert.equal((await provider.list()).find((entry) => entry.id === "run-kept")?.seenRevision, undefined, "a list without a caller carries no read markers");

    await provider.delete("run-gone");
    await provider.deletion("run-gone");
    await provider.shutdown();
    const stored = JSON.parse(await readFile(layout.readMarkersFile, "utf8")) as { markers: Array<{ runId: string }> };
    assert.deepEqual(stored.markers.map((marker) => marker.runId), ["run-kept"], "deleting a run removes its markers");

    provider = createProvider();
    await provider.init();
    const restored = await provider.list(scope("alice"));
    assert.equal(restored.find((entry) => entry.id === "run-kept")?.seenRevision, revision("run-kept"), "a new provider instance reads the markers back");
  } finally {
    await provider.shutdown();
  }
});
