import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test, { type TestContext } from "node:test";
import { Value } from "typebox/value";
import {
  createAccessContext,
  DomainError,
  Journal,
  MethodContributionRegistry,
  Orchestration,
  PluginHost,
  type JsonValue,
  type PluginContext,
  type RunFunction,
  type RunState,
  type ToolScope,
} from "@ragents/engine";
import {
  ACCESS_OPERATIONS,
  WorkspaceOperationExecutor,
  WORKSPACE_EXECUTOR_VERSION,
  type ProcessSandbox,
  workspaceExecutorModules,
  workspaceProcessContext,
  type WorkspaceGrantPolicy,
} from "@ragents/workspace-executor";
import { allGrants, manualExecution, testServices } from "../../../packages/ragents/tests/support.ts";
import { WORKSPACE_ACCESS_OPTION_ID, WORKSPACE_BINDING_OPTION_ID, WORKSPACE_GRANTS_STATE_ID, workspaceContracts, type WorkspaceBinding } from "../../../plugins/ragents.workspace/contract.ts";
import {
  ACCESS_REQUESTED,
  WorkspaceAccessRequests,
  accessRequestMethods,
  grantsOf,
  requestAccessTool,
} from "../../../plugins/ragents.workspace/server/grants.ts";
import { enqueueAndClaim } from "./runtime-fixture.ts";
import { dispatchMethod, methodContext } from "./rpc-fixture.ts";
import { plugin as workspacePlugin } from "../../../plugins/ragents.workspace/server/index.ts";
import type { RunWorkspaceRuntime } from "../../../plugins/ragents.workspace/server/runtime.ts";
import { ServerProcessSandbox, type RunSandboxFolders } from "../src/plugin-support/process-sandbox.ts";
import {
  executorContributionsToken, hostAddressToken, runGuardToken, runOwnerAccessToken,
  runWorkspaceProviderToken, runtimeProviderToken, userAccessToken, workspaceGuardToken,
} from "../src/ragents/host-services.ts";
import { workspaceRuntimeToken } from "../src/ragents/workspace-runtime.ts";

const settled = () => new Promise<void>((resolve) => setImmediate(resolve));

const accessFor = (userId = "alice") => createAccessContext({
  enabled: true,
  user: { id: userId, label: userId, rights: userId === "administrator" ? ["*"] : ["runs.read", "runs.write"] },
});

const fixture = async (t: TestContext, disk = false) => {
  const root = await realpath(await mkdtemp(path.join(tmpdir(), "ragents-access-requests-")));
  const workspace = path.join(root, "workspace");
  const outside = path.join(root, "outside");
  const data = path.join(root, "data");
  await Promise.all([workspace, outside, data].map((directory) => mkdir(directory)));
  const file = path.join(outside, "note.txt");
  await writeFile(file, "Outside content\n");
  await writeFile(path.join(outside, "other.txt"), "Other content\n");
  const services = testServices();
  const journalDirectory = disk ? path.join(data, "journals") : ":memory:";
  let journal = new Journal(journalDirectory, services);
  let runtime = new Orchestration(journal, services);
  const view = runtime.createRun({ commandId: "create" }, {
    runId: "grant-run", title: "Access example", ownerHandle: "owner", ownerDisplayName: "Owner", ownerUserId: "alice",
  });
  const spawned = runtime.spawnAgent({ actorId: view.ownerId, commandId: "spawn" }, view.id, {
    handle: "worker", displayName: "Worker", prompt: "Read the requested material.", execution: manualExecution(), grants: allGrants(), toolNames: null,
  });
  const agent = spawned.actors.find((entry) => entry.kind === "agent")!;
  const turn = enqueueAndClaim(runtime, spawned, agent.id, "input", "Please inspect the reference.", "turn");
  let policy: WorkspaceGrantPolicy = { dataDirectory: data };
  let disabledReason: string | null = null;
  let bindingMachine = true;
  let beforeInspection: (() => Promise<void>) | undefined;
  const executor = new WorkspaceOperationExecutor({
    contextFor: (runId) => Promise.resolve(workspaceProcessContext({
      runId, cwd: workspace, root: workspace, home: { home: workspace }, logDirectory: workspace, hostRoot: undefined,
      access: { level: "isolated", grants: grantsOf(runtime.state(runId)) }, grantPolicy: policy,
    })),
    modules: workspaceExecutorModules({ contributions: [] }),
  });
  const options = {
    sandbox: { execute: async (runId: string, operation: string, input: unknown, call = {}) => {
      await beforeInspection?.();
      return executor.execute(runId, operation, input, call);
    } },
    policyFor: async () => policy,
    disabledReason: (_runId: string, userId: string | null) => userId !== "alice" ? "Only the run's owner may answer access requests." : disabledReason,
    onBindingMachine: () => bindingMachine,
  };
  let service = new WorkspaceAccessRequests(options);
  service.bind(runtime);
  const methods = new MethodContributionRegistry();
  methods.register("ragents.workspace", accessRequestMethods(service, (runId) => { runtime.state(runId); }));
  const scope = {
    caller: { runId: view.id, actorId: agent.id, turnId: turn.turnId },
    context: (id: string) => ({ actorId: agent.id, commandId: `request:${id}`, turnId: turn.turnId }),
  } as unknown as ToolScope;
  t.after(async () => {
    await executor.shutdown();
    journal.close();
    await rm(root, { recursive: true, force: true });
  });
  return {
    root, workspace, outside, data, file, view, agent, turn, scope, executor, methods,
    runtime: () => runtime,
    service: () => service,
    request: (id = "one", requested = file, access: "read" | "write" = "read") => requestAccessTool(service).run(scope, id, { path: requested, access, reason: "Read the reference." } as never),
    action: () => runtime.view(view.id).actions.at(-1)!,
    grants: () => grantsOf(runtime.state(view.id)),
    answer: (decision: "allow" | "allow-folder" | "deny", userId = "alice") => dispatchMethod(methods, workspaceContracts.answerAccess.id,
      { runId: view.id, actionId: runtime.view(view.id).actions.at(-1)!.id, decision }, accessFor(userId)),
    policy: (value: WorkspaceGrantPolicy) => { policy = value; },
    disable: (reason: string | null) => { disabledReason = reason; },
    machine: (value: boolean) => { bindingMachine = value; },
    inspectAfter: (operation: (() => Promise<void>) | undefined) => { beforeInspection = operation; },
    restart: async () => {
      await executor.stopRun(view.id);
      journal.close();
      journal = new Journal(journalDirectory, services);
      runtime = new Orchestration(journal, services);
      service = new WorkspaceAccessRequests(options);
      service.bind(runtime);
    },
  };
};

test("request_access describes a lean sequential turn-ending contract", async (t) => {
  const f = await fixture(t);
  const tool = requestAccessTool(f.service());
  assert.equal(tool.name, "request_access");
  assert.equal(tool.executionMode, "sequential");
  assert.equal(tool.endsTurn?.(ACCESS_REQUESTED), true);
  assert.equal(tool.endsTurn?.("The run already has the requested access."), false);
  assert.equal(Value.Check(tool.schema, { path: "../reference.txt", access: "read", reason: "Compare the design." }), true);
  for (const input of [
    { path: "x", access: "full", reason: "Compare." },
    { path: "x", access: "read" },
    { path: "x", access: "read", reason: "Compare.", token: "old" },
  ]) assert.equal(Value.Check(tool.schema, input), false);
  assert.equal(await f.request(), ACCESS_REQUESTED);
  assert.deepEqual(f.action().payload, { kind: "access-request", path: f.file, access: "read", reason: "Read the reference.", file: true });
  assert.equal(f.action().owner, "ragents.workspace");
  assert.equal(f.action().askedBy, f.agent.id);
  assert.deepEqual(f.grants(), []);
});

test("reachable paths answer at once and do not propose an action", async (t) => {
  const f = await fixture(t);
  const own = path.join(f.workspace, "local.txt");
  await writeFile(own, "Local\n");
  assert.equal(await f.request("own", "local.txt"), "The run already has the requested access.");
  assert.equal(await f.request("new", "new.txt", "write"), "The run already has the requested access.");
  assert.deepEqual(f.runtime().view(f.view.id).actions, []);
});

test("Allow journals one exact grant atomically with the resolution and notifies its actor", async (t) => {
  const f = await fixture(t);
  await f.request("relative", "../outside/note.txt");
  const count = f.runtime().view(f.view.id).inputs.length;
  await f.answer("allow");
  await settled();
  assert.deepEqual(f.grants(), [{ path: f.file, access: "read" }]);
  const events = f.runtime().events(f.view.id);
  const grantEvents = events.filter((event) => (event.type === "plugin.state-replaced" || event.type === "plugin.state-patched") && event.payload.pluginId === WORKSPACE_GRANTS_STATE_ID);
  assert.equal(grantEvents.length, 1);
  const resolved = events.find((event) => event.type === "action.resolved");
  assert.equal(resolved?.commandId, grantEvents[0]!.commandId);
  const messages = f.runtime().view(f.view.id).inputs.slice(count);
  assert.equal(messages.length, 1);
  assert.equal(messages[0]!.actorId, f.agent.id);
  assert.match(messages[0]!.content, /Access allowed \(read\)/);
  assert.match(JSON.stringify(await f.executor.execute(f.view.id, "read", { file_path: f.file })), /Outside content/);
  await assert.rejects(f.executor.execute(f.view.id, "read", { file_path: path.join(f.outside, "other.txt") }), /outside the working directory/);
  await assert.rejects(f.executor.execute(f.view.id, "write", { file_path: f.file, content: "Changed\n" }), /outside the working directory/);
});

test("Allow folder grants the containing folder and write grants include reads", async (t) => {
  const f = await fixture(t);
  await f.request("write", f.file, "write");
  await f.answer("allow-folder");
  assert.deepEqual(f.grants(), [{ path: f.outside, access: "write" }]);
  await f.executor.execute(f.view.id, "write", { file_path: path.join(f.outside, "created.txt"), content: "Created\n" });
  await f.executor.execute(f.view.id, "edit", { file_path: f.file, old_string: "Outside", new_string: "Edited" });
  assert.equal(await readFile(f.file, "utf8"), "Edited content\n");
  assert.match(JSON.stringify(await f.executor.execute(f.view.id, "read", { file_path: path.join(f.outside, "other.txt") })), /Other content/);
});

test("read access requires an existing path and write access can create a missing path", async (t) => {
  const f = await fixture(t);
  const missing = path.join(f.outside, "fresh", "new.txt");
  await assert.rejects(f.request("missing-read", missing), /ENOENT/);
  assert.deepEqual(f.runtime().view(f.view.id).actions, []);
  await f.request("missing-write", missing, "write");
  assert.equal(f.action().payload?.file, false);
  await assert.rejects(f.answer("allow-folder"), /existing file/);
  assert.equal(f.action().status, "pending");
  await f.answer("allow");
  await f.executor.execute(f.view.id, "write", { file_path: missing, content: "New\n" });
  assert.equal(await readFile(missing, "utf8"), "New\n");
  await assert.rejects(f.executor.execute(f.view.id, "write", { file_path: path.join(f.outside, "fresh", "sibling.txt"), content: "No\n" }), /outside/);
});

test("Deny leaves the files isolated and delivers the refusal", async (t) => {
  const f = await fixture(t);
  await f.request();
  await f.answer("deny");
  await settled();
  assert.deepEqual(f.grants(), []);
  assert.equal(f.action().status, "dismissed");
  assert.match(f.runtime().view(f.view.id).inputs.at(-1)!.content, /Access denied.*Do not try to work around/);
  await assert.rejects(f.executor.execute(f.view.id, "read", { file_path: f.file }), /outside/);
});

test("only the owner answers requests, including when another user is an administrator", async (t) => {
  const f = await fixture(t);
  await f.request();
  for (const user of ["bob", "administrator"]) {
    for (const decision of ["allow", "allow-folder", "deny"] as const) {
      await assert.rejects(f.answer(decision, user), /Only the run's owner/);
      assert.equal(f.action().status, "pending");
      assert.deepEqual(f.grants(), []);
    }
  }
  await f.answer("allow");
  assert.equal(f.action().status, "approved");
});

test("answer availability and the method enforce current authorization again", async (t) => {
  const f = await fixture(t);
  await f.request();
  assert.deepEqual(await dispatchMethod(f.methods, workspaceContracts.accessRequestAvailability.id, { runId: f.view.id }, accessFor()), { disabledReason: null });
  f.disable("The server requires isolated access (PROCESS_SANDBOX=on).");
  assert.deepEqual(await dispatchMethod(f.methods, workspaceContracts.accessRequestAvailability.id, { runId: f.view.id }, accessFor()),
    { disabledReason: "The server requires isolated access (PROCESS_SANDBOX=on)." });
  await assert.rejects(f.answer("allow"), /PROCESS_SANDBOX=on/);
  assert.equal(f.action().status, "pending");
  assert.deepEqual(f.grants(), []);
});

test("the generic resolver grants nothing even with a forged approval result", async (t) => {
  const f = await fixture(t);
  await f.request();
  f.runtime().resolveAction({ actorId: f.view.ownerId, commandId: "generic" }, f.view.id, f.action().id, {
    decision: "approved", result: { decision: "allow", path: f.file, access: "write" },
  });
  await settled();
  assert.deepEqual(f.grants(), []);
  assert.equal(f.runtime().view(f.view.id).inputs.at(-1)!.content, "Access request closed without granting access.");
  await assert.rejects(f.executor.execute(f.view.id, "read", { file_path: f.file }), /outside/);
});

test("requests and approvals both reject protected paths and containing folders", async (t) => {
  const f = await fixture(t);
  await assert.rejects(f.request("root", "/", "write"), /full access is required/);
  await assert.rejects(f.request("data", f.data, "write"), /full access is required/);
  await f.request();
  f.policy({ dataDirectory: f.data, protectedPaths: [f.file] });
  await assert.rejects(f.answer("allow"), /full access is required/);
  assert.equal(f.action().status, "pending");
  f.policy({ dataDirectory: f.data, protectedPaths: [path.join(f.outside, "other.txt")] });
  await assert.rejects(f.answer("allow-folder"), /full access is required/);
  assert.deepEqual(f.grants(), []);
  await f.answer("allow");
  assert.deepEqual(f.grants(), [{ path: f.file, access: "read" }]);
});

test("a file replaced by a symlink cannot redirect its approval", async (t) => {
  const f = await fixture(t);
  await f.request();
  await rm(f.file);
  await symlink(path.join(f.outside, "other.txt"), f.file);
  await assert.rejects(f.answer("allow"), /now resolves elsewhere/);
  assert.equal(f.action().status, "pending");
  assert.deepEqual(f.grants(), []);
});

test("Allow folder is rechecked against the current file kind", async (t) => {
  const f = await fixture(t);
  await f.request();
  await rm(f.file);
  await mkdir(f.file);
  await assert.rejects(f.answer("allow-folder"), /existing file/);
  assert.equal(f.action().status, "pending");
  assert.deepEqual(f.grants(), []);
});

test("a workstation request cannot widen a server alias", async (t) => {
  const f = await fixture(t);
  f.machine(false);
  await assert.rejects(f.request(), /only to the run's workspace machine/);
  assert.deepEqual(f.runtime().view(f.view.id).actions, []);
});

test("a new human message withdraws open requests without granting access", async (t) => {
  const f = await fixture(t);
  await f.request();
  f.runtime().enqueueInput({ actorId: f.view.ownerId, commandId: "new-human" }, f.view.id, {
    actorId: f.agent.id, content: "Read the local file instead.", origin: "human",
  });
  await settled();
  assert.equal(f.action().status, "dismissed");
  assert.deepEqual(f.action().result, { superseded: true });
  assert.deepEqual(f.grants(), []);
  await assert.rejects(f.answer("allow"), /already closed/);
  assert.equal(f.runtime().view(f.view.id).inputs.at(-1)!.content, "Read the local file instead.");
});

test("a human message arriving during inspection prevents a stale request", async (t) => {
  const f = await fixture(t);
  let release: () => void = () => undefined;
  const waiting = new Promise<void>((resolve) => { release = resolve; });
  f.inspectAfter(() => waiting);
  const request = f.request();
  f.runtime().enqueueInput({ actorId: f.view.ownerId, commandId: "steer" }, f.view.id, {
    actorId: f.agent.id, content: "Continue without that file.", origin: "human",
  });
  release();
  assert.equal(await request, "Access request closed by a new user message.");
  assert.deepEqual(f.runtime().view(f.view.id).actions, []);
  assert.deepEqual(f.grants(), []);
});

test("withdrawal and actor stop close requests without waking the actor", async (t) => {
  for (const stop of ["withdraw", "actor"] as const) {
    await t.test(stop, async (context) => {
      const f = await fixture(context);
      await f.request();
      const count = f.runtime().view(f.view.id).inputs.length;
      if (stop === "withdraw") f.service().withdraw(f.view.id);
      else f.runtime().stopActor({ actorId: f.view.ownerId, commandId: "stop-actor" }, f.view.id, f.agent.id, "The user stopped the actor.");
      await settled();
      assert.equal(f.action().status, "dismissed");
      assert.deepEqual(f.action().result, { withdrawn: true });
      assert.deepEqual(f.grants(), []);
      assert.equal(f.runtime().view(f.view.id).inputs.length, count);
    });
  }
});

test("journal replay restores approved grants and their file enforcement", async (t) => {
  const f = await fixture(t, true);
  await f.request();
  f.runtime().finishTurn({ actorId: f.agent.id, commandId: "finish", turnId: f.turn.turnId }, f.view.id, f.agent.id, { turnId: f.turn.turnId, outcome: "completed" });
  await f.answer("allow");
  await settled();
  const before = f.runtime().events(f.view.id).length;
  await f.restart();
  assert.deepEqual(f.grants(), [{ path: f.file, access: "read" }]);
  assert.equal(f.runtime().events(f.view.id).length, before);
  assert.equal(f.action().status, "approved");
  assert.match(JSON.stringify(await f.executor.execute(f.view.id, "read", { file_path: f.file })), /Outside content/);
  await assert.rejects(f.executor.execute(f.view.id, "write", { file_path: f.file, content: "No\n" }), /outside/);
});

test("a grant cannot bypass narrowness after the host's protected paths change", async (t) => {
  const f = await fixture(t);
  await f.request();
  await f.answer("allow");
  f.policy({ dataDirectory: f.data, protectedPaths: [f.file] });
  await assert.rejects(f.executor.execute(f.view.id, "read", { file_path: f.file }), /full access is required/);
  await assert.rejects(f.executor.execute(f.view.id, ACCESS_OPERATIONS.inspect, { path: "new.txt", access: "write" }), /full access is required/);
});

const pluginFixture = async (t: TestContext, mode = "auto", mockSandbox = true) => {
  const root = await realpath(await mkdtemp(path.join(tmpdir(), "ragents-grants-plugin-")));
  const data = path.join(root, "data");
  const outside = path.join(root, "outside");
  await mkdir(outside);
  const file = path.join(outside, "reference.txt");
  const writable = path.join(outside, "output.txt");
  await writeFile(file, "Reference\n");
  await writeFile(writable, "Output\n");
  const services = testServices();
  const journal = new Journal(":memory:", services);
  const orchestration = new Orchestration(journal, services);
  const host = new PluginHost({ product: { id: "test", title: "Test" }, dataDirectory: data });
  const policy: RunSandboxFolders[] = [];
  if (mockSandbox) {
    t.mock.method(ServerProcessSandbox.prototype, "start", async () => undefined);
    t.mock.method(ServerProcessSandbox.prototype, "stop", async () => undefined);
    t.mock.method(ServerProcessSandbox.prototype, "forRun", (folders: RunSandboxFolders): ProcessSandbox => {
      policy.push(folders);
      return { wrap: async () => { throw new Error("The fixture does not launch processes."); } };
    });
  }
  const ownerAccess = (userId: string | null) => createAccessContext({ enabled: true, user: userId === null ? null : {
    id: userId, label: userId, rights: userId === "alice" || userId === "administrator" ? ["*"] : ["runs.read", "runs.write"],
  } });
  let runtime: RunWorkspaceRuntime;
  host.provideHost(runWorkspaceProviderToken, (runId) => runtime.resolve(runId, () => undefined));
  host.provideHost(runtimeProviderToken, () => orchestration);
  host.provideHost(runOwnerAccessToken, (runId) => ownerAccess(orchestration.state(runId).ownerUserId));
  host.provideHost(userAccessToken, ownerAccess);
  host.provideHost(hostAddressToken, () => undefined);
  host.provideHost(executorContributionsToken, []);
  host.provideHost(runGuardToken, (runId) => { orchestration.state(runId); });
  host.provideHost(workspaceGuardToken, () => undefined);
  const previous = process.env.PROCESS_SANDBOX;
  process.env.PROCESS_SANDBOX = mode;
  try { host.register(workspacePlugin.create(host)); }
  finally {
    if (previous === undefined) delete process.env.PROCESS_SANDBOX;
    else process.env.PROCESS_SANDBOX = previous;
  }
  host.seal();
  runtime = host.service(workspaceRuntimeToken) as RunWorkspaceRuntime;
  t.after(async () => {
    await host.lifecycle.shutdown();
    journal.close();
    await rm(root, { recursive: true, force: true });
  });
  const createRun = async (runId: string, ownerUserId = "alice", binding: WorkspaceBinding = { machine: "server", folder: "fresh" }) => {
    const view = orchestration.createRun({ commandId: `create:${runId}` }, {
      runId, title: runId, ownerHandle: "owner", ownerDisplayName: "Owner", ownerUserId,
      initialPluginStates: [
        { pluginId: WORKSPACE_ACCESS_OPTION_ID, state: "isolated" },
        { pluginId: WORKSPACE_BINDING_OPTION_ID, state: binding as unknown as JsonValue },
      ],
    });
    await mkdir(path.join(data, "sessions", runId), { recursive: true });
    const spawned = orchestration.spawnAgent({ actorId: view.ownerId, commandId: `spawn:${runId}` }, runId, {
      handle: "worker", displayName: "Worker", prompt: "Inspect the reference.", execution: manualExecution(), grants: allGrants(), toolNames: null,
    });
    const agent = spawned.actors.find((entry) => entry.kind === "agent")!;
    const turn = enqueueAndClaim(orchestration, spawned, agent.id, `input:${runId}`, "Inspect the reference.", `turn:${runId}`);
    const contributor = host.tools.entries().find((entry) => entry.descriptors.some((tool) => tool.name === "request_access"))!;
    const tools = await contributor.tools({ runId } as PluginContext);
    const tool = tools.find((entry) => entry.name === "request_access")! as RunFunction;
    const scope = {
      caller: { runId, actorId: agent.id, turnId: turn.turnId },
      context: (id: string) => ({ actorId: agent.id, commandId: `request:${runId}:${id}`, turnId: turn.turnId }),
    } as unknown as ToolScope;
    return {
      runId, view, agent, turn,
      request: (id = "one", requested = file, access: "read" | "write" = "read") => tool.run(scope, id, { path: requested, access, reason: "Read the reference." } as never),
      action: () => orchestration.view(runId).actions.at(-1)!,
      answer: (decision: "allow" | "allow-folder" | "deny", user = ownerUserId) => dispatchMethod(host.methods, workspaceContracts.answerAccess.id,
        { runId, actionId: orchestration.view(runId).actions.at(-1)!.id, decision }, ownerAccess(user)),
      availability: (user = ownerUserId) => dispatchMethod(host.methods, workspaceContracts.accessRequestAvailability.id, { runId }, ownerAccess(user)),
    };
  };
  return { root, data, outside, file, writable, host, runtime, orchestration, policy, createRun, ownerAccess };
};

test("the workspace plugin permits server answers only to an owner who may choose full access", async (t) => {
  const f = await pluginFixture(t);
  const ordinary = await f.createRun("ordinary", "bob");
  await ordinary.request();
  await assert.rejects(ordinary.answer("allow"), /administrator permissions/);
  await assert.rejects(ordinary.answer("deny", "alice"), /Only the run's owner/);
  assert.deepEqual(grantsOf(f.orchestration.state(ordinary.runId)), []);
  const owner = await f.createRun("owner");
  await owner.request();
  await assert.rejects(owner.answer("allow", "administrator"), /Only the run's owner/);
  assert.deepEqual(await owner.availability(), { disabledReason: null });
  await owner.answer("allow");
  assert.deepEqual(grantsOf(f.orchestration.state(owner.runId)), [{ path: f.file, access: "read" }]);
});

test("authorized full server access does not apply obsolete narrow grants", async (t) => {
  const f = await pluginFixture(t);
  const run = await f.createRun("full");
  await run.request();
  await run.answer("allow");
  await rm(f.file);
  await symlink(f.writable, f.file);
  await assert.rejects(f.runtime.sandbox.execute(run.runId, "read", { file_path: f.file }), /now resolves elsewhere/);
  f.orchestration.replacePluginState({ actorId: run.view.ownerId, commandId: "full-access" }, run.runId,
    { pluginId: WORKSPACE_ACCESS_OPTION_ID, scope: { kind: "run" }, state: "full" });
  const context = await f.runtime.sandbox.serverProcessContextFor(run.runId);
  assert.deepEqual(context.access, { level: "full", grants: [] });
  assert.match(JSON.stringify(await f.runtime.sandbox.execute(run.runId, "read", { file_path: f.file })), /Output/);
  assert.deepEqual(grantsOf(f.orchestration.state(run.runId)), [{ path: f.file, access: "read" }]);
});

test("PROCESS_SANDBOX on forbids server grants even for the owner with all rights", async (t) => {
  const f = await pluginFixture(t, "on");
  const run = await f.createRun("forced");
  await run.request();
  await assert.rejects(run.answer("allow"), /PROCESS_SANDBOX=on/);
  assert.match(JSON.stringify(await run.availability()), /PROCESS_SANDBOX=on/);
  assert.equal(run.action().status, "pending");
  assert.deepEqual(grantsOf(f.orchestration.state(run.runId)), []);
});

test("the server adds exact grants to file tools and the readable and writable process sandbox paths", async (t) => {
  const f = await pluginFixture(t);
  const run = await f.createRun("server");
  await run.request("read");
  await run.answer("allow");
  await run.request("write", f.writable, "write");
  await run.answer("allow");
  const context = await f.runtime.sandbox.serverProcessContextFor(run.runId);
  assert.ok(context.sandbox);
  assert.deepEqual(context.access?.grants, [{ path: f.file, access: "read" }, { path: f.writable, access: "write" }]);
  assert.deepEqual(f.policy.at(-1)!.grants, [
    { path: f.file, access: "read", directory: false },
    { path: f.writable, access: "write", directory: false },
  ]);
  assert.equal(f.policy.at(-1)!.readable.includes(f.file), false);
  assert.equal(f.policy.at(-1)!.writable.includes(f.writable), false);
  assert.match(JSON.stringify(await f.runtime.sandbox.execute(run.runId, "read", { file_path: f.file })), /Reference/);
  await assert.rejects(f.runtime.sandbox.execute(run.runId, "write", { file_path: f.file, content: "No\n" }), /outside/);
  await f.runtime.sandbox.execute(run.runId, "write", { file_path: f.writable, content: "Written\n" });
  assert.equal(await readFile(f.writable, "utf8"), "Written\n");
});

test("another run's bound server folder cannot be granted", async (t) => {
  const f = await pluginFixture(t);
  const protectedFolder = path.join(f.root, "other-project");
  await mkdir(protectedFolder);
  await writeFile(path.join(protectedFolder, "private.txt"), "Other run\n");
  await f.createRun("other", "alice", { machine: "server", folder: { path: protectedFolder } });
  await rm(path.join(f.data, "sessions", "other"), { recursive: true, force: true });
  const run = await f.createRun("requester");
  await assert.rejects(run.request("protected", path.join(protectedFolder, "private.txt")), /full access is required/);
  assert.deepEqual(f.orchestration.view(run.runId).actions, []);
});

test("stopping the run through workspace lifecycle withdraws its open requests", async (t) => {
  const f = await pluginFixture(t);
  const run = await f.createRun("stopped");
  await run.request();
  const count = f.orchestration.view(run.runId).inputs.length;
  await f.host.lifecycle.stopSession(run.runId);
  await settled();
  assert.equal(run.action().status, "dismissed");
  assert.deepEqual(run.action().result, { withdrawn: true });
  assert.deepEqual(grantsOf(f.orchestration.state(run.runId)), []);
  assert.equal(f.orchestration.view(run.runId).inputs.length, count);
});

test("workstation grants travel to the workstation and never enter its server process context", async (t) => {
  const f = await pluginFixture(t, "on");
  const machineRoot = path.join(f.root, "machine");
  const machineOutside = path.join(f.root, "machine-reference");
  await Promise.all([machineRoot, machineOutside].map((directory) => mkdir(directory)));
  const reference = path.join(machineOutside, "reference.txt");
  await writeFile(reference, "Workstation reference\n");
  const runId = "workstation";
  const executed: Array<{ operation: string; grants: unknown }> = [];
  const local = new WorkspaceOperationExecutor({
    contextFor: () => Promise.resolve(workspaceProcessContext({
      runId, cwd: machineRoot, root: machineRoot, home: { home: machineRoot }, logDirectory: machineRoot, hostRoot: undefined,
      access: { level: "isolated", grants: grantsOf(f.orchestration.state(runId)) }, grantPolicy: { dataDirectory: path.join(machineRoot, "data") },
    })),
    modules: workspaceExecutorModules({ contributions: [] }),
  });
  t.after(() => local.shutdown());
  const register = f.host.methods.find(workspaceContracts.clients.register.id)!.contribution;
  await register.execute({
    id: "client-00000001", label: "Workstation", hostname: "workstation", platform: process.platform,
    folders: [machineRoot], runsDirectory: path.join(machineRoot, "runs"), ripgrep: true,
    executor: WORKSPACE_EXECUTOR_VERSION, contributions: [], backgroundTasks: [], confirmedRuns: [],
  }, {
    ...methodContext(f.ownerAccess("bob")),
    connection: {
      id: "workstation-connection", userId: "bob", streamless: false, onClose: () => () => undefined,
      call: async (_contract, input) => {
        const operation = input as { runId: string; operation: string; input: unknown; access: { grants?: unknown } };
        executed.push({ operation: operation.operation, grants: operation.access.grants });
        if (operation.operation === "stop") { await local.stopRun(operation.runId); return { value: null } as never; }
        return { value: await local.execute(operation.runId, operation.operation, operation.input) } as never;
      },
    },
  });
  const run = await f.createRun(runId, "bob", { machine: { client: "client-00000001", label: "Workstation" }, folder: { path: machineRoot } });
  assert.deepEqual(await run.availability(), { disabledReason: null });
  await run.request("read", reference);
  await run.answer("allow");
  assert.match(JSON.stringify(await f.runtime.sandbox.execute(runId, "read", { file_path: reference })), /Workstation reference/);
  assert.deepEqual(executed.at(-1), { operation: "read", grants: [{ path: reference, access: "read" }] });
  await assert.rejects(f.runtime.sandbox.execute(runId, "write", { file_path: reference, content: "No\n" }), /outside/);
  const server = await f.runtime.sandbox.serverProcessContextFor(runId);
  assert.deepEqual(server.access?.grants, []);
  assert.equal(f.policy.at(-1)!.readable.includes(reference), false);
  assert.equal(f.policy.at(-1)!.writable.includes(reference), false);
});

test("approving duplicate pending read requests preserves the existing grant", async (t) => {
  const f = await fixture(t);
  await f.request("first");
  await f.request("second");
  const actions = f.runtime().view(f.view.id).actions;
  await f.service().answer(f.view.id, actions[0]!.id, "allow", accessFor());
  await f.service().answer(f.view.id, actions[1]!.id, "allow", accessFor());
  assert.deepEqual(f.grants(), [{ path: f.file, access: "read" }]);
  assert.match(JSON.stringify(await f.executor.execute(f.view.id, "read", { file_path: f.file })), /Outside content/);
});

test("serverReady restores withdrawal handling before the next human message", async (t) => {
  const f = await pluginFixture(t);
  const run = await f.createRun("restored");
  f.orchestration.proposeAction({ actorId: run.agent.id, commandId: "restored-request", turnId: run.turn.turnId }, run.runId, {
    owner: "ragents.workspace", title: "Access request",
    payload: { kind: "access-request", path: f.file, access: "read", reason: "Read the reference.", file: true },
  });
  await f.host.lifecycle.serverReady();
  f.orchestration.enqueueInput({ actorId: run.view.ownerId, commandId: "human-after-start" }, run.runId, {
    actorId: run.agent.id, content: "Use the local file instead.", origin: "human",
  });
  await settled();
  assert.equal(run.action().status, "dismissed");
  assert.deepEqual(run.action().result, { superseded: true });
  assert.deepEqual(grantsOf(f.orchestration.state(run.runId)), []);
});

test("an approval waiting for inspection cannot overtake a new human message", async (t) => {
  const f = await fixture(t);
  await f.request();
  let release: () => void = () => undefined;
  const waiting = new Promise<void>((resolve) => { release = resolve; });
  f.inspectAfter(() => waiting);
  const approving = f.answer("allow");
  f.runtime().enqueueInput({ actorId: f.view.ownerId, commandId: "human-during-approval" }, f.view.id, {
    actorId: f.agent.id, content: "Continue without the reference.", origin: "human",
  });
  release();
  await assert.rejects(approving, /already closed/);
  assert.deepEqual(f.grants(), []);
});

test("the OS process sandbox enforces exact read and write grants including a new writable path", {
  skip: process.platform !== "darwin" && process.platform !== "linux",
}, async (t) => {
  const f = await pluginFixture(t, "auto", false);
  const run = await f.createRun("process-grants");
  await writeFile(f.file, "Granted process reference\n");
  const command = (text: string) => f.runtime.sandbox.execute(run.runId, "bash", { command: text });
  const denied = await command(`cat '${f.file}'`);
  assert.doesNotMatch(JSON.stringify(denied), /Granted process reference/);
  await run.request("read");
  await run.answer("allow");
  assert.match(JSON.stringify(await command(`cat '${f.file}'`)), /Granted process reference/);
  await command(`printf changed > '${f.file}'`);
  assert.equal(await readFile(f.file, "utf8"), "Granted process reference\n");
  await run.request("write", f.writable, "write");
  await run.answer("allow");
  await command(`printf updated > '${f.writable}'`);
  assert.equal(await readFile(f.writable, "utf8"), "updated");
  const fresh = path.join(f.outside, "new.txt");
  await run.request("new", fresh, "write");
  await run.answer("allow");
  await command(`printf created > '${fresh}'`);
  assert.equal(await readFile(fresh, "utf8"), "created");
  const sibling = path.join(f.outside, "sibling.txt");
  await command(`printf blocked > '${sibling}'`);
  await assert.rejects(readFile(sibling), /ENOENT/);
});


test("an unavailable journal blocks new grant decisions while own-root file tools remain usable", async (t) => {
  const f = await pluginFixture(t);
  const otherFolder = path.join(f.root, "other-bound-folder");
  await mkdir(otherFolder);
  await f.createRun("unavailable", "alice", { machine: "server", folder: { path: otherFolder } });
  const run = await f.createRun("requester");
  await run.request("pending");
  const workspace = await f.runtime.resolve(run.runId, () => undefined);
  await writeFile(path.join(workspace.cwd, "local.txt"), "Local file\n");
  const select = f.orchestration.select.bind(f.orchestration);
  t.mock.method(f.orchestration, "select", <Value>(runId: string, read: (state: RunState) => Value): Value => {
    if (runId === "unavailable") throw new DomainError("journal-unavailable", "The journal is unavailable.", 409);
    return select(runId, read);
  });
  const unavailable = (error: unknown): boolean => error instanceof DomainError && error.code === "workspace-grant-roots-unavailable";
  await assert.rejects(run.request("blocked"), unavailable);
  assert.equal(f.orchestration.view(run.runId).actions.length, 1);
  assert.equal(run.action().status, "pending");
  await assert.rejects(run.answer("allow"), unavailable);
  assert.deepEqual(grantsOf(f.orchestration.state(run.runId)), []);
  assert.match(JSON.stringify(await f.runtime.sandbox.execute(run.runId, "read", { file_path: "local.txt" })), /Local file/);
});
