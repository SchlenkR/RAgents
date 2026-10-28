import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
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
  WORKSPACE_ACCESS_OPTION_ID,
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
  const createRun = (runId: string, ownerUserId: string, level: JsonValue = "isolated", binding: WorkspaceBinding = { machine: "server", folder: "fresh" }) => {
    orchestration.createRun({ commandId: `create:${runId}` }, {
      runId, title: runId, ownerHandle: "owner", ownerDisplayName: "Owner", ownerUserId,
      initialPluginStates: [
        { pluginId: WORKSPACE_ACCESS_OPTION_ID, state: level },
        { pluginId: WORKSPACE_BINDING_OPTION_ID, state: binding as unknown as JsonValue },
      ],
    });
  };
  return { root, host, runtime, orchestration, starts, folders, launches, sandboxes, createRun };
};

test("every owner defaults to isolated in every process sandbox mode", async (t) => {
  for (const mode of [undefined, "auto", "off", "on"]) {
    await t.test(mode ?? "default", async (context) => {
      const f = await fixture(context, mode);
      for (const [runId, owner] of [
        ["employee", "employee"],
        ["administrator", "administrator"],
        ["unknown-owner", "removed-user"],
      ] as const) f.createRun(runId, owner);
      await f.host.lifecycle.initialize();
      assert.equal(f.starts.length, mode === "on" ? 1 : 0);
      for (const runId of ["employee", "administrator", "unknown-owner"]) {
        assert.deepEqual(f.host.service(runSecurityPolicyToken)(runId), { restricted: true, level: "isolated" });
        const processContext = await f.runtime.sandbox.serverProcessContextFor(runId);
        assert.equal(processContext.sandbox, f.sandboxes.get(runId));
        assert.ok(processContext.sandbox);
        assert.deepEqual(processContext.browserNetwork, { allowedOrigins: [] });
        assert.equal(processContext.access.level, "isolated");
        assert.equal(processContext.env.NUGET_PACKAGES,
          path.join(f.root, "sessions", runId, "plugins", "ragents.workspace", "home", ".nuget", "packages"));
        assert.ok(f.folders.at(-1)!.value.writable.every((directory) => !directory.endsWith("nuget-cache")));
      }
      assert.equal(f.starts.length, 1);
      assert.notEqual(f.sandboxes.get("employee"), f.sandboxes.get("administrator"));
    });
  }
});

test("full server access removes the process and file boundaries only for an authorized owner", async (t) => {
  for (const mode of [undefined, "auto", "off"]) {
    await t.test(mode ?? "default", async (context) => {
      const f = await fixture(context, mode);
      f.createRun("administrator", "administrator", "full");
      const processContext = await f.runtime.sandbox.serverProcessContextFor("administrator");
      assert.deepEqual(f.host.service(runSecurityPolicyToken)("administrator"), { restricted: false, level: "full" });
      assert.equal(processContext.sandbox, undefined);
      assert.equal(processContext.browserNetwork, undefined);
      assert.equal(processContext.access.level, "full");
      assert.ok(processContext.env.NUGET_PACKAGES?.endsWith("nuget-cache"));
      assert.equal(processContext.env.SSH_AUTH_SOCK, undefined);
      assert.deepEqual(f.starts, []);
      const foreign = path.join(f.root, "outside.txt");
      await writeFile(foreign, "Outside fixture");
      const result = await f.runtime.sandbox.execute("administrator", "read", { file_path: foreign, seen: null });
      assert.match(JSON.stringify(result), /Outside fixture/);
      const written = path.join(f.root, "outside-new.txt");
      await f.runtime.sandbox.execute("administrator", "write", { file_path: written, content: "Written outside", seen: null });
      assert.equal(await readFile(written, "utf8"), "Written outside");
      f.createRun("isolated", "administrator");
      await assert.rejects(f.runtime.sandbox.execute("isolated", "read", { file_path: foreign, seen: null }), /outside the working directory/);
    });
  }
});

test("an invalid mode, malformed stored access or unauthorized full access fails closed", async (t) => {
  assert.throws(() => withMode("invalid", processSandboxSetting), /PROCESS_SANDBOX/);
  const f = await fixture(t);
  for (const [index, value] of [false, true, "unrestricted", 0, null, {}, []].entries()) {
    const runId = `invalid-${index}`;
    f.createRun(runId, "administrator", value as JsonValue);
    const invalid = (error: unknown) => error instanceof DomainError && error.code === "workspace-access-invalid" && error.status === 409;
    assert.throws(() => f.host.service(runSecurityPolicyToken)(runId), invalid);
    await assert.rejects(f.runtime.sandbox.serverProcessContextFor(runId), invalid);
  }
  f.createRun("employee-full", "employee", "full");
  const forbidden = (error: unknown) => error instanceof DomainError && error.code === "workspace-access-forbidden" && error.status === 403;
  assert.throws(() => f.host.service(runSecurityPolicyToken)("employee-full"), forbidden);
  await assert.rejects(f.runtime.sandbox.serverProcessContextFor("employee-full"), forbidden);
  assert.deepEqual(f.starts, []);
  assert.deepEqual(f.folders, []);
});

test("browser origins and server contexts follow changed access immediately", async (t) => {
  const f = await fixture(t);
  f.createRun("employee", "employee");
  f.createRun("administrator", "administrator", "full");
  let origins = ["http://127.0.0.1:40000"];
  f.runtime.sandbox.registerBrowserOrigins(() => origins);
  assert.deepEqual(f.runtime.sandbox.browserNetworkFor("employee"), { allowedOrigins: origins });
  assert.equal(f.runtime.sandbox.browserNetworkFor("administrator"), undefined);
  const first = await f.runtime.sandbox.serverProcessContextFor("employee");
  origins = ["http://127.0.0.1:40001"];
  const second = await f.runtime.sandbox.serverProcessContextFor("employee");
  assert.equal(first.sandbox, second.sandbox);
  assert.ok(second.sandbox);
  assert.deepEqual(first.browserNetwork, { allowedOrigins: ["http://127.0.0.1:40000"] });
  assert.deepEqual(second.browserNetwork, { allowedOrigins: origins });
  const administrator = f.orchestration.state("administrator");
  f.orchestration.replacePluginState({ actorId: administrator.ownerId, commandId: "replace-access" }, "administrator", {
    pluginId: WORKSPACE_ACCESS_OPTION_ID, scope: { kind: "run" }, state: "isolated",
  });
  assert.deepEqual(f.runtime.sandbox.browserNetworkFor("administrator"), { allowedOrigins: origins });
  const isolated = await f.runtime.sandbox.serverProcessContextFor("administrator");
  assert.ok(isolated.sandbox);
  assert.equal(isolated.access.level, "isolated");
  assert.equal(isolated.env.NUGET_PACKAGES,
    path.join(f.root, "sessions", "administrator", "plugins", "ragents.workspace", "home", ".nuget", "packages"));
});

test("an administrator with a forced sandbox can still use an explicitly selected server folder", async (t) => {
  const f = await fixture(t, "on");
  const project = path.join(f.root, "project");
  await mkdir(project);
  const binding = { machine: "server", folder: { path: project } } as const;
  assert.deepEqual(f.host.startOptions.accept(WORKSPACE_BINDING_OPTION_ID, binding,
    { runId: "administrator-bound", userId: "administrator" }), binding);
  f.createRun("administrator-bound", "administrator", "isolated", binding);
  assert.equal((await f.runtime.resolve("administrator-bound", () => undefined)).cwd, project);
  const processContext = await f.runtime.sandbox.serverProcessContextFor("administrator-bound");
  assert.equal(processContext.cwd, project);
  assert.ok(processContext.sandbox);
  assert.ok(f.folders.at(-1)!.value.writable.includes(project));
});

test("required isolated server access is visible and full access is refused even for an administrator", async (t) => {
  const f = await fixture(t, "on");
  const context = { runId: "embedded", userId: "administrator" };
  const option = f.host.startOptions.entry(WORKSPACE_ACCESS_OPTION_ID)!.option;
  assert.equal(await option.defaultValue(context), "isolated");
  assert.deepEqual(await option.describe("isolated", context), {
    kind: "workspace-access", machine: "server", commandIsolation: "isolated", fullAccessDisabledReason: "The server requires isolated access (PROCESS_SANDBOX=on).",
  });
  const forbidden = (error: unknown) => error instanceof DomainError && error.code === "workspace-access-forbidden" && error.status === 403;
  assert.throws(() => f.host.startOptions.accept(WORKSPACE_ACCESS_OPTION_ID, "full", context), forbidden);
  f.createRun("embedded", "administrator", "full");
  await assert.rejects(f.runtime.sandbox.serverProcessContextFor("embedded"), forbidden);
});

test("full workstation access for an employee keeps every server process and file context isolated", async (t) => {
  const f = await fixture(t, "on");
  const runId = "full-workstation";
  f.createRun(runId, "employee", "full", {
    machine: { client: "client-00000001", label: "Workstation" }, folder: { path: "/home/user/project" },
  });
  assert.deepEqual(f.host.service(runSecurityPolicyToken)(runId), { restricted: false, level: "full" });
  assert.deepEqual(f.runtime.sandbox.browserNetworkFor(runId), { allowedOrigins: [] });
  const context = await f.runtime.sandbox.serverProcessContextFor(runId);
  assert.ok(context.sandbox);
  assert.equal(context.access.level, "isolated");
  assert.equal(context.env.NUGET_PACKAGES,
    path.join(f.root, "sessions", runId, "plugins", "ragents.workspace", "home", ".nuget", "packages"));
  const foreign = path.join(f.root, "outside.txt");
  await writeFile(foreign, "Outside fixture");
  const notes = path.join(f.root, "notes");
  await mkdir(notes);
  f.runtime.sandbox.registerWorkspaceRoot({ id: "notes", alias: "@notes", directoryFor: () => notes });
  await assert.rejects(f.runtime.sandbox.execute(runId, "read", { file_path: "@notes/../outside.txt", seen: null }), /outside the working directory/);
});

test("a supplied bootstrap workspace avoids resolver recursion and registered roots without changing the run's cached context", async (t) => {
  const f = await fixture(t);
  const runId = "bootstrap-workstation";
  f.createRun(runId, "employee", "isolated", {
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
  f.createRun("employee-workstation", "employee", "isolated", {
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

test("initial access prompts stay unchanged while the first model call reports any later change", async (t) => {
  const f = await fixture(t);
  const runId = "prompt-access";
  f.createRun(runId, "administrator");
  const prompts = f.host.prompts.runOverrides(runId);
  assert.match(prompts.get("ragents.workspace.access.prompt") ?? "", /Isolated access on the server/);
  assert.match(prompts.get("ragents.workspace.shell.prompt") ?? "", /Isolated access on the server/);
  const replace = (level: "isolated" | "full") => {
    const state = f.orchestration.state(runId);
    f.orchestration.replacePluginState({ actorId: state.ownerId, commandId: `access:${state.revision}` }, runId, {
      pluginId: WORKSPACE_ACCESS_OPTION_ID, scope: { kind: "run" }, state: level,
    });
  };
  const kept: JsonValue[] = [];
  const hook = () => f.host.agentRuntime.resolve({ runId, agentId: "coordinator", audience: "coordinator", workspace: "/unused" })
    .find((entry) => entry.id === "ragents.workspace.access-note")!.beforeModelCall!;
  const call = () => ({ signal: undefined, modelReadsImages: false, kept: kept.at(-1), keep: (value: JsonValue) => { kept.push(value); } });
  replace("full");
  assert.deepEqual(f.host.prompts.runOverrides(runId), prompts);
  assert.match((await hook()(call()))!, /Run access changed.*Full access on the server/);
  assert.equal(await hook()(call()), undefined);
  replace("isolated");
  assert.deepEqual(f.host.prompts.runOverrides(runId), prompts);
  assert.match((await hook()(call()))!, /Run access changed.*Isolated access on the server/);
  f.createRun("initial-full", "administrator", "full");
  const fullPrompts = f.host.prompts.runOverrides("initial-full");
  assert.match(fullPrompts.get("ragents.workspace.access.prompt") ?? "", /Full access on the server/);
  const fullHook = f.host.agentRuntime.resolve({ runId: "initial-full", agentId: "coordinator", audience: "coordinator", workspace: "/unused" })
    .find((entry) => entry.id === "ragents.workspace.access-note")!.beforeModelCall!;
  assert.equal(await fullHook({ signal: undefined, modelReadsImages: false, kept: undefined, keep: () => undefined }), undefined);
});

test("isolated native execution stays sandboxed with process sandbox off and with a full workstation run", async (t) => {
  const f = await fixture(t, "off");
  const build = path.join(f.root, "build");
  await mkdir(build);
  f.createRun("administrator-isolated", "administrator");
  f.createRun("administrator-full", "administrator", "full");
  f.createRun("workstation-full", "administrator", "full", {
    machine: { client: "client-00000001", label: "Workstation" }, folder: { path: "/home/user/project" },
  });
  for (const runId of ["administrator-isolated", "workstation-full"]) {
    const context = await f.runtime.sandbox.isolatedProcessContextFor(runId, [build], []);
    assert.ok(context.sandbox, `${runId} must not inherit the full server process policy`);
  }
  const full = await f.runtime.sandbox.isolatedProcessContextFor("administrator-full", [build], []);
  assert.equal(full.sandbox, undefined);
});

test("changing access attempts native and workspace cleanup even when one fails", async (t) => {
  const f = await fixture(t);
  f.createRun("cleanup", "administrator", "full");
  const native = t.mock.method(f.orchestration, "stopNativeProcesses", async () => { throw new Error("Native cleanup failed"); });
  const workspace = t.mock.method(f.runtime, "accessChanged", async () => undefined);
  const changed = f.host.startOptions.entry(WORKSPACE_ACCESS_OPTION_ID)!.option.changed!;
  await assert.rejects(changed("isolated", { runId: "cleanup", userId: "administrator" }) as Promise<void>, /Native cleanup failed/);
  assert.equal(native.mock.callCount(), 1);
  assert.equal(workspace.mock.callCount(), 1);
});

test("returning a server run to isolated ends its full-access background process", { skip: process.platform === "win32" }, async (t) => {
  const f = await fixture(t);
  const runId = "access-process";
  f.createRun(runId, "administrator", "full");
  const context = await f.runtime.sandbox.serverProcessContextFor(runId);
  const pidFile = path.join(context.root, "background.pid");
  const command = `echo $$ > '${pidFile}'; sleep 30`;
  await f.runtime.sandbox.execute(runId, "bash", { command, run_in_background: true, startedBy: "worker" });
  let pid = 0;
  for (let attempt = 0; attempt < 200 && pid === 0; attempt++) {
    pid = Number(await readFile(pidFile, "utf8").catch(() => "0"));
    if (pid === 0) await new Promise((resolve) => setTimeout(resolve, 10));
  }
  assert.ok(pid > 0);
  process.kill(pid, 0);
  const state = f.orchestration.state(runId);
  f.orchestration.replacePluginState({ actorId: state.ownerId, commandId: "isolate" }, runId, {
    pluginId: WORKSPACE_ACCESS_OPTION_ID, scope: { kind: "run" }, state: "isolated",
  });
  await f.host.startOptions.entry(WORKSPACE_ACCESS_OPTION_ID)!.option.changed!("isolated", { runId, userId: "administrator" });
  assert.throws(() => process.kill(pid, 0), (error: unknown) => (error as NodeJS.ErrnoException).code === "ESRCH");
  assert.ok((await f.runtime.sandbox.serverProcessContextFor(runId)).sandbox);
});
