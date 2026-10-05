import assert from "node:assert/strict";
import { mkdir, mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test, { type TestContext } from "node:test";
import {
  createAccessContext,
  DomainError,
  Journal,
  Orchestration,
  PluginHost,
  type JsonValue,
  type NativeTypeScriptRequest,
} from "@ragents/engine";
import { type ProcessLaunch, type ProcessSandbox } from "@ragents/workspace-executor";
import { scriptProgram } from "../../../packages/ragents/tests/native-executor.ts";
import { testServices } from "../../../packages/ragents/tests/support.ts";
import {
  WORKSPACE_BINDING_OPTION_ID,
  WORKSPACE_SANDBOX_OPTION_ID,
  type WorkspaceBinding,
} from "../../../plugins/ragents.workspace/contract.ts";
import { runSecurityPolicyToken } from "../../../plugins/ragents.workspace/server/contract.ts";
import { processSandboxSetting } from "../../../plugins/ragents.workspace/server/config.ts";
import { plugin as workspacePlugin } from "../../../plugins/ragents.workspace/server/index.ts";
import type { RunWorkspaceRuntime } from "../../../plugins/ragents.workspace/server/runtime.ts";
import { NodeTypeScriptExecutor } from "../src/plugin-support/native-typescript-executor.ts";
import { ServerProcessSandbox, type RunSandboxFolders } from "../src/plugin-support/process-sandbox.ts";
import {
  executorContributionsToken,
  hostAddressToken,
  runGuardToken,
  runOwnerAccessToken,
  runWorkspaceProviderToken,
  runtimeProviderToken,
  userAccessToken,
  workspaceGuardToken,
} from "../src/ragents/host-services.ts";
import { workspaceRuntimeToken, type SessionWorkspace } from "../src/ragents/workspace-runtime.ts";

const accessFor = (userId: string | null) => createAccessContext({
  enabled: true,
  user: userId === null ? null : {
    id: userId,
    label: userId,
    rights: userId === "administrator" ? ["*"] : userId === "employee" ? ["runs.read", "runs.write", "runs.create"] : [],
  },
});

const withMode = <T>(mode: string | undefined, action: () => T): T => {
  const previous = process.env.PROCESS_SANDBOX;
  if (mode === undefined) delete process.env.PROCESS_SANDBOX;
  else process.env.PROCESS_SANDBOX = mode;
  try { return action(); }
  finally {
    if (previous === undefined) delete process.env.PROCESS_SANDBOX;
    else process.env.PROCESS_SANDBOX = previous;
  }
};

const fixture = async (t: TestContext, mode?: string) => {
  const root = await realpath(await mkdtemp(path.join(tmpdir(), "ragents-workspace-security-")));
  const services = testServices();
  const journal = new Journal(":memory:", services);
  const orchestration = new Orchestration(journal, services);
  const host = new PluginHost({ product: { id: "test", title: "Test" }, dataDirectory: root });
  const starts: number[] = [];
  const folders: { runId: string; value: RunSandboxFolders }[] = [];
  const launches: { runId: string; value: ProcessLaunch }[] = [];
  const sandboxes = new Map<string, ProcessSandbox>();
  t.mock.method(ServerProcessSandbox.prototype, "start", async () => { starts.push(1); });
  t.mock.method(ServerProcessSandbox.prototype, "stop", async () => undefined);
  t.mock.method(ServerProcessSandbox.prototype, "forRun", (value: RunSandboxFolders) => {
    const runId = path.basename(path.dirname(value.temporary));
    folders.push({ runId, value });
    let sandbox = sandboxes.get(runId);
    if (!sandbox) {
      sandbox = { wrap: async (launch) => {
        launches.push({ runId, value: launch });
        throw new Error(`Sandbox launch observed for ${runId}`);
      } };
      sandboxes.set(runId, sandbox);
    }
    return sandbox;
  });
  let runtime: RunWorkspaceRuntime;
  host.provideHost(runWorkspaceProviderToken, (runId) => runtime.resolve(runId, () => undefined));
  host.provideHost(runtimeProviderToken, () => orchestration);
  host.provideHost(runOwnerAccessToken, (runId) => accessFor(orchestration.state(runId).ownerUserId));
  host.provideHost(userAccessToken, accessFor);
  host.provideHost(hostAddressToken, () => undefined);
  host.provideHost(executorContributionsToken, []);
  host.provideHost(runGuardToken, (runId) => { orchestration.state(runId); });
  host.provideHost(workspaceGuardToken, () => undefined);
  withMode(mode, () => host.register(workspacePlugin.create(host)));
  host.seal();
  runtime = host.service(workspaceRuntimeToken) as RunWorkspaceRuntime;
  t.after(async () => {
    try { await host.lifecycle.shutdown(); }
    finally { journal.close(); await rm(root, { recursive: true, force: true }); }
  });
  const createRun = (runId: string, ownerUserId: string, sandbox: JsonValue = false, binding: WorkspaceBinding = { machine: "server", folder: "fresh" }) => {
    orchestration.createRun({ commandId: `create:${runId}` }, {
      runId, title: runId, ownerHandle: "owner", ownerDisplayName: "Owner", ownerUserId,
      initialPluginStates: [
        { pluginId: WORKSPACE_SANDBOX_OPTION_ID, state: sandbox },
        { pluginId: WORKSPACE_BINDING_OPTION_ID, state: binding as unknown as JsonValue },
      ],
    });
  };
  return { root, host, runtime, orchestration, starts, folders, launches, sandboxes, createRun };
};

test("default, auto and off keep nonadministrator runs restricted; on also forces administrators", async (t) => {
  for (const mode of [undefined, "auto", "off", "on"]) {
    await t.test(mode ?? "default", async (context) => {
      const f = await fixture(context, mode);
      for (const [runId, owner, choice] of [
        ["employee", "employee", false],
        ["administrator", "administrator", false],
        ["administrator-restricted", "administrator", true],
        ["unknown-owner", "removed-user", false],
      ] as const) f.createRun(runId, owner, choice);
      await f.host.lifecycle.initialize();
      assert.equal(f.starts.length, mode === "on" ? 1 : 0, "automatic mode starts the process sandbox only when required");
      const administrator = await f.runtime.sandbox.serverProcessContextFor("administrator");
      assert.equal(administrator.sandbox === undefined, mode !== "on");
      assert.equal(administrator.env.NUGET_PACKAGES?.endsWith("nuget-cache"), mode !== "on");
      assert.equal(f.starts.length, mode === "on" ? 1 : 0);
      for (const runId of ["employee", "administrator-restricted", "unknown-owner"]) {
        assert.deepEqual(f.host.service(runSecurityPolicyToken)(runId), { restricted: true });
        const processContext = await f.runtime.sandbox.serverProcessContextFor(runId);
        assert.equal(processContext.sandbox, f.sandboxes.get(runId));
        assert.ok(processContext.sandbox);
        assert.deepEqual(processContext.browserNetwork, { allowedOrigins: [] });
        assert.equal(processContext.env.NUGET_PACKAGES,
          path.join(f.root, "sessions", runId, "plugins", "ragents.workspace", "home", ".nuget", "packages"));
        assert.ok(f.folders.at(-1)!.value.writable.every((directory) => !directory.endsWith("nuget-cache")));
      }
      assert.equal(f.starts.length, 1, "runs share initialization, while each context receives its own sandbox");
      assert.notEqual(f.sandboxes.get("employee"), f.sandboxes.get("administrator-restricted"));
      assert.deepEqual(f.host.service(runSecurityPolicyToken)("administrator"), { restricted: mode === "on" });
      assert.equal(administrator.browserNetwork === undefined, mode !== "on");
    });
  }
});

test("an invalid sandbox mode or stored choice fails instead of allowing unrestricted execution", async (t) => {
  assert.throws(() => withMode("invalid", processSandboxSetting), /PROCESS_SANDBOX/);
  const f = await fixture(t);
  for (const [index, value] of ["false", 0, null, {}, []].entries()) {
    const runId = `invalid-${index}`;
    f.createRun(runId, "administrator", value as JsonValue);
    const invalid = (error: unknown) => error instanceof DomainError && error.code === "workspace-sandbox-invalid" && error.status === 409;
    assert.throws(() => f.host.service(runSecurityPolicyToken)(runId), invalid);
    await assert.rejects(f.runtime.sandbox.serverProcessContextFor(runId), invalid);
  }
  assert.deepEqual(f.starts, []);
  assert.deepEqual(f.folders, []);
});

test("browser origins and the server process context follow the run owner even after stored state is changed", async (t) => {
  const f = await fixture(t);
  f.createRun("employee", "employee", true);
  f.createRun("administrator", "administrator", false);
  let origins = ["http://127.0.0.1:40000"];
  f.runtime.sandbox.registerBrowserOrigins(() => origins);
  const employee = f.orchestration.state("employee");
  f.orchestration.replacePluginState({ actorId: employee.ownerId, commandId: "replace-sandbox-choice" }, "employee", {
    pluginId: WORKSPACE_SANDBOX_OPTION_ID, scope: { kind: "run" }, state: false,
  });
  assert.equal(f.orchestration.state("employee").ownerUserId, "employee");
  assert.deepEqual(f.runtime.sandbox.browserNetworkFor("employee"), { allowedOrigins: origins });
  assert.equal(f.runtime.sandbox.browserNetworkFor("administrator"), undefined);
  const first = await f.runtime.sandbox.serverProcessContextFor("employee");
  origins = ["http://127.0.0.1:40001"];
  const second = await f.runtime.sandbox.serverProcessContextFor("employee");
  assert.equal(first.sandbox, second.sandbox);
  assert.ok(second.sandbox);
  assert.deepEqual(first.browserNetwork, { allowedOrigins: ["http://127.0.0.1:40000"] });
  assert.deepEqual(second.browserNetwork, { allowedOrigins: origins });
});

test("an administrator with a forced sandbox can still use an explicitly selected server folder", async (t) => {
  const f = await fixture(t, "on");
  const project = path.join(f.root, "project");
  await mkdir(project);
  const binding = { machine: "server", folder: { path: project } } as const;
  assert.deepEqual(f.host.startOptions.accept(WORKSPACE_BINDING_OPTION_ID, binding,
    { runId: "administrator-bound", userId: "administrator" }), binding);
  f.createRun("administrator-bound", "administrator", false, binding);
  assert.equal((await f.runtime.resolve("administrator-bound", () => undefined)).cwd, project);
  const processContext = await f.runtime.sandbox.serverProcessContextFor("administrator-bound");
  assert.equal(processContext.cwd, project);
  assert.ok(processContext.sandbox);
  assert.ok(f.folders.at(-1)!.value.writable.includes(project));
});

test("a supplied bootstrap workspace avoids resolver recursion and registered roots without changing the run's cached context", async (t) => {
  const f = await fixture(t);
  const runId = "bootstrap-workstation";
  f.createRun(runId, "employee", false, {
    machine: { client: "client-00000001", label: "Workstation" }, folder: { path: "/home/example/project" },
  });
  const bootstrap = path.join(f.root, "bootstrap");
  const firstHome = path.join(f.root, "first-bootstrap-home");
  const secondHome = path.join(f.root, "second-bootstrap-home");
  const readable = path.join(f.root, "bootstrap-read");
  const notes = path.join(f.root, "notes");
  await Promise.all([bootstrap, firstHome, secondHome, readable, notes].map((directory) => mkdir(directory)));
  let rootCalls = 0;
  f.runtime.sandbox.registerWorkspaceRoot({ id: "notes", alias: "@notes", directoryFor: () => { rootCalls++; return notes; } });
  f.runtime.sandbox.registerBrowserOrigins(() => ["http://127.0.0.1:40000"]);
  let suppliedRootCalls = 0;
  const supplied: SessionWorkspace = {
    cwd: bootstrap,
    hostSandbox: { home: firstHome, readOnlyRoots: [{ directory: readable, alias: "@bootstrap-read" }] },
    extraEnv: { RAGENTS_BOOTSTRAP_MARKER: "bootstrap" },
    currentRoot: async () => { suppliedRootCalls++; return bootstrap; },
    runOperation: (operation) => operation(),
  };
  const resolve = t.mock.method(f.runtime, "resolve", async () => { throw new Error("Bootstrap must not resolve the run's workspace"); });
  const first = await f.runtime.sandbox.serverProcessContextForWorkspace(runId, supplied);
  assert.equal(resolve.mock.callCount(), 0);
  assert.equal(rootCalls, 0);
  assert.equal(suppliedRootCalls, 1);
  assert.equal(first.cwd, bootstrap);
  assert.equal(first.root, bootstrap);
  assert.equal(first.env.HOME, firstHome);
  assert.equal(first.env.RAGENTS_BOOTSTRAP_MARKER, "bootstrap");
  assert.deepEqual(first.additionalRoots, []);
  assert.deepEqual(first.browserNetwork, { allowedOrigins: ["http://127.0.0.1:40000"] });
  assert.ok(first.sandbox);
  assert.equal(first.workspaceAliases?.["@notes"], undefined);
  assert.equal(first.workspaceAliases?.["@bootstrap-read"], readable);
  const allowed = f.folders.at(-1)!.value;
  assert.ok(allowed.writable.includes(bootstrap));
  assert.ok(allowed.writable.includes(firstHome));
  assert.ok(allowed.readable.includes(readable));
  assert.ok(![...allowed.writable, ...allowed.readable].includes(notes));
  resolve.mock.restore();
  const normal = await f.runtime.sandbox.serverProcessContextFor(runId);
  const regularHome = path.join(f.root, "sessions", runId, "plugins", "ragents.workspace", "home");
  assert.equal(normal.env.HOME, regularHome);
  assert.equal(normal.env.RAGENTS_BOOTSTRAP_MARKER, undefined);
  assert.equal(normal.workspaceAliases?.["@notes"], notes);
  assert.equal(normal.workspaceAliases?.["@bootstrap-read"], undefined);
  assert.ok(normal.cwd.endsWith(path.join("ragents.workspace", "server")));
  assert.ok(rootCalls > 0);
  const beforeSecond = rootCalls;
  const second = await f.runtime.sandbox.serverProcessContextForWorkspace(runId, {
    ...supplied, hostSandbox: { home: secondHome, readOnlyRoots: [] },
  });
  assert.equal(rootCalls, beforeSecond);
  assert.equal(second.env.HOME, secondHome);
  assert.equal(second.workspaceAliases?.["@bootstrap-read"], undefined);
  assert.deepEqual(second.additionalRoots, []);
  assert.equal((await f.runtime.sandbox.serverProcessContextFor(runId)).env.HOME, regularHome);
});

test("server TypeScript and a workstation run's server aliases both reach the selected process sandbox", async (t) => {
  const f = await fixture(t);
  f.createRun("employee-server", "employee");
  f.createRun("employee-workstation", "employee", false, {
    machine: { client: "client-00000001", label: "Workstation" }, folder: { path: "/home/example/project" },
  });
  const notes = path.join(f.root, "notes");
  await mkdir(notes);
  f.runtime.sandbox.registerWorkspaceRoot({ id: "notes", alias: "@notes", directoryFor: () => notes });
  const native = new NodeTypeScriptExecutor({
    directoryFor: (runId) => path.join(f.root, "sessions", runId, "programs"),
    serverProcessContextFor: (runId) => f.runtime.sandbox.serverProcessContextFor(runId),
  });
  t.after(() => native.shutdown());
  for (const runId of ["employee-server", "employee-workstation"]) {
    const request: NativeTypeScriptRequest = {
      program: scriptProgram("export const handle = () => 'fixture';"), input: {},
      context: { runId, invocationId: "test", invocationKind: "tool", principal: { id: "worker", kind: "agent" }, capabilities: [] },
    };
    await assert.rejects(native.execute(request, { call: async () => { throw new Error("No capability expected"); }, log: () => undefined }),
      new RegExp(`Sandbox launch observed for ${runId}`));
  }
  await assert.rejects(f.runtime.sandbox.execute("employee-workstation", "bash", { cwd: "@notes", command: "true" }),
    /Sandbox launch observed for employee-workstation/);
  assert.deepEqual(f.launches.map((entry) => entry.runId), ["employee-server", "employee-workstation", "employee-workstation"]);
  for (const launch of f.launches.slice(0, 2)) {
    assert.equal(launch.value.command, process.execPath);
    assert.ok(launch.value.args.some((argument) => argument.endsWith("__runner.mjs")));
  }
  const workstationFolders = f.folders.filter((entry) => entry.runId === "employee-workstation");
  assert.ok(workstationFolders.length > 0);
  for (const { value } of workstationFolders) {
    assert.ok(value.writable.includes(notes));
    assert.ok(value.writable.some((directory) => directory.endsWith(path.join("ragents.workspace", "server"))));
    assert.ok(!value.writable.includes("/home/example/project"));
  }
});
