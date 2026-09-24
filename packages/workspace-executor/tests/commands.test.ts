import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import {
  COMMAND_OPERATIONS,
  COMMAND_OUTPUT_LIMIT,
  WorkspaceOperationError,
  WorkspaceOperationExecutor,
  commandModule,
  sandboxRunEnvironment,
  workspaceProcessContext,
  type CommandResult,
  type CommandRunInput,
  type WorkspaceProcessContext,
} from "../src/index.ts";
import { processExists } from "../src/managed-process.ts";

const coded = (code: string, pattern?: RegExp) => (error: unknown): boolean =>
  error instanceof WorkspaceOperationError && error.code === code && (pattern === undefined || pattern.test(error.message));

const until = async (condition: () => Promise<boolean>, timeoutMs = 5000): Promise<void> => {
  const started = Date.now();
  while (!await condition()) {
    if (Date.now() - started > timeoutMs) throw new Error("Bedingung wurde nicht erfüllt.");
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
};

const node = (script: string, ...args: string[]): Pick<CommandRunInput, "program" | "args"> => ({
  program: process.execPath,
  args: ["-e", script, ...args],
});

const commandFixture = async (platform: NodeJS.Platform = process.platform) => {
  const directory = await realpath(await mkdtemp(path.join(tmpdir(), "ragents-commands-")));
  const workspace = path.join(directory, "workspace");
  const outside = path.join(directory, "outside");
  await Promise.all([path.join(workspace, "src"), outside].map((entry) => mkdir(entry, { recursive: true })));
  await writeFile(path.join(workspace, "notes.md"), "Notizen\n");
  await symlink(outside, path.join(workspace, "link-out"));
  const operations: string[] = [];
  const contextFor = (runId: string): Promise<WorkspaceProcessContext> => Promise.resolve({
    ...workspaceProcessContext({
      runId,
      cwd: workspace,
      root: workspace,
      home: { home: directory },
      logDirectory: directory,
      hostRoot: undefined,
      additions: sandboxRunEnvironment(runId),
      source: { PATH: process.env.PATH, SERVER_SECRET: "nur auf dem Server" },
    }),
    runOperation: async <T>(operation: () => Promise<T>): Promise<T> => {
      operations.push(runId);
      return operation();
    },
  });
  const executor = new WorkspaceOperationExecutor({ contextFor, modules: [commandModule(platform)] });
  return {
    directory,
    workspace,
    executor,
    operations,
    run: (input: unknown, signal?: AbortSignal) =>
      executor.execute("run-1", COMMAND_OPERATIONS.run, input, signal ? { signal } : {}) as Promise<CommandResult>,
    close: async () => {
      await executor.shutdown();
      await rm(directory, { recursive: true, force: true });
    },
  };
};

test("Befehle: das Programm läuft ohne Shell mit wörtlichen Argumenten im gewählten Ordner, mit der Umgebung des Executors", async () => {
  const f = await commandFixture();
  try {
    const result = await f.run({
      ...node(
        [
          "process.stdout.write(JSON.stringify({ args: process.argv.slice(1), cwd: process.cwd(), marker: process.env.RAGENTS_RUN_ID, secret: process.env.SERVER_SECRET ?? null, home: process.env.HOME }));",
          "process.stderr.write('Warnung');",
          "process.exit(3);",
        ].join(""),
        "$HOME; echo nie",
        "a b",
        "*",
      ),
      cwd: "./src/",
      timeoutMs: 10_000,
    });
    assert.equal(result.exitCode, 3, "ein Exit-Code ungleich null ist ein Ergebnis, kein Fehler");
    assert.equal(result.stderr, "Warnung");
    assert.equal(result.stdoutTruncated, false);
    assert.equal(result.stderrTruncated, false);
    assert.deepEqual(JSON.parse(result.stdout), {
      args: ["$HOME; echo nie", "a b", "*"],
      cwd: path.join(f.workspace, "src"),
      marker: "run-1",
      secret: null,
      home: f.directory,
    });
    assert.deepEqual(f.operations, ["run-1"], "der Rahmen des Arbeitsbereichs umschließt den Befehl");
    const root = await f.run({ ...node("process.stdout.write(process.cwd())"), timeoutMs: 10_000 });
    assert.deepEqual(root, { exitCode: 0, stdout: f.workspace, stderr: "", stdoutTruncated: false, stderrTruncated: false });
  } finally {
    await f.close();
  }
});

test("Befehle: der Arbeitsordner wird geprüft wie ein Pfad des Dateimoduls", async () => {
  const f = await commandFixture();
  try {
    const at = (cwd: string) => f.run({ ...node("process.exit(0)"), cwd, timeoutMs: 10_000 });
    await assert.rejects(at("../outside"), coded("workspace-path-invalid", /Ungültiger Pfad: \.\.\/outside/));
    await assert.rejects(at(f.workspace), coded("workspace-path-invalid"));
    await assert.rejects(at("src\\sub"), coded("workspace-path-invalid"));
    await assert.rejects(at("link-out"), coded("workspace-path-invalid", /außerhalb des Arbeitsverzeichnisses/));
    await assert.rejects(at("nirgends"), coded("workspace-path-not-found", /Nicht gefunden: nirgends/));
    await assert.rejects(at("notes.md"), coded("workspace-path-invalid", /Kein Verzeichnis: notes\.md/));
  } finally {
    await f.close();
  }
});

test("Befehle: die Ausgabe ist je Datenstrom begrenzt, der Befehl läuft zu Ende und behält seinen Exit-Code", async () => {
  const f = await commandFixture();
  try {
    const result = await f.run({
      ...node("process.stdout.write('ä'.repeat(5000)); process.stderr.write('y'.repeat(5000)); process.exitCode = 2;"),
      timeoutMs: 10_000,
      maxOutputBytes: 100,
    });
    assert.equal(result.exitCode, 2);
    assert.equal(result.stdout, "ä".repeat(50));
    assert.equal(result.stderr, "y".repeat(100));
    assert.equal(result.stdoutTruncated, true);
    assert.equal(result.stderrTruncated, true);
    const exact = await f.run({ ...node("process.stdout.write('z'.repeat(100))"), timeoutMs: 10_000, maxOutputBytes: 100 });
    assert.equal(exact.stdout.length, 100);
    assert.equal(exact.stdoutTruncated, false);
  } finally {
    await f.close();
  }
});

test("Befehle: ungültige Eingaben, ein fehlendes Programm und eine überschrittene Zeitgrenze sind Fehler mit Kennung", async () => {
  const f = await commandFixture();
  const windows = await commandFixture("win32");
  try {
    await assert.rejects(f.run({ timeoutMs: 1000 }), coded("command-invalid", /braucht ein Programm/));
    await assert.rejects(f.run({ program: "", timeoutMs: 1000 }), coded("command-invalid"));
    await assert.rejects(f.run({ program: "git", args: ["status", 1], timeoutMs: 1000 }), coded("command-invalid", /Argumente/));
    await assert.rejects(f.run({ program: "git", args: ["a\0b"], timeoutMs: 1000 }), coded("command-invalid", /Nullzeichen/));
    await assert.rejects(f.run({ program: "git", cwd: 1, timeoutMs: 1000 }), coded("command-invalid", /Arbeitsordner/));
    await assert.rejects(f.run({ program: "git" }), coded("command-invalid", /Zeitgrenze/));
    await assert.rejects(f.run({ program: "git", timeoutMs: 1.5 }), coded("command-invalid", /Zeitgrenze/));
    await assert.rejects(f.run({ program: "git", timeoutMs: 1000, maxOutputBytes: COMMAND_OUTPUT_LIMIT + 1 }), coded("command-invalid", /Ausgabegrenze/));
    await assert.rejects(windows.run({ program: "pnpm.cmd", timeoutMs: 1000 }), coded("command-invalid", /braucht unter Windows eine Shell/));
    await assert.rejects(
      f.run({ program: "ragents-gibt-es-nicht", timeoutMs: 10_000 }),
      coded("command-unavailable", /Das Programm ragents-gibt-es-nicht gibt es auf diesem Rechner nicht/),
    );
    await assert.rejects(
      f.run({ ...node("setTimeout(() => {}, 30000)"), timeoutMs: 200 }),
      coded("command-timeout", /Zeitgrenze von 200 ms/),
    );
  } finally {
    await f.close();
    await windows.close();
  }
});

test("Befehle: ein Abbruch und der Stopp des Runs beenden einen laufenden Befehl samt Prozess", async () => {
  const f = await commandFixture();
  const waiting = (marker: string) => node(`require('node:fs').writeFileSync(${JSON.stringify(marker)}, String(process.pid)); setTimeout(() => {}, 30000);`);
  const pidOf = async (marker: string): Promise<number> => {
    await until(() => readFile(path.join(f.workspace, marker), "utf8").then((text) => text.length > 0, () => false));
    return Number(await readFile(path.join(f.workspace, marker), "utf8"));
  };
  try {
    const controller = new AbortController();
    const aborted = f.run({ ...waiting("abgebrochen.pid"), timeoutMs: 60_000 }, controller.signal);
    const first = await pidOf("abgebrochen.pid");
    controller.abort();
    await assert.rejects(aborted);
    assert.equal(processExists(first), false);

    const stopped = f.run({ ...waiting("gestoppt.pid"), timeoutMs: 60_000 });
    const second = await pidOf("gestoppt.pid");
    await f.executor.stopRun("run-1");
    await assert.rejects(stopped, /Der Befehl wurde mit seinem Lauf beendet/);
    assert.equal(processExists(second), false);
    await f.executor.stopRun("run-1");
  } finally {
    await f.close();
  }
});
