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
  WorkspaceOperationExecutor,
  browserModule,
  commandModule,
  fileModule,
  hasProcessTable,
  processModule,
  processTableForPlatform,
  runFolderModule,
  sandboxToolsModule,
  workspaceProcessContext,
  type FileListing,
  type FileText,
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
import { stubBrowser } from "../../../packages/workspace-executor/tests/browser-stub.ts";
import { NodeTypeScriptExecutor } from "../src/plugin-support/native-typescript-executor.ts";
import { createTypeScriptToolContributor } from "../src/ragents/typescript-tools.ts";
import type { WorkspaceResolver } from "../src/ragents/workspace-runtime.ts";
import { methodContext, startRpcServer } from "./rpc-fixture.ts";

// Server und Arbeitsplatz laufen hier auf einem Rechner; der Arbeitsplatz bietet deshalb Pfade an, die es auf dem Server nicht gibt.

const until = async (condition: () => boolean, timeoutMs = 5000): Promise<void> => {
  const started = Date.now();
  while (!condition()) {
    if (Date.now() - started > timeoutMs) throw new Error("Bedingung wurde nicht erfüllt.");
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

/** Ein Arbeitsplatz auf einem anderen Rechner: er meldet Pfade an, die es auf dem Server nicht gibt, und bildet sie auf seine eigenen Ordner ab. */
const foreignWorkstation = async (
  t: TestContext,
  url: string,
  id: string,
  label: string,
  folders: Readonly<Record<string, string>>,
  modules: readonly WorkspaceModuleFactory[],
  runsDirectory = "/fremd/runs",
): Promise<{ operations: string[]; disconnect: () => void }> => {
  const client = new RpcClient({ baseUrl: url, retryDelayMs: 50 });
  const contexts = new Map<string, WorkspaceProcessContext>();
  const operations: string[] = [];
  const executor = new WorkspaceOperationExecutor({
    contextFor: async (runId) => {
      const context = contexts.get(runId);
      if (!context) throw new Error(`Für ${runId} liegt kein Auftrag vor`);
      return context;
    },
    modules,
  });
  t.after(client.handle(workspaceClientContracts.execute, async (input, context) => {
    const local = folders[input.cwd] ?? (input.cwd.startsWith(`${runsDirectory}${path.sep}`) ? input.cwd : undefined);
    if (!local) throw new Error(`Den Ordner ${input.cwd} bietet dieser Arbeitsplatz nicht an`);
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
  await client.call(workspaceContracts.clients.register, {
    id, label, hostname: "fremder-rechner", platform: process.platform, folders: Object.keys(folders), runsDirectory, executor: WORKSPACE_EXECUTOR_VERSION,
  });
  return { operations, disconnect: () => client.close() };
};

/** Der Server mit dem echten Arbeitsbereich-Plugin; jeder Run ist an den Arbeitsplatz gebunden, den der Test ihm gibt. */
const serverFixture = async (t: TestContext, { resolver, skills = [] }: { resolver?: WorkspaceResolver; skills?: readonly string[] } = {}) => {
  const root = await realpath(await mkdtemp(path.join(tmpdir(), "ragents-foreign-machine-")));
  t.after(() => rm(root, { recursive: true, force: true }));
  const registry = new WorkspaceClientRegistry();
  const { url } = await startRpcServer(t, { methods: clientMethods(registry) });
  const bindings = new Map<string, WorkspaceBinding>();
  const runState = (runId: string): RunState => {
    const binding = bindings.get(runId) ?? bindings.get("*");
    if (!binding) throw new Error(`Der Test hat den Run ${runId} nicht gebunden`);
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
    storeBinding: () => { throw new Error("Der Test bindet nicht um"); },
    clients: registry,
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

test("der Reiter Dateien holt Liste, Vorschau und Änderungen vom Arbeitsplatz, nicht vom Server", async (t) => {
  const server = await serverFixture(t);
  const project = path.join(server.root, "arbeitsplatz", "projekt");
  await mkdir(path.join(project, "src"), { recursive: true });
  await writeFile(path.join(project, "src", "app.ts"), "export const ort = \"Arbeitsplatz\";\n");
  const offered = `/fremder-rechner-${randomUUID()}/projekt`;
  await missingOnServer(offered);
  const workstation = await foreignWorkstation(t, server.url, "notebook-0001", "Notebook", { [offered]: project }, [fileModule]);
  server.bindings.set("fremd", { machine: { client: "notebook-0001", label: "Notebook" }, folder: { path: offered } });

  const listing = await server.list("fremd", "workspace", "");
  assert.deepEqual(listing.entries.map((entry) => entry.name), ["src"]);
  assert.equal(listing.location, `Arbeitsplatz Notebook: ${project}`);
  assert.deepEqual((await server.list("fremd", "workspace", "src")).entries.map((entry) => entry.name), ["app.ts"]);
  const preview = await server.preview("fremd", "workspace", "src/app.ts");
  assert.equal(preview.previewable === true ? preview.content : undefined, "export const ort = \"Arbeitsplatz\";\n");
  await assert.rejects(server.preview("fremd", "workspace", "../geheim"), (error: unknown) =>
    error instanceof DomainError && error.code === "workspace-path-invalid" && error.status === 400);

  const messages: unknown[] = [];
  const stop = await server.channel.open({ runId: "fremd", root: "workspace" }, (message) => messages.push(message),
    { access: server.context.access, connection: server.context.connection });
  await writeFile(path.join(project, "src", "neu.ts"), "export {};\n");
  await until(() => messages.length > 0);
  stop();
  assert.deepEqual(messages, [{ changed: true }]);
  assert.deepEqual([...new Set(workstation.operations)].sort(), ["files.list", "files.read", "files.watch"]);
});

test("ein Arbeitsplatz mit dem Ordner / liefert über den Reiter Dateien nie die Dateien des Servers", async (t) => {
  const server = await serverFixture(t);
  const machineRoot = path.join(server.root, "arbeitsplatz-wurzel");
  await mkdir(machineRoot, { recursive: true });
  await writeFile(path.join(machineRoot, "nur-auf-dem-arbeitsplatz.txt"), "vom Arbeitsplatz\n");
  await foreignWorkstation(t, server.url, "wurzel-0001", "Wurzel", { "/": machineRoot }, [fileModule]);
  server.bindings.set("wurzel", { machine: { client: "wurzel-0001", label: "Wurzel" }, folder: { path: "/" } });

  const listing = await server.list("wurzel", "workspace", "");
  assert.deepEqual(listing.entries.map((entry) => entry.name), ["nur-auf-dem-arbeitsplatz.txt"]);
  const own = await server.preview("wurzel", "workspace", "nur-auf-dem-arbeitsplatz.txt");
  assert.equal(own.previewable === true ? own.content : undefined, "vom Arbeitsplatz\n");
  await assert.rejects(server.preview("wurzel", "workspace", "etc/hosts"), (error: unknown) =>
    error instanceof DomainError && error.code === "workspace-path-not-found" && error.status === 404);
});

const exited = (child: ChildProcess): Promise<void> =>
  child.exitCode !== null || child.signalCode !== null ? Promise.resolve() : new Promise((resolve) => child.once("exit", () => resolve()));

test("die Prozessanzeige zeigt und beendet die Prozesse des Arbeitsplatzes, nicht die des Servers", { skip: !hasProcessTable() }, async (t) => {
  const server = await serverFixture(t);
  const project = path.join(server.root, "arbeitsplatz", "projekt");
  await mkdir(project, { recursive: true });
  const offered = `/fremder-rechner-${randomUUID()}/projekt`;
  const runId = `fremde-prozesse-${process.pid}`;
  const child = spawn(process.execPath, ["-e", [
    "const server = require('node:net').createServer();",
    "server.listen(0, '127.0.0.1', () => process.stdout.write(String(server.address().port) + '\\n'));",
    "setTimeout(() => process.exit(0), 30000);",
  ].join("")], { detached: true, env: { ...process.env, [RUN_MARKER_ENV]: `nur-auf-dem-server-${process.pid}` }, stdio: ["ignore", "pipe", "inherit"] });
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
  // Nur die Prozesstabelle des Arbeitsplatzes ordnet den Prozess dem Run zu; auf dem Server trägt er einen anderen Marker.
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

/** Die Actor-Programme eines Runs liegen auf dem Server unter @actors, wie sie `ragents.actor-programs` registriert. */
const actorRoot = async (server: Awaited<ReturnType<typeof serverFixture>>): Promise<string> => {
  const actors = path.join(server.root, "server", "actors");
  await mkdir(path.join(actors, "app", "src"), { recursive: true });
  server.runtime.sandbox.registerWorkspaceRoot({ id: "actors", alias: "@actors", environmentVariable: "RAGENTS_ACTORS_DIR", directoryFor: () => actors });
  return actors;
};

/** Ein Projekt, das nur auf dem Arbeitsplatz liegt, und der Pfad, unter dem der Arbeitsplatz es anbietet. */
const workstationProject = async (server: Awaited<ReturnType<typeof serverFixture>>): Promise<{ project: string; offered: string }> => {
  const project = path.join(server.root, "arbeitsplatz", "projekt");
  await mkdir(project, { recursive: true });
  await writeFile(path.join(project, "README.md"), "Vom Arbeitsplatz\n");
  const offered = `/fremder-rechner-${randomUUID()}/projekt`;
  await missingOnServer(offered);
  return { project, offered };
};

/** Ein Werkzeugergebnis des Executors trägt Textteile, ein Werkzeug im Turn liefert den Text selbst. */
const textOf = (result: unknown): string => typeof result === "string" ? result
  : (result as { content: Array<{ text?: string }> }).content.map((part) => part.text ?? "").join("\n");

test("typescript_eval mit path liest die Datei vom Arbeitsplatz und läuft im eigenen Ordner des Runs auf dem Server", async (t) => {
  const server = await serverFixture(t);
  const actors = await actorRoot(server);
  await writeFile(path.join(actors, "setup.ts"), "return { ort: \"Server\" };\n");
  const project = path.join(server.root, "arbeitsplatz", "projekt");
  await mkdir(path.join(project, "snippets"), { recursive: true });
  await writeFile(path.join(project, "snippets", "rechne.ts"), "return { antwort: 6 * 7, ort: process.cwd() };\n");
  const offered = `/fremder-rechner-${randomUUID()}/projekt`;
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
  const queued = postTo(setup.runtime, setup.view, setup.agent.id, "snippet-input", "Rechne.");
  const input = queued.inputs.find((entry) => entry.actorId === setup.agent.id && entry.lifecycle.kind === "pending");
  assert.ok(input);
  const turn = claimTurn(setup.runtime, setup.view.id, setup.agent.id, input.id, "snippet-turn");
  const toolset = await TurnToolset.create({ runtime: setup.runtime, turn, catalog, registry, workspace: offered });

  const output = (await toolset.invoke("eval-path", "typescript_eval", { path: "snippets/rechne.ts" })).output as { result: { antwort: number; ort: string } };
  assert.equal(output.result.antwort, 42);
  const serverFolder = path.join(server.root, "server", "sessions", setup.view.id, "plugins", "ragents.workspace", "server");
  assert.equal(await realpath(output.result.ort), serverFolder);
  assert.deepEqual(workstation.operations, ["files.read"]);
  assert.deepEqual((await toolset.invoke("eval-alias", "typescript_eval", { path: "@actors/setup.ts" })).output, { result: { ort: "Server" }, logs: [] });
  assert.deepEqual(workstation.operations, ["files.read"], "die Datei unter @actors kommt vom Server");
});

test("Dateiwerkzeuge mit @actors laufen in einem Arbeitsplatz-Run auf dem Server, ohne Alias auf dem Arbeitsplatz", async (t) => {
  const server = await serverFixture(t);
  const actors = await actorRoot(server);
  const { offered, project } = await workstationProject(server);
  const workstation = await foreignWorkstation(t, server.url, "notebook-0006", "Notebook", { [offered]: project }, [sandboxToolsModule, fileModule]);
  server.bindings.set("aktoren", { machine: { client: "notebook-0006", label: "Notebook" }, folder: { path: offered } });
  const execute = (operation: string, input: unknown) => server.runtime.sandbox.execute("aktoren", operation, input);

  await execute("write", { path: "@actors/app/src/index.ts", content: "export const wert = 1;\n" });
  await execute("edit", { path: "@actors/app/src/index.ts", edits: [{ oldText: "wert = 1", newText: "wert = 2" }] });
  assert.equal(await readFile(path.join(actors, "app", "src", "index.ts"), "utf8"), "export const wert = 2;\n");
  assert.match(textOf(await execute("read", { path: "@actors/app/src/index.ts" })), /wert = 2/);
  assert.deepEqual((await execute(FILE_OPERATIONS.list, { path: "app", alias: "@actors" }) as FileListing).entries.map((entry) => entry.name), ["src"]);
  const source = await execute(FILE_OPERATIONS.read, { path: "app/src/index.ts", alias: "@actors" }) as FileText;
  assert.equal(source.previewable ? source.content : undefined, "export const wert = 2;\n");
  assert.deepEqual(workstation.operations, [], "kein Aufruf mit @actors erreicht den Arbeitsplatz");

  assert.match(textOf(await execute("read", { path: "README.md" })), /Vom Arbeitsplatz/);
  assert.deepEqual(workstation.operations, ["read"]);
  await assert.rejects(execute("read", { path: "@apps/liste.ts" }), (error: unknown) =>
    error instanceof DomainError && error.code === "workspace-alias-unknown" && /@apps \(bekannt: @actors\)/.test(error.message));
});

test("eine Bash ohne Alias läuft auf dem Arbeitsplatz, mit @actors als cwd auf dem Server, und nur dort gibt es RAGENTS_ACTORS_DIR", async (t) => {
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
  assert.deepEqual(workstation.operations, ["bash"], "eine Bash mit @actors erreicht den Arbeitsplatz nicht");
  await assert.rejects(server.runtime.sandbox.execute("bash", "bash", { command: "pwd", cwd: actors }), (error: unknown) =>
    error instanceof DomainError && error.code === "workspace-path-invalid");
  await assert.rejects(server.runtime.sandbox.execute("bash", "bash", { command: "pwd", cwd: "@actors/fehlt" }), (error: unknown) =>
    error instanceof DomainError && error.code === "workspace-path-not-found");
});

test("die Sprachserver öffnen @actors in einem Arbeitsplatz-Run auf dem Server, ein Aufruf über beide Rechner scheitert mit Ursache", async (t) => {
  const server = await serverFixture(t);
  const actors = await actorRoot(server);
  await writeFile(path.join(actors, "app", "src", "index.ts"), "export const wert: number = \"Text\";\n");
  const { offered, project } = await workstationProject(server);
  const workstation = await foreignWorkstation(t, server.url, "notebook-0008", "Notebook", { [offered]: project }, [sandboxToolsModule]);
  server.bindings.set("sprache", { machine: { client: "notebook-0008", label: "Notebook" }, folder: { path: offered } });
  const execute = (operation: string, input: unknown) => server.runtime.sandbox.execute("sprache", operation, input);

  assert.match(String(await execute("typescript_open", { root: "@actors/app" })), /TypeScript-Server auf app bereit/);
  const diagnostics = String(await execute("typescript_diagnostics", { paths: ["@actors/app/src/index.ts"] }));
  assert.match(diagnostics, /Diagnostik \(TypeScript\) @actors\/app\/src\/index\.ts: 1 Fehler/);
  assert.match(textOf(await execute("write", { path: "@actors/app/src/index.ts", content: "export const wert: number = 1;\n" })), /keine Fehler/);
  await assert.rejects(execute("typescript_diagnostics", { root: "@actors/app", paths: ["src/index.ts"] }), (error: unknown) =>
    error instanceof DomainError && error.code === "workspace-roots-mixed" && error.status === 400 && /@actors/.test(error.message));
  assert.deepEqual(workstation.operations, []);
  assert.match(String(await execute("typescript_close", { root: "@actors/app" })), /beendet/);
});

test("Skills sind in einem Arbeitsplatz-Run unter @skills lesbar, samt der Dateien daneben, aber nicht beschreibbar", async (t) => {
  const skills = await realpath(await mkdtemp(path.join(tmpdir(), "ragents-foreign-skills-")));
  t.after(() => rm(skills, { recursive: true, force: true }));
  const skill = path.join(skills, "notizen");
  await mkdir(skill);
  await writeFile(path.join(skill, "SKILL.md"), "---\nname: notizen\ndescription: Notizen ordnen.\n---\nLies vorlage.md.\n");
  await writeFile(path.join(skill, "vorlage.md"), "# Vorlage\n");
  const server = await serverFixture(t, { skills: [skill] });
  const { offered, project } = await workstationProject(server);
  const workstation = await foreignWorkstation(t, server.url, "notebook-0009", "Notebook", { [offered]: project }, [sandboxToolsModule, fileModule]);
  server.bindings.set("skill", { machine: { client: "notebook-0009", label: "Notebook" }, folder: { path: offered } });
  const execute = (operation: string, input: unknown) => server.runtime.sandbox.execute("skill", operation, input);

  assert.match(textOf(await execute("read", { path: "@skills/notizen/SKILL.md" })), /Lies vorlage\.md/);
  assert.match(textOf(await execute("read", { path: "@skills/notizen/vorlage.md" })), /# Vorlage/);
  assert.match(textOf(await execute("bash", { command: "cat vorlage.md", cwd: "@skills/notizen" })), /# Vorlage/);
  const listed = await execute(FILE_OPERATIONS.list, { path: "notizen", alias: "@skills" }) as FileListing;
  assert.deepEqual(listed.entries.map((entry) => entry.name), ["SKILL.md", "vorlage.md"]);
  await assert.rejects(execute("write", { path: "@skills/notizen/neu.md", content: "nein" }), /außerhalb/);
  await assert.rejects(execute("read", { path: "@skills/fehlt/SKILL.md" }), (error: unknown) =>
    error instanceof DomainError && error.code === "workspace-alias-unknown" && /@skills\/fehlt/.test(error.message));
  assert.deepEqual(workstation.operations, []);
});

test("die Selbstbeschreibung nennt die Wurzeln des Servers je Bindung, ihre Variablen im Arbeitsplatz-Run nur für die Bash dort", async (t) => {
  const skills = await realpath(await mkdtemp(path.join(tmpdir(), "ragents-foreign-skills-")));
  t.after(() => rm(skills, { recursive: true, force: true }));
  await mkdir(path.join(skills, "notizen"));
  const server = await serverFixture(t, { skills: [path.join(skills, "notizen")] });
  await actorRoot(server);
  server.bindings.set("fremd", { machine: { client: "notebook-0010", label: "Notebook" }, folder: { path: "/fremder-rechner/projekt" } });
  server.bindings.set("hier", { machine: "server", folder: "fresh" });

  const remote = (await server.runtime.resolve("fremd", () => undefined)).description ?? "";
  assert.match(remote, /## Roots on the server/);
  assert.match(remote, /`@actors` \(read and write\) and `@skills` \(read only\)/);
  assert.match(remote, /with a `cwd` that starts with an alias it runs on the server instead and sees only the server, and only that bash has `\$RAGENTS_ACTORS_DIR` for `@actors`/);
  assert.match(remote, /never combine a path with an alias and a path in the working directory/);
  const local = (await server.runtime.resolve("hier", () => undefined)).description ?? "";
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
  assert.equal(await program.functions.transform({ value: " hallo " }, createTestContext({ state: {} })), "HALLO");
});
`,
};

test("ein Actor-Programm entsteht, wird mit den Dateiwerkzeugen bearbeitet und aktiviert in einem Arbeitsplatz-Run", async (t) => {
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
      if (!actor) throw new Error(`Den Actor ${actorId} gibt es im Test nicht`);
      return registry.resolve({ runId, actorId, actor, turnId: null, view: provisional ? { ...view, actors: [...view.actors, provisional] } : view, workspace: offered });
    },
    askService: () => ({ ask: async () => { throw new Error("Der Test erwartet keine Rückfrage"); } }),
    reservedToolNames: () => [],
    serverProcessContextFor,
    operations: { operation: () => { throw new Error("Der Test hat keine Operationen"); }, invoke: async () => { throw new Error("Der Test hat keine Operationen"); }, list: () => [] },
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
  const queued = postTo(setup.runtime, setup.view, setup.agent.id, "program-input", "Baue ein Programm.");
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
  assert.deepEqual(await call("use", "typescript_eval", { code: 'return context.functions.format_text({ value: " hallo " });' }), { result: "HALLO", logs: [] });
  assert.deepEqual(workstation.operations, [], "Anlegen, Bearbeiten und Aktivieren bleiben auf dem Server");
  await missingOnServer(offered);
});

test("die Browserprüfung läuft auf dem Arbeitsplatz, ihre Aufnahmen liegen in der Ablage des Servers", async (t) => {
  const server = await serverFixture(t);
  const project = path.join(server.root, "arbeitsplatz", "projekt");
  await mkdir(project, { recursive: true });
  const offered = `/fremder-rechner-${randomUUID()}/projekt`;
  await missingOnServer(offered);
  const stub = stubBrowser({
    "/": { title: "App auf dem Arbeitsplatz", elements: [{ role: "button", name: "Speichern", onClick: (page) => page.show({ role: "status", name: "Gespeichert" }) }] },
  });
  const workstation = await foreignWorkstation(t, server.url, "notebook-0004", "Notebook", { [offered]: project },
    [browserModule({ launch: stub.launch, timeoutMs: 500, checkTimeoutMs: 50 })]);
  const runId = "fremder-browser";
  server.bindings.set(runId, { machine: { client: "notebook-0004", label: "Notebook" }, folder: { path: offered } });
  const documents = path.join(server.root, "server", "documents", runId);
  const browser = new RunBrowser({ sandbox: server.runtime.sandbox, filesFor: async () => documents });
  t.after(() => browser.shutdown());

  const opened = await browser.open(runId, "http://localhost:4173/");
  assert.equal(opened.title, "App auf dem Arbeitsplatz");
  await browser.click(runId, { role: "button", name: "Speichern" });
  const checked = await browser.check(runId, { target: { role: "status" }, text: "Gespeichert" });
  const shot = await browser.screenshot(runId, { label: "Vom Arbeitsplatz" });
  assert.equal(await readFile(path.join(documents, shot.path), "utf8"), "PNG 1920x1080");
  assert.equal((await browser.image(runId)).toString(), "PNG 1920x1080");
  assert.deepEqual(await readdir(project), [], "der Arbeitsplatz legt keine Aufnahme ab");
  assert.deepEqual(browser.evidence(runId), {
    checkedAt: checked.checkedAt,
    url: "http://localhost:4173/",
    screenshots: [{ name: "Vom Arbeitsplatz", url: shot.url }],
    currentScreenshots: [{ name: "Vom Arbeitsplatz", url: shot.url }],
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
  assert.equal(browser.evidence(runId).url, undefined, "ohne Arbeitsplatz kennt der Server keinen Stand der Seite");
  assert.equal(browser.evidence(runId).screenshots.length, 1);
});

test("ein neuer Ordner je Run entsteht auf dem Arbeitsplatz als Git-Worktree des Beitrags und verschwindet mit dem Run", async (t) => {
  const git = (cwd: string, ...args: string[]): string =>
    execFileSync("git", ["-c", "user.name=Beispiel", "-c", "user.email=beispiel@example.invalid", ...args], { cwd, encoding: "utf8" });
  const worktreeStep = (repository: string, ...args: string[]) =>
    ({ operation: "commands.run", input: { program: "git", args: ["-C", repository, "worktree", ...args], timeoutMs: 30_000 } });
  let repository = "";
  const resolver: WorkspaceResolver = {
    workstation: {
      label: "Git-Worktree je Run",
      prepare: ({ runId, path: folder }) => [worktreeStep(repository, "add", "-b", `ragents/${runId}`, folder)],
      release: ({ path: folder }) => [worktreeStep(repository, "remove", "--force", folder)],
    },
    resolve: () => Promise.reject(new Error("auf dem Server nicht gefragt")),
  };
  const server = await serverFixture(t, { resolver });
  repository = path.join(server.root, "arbeitsplatz", "projekt");
  const runs = path.join(server.root, "arbeitsplatz", "runs");
  await mkdir(repository, { recursive: true });
  git(repository, "init", "-q", "-b", "main");
  await writeFile(path.join(repository, "README.md"), "Hallo vom Arbeitsplatz\n");
  git(repository, "add", "README.md");
  git(repository, "commit", "-q", "-m", "Anfang");
  const workstation = await foreignWorkstation(t, server.url, "notebook-0005", "Notebook", { [repository]: repository },
    [runFolderModule((runId) => path.join(runs, runId)), commandModule(), sandboxToolsModule], runs);
  const runId = "neuer-worktree";
  const folder = path.join(runs, runId);
  server.bindings.set(runId, { machine: { client: "notebook-0005", label: "Notebook" }, folder: { path: folder, fresh: true } });

  const workspace = await server.runtime.resolve(runId, () => undefined);
  assert.equal(workspace.cwd, folder);
  await missingOnServer(folder);
  const read = await server.runtime.sandbox.execute(runId, "read", { path: "README.md" }) as { content: Array<{ text: string }> };
  assert.match(read.content[0]!.text, /Hallo vom Arbeitsplatz/);
  assert.deepEqual(workstation.operations, ["runFolder.create", "commands.run", "read"]);
  assert.match(git(repository, "worktree", "list"), new RegExp(`${runId}.*\\[ragents/${runId}\\]`));
  await server.runtime.sandbox.execute(runId, "read", { path: "README.md" });
  assert.deepEqual(workstation.operations.slice(3), ["read"], "der Worktree entsteht nur einmal");
  assert.equal(await stat(path.join(server.root, "server", "sessions", runId, "plugins", "ragents.workspace", "workspace")).catch(() => undefined), undefined);

  await server.runtime.deleteSession(runId);
  assert.deepEqual(workstation.operations.slice(4), ["stop", "commands.run", "runFolder.remove"]);
  await missingOnServer(folder);
  assert.doesNotMatch(git(repository, "worktree", "list"), new RegExp(runId));
});
