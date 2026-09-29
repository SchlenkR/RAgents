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
    if (Date.now() - started > timeoutMs) throw new Error("Condition was not met.");
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
  await writeFile(path.join(workspace, "notes.md"), "Notes\n");
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
      source: { PATH: process.env.PATH, SERVER_SECRET: "only on the server" },
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

test("commands: the program runs without a shell with literal arguments in the chosen folder, with the environment of the executor", async () => {
  const f = await commandFixture();
  try {
    const result = await f.run({
      ...node(
        [
          "process.stdout.write(JSON.stringify({ args: process.argv.slice(1), cwd: process.cwd(), marker: process.env.RAGENTS_RUN_ID, secret: process.env.SERVER_SECRET ?? null, home: process.env.HOME }));",
          "process.stderr.write('Warning');",
          "process.exit(3);",
        ].join(""),
        "$HOME; echo never",
        "a b",
        "*",
      ),
      cwd: "./src/",
      timeoutMs: 10_000,
    });
    assert.equal(result.exitCode, 3, "a nonzero exit code is a result, not an error");
    assert.equal(result.stderr, "Warning");
    assert.equal(result.stdoutTruncated, false);
    assert.equal(result.stderrTruncated, false);
    assert.deepEqual(JSON.parse(result.stdout), {
      args: ["$HOME; echo never", "a b", "*"],
      cwd: path.join(f.workspace, "src"),
      marker: "run-1",
      secret: null,
      home: f.directory,
    });
    assert.deepEqual(f.operations, ["run-1"], "the frame of the workspace wraps the command");
    const root = await f.run({ ...node("process.stdout.write(process.cwd())"), timeoutMs: 10_000 });
    assert.deepEqual(root, { exitCode: 0, stdout: f.workspace, stderr: "", stdoutTruncated: false, stderrTruncated: false });
  } finally {
    await f.close();
  }
});

test("commands: the working folder is checked like a path of the file module", async () => {
  const f = await commandFixture();
  try {
    const at = (cwd: string) => f.run({ ...node("process.exit(0)"), cwd, timeoutMs: 10_000 });
    await assert.rejects(at("../outside"), coded("workspace-path-invalid", /Invalid path: \.\.\/outside/));
    await assert.rejects(at(f.workspace), coded("workspace-path-invalid"));
    await assert.rejects(at("src\\sub"), coded("workspace-path-invalid"));
    await assert.rejects(at("link-out"), coded("workspace-path-invalid", /outside the working directory/));
    await assert.rejects(at("nowhere"), coded("workspace-path-not-found", /Not found: nowhere/));
    await assert.rejects(at("notes.md"), coded("workspace-path-invalid", /Not a directory: notes\.md/));
  } finally {
    await f.close();
  }
});

test("commands: the output is limited per stream, the command runs to completion and keeps its exit code", async () => {
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

test("commands: invalid inputs, a missing program and an exceeded timeout are errors with a code", async () => {
  const f = await commandFixture();
  const windows = await commandFixture("win32");
  try {
    await assert.rejects(f.run({ timeoutMs: 1000 }), coded("command-invalid", /needs a program/));
    await assert.rejects(f.run({ program: "", timeoutMs: 1000 }), coded("command-invalid"));
    await assert.rejects(f.run({ program: "git", args: ["status", 1], timeoutMs: 1000 }), coded("command-invalid", /arguments/));
    await assert.rejects(f.run({ program: "git", args: ["a\0b"], timeoutMs: 1000 }), coded("command-invalid", /null characters/));
    await assert.rejects(f.run({ program: "git", cwd: 1, timeoutMs: 1000 }), coded("command-invalid", /working folder/));
    await assert.rejects(f.run({ program: "git" }), coded("command-invalid", /timeout/));
    await assert.rejects(f.run({ program: "git", timeoutMs: 1.5 }), coded("command-invalid", /timeout/));
    await assert.rejects(f.run({ program: "git", timeoutMs: 1000, maxOutputBytes: COMMAND_OUTPUT_LIMIT + 1 }), coded("command-invalid", /output limit/));
    await assert.rejects(windows.run({ program: "pnpm.cmd", timeoutMs: 1000 }), coded("command-invalid", /needs a shell on Windows/));
    await assert.rejects(
      f.run({ program: "ragents-does-not-exist", timeoutMs: 10_000 }),
      coded("command-unavailable", /The program ragents-does-not-exist does not exist on this machine/),
    );
    await assert.rejects(
      f.run({ ...node("setTimeout(() => {}, 30000)"), timeoutMs: 200 }),
      coded("command-timeout", /timeout of 200 ms/),
    );
  } finally {
    await f.close();
    await windows.close();
  }
});

test("commands: an abort and the stop of the run end a running command together with its process", async () => {
  const f = await commandFixture();
  const waiting = (marker: string) => node(`require('node:fs').writeFileSync(${JSON.stringify(marker)}, String(process.pid)); setTimeout(() => {}, 30000);`);
  const pidOf = async (marker: string): Promise<number> => {
    await until(() => readFile(path.join(f.workspace, marker), "utf8").then((text) => text.length > 0, () => false));
    return Number(await readFile(path.join(f.workspace, marker), "utf8"));
  };
  try {
    const controller = new AbortController();
    const aborted = f.run({ ...waiting("aborted.pid"), timeoutMs: 60_000 }, controller.signal);
    const first = await pidOf("aborted.pid");
    controller.abort();
    await assert.rejects(aborted);
    assert.equal(processExists(first), false);

    const stopped = f.run({ ...waiting("stopped.pid"), timeoutMs: 60_000 });
    const second = await pidOf("stopped.pid");
    await f.executor.stopRun("run-1");
    await assert.rejects(stopped, /The command was ended with its run/);
    assert.equal(processExists(second), false);
    await f.executor.stopRun("run-1");
  } finally {
    await f.close();
  }
});
