import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { mkdir, mkdtemp, readdir, readFile, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import {
  COMMAND_OPERATIONS,
  FILE_OPERATIONS,
  FILE_READ_LIMIT,
  PROCESS_OPERATIONS,
  RUN_MARKER_ENV,
  WorkspaceOperationError,
  WorkspaceOperationExecutor,
  containsWorkspacePath,
  fileModule,
  hasProcessTable,
  languageServerModule,
  processModule,
  workspaceExecutorModules,
  workspaceProcessContext,
  type FileListing,
  type FileText,
  type ProcessRecord,
  type ProcessTable,
  type WorkspaceExecutorModule,
  type WorkspaceModuleFactory,
  type WorkspaceProcessSnapshot,
} from "../src/index.ts";
import { processExists } from "../src/managed-process.ts";

const until = async (condition: () => boolean, timeoutMs = 5000): Promise<void> => {
  const started = Date.now();
  while (!condition()) {
    if (Date.now() - started > timeoutMs) throw new Error("Condition was not met.");
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
};

const coded = (code: string, pattern?: RegExp) => (error: unknown): boolean =>
  error instanceof WorkspaceOperationError && error.code === code && (pattern === undefined || pattern.test(error.message));

const contextIn = (directory: string, aliases: Readonly<Record<string, string>> = {}) => (runId: string) =>
  Promise.resolve(workspaceProcessContext({
    runId,
    cwd: directory,
    root: directory,
    home: { home: directory },
    logDirectory: directory,
    hostRoot: undefined,
    additionalRoots: Object.entries(aliases).map(([alias, root]) => ({ directory: root, alias })),
  }));

const demoAdapter = {
  id: "demo", label: "Demo LSP", languages: { ".demo": "demo" }, rootDescription: "directory",
  resolveRoot: async (_workspace: string, root: string) => root,
  rootDirectory: (root: string) => root,
  launch: async () => { throw new Error("The test starts no language server"); },
  open: async () => "unused",
};

test("the language server operations check their input before they create a root", async () => {
  const executor = new WorkspaceOperationExecutor({ contextFor: contextIn(tmpdir()), modules: [languageServerModule([demoAdapter])] });
  await assert.rejects(executor.execute("run-1", "demo_open", {}), coded("language-server-input-invalid", /demo_open: root is missing/));
  await assert.rejects(executor.execute("run-1", "demo_open", null), coded("language-server-input-invalid", /root is missing/));
  await assert.rejects(executor.execute("run-1", "demo_open", { root: 3 }), coded("language-server-input-invalid", /root must be a text/));
  await assert.rejects(executor.execute("run-1", "demo_close", "everything"), coded("language-server-input-invalid", /an object/));
  await assert.rejects(executor.execute("run-1", "demo_diagnostics", { paths: "a.demo" }), coded("language-server-input-invalid", /paths must be a list of texts/));
  await assert.rejects(executor.execute("run-1", "demo_diagnostics", { warnings: "yes" }), coded("language-server-input-invalid", /warnings must be true or false/));
  assert.deepEqual(await executor.execute("run-1", "demo_snapshot", null), { instances: [] });
  await assert.rejects(executor.execute("run-1", "demo_open", { root: "a", ifNoneOpen: "yes" }), coded("language-server-input-invalid", /ifNoneOpen must be true or false/));
  await assert.rejects(executor.execute("run-1", "demo_solutions", null), coded("workspace-operation-unknown"));
  await assert.rejects(executor.execute("run-1", "demo_switch", { root: null }), coded("workspace-operation-unknown"));
  await executor.shutdown();
  const withSolutions = new WorkspaceOperationExecutor({
    contextFor: contextIn(tmpdir()),
    modules: [languageServerModule([{ ...demoAdapter, solutionExtensions: [".demo"] }])],
  });
  await assert.rejects(withSolutions.execute("run-1", "demo_switch", {}), coded("language-server-input-invalid", /demo_switch: root must be a text or null/));
  await assert.rejects(withSolutions.execute("run-1", "demo_switch", { root: 3 }), coded("language-server-input-invalid", /root must be a text or null/));
  assert.match(await withSolutions.execute("run-1", "demo_switch", { root: null }) as string, /is not open in this run/);
  await withSolutions.shutdown();
});

test("every operation belongs to exactly one module, an unknown one is an error with a code", async () => {
  const echo = (): WorkspaceExecutorModule => ({ operations: { echo: async ({ input }) => input } });
  assert.throws(
    () => new WorkspaceOperationExecutor({ contextFor: contextIn(tmpdir()), modules: [echo, echo] }),
    /The operation echo is registered twice in the executor/,
  );
  const executor = new WorkspaceOperationExecutor({ contextFor: contextIn(tmpdir()), modules: [echo] });
  assert.equal(await executor.execute("run-1", "echo", "hello"), "hello");
  await assert.rejects(executor.execute("run-1", "grep", null), coded("workspace-operation-unknown", /does not know the operation grep/));
});

test("the executor brings no language server along; each one is added by a contribution", async () => {
  const bare = new WorkspaceOperationExecutor({ contextFor: contextIn(tmpdir()), modules: workspaceExecutorModules({ contributions: [] }) });
  await assert.rejects(bare.execute("run-1", "demo_snapshot", null), coded("workspace-operation-unknown"));
  await bare.shutdown();
  const contributed = new WorkspaceOperationExecutor({
    contextFor: contextIn(tmpdir()),
    modules: workspaceExecutorModules({ contributions: [{}, { languageServers: [demoAdapter] }] }),
  });
  assert.deepEqual(await contributed.execute("run-1", "demo_snapshot", null), { instances: [] });
  await contributed.shutdown();
  assert.throws(() => workspaceExecutorModules({ contributions: [{ languageServers: [demoAdapter] }, { languageServers: [demoAdapter] }] }), /The language server demo occurs twice in the executor/);
});

test("the footprint of an input names its roots and its running time, declared by the module of the operation", async () => {
  const executor = new WorkspaceOperationExecutor({
    contextFor: contextIn(tmpdir()),
    modules: workspaceExecutorModules({ contributions: [{ languageServers: [demoAdapter] }] }),
  });
  const roots = (operation: string, input: unknown) => executor.footprintOf(operation, input).roots;
  assert.deepEqual(roots("read", { path: "@actors/app/src/index.ts" }), { aliases: ["@actors"], runRoot: false });
  assert.deepEqual(roots("write", { path: "src/index.ts", content: "" }), { aliases: [], runRoot: true });
  assert.deepEqual(roots("edit", { path: "/abs/src/index.ts" }), { aliases: [], runRoot: true });
  assert.deepEqual(roots("bash", { command: "ls" }), { aliases: [], runRoot: false });
  assert.deepEqual(executor.footprintOf("bash", { command: "ls", cwd: "@skills/notes", timeout: 30 }), { roots: { aliases: ["@skills"], runRoot: false }, durationMs: 30_000 });
  assert.deepEqual(roots("demo_open", { root: "@actors/app" }), { aliases: ["@actors"], runRoot: false });
  assert.deepEqual(roots("demo_diagnostics", { root: "@actors/app", paths: ["src/a.demo", "@actors/app/b.demo"] }), { aliases: ["@actors"], runRoot: true });
  assert.deepEqual(roots("demo_diagnostics", {}), { aliases: [], runRoot: false });
  assert.deepEqual(roots(FILE_OPERATIONS.read, { path: "SKILL.md", alias: "@skills/notes" }), { aliases: ["@skills"], runRoot: false });
  assert.deepEqual(roots(FILE_OPERATIONS.list, { path: "@actors" }), { aliases: [], runRoot: true });
  assert.deepEqual(executor.footprintOf(COMMAND_OPERATIONS.run, { program: "git", timeoutMs: 5_000 }), { roots: { aliases: [], runRoot: true }, durationMs: 5_000 });
  assert.deepEqual(executor.footprintOf(PROCESS_OPERATIONS.snapshot, null), { roots: { aliases: [], runRoot: false } });
  assert.deepEqual(roots("read", "not an object"), { aliases: [], runRoot: false });
  const stray: WorkspaceModuleFactory = () => ({ operations: {}, footprints: { stray: () => ({ roots: { aliases: [], runRoot: false } }) } });
  assert.throws(() => new WorkspaceOperationExecutor({ contextFor: contextIn(tmpdir()), modules: [stray] }), /footprint for stray, an operation it does not have/);
  await executor.shutdown();
});

test("an alias names exactly one root, and under a shared alias like @skills the first folder chooses the root", async () => {
  const directory = await realpath(await mkdtemp(path.join(tmpdir(), "ragents-shared-alias-")));
  const notes = path.join(directory, "skills", "notes");
  await mkdir(notes, { recursive: true });
  await writeFile(path.join(notes, "SKILL.md"), "Notes\n");
  const context = (roots: readonly { directory: string; alias: string }[]) => workspaceProcessContext({
    runId: "run-1", cwd: directory, root: directory, home: { home: directory }, logDirectory: directory, hostRoot: undefined, readOnlyRoots: roots,
  });
  try {
    assert.throws(() => context([{ directory: notes, alias: "@skills/notes" }, { directory, alias: "@skills/notes" }]), /@skills\/notes names more than one root/);
    assert.throws(() => context([{ directory: notes, alias: "@skills" }, { directory: notes, alias: "@skills/notes" }]), /@skills names more than one root/);
    const executor = new WorkspaceOperationExecutor({ contextFor: async () => context([{ directory: notes, alias: "@skills/notes" }]), modules: [fileModule] });
    for (const input of [{ alias: "@skills/notes", path: "SKILL.md" }, { alias: "@skills", path: "notes/SKILL.md" }]) {
      const text = await executor.execute("run-1", FILE_OPERATIONS.read, input) as FileText;
      assert.equal(text.previewable ? text.content : undefined, "Notes\n", JSON.stringify(input));
    }
    await assert.rejects(executor.execute("run-1", FILE_OPERATIONS.read, { alias: "@skills", path: "missing/SKILL.md" }),
      coded("workspace-alias-unknown", /Unknown working directory alias: @skills\/missing \(known: @skills\/notes\)/));
    await assert.rejects(executor.execute("run-1", FILE_OPERATIONS.list, { alias: "@skills", path: "" }), coded("workspace-alias-unknown"));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("progress is a JSON value, annotations come from all modules, stopRun and shutdown reach every module", async () => {
  const steps: string[] = [];
  const reporting: WorkspaceModuleFactory = (host) => ({
    operations: {
      report: async ({ runId, progress }) => {
        progress?.({ step: 1, runId });
        return host.annotate(runId, "/file.ts");
      },
    },
    annotate: async () => "first annotation",
    stopRun: async (runId) => { steps.push(`stop ${runId}`); },
    shutdown: async () => { steps.push("shutdown"); },
  });
  const quiet: WorkspaceModuleFactory = () => ({
    operations: {},
    annotate: async (_runId, file) => `second annotation for ${file}`,
    stopRun: async (runId) => { steps.push(`still ${runId}`); },
  });
  const executor = new WorkspaceOperationExecutor({ contextFor: contextIn(tmpdir()), modules: [reporting, quiet] });
  const progress: unknown[] = [];
  const note = await executor.execute("run-1", "report", null, { onProgress: (value) => progress.push(value) });
  assert.deepEqual(progress, [{ step: 1, runId: "run-1" }]);
  assert.equal(note, "first annotation\nsecond annotation for /file.ts");
  await executor.stopRun("run-1");
  await executor.shutdown();
  assert.deepEqual(steps, ["stop run-1", "still run-1", "shutdown"]);
  await assert.rejects(executor.execute("run-1", "report", null, { untilAborted: true }), /needs an abort signal for that/);
});

const fileFixture = async () => {
  const directory = await realpath(await mkdtemp(path.join(tmpdir(), "ragents-files-")));
  const workspace = path.join(directory, "workspace");
  const actors = path.join(directory, "actors");
  const outside = path.join(directory, "outside");
  await Promise.all([path.join(workspace, "src"), path.join(workspace, ".git"), actors, outside].map((entry) => mkdir(entry, { recursive: true })));
  await writeFile(path.join(workspace, "notes.md"), "Greetings from the run\n");
  await writeFile(path.join(workspace, ".env"), "TOKEN=1\n");
  await writeFile(path.join(workspace, "app.bin"), Buffer.from([0x50, 0x00, 0x4b]));
  await writeFile(path.join(workspace, "big.txt"), "x".repeat(FILE_READ_LIMIT + 1));
  await writeFile(path.join(workspace, "src", "index.ts"), "export const x = 1;\n");
  await writeFile(path.join(actors, "setup.ts"), "return 1;\n");
  await writeFile(path.join(outside, "secret.txt"), "not for the run\n");
  await symlink(outside, path.join(workspace, "link-out"));
  const executor = new WorkspaceOperationExecutor({ contextFor: contextIn(workspace, { "@actors": actors }), modules: [fileModule] });
  return {
    workspace,
    executor,
    list: (target: string, alias?: string) =>
      executor.execute("run-1", FILE_OPERATIONS.list, { path: target, ...(alias ? { alias } : {}) }) as Promise<FileListing>,
    read: (target: string, alias?: string) =>
      executor.execute("run-1", FILE_OPERATIONS.read, { path: target, ...(alias ? { alias } : {}) }) as Promise<FileText>,
    close: () => rm(directory, { recursive: true, force: true }),
  };
};

test("files: the listing names folders first, then alphabetically, relative to the root of the run", async () => {
  const f = await fileFixture();
  try {
    const root = await f.list("");
    assert.equal(root.location, f.workspace);
    assert.equal(root.path, "");
    assert.equal(root.truncated, false);
    assert.deepEqual(root.entries.map((entry) => [entry.name, entry.kind]), [
      [".git", "directory"], ["src", "directory"], [".env", "file"], ["app.bin", "file"], ["big.txt", "file"], ["link-out", "file"], ["notes.md", "file"],
    ]);
    assert.deepEqual((await f.list("./src/")).entries.map((entry) => entry.name), ["index.ts"]);
    assert.equal((await f.list("./src/")).path, "src");
  } finally {
    await f.close();
  }
});

test("files: no .., no absolute path, no escape through symlinks, missing paths with their own code", async () => {
  const f = await fileFixture();
  try {
    await assert.rejects(f.list("../outside"), coded("workspace-path-invalid", /Invalid path: \.\.\/outside/));
    await assert.rejects(f.list("/etc"), coded("workspace-path-invalid"));
    await assert.rejects(f.read("src\\index.ts"), coded("workspace-path-invalid"));
    await assert.rejects(f.read("link-out/secret.txt"), coded("workspace-path-invalid", /outside the working directory/));
    await assert.rejects(f.list("link-out"), coded("workspace-path-invalid"));
    await assert.rejects(f.list("nowhere"), coded("workspace-path-not-found", /Not found: nowhere/));
    await assert.rejects(f.list("notes.md"), coded("workspace-path-invalid", /Not a directory: notes\.md/));
    await assert.rejects(f.read("src"), coded("workspace-path-invalid", /Not a file: src/));
    await assert.rejects(f.executor.execute("run-1", FILE_OPERATIONS.read, {}), coded("workspace-path-invalid"));
  } finally {
    await f.close();
  }
});

test("files: text comes back, a binary or too large file names the reason, an alias chooses its root", async () => {
  const f = await fileFixture();
  try {
    assert.deepEqual(await f.read("notes.md"), {
      path: "notes.md",
      size: Buffer.byteLength("Greetings from the run\n"),
      previewable: true,
      content: "Greetings from the run\n",
    });
    const binary = await f.read("app.bin");
    assert.equal(binary.previewable === false ? binary.reason : undefined, "The file is binary");
    const big = await f.read("big.txt");
    assert.equal(big.previewable === false ? big.reason : undefined, "The file is larger than 256 KB and is not read");
    const aliased = await f.read("setup.ts", "@actors");
    assert.equal(aliased.previewable === true ? aliased.content : undefined, "return 1;\n");
    await assert.rejects(f.read("setup.ts", "@apps"), coded("workspace-alias-unknown", /Unknown working directory alias: @apps \(known: @actors\)/));
  } finally {
    await f.close();
  }
});

test("files: an attachment is stored under a free name in attachments, never over an existing file or behind a symlink", async () => {
  const directory = await realpath(await mkdtemp(path.join(tmpdir(), "ragents-attach-")));
  const outside = await realpath(await mkdtemp(path.join(tmpdir(), "ragents-attach-outside-")));
  const executor = new WorkspaceOperationExecutor({ contextFor: contextIn(directory), modules: [fileModule] });
  const attach = (name: string, content: Buffer) =>
    executor.execute("run-1", FILE_OPERATIONS.attach, { name, content: content.toString("base64") }) as Promise<{ name: string }>;
  try {
    const content = Buffer.from([0, 255, 13, 4]);
    assert.deepEqual(await attach("data.bin", content), { name: "data.bin" });
    assert.deepEqual(await attach("data.bin", content), { name: "2-data.bin" });
    assert.deepEqual(await attach("../Report (final).zip", content), { name: "Report__final_.zip" });
    assert.deepEqual(await readFile(path.join(directory, "attachments", "2-data.bin")), content);
    await assert.rejects(executor.execute("run-1", FILE_OPERATIONS.attach, { name: "x.bin" }), coded("workspace-path-invalid", /name and content/));
    await rm(path.join(directory, "attachments"), { recursive: true });
    await symlink(outside, path.join(directory, "attachments"));
    await assert.rejects(attach("data.bin", content), coded("workspace-path-invalid", /not a regular directory/));
    assert.deepEqual(await readdir(outside), []);
  } finally {
    await rm(directory, { recursive: true, force: true });
    await rm(outside, { recursive: true, force: true });
  }
});

test("files: the watch reports ready first, then debounced changes, until aborted", async () => {
  const f = await fileFixture();
  try {
    await assert.rejects(f.executor.execute("run-1", FILE_OPERATIONS.watch, {}, { signal: new AbortController().signal }),
      /needs an abort signal and progress/);
    const controller = new AbortController();
    const progress: unknown[] = [];
    const watching = f.executor.execute("run-1", FILE_OPERATIONS.watch, {}, {
      signal: controller.signal,
      untilAborted: true,
      onProgress: (value) => progress.push(value),
    });
    await until(() => progress.length === 1);
    assert.deepEqual(progress, [{ kind: "ready" }]);
    await writeFile(path.join(f.workspace, "src", "new.ts"), "export const y = 2;\n");
    await writeFile(path.join(f.workspace, "src", "second.ts"), "export const z = 3;\n");
    await until(() => progress.length >= 2);
    assert.deepEqual(progress[1], { kind: "changed" });
    controller.abort();
    assert.equal(await watching, null);
  } finally {
    await f.close();
  }
});

test("files: stop of the run and shutdown end open watches, even without an abort by the caller", async () => {
  const f = await fileFixture();
  const watch = (runId: string) => {
    const progress: unknown[] = [];
    const ended = f.executor.execute(runId, FILE_OPERATIONS.watch, {}, {
      signal: new AbortController().signal,
      untilAborted: true,
      onProgress: (value) => progress.push(value),
    });
    return { progress, ended };
  };
  try {
    const first = watch("run-1");
    const other = watch("run-2");
    await until(() => first.progress.length === 1 && other.progress.length === 1);
    await f.executor.stopRun("run-1");
    assert.equal(await first.ended, null);
    const late = watch("run-3");
    await until(() => late.progress.length === 1);
    await f.executor.shutdown();
    assert.deepEqual(await Promise.all([other.ended, late.ended]), [null, null]);
    await assert.rejects(watch("run-4").ended, /has ended and watches nothing anymore/);
  } finally {
    await f.close();
  }
});

test("paths: a drive root contains every path below it, a neighbor with the same prefix does not belong to it", () => {
  assert.equal(containsWorkspacePath("/", "/home/a/p"), true);
  assert.equal(containsWorkspacePath("/", "/"), true);
  assert.equal(containsWorkspacePath("/work", "/work"), true);
  assert.equal(containsWorkspacePath("/work", "/work/src/a.ts"), true);
  assert.equal(containsWorkspacePath("/work", "/work/..file"), true);
  assert.equal(containsWorkspacePath("/work", "/workshop/a.ts"), false);
  assert.equal(containsWorkspacePath("/work", "/"), false);
  assert.equal(containsWorkspacePath("/work/src", "/work"), false);
});

test("files: a run with the root / lists and reads below it", async () => {
  const directory = await realpath(await mkdtemp(path.join(tmpdir(), "ragents-root-")));
  await writeFile(path.join(directory, "file.txt"), "below the root\n");
  const executor = new WorkspaceOperationExecutor({ contextFor: contextIn(path.parse(directory).root), modules: [fileModule] });
  const relative = path.relative(path.parse(directory).root, directory).split(path.sep).join("/");
  try {
    const listing = await executor.execute("run-1", FILE_OPERATIONS.list, { path: relative }) as FileListing;
    assert.deepEqual(listing.entries.map((entry) => entry.name), ["file.txt"]);
    const text = await executor.execute("run-1", FILE_OPERATIONS.read, { path: `${relative}/file.txt` }) as FileText;
    assert.equal(text.previewable === true ? text.content : undefined, "below the root\n");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("processes: concurrent queries of two runs share one scan of the table", async () => {
  let scans = 0;
  const records: ProcessRecord[] = [
    { pid: 10, ppid: 1, pgid: 10, uid: process.getuid?.() ?? 0, startKey: "a", command: "node a.js" },
    { pid: 11, ppid: 1, pgid: 11, uid: process.getuid?.() ?? 0, startKey: "b", command: "node b.js" },
  ];
  const table: ProcessTable = {
    list: async () => {
      scans += 1;
      return records;
    },
    runMarkers: async () => new Map([[10, "run-a"], [11, "run-b"]]),
    listeningPorts: async () => new Map(),
  };
  const executor = new WorkspaceOperationExecutor({ contextFor: contextIn(tmpdir()), modules: [processModule({ table: () => table })] });
  const [first, second] = await Promise.all(["run-a", "run-b"].map((runId) =>
    executor.execute(runId, PROCESS_OPERATIONS.snapshot, {}) as Promise<WorkspaceProcessSnapshot>));
  assert.equal(scans, 1);
  assert.deepEqual(first!.processes.map((entry) => [entry.pid, entry.origin]), [[10, "background"]]);
  assert.deepEqual(second!.processes.map((entry) => [entry.pid, entry.origin]), [[11, "background"]]);
  await assert.rejects(executor.execute("run-a", PROCESS_OPERATIONS.stop, { processId: 12 }), coded("invalid-process"));
});

const exited = (child: ChildProcess): Promise<void> =>
  child.exitCode !== null || child.signalCode !== null ? Promise.resolve() : new Promise((resolve) => child.once("exit", () => resolve()));

const startMarked = (runId: string): Promise<{ child: ChildProcess; port: number }> =>
  new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["-e", [
      "const server = require('node:net').createServer();",
      "server.listen(0, '127.0.0.1', () => process.stdout.write(String(server.address().port) + '\\n'));",
      "setTimeout(() => process.exit(0), 30000);",
    ].join("")], { detached: true, env: { ...process.env, [RUN_MARKER_ENV]: runId }, stdio: ["ignore", "pipe", "inherit"] });
    let output = "";
    child.stdout?.on("data", (chunk: Buffer) => {
      output += chunk.toString("utf8");
      const port = Number(output.trim());
      if (Number.isInteger(port) && port > 0) resolve({ child, port });
    });
    child.once("error", reject);
  });

test("processes: the snapshot names marked processes with their port, ending hits one, the stop of the run all", { skip: !hasProcessTable() }, async () => {
  const runId = `executor-processes-${process.pid}`;
  const executor = new WorkspaceOperationExecutor({ contextFor: contextIn(tmpdir()), modules: [processModule()] });
  const first = await startMarked(runId);
  const second = await startMarked(runId);
  try {
    const snapshot = await executor.execute(runId, PROCESS_OPERATIONS.snapshot, {}) as WorkspaceProcessSnapshot;
    const seen = snapshot.processes.find((entry) => entry.pid === first.child.pid);
    assert.ok(seen, JSON.stringify(snapshot.processes));
    assert.deepEqual(seen.ports, [{ port: first.port, address: "127.0.0.1" }]);
    assert.equal(await executor.execute(runId, PROCESS_OPERATIONS.stop, { processId: seen.id }), null);
    await exited(first.child);
    assert.equal(processExists(second.child.pid!), true);
    await executor.stopRun(runId);
    await exited(second.child);
    assert.ok(second.child.signalCode !== null, "the stop of the run ends the second process with a signal");
  } finally {
    for (const { child } of [first, second]) if (child.pid && processExists(child.pid)) child.kill("SIGKILL");
  }
});
