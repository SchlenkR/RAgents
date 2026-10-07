import assert from "node:assert/strict";
import { access, mkdtemp, mkdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test, { after } from "node:test";
import { PluginHost } from "@ragents/engine";
import { runManagedProcess } from "@ragents/workspace-executor";
import { RunWorkspaceRuntime } from "../../../plugins/ragents.workspace/server/runtime.ts";
import { WorkspaceClientRegistry } from "../../../plugins/ragents.workspace/server/clients.ts";
import { sandboxServicesToken } from "../src/plugin-support/workspace-sandbox-host.ts";
import { productRuntimeToken } from "../src/ragents/product-runtime.ts";
import { workspaceRuntimeToken } from "../src/ragents/workspace-runtime.ts";
import { coreMethods } from "../src/api/core-methods.ts";
import { coreContracts } from "../src/api/contracts.ts";
import type { Engine } from "../src/ragents/engine.ts";
import { coreSources, methodContext } from "./rpc-fixture.ts";

const directory = await mkdtemp(path.join(tmpdir(), "ragents-preparation-cancel-"));
process.env.DATA_DIR = directory;
process.env.PRODUCT_PROFILE = "core";
process.env.PRODUCT_ID = "test";
process.env.PRODUCT_TITLE = "Test";
process.env.COMPACTION_MODEL = "";
delete process.env.ACCESS_TOKEN;
const { RunSessionProvider } = await import("../src/provider.ts");
after(() => rm(directory, {recursive: true, force: true}));

const waitFor = async (ready: () => Promise<boolean>) => {
  const deadline = Date.now() + 10_000;
  while (!await ready()) {
    if (Date.now() >= deadline) throw new Error("The preparation process did not reach the expected state");
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
};

test("production chat cancellation reaches the workspace process, isolates callers and leaves retryable runs", {timeout: 30_000}, async (t) => {
  const blocking = new Set(["cancelled", "shared", "isolated", "cleanup"]);
  const cleanupEntered = Promise.withResolvers<void>();
  const cleanupRelease = Promise.withResolvers<void>();
  t.after(() => cleanupRelease.resolve());
  const signals = new Map<string, AbortSignal>();
  const attempts = new Map<string, number>();
  const finished = new Map<string, Promise<unknown>>();
  const marker = (runId: string) => path.join(directory, `${runId}.pid`);
  const provider = new RunSessionProvider((bridges) => {
    const host = new PluginHost({product: {id: "test", title: "Test"}, dataDirectory: directory});
    const workspace = new RunWorkspaceRuntime({
      globalDirectory: path.join(directory, "global"),
      sessionDirectory: (runId, ...segments) => path.join(directory, "workspaces", runId, ...segments),
      storageRootFor: (runId) => path.join(directory, "workspaces", runId),
      sessionsDirectoryPattern: path.join(directory, "workspaces", "{runId}"),
      sessionWorkspaceFor: bridges.sessionWorkspaceFor, skillPaths: async () => [],
      clients: new WorkspaceClientRegistry([]), contributions: [],
      runState: (runId) => bridges.runtime().state(runId), administratorFor: () => true,
      storeBinding: () => { throw new Error("Unexpected workspace rebinding"); },
      resolver: () => ({
        kind: {id: "fixture", label: "Prepared workspace", serverFolders: true},
        resolve: async ({runId, directory: cwd, signal}) => {
          assert.ok(signal, "the production provider and workspace resolver carry the preparation signal");
          signals.set(runId, signal);
          attempts.set(runId, (attempts.get(runId) ?? 0) + 1);
          await mkdir(cwd, {recursive: true});
          if (blocking.has(runId)) {
            const job = runManagedProcess({command: process.execPath,
              args: ["-e", 'require("node:fs").writeFileSync(process.argv[1], String(process.pid)); setInterval(() => {}, 1000);', marker(runId)],
              cwd, env: process.env, label: "Workspace preparation", timeoutMs: 20_000, signal, terminationGraceMs: 0});
            finished.set(runId, job.then(() => undefined, () => undefined));
            try { await job; }
            catch (error) {
              if (runId === "cleanup") {
                cleanupEntered.resolve();
                await cleanupRelease.promise;
              }
              throw error;
            }
          }
          signal.throwIfAborted();
          return {cwd};
        },
      }),
    });
    host.register({manifest: {id: "test.product"}, register(registration) {
      registration.provide(sandboxServicesToken, workspace.sandbox);
      registration.provide(workspaceRuntimeToken, workspace);
      registration.lifecycle({id: "workspace", shutdown: () => workspace.shutdown()});
      registration.profiles({id: "manual", models: () => [], profiles: () => [{name: "manual", description: "Manual test actor", driver: "manual", turnTimeoutMs: null, isolateWorkspace: false}]});
      registration.provide(productRuntimeToken, {
        coordinator: {handle: "coordinator", displayName: "Coordinator", profile: "manual", runTitle: "New", ownerHandle: "owner", ownerDisplayName: "Owner"},
        roleFor: (view, actor) => view.primaryActorId === actor.id ? "primary" : "worker",
        contract: () => "", promptComposition: "test", systemPrompts: () => ({mode: "fixed", options: [], defaultIds: [], shareDefault: false}),
      });
    }});
    host.seal();
    return host;
  }, undefined);
  t.after(() => provider.shutdown());
  await provider.init();
  const engine = (provider as unknown as {engine: Engine}).engine;
  const method = coreMethods(coreSources({get: (runId) => provider.get(runId)})).find((entry) => entry.contract.id === coreContracts.chat.send.id)!;
  const caller = new AbortController();
  const pending = method.execute({runId: "cancelled", text: "Cancelled message"}, {...methodContext(), signal: caller.signal});
  const cancellation = assert.rejects(pending, /disconnected/);
  await waitFor(() => access(marker("cancelled")).then(() => true, () => false));
  const pid = Number(await readFile(marker("cancelled"), "utf8"));
  caller.abort(new Error("Request disconnected"));
  await cancellation;
  await finished.get("cancelled");
  assert.equal(signals.get("cancelled")!.aborted, true);
  assert.throws(() => process.kill(pid, 0), {code: "ESRCH"}, "the actual preparation process has exited");
  assert.equal(engine.runtime.view("cancelled").inputs.length, 0);
  const row = (await provider.list()).find((run) => run.id === "cancelled")!;
  assert.equal(row.locked, undefined, "a cancelled preparation never becomes a workspace failure");
  blocking.delete("cancelled");
  await method.execute({runId: "cancelled", text: "Accepted retry"}, methodContext());
  assert.equal(attempts.get("cancelled"), 2, "cancellation evicts the unfinished workspace cache");
  assert.deepEqual(engine.runtime.view("cancelled").inputs.map((input) => input.content), ["Accepted retry"]);
  const acceptedCaller = new AbortController();
  await method.execute({runId: "cancelled", text: "Another accepted message"}, {...methodContext(), signal: acceptedCaller.signal});
  acceptedCaller.abort(new Error("Disconnected after acceptance"));
  assert.equal(signals.get("cancelled")!.aborted, false, "accepted work has no lifetime link to the old request");
  assert.equal(engine.runtime.view("cancelled").inputs.length, 2);

  const firstCaller = new AbortController();
  const first = method.execute({runId: "shared", text: "Cancelled shared message"}, {...methodContext(), signal: firstCaller.signal});
  const firstCancelled = assert.rejects(first, /disconnected/);
  await waitFor(() => access(marker("shared")).then(() => true, () => false));
  const secondCaller = new AbortController();
  const second = method.execute({runId: "shared", text: "Second message"}, {...methodContext(), signal: secondCaller.signal});
  const secondCancelled = assert.rejects(second, /disconnected/);
  await new Promise((resolve) => setTimeout(resolve, 20));
  firstCaller.abort(new Error("First request disconnected"));
  await firstCancelled;
  assert.equal(signals.get("shared")!.aborted, false, "a second waiter preserves preparation ownership");
  const isolatedCaller = new AbortController();
  const isolated = method.execute({runId: "isolated", text: "Other run"}, {...methodContext(), signal: isolatedCaller.signal});
  const isolatedCancelled = assert.rejects(isolated, /disconnected/);
  await waitFor(() => access(marker("isolated")).then(() => true, () => false));
  secondCaller.abort(new Error("Second request disconnected"));
  await secondCancelled;
  await finished.get("shared");
  assert.equal(signals.get("shared")!.aborted, true);
  assert.equal(signals.get("isolated")!.aborted, false, "the other run's preparation stays alive");
  isolatedCaller.abort(new Error("Isolated request disconnected"));
  await isolatedCancelled;
  await finished.get("isolated");
  assert.equal(engine.runtime.view("shared").inputs.length, 0);
  assert.equal(engine.runtime.view("isolated").inputs.length, 0);

  const cleanupCaller = new AbortController();
  const cleanupPending = method.execute({runId: "cleanup", text: "Cancelled before cleanup"}, {...methodContext(), signal: cleanupCaller.signal});
  const cleanupCancelled = assert.rejects(cleanupPending, /disconnected/);
  await waitFor(() => access(marker("cleanup")).then(() => true, () => false));
  cleanupCaller.abort(new Error("Request disconnected"));
  await cleanupCancelled;
  await cleanupEntered.promise;
  const retryCaller = new AbortController();
  const retryPending = method.execute({runId: "cleanup", text: "Cancelled while old cleanup waits"}, {...methodContext(), signal: retryCaller.signal});
  const retryCancelled = assert.rejects(retryPending, /disconnected/);
  await new Promise((resolve) => setTimeout(resolve, 0));
  retryCaller.abort(new Error("Retry request disconnected"));
  await retryCancelled;
  assert.equal(attempts.get("cleanup"), 1, "an aborted retry never starts another preparation while old cleanup is pending");
  assert.equal(engine.runtime.view("cleanup").inputs.length, 0);
  cleanupRelease.resolve();
  blocking.delete("cleanup");
  await method.execute({runId: "cleanup", text: "Accepted after cleanup"}, methodContext());
  assert.equal(attempts.get("cleanup"), 2);
  assert.equal((await provider.list()).some((run) => run.locked), false);
});
