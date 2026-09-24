import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  WorkspaceOperationExecutor,
  changedWorkspaceFiles,
  languageServerModule,
  runManagedProcess,
  sandboxToolsModule,
  typescriptAdapter,
  workspaceProcessContext,
  type LanguageServerAdapter,
  type LanguageServerSnapshot,
  type WorkspaceProcessContext,
} from "../src/index.ts";

const textOf = (result: unknown): string =>
  ((result as { content?: Array<{ type: string; text?: string }> }).content ?? [])
    .filter((part) => part.type === "text" && typeof part.text === "string")
    .map((part) => part.text)
    .join("\n");

const fixture = async () => {
  const directory = await realpath(await mkdtemp(path.join(tmpdir(), "ragents-executor-")));
  const workspace = path.join(directory, "workspace");
  const skills = path.join(directory, "skills");
  await Promise.all([workspace, skills].map((entry) => mkdir(entry, { recursive: true })));
  await writeFile(path.join(skills, "anleitung.md"), "# Anleitung\n");
  const contexts: WorkspaceProcessContext[] = [];
  const executor = new WorkspaceOperationExecutor({
    modules: [sandboxToolsModule],
    contextFor: (runId) => {
      const context = workspaceProcessContext({
        runId,
        cwd: workspace,
        root: workspace,
        home: { home: path.join(directory, "home") },
        logDirectory: path.join(directory, "logs"),
        hostRoot: undefined,
        readOnlyRoots: [{ directory: skills }],
        additions: { RAGENTS_RUN_ID: runId },
      });
      contexts.push(context);
      return Promise.resolve(context);
    },
  });
  return {
    directory,
    workspace,
    skills,
    executor,
    contexts,
    close: async () => {
      await executor.shutdown();
      await rm(directory, { recursive: true, force: true });
    },
  };
};

test("der Executor führt read, write, edit und bash im Ordner seiner Maschine aus", async () => {
  const f = await fixture();
  try {
    await f.executor.execute("run-1", "write", { path: "notiz.md", content: "Grüße\n" });
    assert.equal(await readFile(path.join(f.workspace, "notiz.md"), "utf8"), "Grüße\n");
    await f.executor.execute("run-1", "edit", { path: "notiz.md", edits: [{ oldText: "Grüße", newText: "Hallo" }] });
    assert.match(textOf(await f.executor.execute("run-1", "read", { path: "notiz.md" })), /Hallo/);
    assert.match(textOf(await f.executor.execute("run-1", "bash", { command: "printf hallo-$RAGENTS_RUN_ID" })), /hallo-run-1/);
  } finally {
    await f.close();
  }
});

test("nur lesbare Wurzeln bleiben lesbar, alles außerhalb scheitert mit Ursache", async () => {
  const f = await fixture();
  try {
    assert.match(textOf(await f.executor.execute("run-1", "read", { path: path.join(f.skills, "anleitung.md") })), /Anleitung/);
    await assert.rejects(f.executor.execute("run-1", "write", { path: path.join(f.skills, "neu.md"), content: "x" }), /außerhalb/);
    await assert.rejects(f.executor.execute("run-1", "read", { path: "/etc/hosts" }), /außerhalb/);
    await assert.rejects(f.executor.execute("run-1", "grep", { path: "notiz.md" }), /kennt die Operation grep nicht/);
  } finally {
    await f.close();
  }
});

test("bash meldet seine Ausgabe als Fortschritt und lässt sich abbrechen", async () => {
  const f = await fixture();
  try {
    const progress: string[] = [];
    const finished = await f.executor.execute("run-1", "bash", { command: "printf fertig; exit 4" }, {
      onProgress: (value) => progress.push((value as { text: string }).text),
    });
    assert.match(textOf(finished), /fertig/);
    assert.match(textOf(finished), /Command exited with code 4/);
    assert.ok(progress.some((text) => text.includes("fertig")), progress.join("|"));

    const controller = new AbortController();
    const running = f.executor.execute("run-1", "bash", { command: "printf gestartet; sleep 5" }, {
      signal: controller.signal,
      onProgress: (value) => {
        if ((value as { text: string }).text.includes("gestartet")) controller.abort();
      },
    });
    assert.match(textOf(await running), /gestartet/);
  } finally {
    await f.close();
  }
});

test("stop beendet die Werkzeuge eines Runs und die Sprachserver derselben Kennung", async () => {
  const f = await fixture();
  const stopped: string[] = [];
  const adapter: LanguageServerAdapter = {
    id: "fake",
    label: "Fake",
    languages: { ".fake": "fake" },
    rootDescription: "directory",
    resolveRoot: (_workspaceRoot, root) => Promise.resolve(root),
    rootDirectory: (root) => root,
    launch: () => Promise.reject(new Error("Fake startet nicht")),
    open: () => Promise.resolve("unbenutzt"),
  };
  const executor = new WorkspaceOperationExecutor({
    contextFor: (runId) => {
      stopped.push(runId);
      return Promise.resolve(workspaceProcessContext({
        runId, cwd: f.workspace, root: f.workspace, home: { home: f.directory }, logDirectory: f.directory, hostRoot: undefined,
      }));
    },
    modules: [sandboxToolsModule, languageServerModule([adapter])],
  });
  try {
    await assert.rejects(executor.execute("run-2", "fake_diagnostics", { paths: ["a.fake"] }), /fake_open/);
    assert.deepEqual(await executor.execute("run-2", "fake_snapshot", null), { instances: [] });
    await executor.execute("run-2", "write", { path: "datei.txt", content: "x" });
    await executor.stopRun("run-2");
    await executor.execute("run-2", "write", { path: "datei.txt", content: "y" });
    assert.equal(await readFile(path.join(f.workspace, "datei.txt"), "utf8"), "y");
    assert.ok(stopped.length > 0);
  } finally {
    await executor.shutdown();
    await f.close();
  }
});

test("ohne paths findet die Diagnostik die geänderten Dateien auch im Unterordner eines Repos", async () => {
  const f = await fixture();
  const repository = path.join(f.directory, "repo");
  const area = path.join(repository, "area");
  try {
    await mkdir(area, { recursive: true });
    await writeFile(path.join(repository, "top.fake"), "oben\n");
    await writeFile(path.join(area, "known.fake"), "innen\n");
    for (const args of [["init", "-q"], ["add", "."], ["-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "-m", "erst"]]) {
      const result = await runManagedProcess({ command: "git", args, cwd: repository, env: process.env, label: "git", timeoutMs: 30_000 });
      assert.equal(result.code, 0);
    }
    await writeFile(path.join(area, "known.fake"), "innen geändert\n");
    await writeFile(path.join(area, "fresh.fake"), "neu\n");
    await writeFile(path.join(repository, "top.fake"), "oben geändert\n");
    const context = workspaceProcessContext({ runId: "run-3", cwd: area, root: area, home: { home: f.directory }, logDirectory: f.directory, hostRoot: undefined });
    const changed = await changedWorkspaceFiles(context, area, "fake_diagnostics", (file) => file.endsWith(".fake"));
    assert.deepEqual(changed.sort(), [path.join(area, "fresh.fake"), path.join(area, "known.fake")]);
  } finally {
    await f.close();
  }
});

const tsFixture = async () => {
  const directory = await realpath(await mkdtemp(path.join(tmpdir(), "ragents-lsp-multi-")));
  const workspace = path.join(directory, "workspace");
  await mkdir(workspace, { recursive: true });
  const project = async (name: string, content: string): Promise<string> => {
    const root = path.join(workspace, name);
    await mkdir(root, { recursive: true });
    await writeFile(path.join(root, "tsconfig.json"), `${JSON.stringify({
      compilerOptions: { strict: true, noEmit: true, target: "es2022", module: "esnext", moduleResolution: "bundler" },
      include: ["*.ts"],
    }, null, 2)}\n`);
    await writeFile(path.join(root, "broken.ts"), content);
    return root;
  };
  const first = await project("a", "export const count: number = \"eins\";\n");
  const second = await project("b", "export const label: string = 7;\n");
  await writeFile(path.join(workspace, "lose.ts"), "export const outside: string = 1;\n");
  const result = await runManagedProcess({ command: "git", args: ["init", "-q"], cwd: workspace, env: process.env, label: "git", timeoutMs: 30_000 });
  assert.equal(result.code, 0);
  const executor = new WorkspaceOperationExecutor({
    contextFor: (runId) => Promise.resolve(workspaceProcessContext({
      runId,
      cwd: workspace,
      root: workspace,
      home: { home: path.join(directory, "home") },
      logDirectory: path.join(directory, "logs"),
      hostRoot: path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", ".."),
    })),
    modules: [sandboxToolsModule, languageServerModule([typescriptAdapter], { openTimeoutMs: 120_000, diagnosticsTimeoutMs: 60_000 })],
  });
  return {
    workspace,
    first,
    second,
    executor,
    roots: async (runId: string) =>
      ((await executor.execute(runId, "typescript_snapshot", null)) as LanguageServerSnapshot)
        .instances.map((instance) => `${instance.root}:${instance.state}`),
    close: async () => {
      await executor.shutdown();
      await rm(directory, { recursive: true, force: true });
    },
  };
};

test("zwei TypeScript-Wurzeln bleiben im selben Run nebeneinander offen", { timeout: 300_000 }, async () => {
  const f = await tsFixture();
  try {
    assert.match(await f.executor.execute("run-ts", "typescript_open", { root: "a" }) as string, /1 offene Instanz von TypeScript/);
    assert.match(await f.executor.execute("run-ts", "typescript_open", { root: "a" }) as string, /bereits geöffnet/);
    assert.match(await f.executor.execute("run-ts", "typescript_open", { root: "b" }) as string, /2 offene Instanzen von TypeScript/);
    assert.deepEqual(await f.roots("run-ts"), [`${f.first}:ready`, `${f.second}:ready`]);

    const both = await f.executor.execute("run-ts", "typescript_diagnostics", {}) as string;
    assert.match(both, /a\/broken\.ts:1:14 error 2322/);
    assert.match(both, /b\/broken\.ts:1:14 error 2322/);

    const onlyFirst = await f.executor.execute("run-ts", "typescript_diagnostics", { paths: ["a/broken.ts"] }) as string;
    assert.match(onlyFirst, /a\/broken\.ts:1:14 error 2322/);
    assert.doesNotMatch(onlyFirst, /b\/broken\.ts/);
    const onlySecond = await f.executor.execute("run-ts", "typescript_diagnostics", { root: "b" }) as string;
    assert.match(onlySecond, /b\/broken\.ts:1:14 error 2322/);
    assert.doesNotMatch(onlySecond, /a\/broken\.ts/);

    await assert.rejects(
      f.executor.execute("run-ts", "typescript_diagnostics", { paths: ["lose.ts"] }),
      (error: Error) => error.message.includes("liegt in keiner geöffneten TypeScript-Wurzel")
        && error.message.includes(f.first)
        && error.message.includes(f.second),
    );

    const edited = await f.executor.execute("run-ts", "edit", {
      path: "b/broken.ts",
      edits: [{ oldText: "7", newText: "false" }],
    });
    assert.match(textOf(edited), /Diagnostik \(TypeScript\) b\/broken\.ts: 1 Fehler/);
    assert.doesNotMatch(textOf(edited), /a\/broken\.ts/);

    assert.match(await f.executor.execute("run-ts", "typescript_close", { root: "a" }) as string, /1 offene Instanz/);
    assert.deepEqual(await f.roots("run-ts"), [`${f.second}:ready`]);
    assert.match(await f.executor.execute("run-ts", "typescript_diagnostics", {}) as string, /b\/broken\.ts:1:14 error 2322/);

    await f.executor.stopRun("run-ts");
    assert.deepEqual(await f.roots("run-ts"), []);
  } finally {
    await f.close();
  }
});
