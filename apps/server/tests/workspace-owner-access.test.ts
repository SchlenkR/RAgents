import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test, { after } from "node:test";
import { createAccessContext, DomainError, Journal, Orchestration, RpcPeer, type AccessContext, type PluginHost } from "@ragents/engine";
import { testServices } from "../../../packages/ragents/tests/support.ts";
import type { RunAccessPolicy } from "../src/api/rights.ts";
import { RpcConnection, RpcDispatcher } from "../src/rpc/dispatcher.ts";
import { compositionEnvironment, showcaseFixture } from "./fixtures/profile-composition/profiles.ts";

// Ein Run, den nur sein Eigentümer bedient, zeigt seinen Arbeitsbereich auch lesend nur ihm; jeder Weg zum Executor prüft das vorher.

const BOUND = "run-bound";
const OPEN = "run-open";

const policy: RunAccessPolicy = {
  global: undefined,
  ownerOf: (runId) => (runId === BOUND || runId === OPEN ? "alice" : undefined),
  ownerOnly: (runId) => runId === BOUND,
};

const user = (id: string, rights: readonly string[]): AccessContext =>
  createAccessContext({ enabled: true, user: { id, label: id, rights: [...rights] } });

const alice = user("alice", ["*"]);
const admin = user("admin", ["*"]);
const hostService = user("host-service", ["runs.read", "runs.read.all", "runs.write", "runs.create", "runs.inspect"]);
const anonymous = createAccessContext({ enabled: false, user: null });

const temporaryDirectory = mkdtempSync(path.join(tmpdir(), "ragents-owner-access-"));
const workspaceDirectory = path.join(temporaryDirectory, "workspace");
mkdirSync(workspaceDirectory);
const environment = { ...compositionEnvironment, DATA_DIR: path.join(temporaryDirectory, "data") };
const previousEnvironment = new Map(Object.keys(environment).map((key) => [key, process.env[key]]));
for (const [key, value] of Object.entries(environment)) {
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
}
const { assertRunWorkspaceAccess } = await import("../src/api/rights.ts");
const { WorkspaceSandboxHost } = await import("../src/plugin-support/workspace-sandbox-host.ts");
const services = testServices();
const journal = new Journal(":memory:", services);
const runtime = new Orchestration(journal, services);
const hosts: PluginHost[] = [];
const reached: string[] = [];
const execute = Object.getOwnPropertyDescriptor(WorkspaceSandboxHost.prototype, "execute")!;
// Jeder Weg eines Plugins zum Arbeitsbereich läuft über SandboxServices.execute; hier endet er mit einer Kennung statt beim Executor.
Object.defineProperty(WorkspaceSandboxHost.prototype, "execute", {
  ...execute,
  value: async (runId: string, operation: string) => {
    reached.push(`${operation}:${runId}`);
    throw new DomainError("executor-reached", `${operation} hat den Executor erreicht`, 418);
  },
});
after(async () => {
  Object.defineProperty(WorkspaceSandboxHost.prototype, "execute", execute);
  try { await Promise.all(hosts.map((host) => host.lifecycle.shutdown())); }
  finally {
    for (const [key, value] of previousEnvironment) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    journal.close();
    rmSync(temporaryDirectory, { recursive: true, force: true });
  }
});

const { loadPlugins } = await import("../src/profile/plugin-discovery.ts");
const { composeProfile } = await import("../src/profile/compose.ts");

const composed = async (): Promise<PluginHost> => {
  const loaded = await loadPlugins(showcaseFixture.plugins);
  const host = composeProfile(
    { product: showcaseFixture.product, pluginIds: showcaseFixture.plugins, modules: loaded.modules, web: loaded.web },
    {
      ensureSession: () => {},
      ensureWorkspaceAccess: (access, runId) => assertRunWorkspaceAccess(access, runId, policy),
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

test("Dateien-Reiter, Prozessanzeige und Sprachserver prüfen den Zugang zum Arbeitsbereich, bevor sie den Executor fragen", async () => {
  const host = await composed();
  const dispatcher = new RpcDispatcher({ methods: host.methods, channels: host.channels });
  const context = { id: 1, signal: new AbortController().signal, progress: () => undefined };
  const connectionOf = (access: AccessContext) =>
    new RpcConnection({ id: `test-${access.user?.id ?? "anonym"}`, access, local: true, peer: new RpcPeer({ send: () => undefined }) }, dispatcher);
  const snapshotMethods = host.methods.describe().map((method) => method.id).filter((id) => /^ragents\.lsp-[a-z]+\.snapshot$/.test(id));
  assert.deepEqual(snapshotMethods.sort(), ["ragents.lsp-fsharp.snapshot", "ragents.lsp-roslyn.snapshot", "ragents.lsp-typescript.snapshot"]);
  const calls = (runId: string): ReadonlyArray<readonly [string, unknown]> => [
    ["ragents.workspace.browse.list", { runId, root: "workspace", path: "" }],
    ["ragents.workspace.browse.preview", { runId, root: "workspace", path: ".env" }],
    ["ragents.processes.snapshot", { runId }],
    ["ragents.processes.stop", { runId, processId: `1-${"0".repeat(64)}` }],
    ...snapshotMethods.map((method) => [method, { runId }] as const),
  ];
  const channels = (runId: string): ReadonlyArray<readonly [string, unknown]> => [
    ["ragents.workspace.browse", { runId, root: "workspace" }],
    ["ragents.processes", { runId }],
  ];
  const attempt = async (access: AccessContext, runId: string): Promise<string[]> => {
    const connection = connectionOf(access);
    const outcomes: string[] = [];
    for (const [method, params] of calls(runId)) {
      outcomes.push(await dispatcher.dispatch(connection, method, params, context).then(() => "ok", (error: unknown) =>
        error instanceof DomainError ? error.code : String(error)));
    }
    for (const [channel, params] of channels(runId)) {
      outcomes.push(await dispatcher.dispatch(connection, "rpc.subscribe", { channel, params }, context).then(() => "ok", (error: unknown) =>
        error instanceof DomainError ? error.code : String(error)));
    }
    return outcomes;
  };
  const count = calls(BOUND).length + channels(BOUND).length;

  reached.length = 0;
  assert.deepEqual(await attempt(admin, BOUND), Array(count).fill("run-workspace-owner-only"));
  assert.deepEqual(reached, [], "admin erreicht den Executor nicht");
  const service = await attempt(hostService, BOUND);
  assert.deepEqual(service.slice(0, 2), ["run-workspace-owner-only", "run-workspace-owner-only"], "die Dienstidentität liest keine Dateien");
  assert.ok(service.every((outcome) => outcome === "run-workspace-owner-only" || outcome === "access-denied"), service.join(", "));
  assert.deepEqual(reached, [], "die Dienstidentität erreicht den Executor nicht");

  reached.length = 0;
  await attempt(alice, BOUND);
  assert.ok(reached.length >= calls(BOUND).length, `der Eigentümer erreicht den Executor: ${reached.join(", ")}`);

  reached.length = 0;
  const open = await attempt(admin, OPEN);
  assert.ok(!open.includes("run-workspace-owner-only"), open.join(", "));
  assert.ok(reached.length > 0, "einen gewöhnlichen Run liest auch runs.read.all");

  const files = await dispatcher.dispatch(connectionOf(admin), "ragents.workspace.browse.list", { runId: BOUND, root: "files", path: "" }, context)
    .then(() => "ok", (error: unknown) => error instanceof DomainError ? error.code : String(error));
  assert.notEqual(files, "run-workspace-owner-only", "die Dateiablage des Servers gehört nicht zum Arbeitsbereich");
});

test("den Arbeitsbereich eines Runs, den nur sein Eigentümer bedient, erreicht auch lesend nur er", () => {
  assert.doesNotThrow(() => assertRunWorkspaceAccess(alice, BOUND, policy));
  assert.doesNotThrow(() => assertRunWorkspaceAccess(anonymous, BOUND, policy), "ohne Anmeldung gibt es genau einen Zugang");
  for (const other of [admin, hostService]) {
    assert.throws(() => assertRunWorkspaceAccess(other, BOUND, policy), (error: unknown) =>
      error instanceof DomainError && error.code === "run-workspace-owner-only" && error.status === 403);
    assert.doesNotThrow(() => assertRunWorkspaceAccess(other, OPEN, policy), "ein gewöhnlicher Run bleibt für runs.read.all lesbar");
  }
});
