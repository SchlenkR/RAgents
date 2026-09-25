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
    if (Date.now() - started > timeoutMs) throw new Error("Bedingung wurde nicht erfüllt.");
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

test("die Sprachserver-Operationen prüfen ihre Eingabe, bevor sie eine Wurzel anlegen", async () => {
  const adapter = {
    id: "demo", label: "Demo LSP", languages: { ".demo": "demo" }, rootDescription: "directory",
    resolveRoot: async (_workspace: string, root: string) => root,
    rootDirectory: (root: string) => root,
    launch: async () => { throw new Error("Der Test startet keinen Sprachserver"); },
    open: async () => "unbenutzt",
  };
  const executor = new WorkspaceOperationExecutor({ contextFor: contextIn(tmpdir()), modules: [languageServerModule([adapter])] });
  await assert.rejects(executor.execute("run-1", "demo_open", {}), coded("language-server-input-invalid", /demo_open: root fehlt/));
  await assert.rejects(executor.execute("run-1", "demo_open", null), coded("language-server-input-invalid", /root fehlt/));
  await assert.rejects(executor.execute("run-1", "demo_open", { root: 3 }), coded("language-server-input-invalid", /root muss ein Text sein/));
  await assert.rejects(executor.execute("run-1", "demo_close", "alles"), coded("language-server-input-invalid", /ein Objekt/));
  await assert.rejects(executor.execute("run-1", "demo_diagnostics", { paths: "a.demo" }), coded("language-server-input-invalid", /paths muss eine Liste von Texten/));
  await assert.rejects(executor.execute("run-1", "demo_diagnostics", { warnings: "ja" }), coded("language-server-input-invalid", /warnings muss true oder false/));
  assert.deepEqual(await executor.execute("run-1", "demo_snapshot", null), { instances: [] });
  await assert.rejects(executor.execute("run-1", "demo_open", { root: "a", ifNoneOpen: "ja" }), coded("language-server-input-invalid", /ifNoneOpen muss true oder false sein/));
  await assert.rejects(executor.execute("run-1", "demo_solutions", null), coded("workspace-operation-unknown"));
  await assert.rejects(executor.execute("run-1", "demo_switch", { root: null }), coded("workspace-operation-unknown"));
  await executor.shutdown();
  const withSolutions = new WorkspaceOperationExecutor({
    contextFor: contextIn(tmpdir()),
    modules: [languageServerModule([{ ...adapter, solutionExtensions: [".demo"] }])],
  });
  await assert.rejects(withSolutions.execute("run-1", "demo_switch", {}), coded("language-server-input-invalid", /demo_switch: root muss ein Text oder null sein/));
  await assert.rejects(withSolutions.execute("run-1", "demo_switch", { root: 3 }), coded("language-server-input-invalid", /root muss ein Text oder null sein/));
  assert.match(await withSolutions.execute("run-1", "demo_switch", { root: null }) as string, /ist in diesem Run nicht geöffnet/);
  await withSolutions.shutdown();
});

test("jede Operation gehört genau einem Modul, eine unbekannte ist ein Fehler mit Kennung", async () => {
  const echo = (): WorkspaceExecutorModule => ({ operations: { echo: async ({ input }) => input } });
  assert.throws(
    () => new WorkspaceOperationExecutor({ contextFor: contextIn(tmpdir()), modules: [echo, echo] }),
    /Die Operation echo ist im Executor doppelt registriert/,
  );
  const executor = new WorkspaceOperationExecutor({ contextFor: contextIn(tmpdir()), modules: [echo] });
  assert.equal(await executor.execute("run-1", "echo", "hallo"), "hallo");
  await assert.rejects(executor.execute("run-1", "grep", null), coded("workspace-operation-unknown", /kennt die Operation grep nicht/));
});

test("der Fußabdruck einer Eingabe nennt ihre Wurzeln und ihre Laufzeit, erklärt vom Modul der Operation", async () => {
  const executor = new WorkspaceOperationExecutor({ contextFor: contextIn(tmpdir()), modules: workspaceExecutorModules() });
  const roots = (operation: string, input: unknown) => executor.footprintOf(operation, input).roots;
  assert.deepEqual(roots("read", { path: "@actors/app/src/index.ts" }), { aliases: ["@actors"], runRoot: false });
  assert.deepEqual(roots("write", { path: "src/index.ts", content: "" }), { aliases: [], runRoot: true });
  assert.deepEqual(roots("edit", { path: "/abs/src/index.ts" }), { aliases: [], runRoot: true });
  assert.deepEqual(roots("bash", { command: "ls" }), { aliases: [], runRoot: false });
  assert.deepEqual(executor.footprintOf("bash", { command: "ls", cwd: "@skills/notes", timeout: 30 }), { roots: { aliases: ["@skills"], runRoot: false }, durationMs: 30_000 });
  assert.deepEqual(roots("typescript_open", { root: "@actors/app" }), { aliases: ["@actors"], runRoot: false });
  assert.deepEqual(roots("typescript_diagnostics", { root: "@actors/app", paths: ["src/a.ts", "@actors/app/b.ts"] }), { aliases: ["@actors"], runRoot: true });
  assert.deepEqual(roots("typescript_diagnostics", {}), { aliases: [], runRoot: false });
  assert.deepEqual(roots(FILE_OPERATIONS.read, { path: "SKILL.md", alias: "@skills/notes" }), { aliases: ["@skills"], runRoot: false });
  assert.deepEqual(roots(FILE_OPERATIONS.list, { path: "@actors" }), { aliases: [], runRoot: true });
  assert.deepEqual(executor.footprintOf(COMMAND_OPERATIONS.run, { program: "git", timeoutMs: 5_000 }), { roots: { aliases: [], runRoot: true }, durationMs: 5_000 });
  assert.deepEqual(executor.footprintOf(PROCESS_OPERATIONS.snapshot, null), { roots: { aliases: [], runRoot: false } });
  assert.deepEqual(roots("read", "kein Objekt"), { aliases: [], runRoot: false });
  const stray: WorkspaceModuleFactory = () => ({ operations: {}, footprints: { fremd: () => ({ roots: { aliases: [], runRoot: false } }) } });
  assert.throws(() => new WorkspaceOperationExecutor({ contextFor: contextIn(tmpdir()), modules: [stray] }), /Fußabdruck für fremd, eine Operation, die es nicht hat/);
  await executor.shutdown();
});

test("ein Alias nennt genau eine Wurzel, und unter einem gemeinsamen Alias wie @skills wählt der erste Ordner die Wurzel", async () => {
  const directory = await realpath(await mkdtemp(path.join(tmpdir(), "ragents-shared-alias-")));
  const notes = path.join(directory, "skills", "notes");
  await mkdir(notes, { recursive: true });
  await writeFile(path.join(notes, "SKILL.md"), "Notizen\n");
  const context = (roots: readonly { directory: string; alias: string }[]) => workspaceProcessContext({
    runId: "run-1", cwd: directory, root: directory, home: { home: directory }, logDirectory: directory, hostRoot: undefined, readOnlyRoots: roots,
  });
  try {
    assert.throws(() => context([{ directory: notes, alias: "@skills/notes" }, { directory, alias: "@skills/notes" }]), /@skills\/notes nennt mehr als eine Wurzel/);
    assert.throws(() => context([{ directory: notes, alias: "@skills" }, { directory: notes, alias: "@skills/notes" }]), /@skills nennt mehr als eine Wurzel/);
    const executor = new WorkspaceOperationExecutor({ contextFor: async () => context([{ directory: notes, alias: "@skills/notes" }]), modules: [fileModule] });
    for (const input of [{ alias: "@skills/notes", path: "SKILL.md" }, { alias: "@skills", path: "notes/SKILL.md" }]) {
      const text = await executor.execute("run-1", FILE_OPERATIONS.read, input) as FileText;
      assert.equal(text.previewable ? text.content : undefined, "Notizen\n", JSON.stringify(input));
    }
    await assert.rejects(executor.execute("run-1", FILE_OPERATIONS.read, { alias: "@skills", path: "fehlt/SKILL.md" }),
      coded("workspace-alias-unknown", /Unbekannter Arbeitsverzeichnis-Alias: @skills\/fehlt \(bekannt: @skills\/notes\)/));
    await assert.rejects(executor.execute("run-1", FILE_OPERATIONS.list, { alias: "@skills", path: "" }), coded("workspace-alias-unknown"));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("Fortschritt ist ein JSON-Wert, Anmerkungen kommen aus allen Modulen, stopRun und shutdown erreichen jedes Modul", async () => {
  const steps: string[] = [];
  const reporting: WorkspaceModuleFactory = (host) => ({
    operations: {
      report: async ({ runId, progress }) => {
        progress?.({ step: 1, runId });
        return host.annotate(runId, "/datei.ts");
      },
    },
    annotate: async () => "erste Anmerkung",
    stopRun: async (runId) => { steps.push(`stop ${runId}`); },
    shutdown: async () => { steps.push("shutdown"); },
  });
  const quiet: WorkspaceModuleFactory = () => ({
    operations: {},
    annotate: async (_runId, file) => `zweite Anmerkung zu ${file}`,
    stopRun: async (runId) => { steps.push(`still ${runId}`); },
  });
  const executor = new WorkspaceOperationExecutor({ contextFor: contextIn(tmpdir()), modules: [reporting, quiet] });
  const progress: unknown[] = [];
  const note = await executor.execute("run-1", "report", null, { onProgress: (value) => progress.push(value) });
  assert.deepEqual(progress, [{ step: 1, runId: "run-1" }]);
  assert.equal(note, "erste Anmerkung\nzweite Anmerkung zu /datei.ts");
  await executor.stopRun("run-1");
  await executor.shutdown();
  assert.deepEqual(steps, ["stop run-1", "still run-1", "shutdown"]);
  await assert.rejects(executor.execute("run-1", "report", null, { untilAborted: true }), /braucht dafür ein Abbruchsignal/);
});

const fileFixture = async () => {
  const directory = await realpath(await mkdtemp(path.join(tmpdir(), "ragents-files-")));
  const workspace = path.join(directory, "workspace");
  const actors = path.join(directory, "actors");
  const outside = path.join(directory, "outside");
  await Promise.all([path.join(workspace, "src"), path.join(workspace, ".git"), actors, outside].map((entry) => mkdir(entry, { recursive: true })));
  await writeFile(path.join(workspace, "notes.md"), "Grüße aus dem Run\n");
  await writeFile(path.join(workspace, ".env"), "TOKEN=1\n");
  await writeFile(path.join(workspace, "app.bin"), Buffer.from([0x50, 0x00, 0x4b]));
  await writeFile(path.join(workspace, "big.txt"), "x".repeat(FILE_READ_LIMIT + 1));
  await writeFile(path.join(workspace, "src", "index.ts"), "export const x = 1;\n");
  await writeFile(path.join(actors, "setup.ts"), "return 1;\n");
  await writeFile(path.join(outside, "secret.txt"), "nicht für den Run\n");
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

test("Dateien: die Liste nennt Ordner zuerst, dann alphabetisch, relativ zur Wurzel des Runs", async () => {
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

test("Dateien: kein .., kein absoluter Pfad, kein Ausbruch über Symlinks, fehlende Pfade mit eigener Kennung", async () => {
  const f = await fileFixture();
  try {
    await assert.rejects(f.list("../outside"), coded("workspace-path-invalid", /Ungültiger Pfad: \.\.\/outside/));
    await assert.rejects(f.list("/etc"), coded("workspace-path-invalid"));
    await assert.rejects(f.read("src\\index.ts"), coded("workspace-path-invalid"));
    await assert.rejects(f.read("link-out/secret.txt"), coded("workspace-path-invalid", /außerhalb des Arbeitsverzeichnisses/));
    await assert.rejects(f.list("link-out"), coded("workspace-path-invalid"));
    await assert.rejects(f.list("nirgends"), coded("workspace-path-not-found", /Nicht gefunden: nirgends/));
    await assert.rejects(f.list("notes.md"), coded("workspace-path-invalid", /Kein Verzeichnis: notes\.md/));
    await assert.rejects(f.read("src"), coded("workspace-path-invalid", /Keine Datei: src/));
    await assert.rejects(f.executor.execute("run-1", FILE_OPERATIONS.read, {}), coded("workspace-path-invalid"));
  } finally {
    await f.close();
  }
});

test("Dateien: Text kommt zurück, eine binäre oder zu große Datei nennt den Grund, ein Alias wählt seine Wurzel", async () => {
  const f = await fileFixture();
  try {
    assert.deepEqual(await f.read("notes.md"), {
      path: "notes.md",
      size: Buffer.byteLength("Grüße aus dem Run\n"),
      previewable: true,
      content: "Grüße aus dem Run\n",
    });
    const binary = await f.read("app.bin");
    assert.equal(binary.previewable === false ? binary.reason : undefined, "Die Datei ist binär");
    const big = await f.read("big.txt");
    assert.equal(big.previewable === false ? big.reason : undefined, "Die Datei ist größer als 256 KB und wird nicht gelesen");
    const aliased = await f.read("setup.ts", "@actors");
    assert.equal(aliased.previewable === true ? aliased.content : undefined, "return 1;\n");
    await assert.rejects(f.read("setup.ts", "@apps"), coded("workspace-alias-unknown", /Unbekannter Arbeitsverzeichnis-Alias: @apps \(bekannt: @actors\)/));
  } finally {
    await f.close();
  }
});

test("Dateien: ein Anhang liegt unter einem freien Namen in attachments, nie über einer vorhandenen Datei oder hinter einem Symlink", async () => {
  const directory = await realpath(await mkdtemp(path.join(tmpdir(), "ragents-attach-")));
  const outside = await realpath(await mkdtemp(path.join(tmpdir(), "ragents-attach-outside-")));
  const executor = new WorkspaceOperationExecutor({ contextFor: contextIn(directory), modules: [fileModule] });
  const attach = (name: string, content: Buffer) =>
    executor.execute("run-1", FILE_OPERATIONS.attach, { name, content: content.toString("base64") }) as Promise<{ name: string }>;
  try {
    const content = Buffer.from([0, 255, 13, 4]);
    assert.deepEqual(await attach("data.bin", content), { name: "data.bin" });
    assert.deepEqual(await attach("data.bin", content), { name: "2-data.bin" });
    assert.deepEqual(await attach("../Bericht (final).zip", content), { name: "Bericht__final_.zip" });
    assert.deepEqual(await readFile(path.join(directory, "attachments", "2-data.bin")), content);
    await assert.rejects(executor.execute("run-1", FILE_OPERATIONS.attach, { name: "x.bin" }), coded("workspace-path-invalid", /name und content/));
    await rm(path.join(directory, "attachments"), { recursive: true });
    await symlink(outside, path.join(directory, "attachments"));
    await assert.rejects(attach("data.bin", content), coded("workspace-path-invalid", /kein normales Verzeichnis/));
    assert.deepEqual(await readdir(outside), []);
  } finally {
    await rm(directory, { recursive: true, force: true });
    await rm(outside, { recursive: true, force: true });
  }
});

test("Dateien: die Beobachtung meldet erst ready, dann entprellte Änderungen, bis zum Abbruch", async () => {
  const f = await fileFixture();
  try {
    await assert.rejects(f.executor.execute("run-1", FILE_OPERATIONS.watch, {}, { signal: new AbortController().signal }),
      /braucht Abbruchsignal und Fortschritt/);
    const controller = new AbortController();
    const progress: unknown[] = [];
    const watching = f.executor.execute("run-1", FILE_OPERATIONS.watch, {}, {
      signal: controller.signal,
      untilAborted: true,
      onProgress: (value) => progress.push(value),
    });
    await until(() => progress.length === 1);
    assert.deepEqual(progress, [{ kind: "ready" }]);
    await writeFile(path.join(f.workspace, "src", "neu.ts"), "export const y = 2;\n");
    await writeFile(path.join(f.workspace, "src", "zweite.ts"), "export const z = 3;\n");
    await until(() => progress.length >= 2);
    assert.deepEqual(progress[1], { kind: "changed" });
    controller.abort();
    assert.equal(await watching, null);
  } finally {
    await f.close();
  }
});

test("Dateien: Stopp des Runs und Shutdown beenden offene Beobachtungen, auch ohne Abbruch des Aufrufers", async () => {
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
    await assert.rejects(watch("run-4").ended, /beendet und beobachtet nichts mehr/);
  } finally {
    await f.close();
  }
});

test("Pfade: eine Laufwerkswurzel enthält jeden Pfad darunter, ein Nachbar mit gleichem Anfang gehört nicht dazu", () => {
  assert.equal(containsWorkspacePath("/", "/home/a/p"), true);
  assert.equal(containsWorkspacePath("/", "/"), true);
  assert.equal(containsWorkspacePath("/work", "/work"), true);
  assert.equal(containsWorkspacePath("/work", "/work/src/a.ts"), true);
  assert.equal(containsWorkspacePath("/work", "/work/..datei"), true);
  assert.equal(containsWorkspacePath("/work", "/workshop/a.ts"), false);
  assert.equal(containsWorkspacePath("/work", "/"), false);
  assert.equal(containsWorkspacePath("/work/src", "/work"), false);
});

test("Dateien: ein Run mit der Wurzel / listet und liest darunter", async () => {
  const directory = await realpath(await mkdtemp(path.join(tmpdir(), "ragents-root-")));
  await writeFile(path.join(directory, "datei.txt"), "unter der Wurzel\n");
  const executor = new WorkspaceOperationExecutor({ contextFor: contextIn(path.parse(directory).root), modules: [fileModule] });
  const relative = path.relative(path.parse(directory).root, directory).split(path.sep).join("/");
  try {
    const listing = await executor.execute("run-1", FILE_OPERATIONS.list, { path: relative }) as FileListing;
    assert.deepEqual(listing.entries.map((entry) => entry.name), ["datei.txt"]);
    const text = await executor.execute("run-1", FILE_OPERATIONS.read, { path: `${relative}/datei.txt` }) as FileText;
    assert.equal(text.previewable === true ? text.content : undefined, "unter der Wurzel\n");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("Prozesse: gleichzeitige Abfragen zweier Runs teilen sich einen Scan der Tabelle", async () => {
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

test("Prozesse: der Stand nennt markierte Prozesse mit Port, beenden trifft einen, der Stopp des Runs alle", { skip: !hasProcessTable() }, async () => {
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
    assert.ok(second.child.signalCode !== null, "der Stopp des Runs beendet den zweiten Prozess mit einem Signal");
  } finally {
    for (const { child } of [first, second]) if (child.pid && processExists(child.pid)) child.kill("SIGKILL");
  }
});
