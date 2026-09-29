import assert from "node:assert/strict";
import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, readdir, readFile, realpath, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test, { type TestContext } from "node:test";
import { claimTurn, DomainError, pluginStateKey, ToolRegistry, TurnToolset, type RunState } from "@ragents/engine";
import {
  FILE_OPERATIONS,
  RUN_MARKER_ENV,
  WORKSPACE_EXECUTOR_VERSION,
  WorkspaceOperationError,
  EXECUTOR_CONTRIBUTION_FILE,
  WorkspaceOperationExecutor,
  commandModule,
  executorMachine,
  loadExecutorContribution,
  prepareExecutorContribution,
  fileModule,
  hasProcessTable,
  processModule,
  processTableForPlatform,
  runFolderModule,
  sandboxToolsModule,
  workspaceProcessContext,
  type FileListing,
  type FileText,
  type PreparedExecutorContribution,
  type ProcessTable,
  type WorkspaceModuleFactory,
  type WorkspaceProcessContext,
} from "@ragents/workspace-executor";
import { RpcClient } from "../../web/src/rpc/client.ts";
import { allGrants, catalog, postTo, setupRun } from "../../../packages/ragents/tests/support.ts";
import {
  WORKSPACE_BINDING_OPTION_ID,
  WORKSPACE_CLIENT_STOP_OPERATION,
  workspaceClientContracts,
  workspaceContracts,
  type BrowseListing,
  type BrowsePreview,
  type BrowseRoot,
  type WorkspaceBinding,
} from "../../../plugins/ragents.workspace/contract.ts";
import { bindingOf, workspaceLocation } from "../../../plugins/ragents.workspace/server/binding.ts";
import { createBrowseChannel, createBrowseMethods } from "../../../plugins/ragents.workspace/server/browse-route.ts";
import { clientMethods, WorkspaceClientRegistry } from "../../../plugins/ragents.workspace/server/clients.ts";
import { RunWorkspaceRuntime } from "../../../plugins/ragents.workspace/server/runtime.ts";
import { ActorProgramRuntime } from "../../../plugins/ragents.actor-programs/server/runtime.ts";
import { createActorProgramToolContributors } from "../../../plugins/ragents.actor-programs/server/tool-contributor.ts";
import { runProcessesOf } from "../../../plugins/ragents.processes/server/run-processes.ts";
import { RunBrowser } from "../../../plugins/ragents.browser/server/browser.ts";
import { browserModule } from "../../../plugins/ragents.browser/executor/module.ts";
import { stubBrowser } from "./browser-stub.ts";
import { hostRoot } from "../src/host-version.ts";
import { NodeTypeScriptExecutor } from "../src/plugin-support/native-typescript-executor.ts";
import { createTypeScriptToolContributor } from "../src/ragents/typescript-tools.ts";
import type { WorkspaceResolver } from "../src/ragents/workspace-runtime.ts";
import { methodContext, startRpcServer } from "./rpc-fixture.ts";

// Server and workstation run on one machine here; the workstation therefore offers paths that do not exist on the server.

const until = async (condition: () => boolean, timeoutMs = 5000): Promise<void> => {
  const started = Date.now();
  while (!condition()) {
    if (Date.now() - started > timeoutMs) throw new Error("Condition was not met.");
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
};

const missingOnServer = async (candidate: string): Promise<void> => {
  await assert.rejects(stat(candidate), (error: unknown) => (error as NodeJS.ErrnoException).code === "ENOENT");
};

const runStateWith = (binding: WorkspaceBinding): RunState => ({
  ownerUserId: null,
  pluginStates: new Map([[
    pluginStateKey(WORKSPACE_BINDING_OPTION_ID, { kind: "run" }),
    { pluginId: WORKSPACE_BINDING_OPTION_ID, scope: { kind: "run" }, state: binding, updatedAt: "2026-09-23T00:00:00.000Z" },
  ]]),
}) as unknown as RunState;

/** A workstation on another machine: it registers paths that do not exist on the server and maps them to its own folders. */
const foreignWorkstation = async (
  t: TestContext,
  url: string,
  id: string,
  label: string,
  folders: Readonly<Record<string, string>>,
  modules: readonly WorkspaceModuleFactory[],
  runsDirectory = "/foreign/runs",
): Promise<{ operations: string[]; disconnect: () => void }> => {
  const client = new RpcClient({ baseUrl: url, retryDelayMs: 50 });
  const contexts = new Map<string, WorkspaceProcessContext>();
  const operations: string[] = [];
  const executor = new WorkspaceOperationExecutor({
    contextFor: async (runId) => {
      const context = contexts.get(runId);
      if (!context) throw new Error(`There is no task for ${runId}`);
      return context;
    },
    modules,
  });
  t.after(client.handle(workspaceClientContracts.execute, async (input, context) => {
    const local = folders[input.cwd] ?? (input.cwd.startsWith(`${runsDirectory}${path.sep}`) ? input.cwd : undefined);
    if (!local) throw new Error(`This workstation does not offer the folder ${input.cwd}`);
    operations.push(input.operation);
    contexts.set(input.runId, workspaceProcessContext({
      runId: input.runId, cwd: local, root: local, home: { home: local }, logDirectory: local, hostRoot: undefined, additions: input.env,
    }));
    try {
      if (input.operation === WORKSPACE_CLIENT_STOP_OPERATION) {
        await executor.stopRun(input.runId);
        return { value: null };
      }
      return { value: await executor.execute(input.runId, input.operation, input.input, { signal: context.signal, onProgress: context.progress }) };
    } catch (error) {
      throw error instanceof WorkspaceOperationError ? new DomainError(error.code, error.message, error.status) : error;
    }
  }));
  t.after(async () => {
    client.close();
    await executor.shutdown();
  });
  await until(() => client.status.kind === "connected");
  const contributions = await client.call(workspaceContracts.clients.contributions, { label, executor: WORKSPACE_EXECUTOR_VERSION });
  await client.call(workspaceContracts.clients.register, {
    id, label, hostname: "foreign-machine", platform: process.platform, folders: Object.keys(folders), runsDirectory, ripgrep: false, executor: WORKSPACE_EXECUTOR_VERSION, contributions,
  });
  return { operations, disconnect: () => client.close() };
};

/** The server with the real workspace plugin; every run is bound to the workstation the test gives it. */
const serverFixture = async (t: TestContext, { resolver, skills = [], contributions = [] }: {
  resolver?: WorkspaceResolver;
  skills?: readonly string[];
  contributions?: readonly PreparedExecutorContribution[];
} = {}) => {
  const root = await realpath(await mkdtemp(path.join(tmpdir(), "ragents-foreign-machine-")));
  t.after(() => rm(root, { recursive: true, force: true }));
  const registry = new WorkspaceClientRegistry(contributions);
  const { url } = await startRpcServer(t, { methods: clientMethods(registry) });
  const bindings = new Map<string, WorkspaceBinding>();
  const runState = (runId: string): RunState => {
    const binding = bindings.get(runId) ?? bindings.get("*");
    if (!binding) throw new Error(`The test has not bound the run ${runId}`);
    return runStateWith(binding);
  };
  const sessions = path.join(root, "server", "sessions");
  const documents = path.join(root, "server", "documents");
  await mkdir(documents, { recursive: true });
  const runtime: RunWorkspaceRuntime = new RunWorkspaceRuntime({
    globalDirectory: path.join(root, "server", "global"),
    sessionDirectory: (runId, ...segments) => path.join(sessions, runId, "plugins", "ragents.workspace", ...segments),
    storageRootFor: (runId) => path.join(sessions, runId),
    sessionsDirectoryPattern: path.join(sessions, "{runId}", "plugins", "ragents.workspace"),
    sessionWorkspaceFor: (runId) => runtime.resolve(runId, () => undefined),
    skillPaths: async () => skills,
    resolver: () => resolver,
    runState,
    storeBinding: () => { throw new Error("The test does not rebind"); },
    clients: registry,
    contributions: contributions.map((contribution) => contribution.parts),
  });
  t.after(() => runtime.shutdown());
  const browseOptions = {
    ensureSession: () => undefined,
    ensureWorkspaceAccess: () => undefined,
    execute: runtime.sandbox.execute.bind(runtime.sandbox),
    documentsFor: async () => documents,
    locationOf: (runId: string, location: string) => workspaceLocation(bindingOf(runState(runId)), location),
  };
  const [listMethod, previewMethod] = createBrowseMethods(browseOptions);
  const context = methodContext();
  return {
    root,
    url,
    registry,
    bindings,
    runtime,
    list: (runId: string, root: BrowseRoot, target: string) =>
      listMethod!.execute({ runId, root, path: target }, context) as Promise<BrowseListing>,
    preview: (runId: string, root: BrowseRoot, target: string) =>
      previewMethod!.execute({ runId, root, path: target }, context) as Promise<BrowsePreview>,
    channel: createBrowseChannel(browseOptions),
    context,
  };
};

test("the files tab fetches listing, preview and changes from the workstation, not from the server", async (t) => {
  const server = await serverFixture(t);
  const project = path.join(server.root, "workstation", "project");
  await mkdir(path.join(project, "src"), { recursive: true });
  await writeFile(path.join(project, "src", "app.ts"), "export const place = \"workstation\";\n");
  const offered = `/foreign-machine-${randomUUID()}/project`;
  await missingOnServer(offered);
  const workstation = await foreignWorkstation(t, server.url, "notebook-0001", "Notebook", { [offered]: project }, [fileModule]);
  server.bindings.set("foreign", { machine: { client: "notebook-0001", label: "Notebook" }, folder: { path: offered } });

  const listing = await server.list("foreign", "workspace", "");
  assert.deepEqual(listing.entries.map((entry) => entry.name), ["src"]);
  assert.equal(listing.location, `Workstation Notebook: ${project}`);
  assert.deepEqual((await server.list("foreign", "workspace", "src")).entries.map((entry) => entry.name), ["app.ts"]);
  const preview = await server.preview("foreign", "workspace", "src/app.ts");
  assert.equal(preview.previewable === true ? preview.content : undefined, "export const place = \"workstation\";\n");
  await assert.rejects(server.preview("foreign", "workspace", "../secret"), (error: unknown) =>
    error instanceof DomainError && error.code === "workspace-path-invalid" && error.status === 400);

  const messages: unknown[] = [];
  const stop = await server.channel.open({ runId: "foreign", root: "workspace" }, (message) => messages.push(message),
    { access: server.context.access, connection: server.context.connection });
  await writeFile(path.join(project, "src", "new.ts"), "export {};\n");
  await until(() => messages.length > 0);
  stop();
  assert.deepEqual(messages, [{ changed: true }]);
  assert.deepEqual([...new Set(workstation.operations)].sort(), ["files.list", "files.read", "files.watch"]);
});

test("a workstation with the folder / never delivers the server's files through the files tab", async (t) => {
  const server = await serverFixture(t);
  const machineRoot = path.join(server.root, "workstation-root");
  await mkdir(machineRoot, { recursive: true });
  await writeFile(path.join(machineRoot, "only-on-the-workstation.txt"), "from the workstation\n");
  await foreignWorkstation(t, server.url, "root-0001", "Root", { "/": machineRoot }, [fileModule]);
  server.bindings.set("root", { machine: { client: "root-0001", label: "Root" }, folder: { path: "/" } });

  const listing = await server.list("root", "workspace", "");
  assert.deepEqual(listing.entries.map((entry) => entry.name), ["only-on-the-workstation.txt"]);
  const own = await server.preview("root", "workspace", "only-on-the-workstation.txt");
  assert.equal(own.previewable === true ? own.content : undefined, "from the workstation\n");
  await assert.rejects(server.preview("root", "workspace", "etc/hosts"), (error: unknown) =>
    error instanceof DomainError && error.code === "workspace-path-not-found" && error.status === 404);
});

const exited = (child: ChildProcess): Promise<void> =>
  child.exitCode !== null || child.signalCode !== null ? Promise.resolve() : new Promise((resolve) => child.once("exit", () => resolve()));

test("the process view shows and ends the processes of the workstation, not those of the server", { skip: !hasProcessTable() }, async (t) => {
  const server = await serverFixture(t);
  const project = path.join(server.root, "workstation", "project");
  await mkdir(project, { recursive: true });
  const offered = `/foreign-machine-${randomUUID()}/project`;
  const runId = `foreign-processes-${process.pid}`;
  const child = spawn(process.execPath, ["-e", [
    "const server = require('node:net').createServer();",
    "server.listen(0, '127.0.0.1', () => process.stdout.write(String(server.address().port) + '\\n'));",
    "setTimeout(() => process.exit(0), 30000);",
  ].join("")], { detached: true, env: { ...process.env, [RUN_MARKER_ENV]: `only-on-the-server-${process.pid}` }, stdio: ["ignore", "pipe", "inherit"] });
  t.after(() => { if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL"); });
  const port = await new Promise<number>((resolve, reject) => {
    let output = "";
    child.stdout?.on("data", (chunk: Buffer) => {
      output += chunk.toString("utf8");
      const value = Number(output.trim());
      if (Number.isInteger(value) && value > 0) resolve(value);
    });
    child.once("error", reject);
  });
  const machine = processTableForPlatform();
  // Only the process table of the workstation assigns the process to the run; on the server it carries a different marker.
  const workstationTable: ProcessTable = {
    list: () => machine.list(),
    runMarkers: async (pids) => new Map(pids.filter((pid) => pid === child.pid).map((pid) => [pid, runId])),
    listeningPorts: (pids) => machine.listeningPorts(pids),
  };
  await foreignWorkstation(t, server.url, "notebook-0002", "Notebook", { [offered]: project }, [processModule({ table: () => workstationTable })]);
  server.bindings.set(runId, { machine: { client: "notebook-0002", label: "Notebook" }, folder: { path: offered } });
  const processes = runProcessesOf(server.runtime.sandbox);

  const snapshot = await processes.snapshot(runId);
  assert.equal(snapshot.runId, runId);
  const seen = snapshot.processes.find((entry) => entry.pid === child.pid);
  assert.ok(seen, JSON.stringify(snapshot));
  assert.deepEqual(seen.ports, [{ port, address: "127.0.0.1" }]);
  await processes.terminate(runId, seen.id, new AbortController().signal);
  await exited(child);
  assert.deepEqual((await processes.snapshot(runId)).processes, []);
});

/** The actor programs of a run are on the server under @actors, as `ragents.actor-programs` registers them. */
const actorRoot = async (server: Awaited<ReturnType<typeof serverFixture>>): Promise<string> => {
  const actors = path.join(server.root, "server", "actors");
  await mkdir(path.join(actors, "app", "src"), { recursive: true });
  server.runtime.sandbox.registerWorkspaceRoot({ id: "actors", alias: "@actors", environmentVariable: "RAGENTS_ACTORS_DIR", directoryFor: () => actors });
  return actors;
};

/** A project that exists only on the workstation, and the path under which the workstation offers it. */
const workstationProject = async (server: Awaited<ReturnType<typeof serverFixture>>): Promise<{ project: string; offered: string }> => {
  const project = path.join(server.root, "workstation", "project");
  await mkdir(project, { recursive: true });
  await writeFile(path.join(project, "README.md"), "From the workstation\n");
  const offered = `/foreign-machine-${randomUUID()}/project`;
  await missingOnServer(offered);
  return { project, offered };
};

/** A tool result of the executor carries text parts, a tool in the turn returns the text itself. */
const textOf = (result: unknown): string => typeof result === "string" ? result
  : (result as { content: Array<{ text?: string }> }).content.map((part) => part.text ?? "").join("\n");

test("typescript_eval with path reads the file from the workstation and runs in the run's own folder on the server", async (t) => {
  const server = await serverFixture(t);
  const actors = await actorRoot(server);
  await writeFile(path.join(actors, "setup.ts"), "return { place: \"server\" };\n");
  const project = path.join(server.root, "workstation", "project");
  await mkdir(path.join(project, "snippets"), { recursive: true });
  await writeFile(path.join(project, "snippets", "compute.ts"), "return { answer: 6 * 7, place: process.cwd() };\n");
  const offered = `/foreign-machine-${randomUUID()}/project`;
  await missingOnServer(offered);
  const workstation = await foreignWorkstation(t, server.url, "notebook-0003", "Notebook", { [offered]: project }, [sandboxToolsModule, fileModule]);
  server.bindings.set("*", { machine: { client: "notebook-0003", label: "Notebook" }, folder: { path: offered } });

  const setup = setupRun({ grants: allGrants(), toolNames: null });
  const native = new NodeTypeScriptExecutor({
    directoryFor: (runId) => path.join(server.root, "server", "native", runId),
    serverProcessContextFor: (runId) => server.runtime.sandbox.serverProcessContextFor(runId),
  });
  setup.services.nativeTypeScriptExecutor = native;
  t.after(async () => {
    await native.shutdown();
    setup.journal.close();
  });
  const registry = new ToolRegistry().register(createTypeScriptToolContributor({
    serverProcessContextFor: (runId) => server.runtime.sandbox.serverProcessContextFor(runId),
    execute: (runId, operation, input, options) => server.runtime.sandbox.execute(runId, operation, input, options),
  }));
  const queued = postTo(setup.runtime, setup.view, setup.agent.id, "snippet-input", "Compute.");
  const input = queued.inputs.find((entry) => entry.actorId === setup.agent.id && entry.lifecycle.kind === "pending");
  assert.ok(input);
  const turn = claimTurn(setup.runtime, setup.view.id, setup.agent.id, input.id, "snippet-turn");
  const toolset = await TurnToolset.create({ runtime: setup.runtime, turn, catalog, registry, workspace: offered });

  const output = (await toolset.invoke("eval-path", "typescript_eval", { path: "snippets/compute.ts" })).output as { result: { answer: number; place: string } };
  assert.equal(output.result.answer, 42);
  const serverFolder = path.join(server.root, "server", "sessions", setup.view.id, "plugins", "ragents.workspace", "server");
  assert.equal(await realpath(output.result.place), serverFolder);
  assert.deepEqual(workstation.operations, ["files.read"]);
  assert.deepEqual((await toolset.invoke("eval-alias", "typescript_eval", { path: "@actors/setup.ts" })).output, { result: { place: "server" }, logs: [] });
  assert.deepEqual(workstation.operations, ["files.read"], "the file under @actors comes from the server");
});

test("file tools with @actors run on the server in a workstation run, without an alias on the workstation", async (t) => {
  const server = await serverFixture(t);
  const actors = await actorRoot(server);
  const { offered, project } = await workstationProject(server);
  const workstation = await foreignWorkstation(t, server.url, "notebook-0006", "Notebook", { [offered]: project }, [sandboxToolsModule, fileModule]);
  server.bindings.set("actors-run", { machine: { client: "notebook-0006", label: "Notebook" }, folder: { path: offered } });
  const execute = (operation: string, input: unknown) => server.runtime.sandbox.execute("actors-run", operation, input);

  await execute("write", { path: "@actors/app/src/index.ts", content: "export const value = 1;\n" });
  await execute("edit", { path: "@actors/app/src/index.ts", edits: [{ oldText: "value = 1", newText: "value = 2" }] });
  assert.equal(await readFile(path.join(actors, "app", "src", "index.ts"), "utf8"), "export const value = 2;\n");
  assert.match(textOf(await execute("read", { path: "@actors/app/src/index.ts" })), /value = 2/);
  assert.deepEqual((await execute(FILE_OPERATIONS.list, { path: "app", alias: "@actors" }) as FileListing).entries.map((entry) => entry.name), ["src"]);
  const source = await execute(FILE_OPERATIONS.read, { path: "app/src/index.ts", alias: "@actors" }) as FileText;
  assert.equal(source.previewable ? source.content : undefined, "export const value = 2;\n");
  assert.deepEqual(workstation.operations, [], "no call with @actors reaches the workstation");

  assert.match(textOf(await execute("read", { path: "README.md" })), /From the workstation/);
  assert.deepEqual(workstation.operations, ["read"]);
  await assert.rejects(execute("read", { path: "@apps/list.ts" }), (error: unknown) =>
    error instanceof DomainError && error.code === "workspace-alias-unknown" && /@apps \(known: @actors\)/.test(error.message));
});

test("a bash without an alias runs on the workstation, with @actors as cwd on the server, and only there is RAGENTS_ACTORS_DIR set", async (t) => {
  const server = await serverFixture(t);
  const actors = await actorRoot(server);
  const { offered, project } = await workstationProject(server);
  const workstation = await foreignWorkstation(t, server.url, "notebook-0007", "Notebook", { [offered]: project }, [sandboxToolsModule]);
  server.bindings.set("bash", { machine: { client: "notebook-0007", label: "Notebook" }, folder: { path: offered } });
  const bash = async (input: Record<string, unknown>): Promise<string[]> =>
    textOf(await server.runtime.sandbox.execute("bash", "bash", { command: 'pwd; echo "[${RAGENTS_ACTORS_DIR:-}]"', ...input })).trim().split("\n");

  assert.deepEqual(await bash({}), [project, "[]"]);
  assert.deepEqual(workstation.operations, ["bash"]);
  assert.deepEqual(await bash({ cwd: "@actors/app" }), [path.join(actors, "app"), `[${actors}]`]);
  assert.deepEqual(await bash({ cwd: "@actors" }), [actors, `[${actors}]`]);
  assert.deepEqual(workstation.operations, ["bash"], "a bash with @actors does not reach the workstation");
  await assert.rejects(server.runtime.sandbox.execute("bash", "bash", { command: "pwd", cwd: actors }), (error: unknown) =>
    error instanceof DomainError && error.code === "workspace-path-invalid");
  await assert.rejects(server.runtime.sandbox.execute("bash", "bash", { command: "pwd", cwd: "@actors/missing" }), (error: unknown) =>
    error instanceof DomainError && error.code === "workspace-path-not-found");
});

test("the language servers open @actors on the server in a workstation run, a call across both machines fails with a cause", async (t) => {
  const file = path.join(hostRoot(), "bundles", "ragents.lsp-typescript", EXECUTOR_CONTRIBUTION_FILE);
  const typescript = prepareExecutorContribution(await loadExecutorContribution("ragents.lsp-typescript", file), "/unused");
  const server = await serverFixture(t, { contributions: [typescript] });
  const actors = await actorRoot(server);
  await writeFile(path.join(actors, "app", "src", "index.ts"), "export const value: number = \"text\";\n");
  const { offered, project } = await workstationProject(server);
  const workstation = await foreignWorkstation(t, server.url, "notebook-0008", "Notebook", { [offered]: project }, [sandboxToolsModule]);
  server.bindings.set("language", { machine: { client: "notebook-0008", label: "Notebook" }, folder: { path: offered } });
  const execute = (operation: string, input: unknown) => server.runtime.sandbox.execute("language", operation, input);

  assert.match(String(await execute("typescript_open", { root: "@actors/app" })), /TypeScript server ready on app/);
  const diagnostics = String(await execute("typescript_diagnostics", { paths: ["@actors/app/src/index.ts"] }));
  assert.match(diagnostics, /Diagnostics \(TypeScript\) @actors\/app\/src\/index\.ts: 1 error/);
  assert.match(textOf(await execute("write", { path: "@actors/app/src/index.ts", content: "export const value: number = 1;\n" })), /no errors/);
  await assert.rejects(execute("typescript_diagnostics", { root: "@actors/app", paths: ["src/index.ts"] }), (error: unknown) =>
    error instanceof DomainError && error.code === "workspace-roots-mixed" && error.status === 400 && /@actors/.test(error.message));
  assert.deepEqual(workstation.operations, []);
  assert.match(String(await execute("typescript_close", { root: "@actors/app" })), /ended/);
});

test("skills are readable under @skills in a workstation run, including the files next to them, but not writable", async (t) => {
  const skills = await realpath(await mkdtemp(path.join(tmpdir(), "ragents-foreign-skills-")));
  t.after(() => rm(skills, { recursive: true, force: true }));
  const skill = path.join(skills, "notes");
  await mkdir(skill);
  await writeFile(path.join(skill, "SKILL.md"), "---\nname: notes\ndescription: Order notes.\n---\nRead template.md.\n");
  await writeFile(path.join(skill, "template.md"), "# Template\n");
  const server = await serverFixture(t, { skills: [skill] });
  const { offered, project } = await workstationProject(server);
  const workstation = await foreignWorkstation(t, server.url, "notebook-0009", "Notebook", { [offered]: project }, [sandboxToolsModule, fileModule]);
  server.bindings.set("skill", { machine: { client: "notebook-0009", label: "Notebook" }, folder: { path: offered } });
  const execute = (operation: string, input: unknown) => server.runtime.sandbox.execute("skill", operation, input);

  assert.match(textOf(await execute("read", { path: "@skills/notes/SKILL.md" })), /Read template\.md/);
  assert.match(textOf(await execute("read", { path: "@skills/notes/template.md" })), /# Template/);
  assert.match(textOf(await execute("bash", { command: "cat template.md", cwd: "@skills/notes" })), /# Template/);
  const listed = await execute(FILE_OPERATIONS.list, { path: "notes", alias: "@skills" }) as FileListing;
  assert.deepEqual(listed.entries.map((entry) => entry.name), ["SKILL.md", "template.md"]);
  await assert.rejects(execute("write", { path: "@skills/notes/new.md", content: "no" }), /outside/);
  await assert.rejects(execute("read", { path: "@skills/missing/SKILL.md" }), (error: unknown) =>
    error instanceof DomainError && error.code === "workspace-alias-unknown" && /@skills\/missing/.test(error.message));
  assert.deepEqual(workstation.operations, []);
});

test("the self-description names the server roots per binding, and in a workstation run their variables only for the bash there", async (t) => {
  const skills = await realpath(await mkdtemp(path.join(tmpdir(), "ragents-foreign-skills-")));
  t.after(() => rm(skills, { recursive: true, force: true }));
  await mkdir(path.join(skills, "notes"));
  const server = await serverFixture(t, { skills: [path.join(skills, "notes")] });
  await actorRoot(server);
  server.bindings.set("foreign", { machine: { client: "notebook-0010", label: "Notebook" }, folder: { path: "/foreign-machine/project" } });
  server.bindings.set("here", { machine: "server", folder: "fresh" });

  const remote = (await server.runtime.resolve("foreign", () => undefined)).description ?? "";
  assert.match(remote, /## Roots on the server/);
  assert.match(remote, /`@actors` \(read and write\) and `@skills` \(read only\)/);
  assert.match(remote, /with a `cwd` that starts with an alias it runs on the server instead and sees only the server, and only that bash has `\$RAGENTS_ACTORS_DIR` for `@actors`/);
  assert.match(remote, /never combine a path with an alias and a path in the working directory/);
  const local = (await server.runtime.resolve("here", () => undefined)).description ?? "";
  assert.match(local, /## Roots besides the working directory/);
  assert.match(local, /`bash` also has `\$RAGENTS_ACTORS_DIR` for `@actors`\./);
  assert.doesNotMatch(local, /on the server instead/);
});

const formatterFiles: Readonly<Record<string, string>> = {
  "package.json": JSON.stringify({ name: "formatter", type: "module", private: true, ragents: { title: "Formatter", backend: "src/server.ts" } }),
  "src/server.ts": `import { Type } from "typebox";
import { defineActor } from "@ragents/server";
export default defineActor({ state: Type.Object({}), functions: {
  transform: { label: "Transform", input: Type.Object({ value: Type.String() }), output: Type.String(), tool: { name: "format_text" } },
} }, { functions: { transform: (input) => input.value.toUpperCase() } });
`,
  "tests/transform.test.ts": `import assert from "node:assert/strict";
import test from "node:test";
import { createTestContext } from "@ragents/server/testing";
import program from "../src/server.ts";
test("transform", async () => {
  assert.equal(await program.functions.transform({ value: " hello " }, createTestContext({ state: {} })), "HELLO");
});
`,
};

test("an actor program is created, edited with the file tools and activated in a workstation run", async (t) => {
  const server = await serverFixture(t);
  const { offered, project } = await workstationProject(server);
  const workstation = await foreignWorkstation(t, server.url, "notebook-0011", "Notebook", { [offered]: project }, [sandboxToolsModule, fileModule]);
  server.bindings.set("*", { machine: { client: "notebook-0011", label: "Notebook" }, folder: { path: offered } });
  const { sandbox } = server.runtime;
  const serverProcessContextFor = (runId: string) => sandbox.serverProcessContextFor(runId);
  const setup = setupRun({ grants: allGrants(), toolNames: null });
  const native = new NodeTypeScriptExecutor({ directoryFor: (runId) => path.join(server.root, "server", "native", runId), serverProcessContextFor });
  setup.services.nativeTypeScriptExecutor = native;
  const registry = new ToolRegistry();
  const programs = new ActorProgramRuntime({
    runtime: () => setup.runtime,
    agentToolsFor: async (runId, actorId, provisional) => {
      const view = setup.runtime.view(runId);
      const actor = provisional ?? view.actors.find((candidate) => candidate.id === actorId);
      if (!actor) throw new Error(`The actor ${actorId} does not exist in the test`);
      return registry.resolve({ runId, actorId, actor, turnId: null, view: provisional ? { ...view, actors: [...view.actors, provisional] } : view, workspace: offered });
    },
    askService: () => ({ ask: async () => { throw new Error("The test expects no question"); } }),
    reservedToolNames: () => [],
    serverProcessContextFor,
    operations: { operation: () => { throw new Error("The test has no operations"); }, invoke: async () => { throw new Error("The test has no operations"); }, list: () => [] },
    directoryFor: (runId) => path.join(server.root, "server", "programs", runId),
    scriptSources: () => undefined,
  });
  setup.services.actorPrograms = programs;
  t.after(async () => {
    await programs.shutdown();
    await native.shutdown();
    setup.journal.close();
  });
  sandbox.registerWorkspaceRoot({ id: "actor-programs", alias: "@actors", environmentVariable: "RAGENTS_ACTORS_DIR", directoryFor: (runId) => programs.workspaceDirectory(runId) });
  registry.register(sandbox.workspaceTools());
  registry.register(createTypeScriptToolContributor({ serverProcessContextFor, execute: (runId, operation, input, options) => sandbox.execute(runId, operation, input, options) }));
  for (const contributor of createActorProgramToolContributors(programs, { latest: () => "" })) registry.register(contributor);
  const queued = postTo(setup.runtime, setup.view, setup.agent.id, "program-input", "Build a program.");
  const input = queued.inputs.find((entry) => entry.actorId === setup.agent.id && entry.lifecycle.kind === "pending");
  assert.ok(input);
  const turn = claimTurn(setup.runtime, setup.view.id, setup.agent.id, input.id, "program-turn");
  const toolset = await TurnToolset.create({ runtime: setup.runtime, turn, catalog, registry, workspace: offered });
  const call = async (id: string, name: string, value: Record<string, unknown>): Promise<unknown> => (await toolset.invoke(id, name, value as never)).output;

  await call("create", "typescript_eval", { code: 'return context.functions.actor_program_create({ name: "formatter", template: "blank" });' });
  for (const [file, content] of Object.entries(formatterFiles)) await call(`write-${file}`, "write", { path: `@actors/formatter/${file}`, content });
  await call("edit", "edit", { path: "@actors/formatter/src/server.ts", edits: [{ oldText: "input.value.toUpperCase()", newText: "input.value.trim().toUpperCase()" }] });
  assert.match(textOf(await call("bash", "bash", { command: "ls src tests", cwd: "@actors/formatter" })), /server\.ts[\s\S]*transform\.test\.ts/);
  assert.deepEqual(await call("activate", "typescript_eval", { code: 'return context.functions.actor_program_activate({ name: "formatter" });' }),
    { result: { name: "formatter", actor: "@formatter", views: 0, active: true }, logs: [] });
  assert.deepEqual(await call("use", "typescript_eval", { code: 'return context.functions.format_text({ value: " hello " });' }), { result: "HELLO", logs: [] });
  assert.deepEqual(workstation.operations, [], "creating, editing and activating stay on the server");
  await missingOnServer(offered);
});

test("the browser check runs on the workstation, its screenshots are in the server's file store", async (t) => {
  const server = await serverFixture(t);
  const project = path.join(server.root, "workstation", "project");
  await mkdir(project, { recursive: true });
  const offered = `/foreign-machine-${randomUUID()}/project`;
  await missingOnServer(offered);
  const stub = stubBrowser({
    "/": { title: "App on the workstation", elements: [{ role: "button", name: "Save", onClick: (page) => page.show({ role: "status", name: "Saved" }) }] },
  });
  const workstation = await foreignWorkstation(t, server.url, "notebook-0004", "Notebook", { [offered]: project },
    [browserModule(executorMachine("/unused"), { launch: stub.launch, timeoutMs: 500, checkTimeoutMs: 50 })]);
  const runId = "foreign-browser";
  server.bindings.set(runId, { machine: { client: "notebook-0004", label: "Notebook" }, folder: { path: offered } });
  const documents = path.join(server.root, "server", "documents", runId);
  const browser = new RunBrowser({ sandbox: server.runtime.sandbox, filesFor: async () => documents });
  t.after(() => browser.shutdown());

  const opened = await browser.open(runId, "http://localhost:4173/");
  assert.equal(opened.title, "App on the workstation");
  await browser.click(runId, { role: "button", name: "Save" });
  const checked = await browser.check(runId, { target: { role: "status" }, text: "Saved" });
  const shot = await browser.screenshot(runId, { label: "From the workstation" });
  assert.equal(await readFile(path.join(documents, shot.path), "utf8"), "PNG 1920x1080");
  assert.equal((await browser.image(runId)).toString(), "PNG 1920x1080");
  assert.deepEqual(await readdir(project), [], "the workstation stores no screenshot");
  assert.deepEqual(browser.evidence(runId), {
    checkedAt: checked.checkedAt,
    url: "http://localhost:4173/",
    screenshots: [{ name: "From the workstation", url: shot.url }],
    currentScreenshots: [{ name: "From the workstation", url: shot.url }],
    errors: [],
  });
  assert.deepEqual(workstation.operations, ["browser.open", "browser.click", "browser.check", "browser.screenshot"]);
  assert.equal(stub.log.launches, 1);

  await browser.close(runId);
  assert.equal(stub.log.closes, 1);
  assert.equal(workstation.operations.at(-1), "browser.close");
  await browser.open(runId, "http://localhost:4173/");
  workstation.disconnect();
  await until(() => server.registry.list(null).length === 0);
  await assert.rejects(browser.snapshot(runId), (error: unknown) => error instanceof DomainError && error.code === "workspace-client-disconnected");
  assert.equal(browser.evidence(runId).url, undefined, "without a workstation the server knows no page state");
  assert.equal(browser.evidence(runId).screenshots.length, 1);
});

test("a new folder per run is created on the workstation as the contribution's Git worktree and disappears with the run", async (t) => {
  const git = (cwd: string, ...args: string[]): string =>
    execFileSync("git", ["-c", "user.name=Example", "-c", "user.email=example@example.invalid", ...args], { cwd, encoding: "utf8" });
  const worktreeStep = (repository: string, ...args: string[]) =>
    ({ operation: "commands.run", input: { program: "git", args: ["-C", repository, "worktree", ...args], timeoutMs: 30_000 } });
  let repository = "";
  const resolver: WorkspaceResolver = {
    workstation: {
      label: "Git worktree per run",
      prepare: ({ runId, path: folder }) => [worktreeStep(repository, "add", "-b", `ragents/${runId}`, folder)],
      release: ({ path: folder }) => [worktreeStep(repository, "remove", "--force", folder)],
    },
    resolve: () => Promise.reject(new Error("not asked on the server")),
  };
  const server = await serverFixture(t, { resolver });
  repository = path.join(server.root, "workstation", "project");
  const runs = path.join(server.root, "workstation", "runs");
  await mkdir(repository, { recursive: true });
  git(repository, "init", "-q", "-b", "main");
  await writeFile(path.join(repository, "README.md"), "Hello from the workstation\n");
  git(repository, "add", "README.md");
  git(repository, "commit", "-q", "-m", "Start");
  const workstation = await foreignWorkstation(t, server.url, "notebook-0005", "Notebook", { [repository]: repository },
    [runFolderModule((runId) => path.join(runs, runId)), commandModule(), sandboxToolsModule], runs);
  const runId = "new-worktree";
  const folder = path.join(runs, runId);
  server.bindings.set(runId, { machine: { client: "notebook-0005", label: "Notebook" }, folder: { path: folder, fresh: true } });

  const workspace = await server.runtime.resolve(runId, () => undefined);
  assert.equal(workspace.cwd, folder);
  await missingOnServer(folder);
  const read = await server.runtime.sandbox.execute(runId, "read", { path: "README.md" }) as { content: Array<{ text: string }> };
  assert.match(read.content[0]!.text, /Hello from the workstation/);
  assert.deepEqual(workstation.operations, ["runFolder.create", "commands.run", "read"]);
  assert.match(git(repository, "worktree", "list"), new RegExp(`${runId}.*\\[ragents/${runId}\\]`));
  await server.runtime.sandbox.execute(runId, "read", { path: "README.md" });
  assert.deepEqual(workstation.operations.slice(3), ["read"], "the worktree is created only once");
  assert.equal(await stat(path.join(server.root, "server", "sessions", runId, "plugins", "ragents.workspace", "workspace")).catch(() => undefined), undefined);

  await server.runtime.deleteSession(runId);
  assert.deepEqual(workstation.operations.slice(4), ["stop", "commands.run", "runFolder.remove"]);
  await missingOnServer(folder);
  assert.doesNotMatch(git(repository, "worktree", "list"), new RegExp(runId));
});
