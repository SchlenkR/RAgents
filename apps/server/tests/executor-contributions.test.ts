import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import {
  EXECUTOR_CONTRIBUTION_FILE,
  WorkspaceOperationExecutor,
  executorMachine,
  hostDataDirectory,
  languageServerModule,
  loadExecutorContribution,
  pluginToolsDirectory,
  prepareExecutorContribution,
  runManagedProcess,
  sandboxToolsModule,
  workspaceProcessContext,
  type LanguageServerSnapshot,
  type WorkspaceExecutorContribution,
  type WorkspaceExecutorParts,
} from "@ragents/workspace-executor";
import { executor as fsharpExecutor } from "../../../plugins/ragents.lsp-fsharp/executor.ts";
import { executor as roslynExecutor, ROSLYN_SERVER_FILE, ROSLYN_SERVER_VARIABLE } from "../../../plugins/ragents.lsp-roslyn/executor.ts";
import { executor as typescriptExecutor } from "../../../plugins/ragents.lsp-typescript/executor.ts";
import { hostRoot } from "../src/host-version.ts";
import { loadPlugins } from "../src/profile/plugin-discovery.ts";
import { workspaceProvisionPlugins } from "../src/profile/provisioning.ts";

const textOf = (result: unknown): string =>
  ((result as { content?: Array<{ type: string; text?: string }> }).content ?? [])
    .filter((part) => part.type === "text" && typeof part.text === "string")
    .map((part) => part.text)
    .join("\n");

/** What a plugin contributes to a workstation, built with the plugin's tool folder. */
const partsOf = (plugin: string, contribution: WorkspaceExecutorContribution): WorkspaceExecutorParts =>
  contribution(executorMachine(pluginToolsDirectory(hostDataDirectory(), plugin)));

const LANGUAGE_SERVER_PLUGINS = ["ragents.lsp-roslyn", "ragents.lsp-fsharp", "ragents.lsp-typescript"] as const;

test("the language servers come from their plugins: the server loads the contributions with the bundles, a workstation the same files in the same state", async () => {
  const loaded = await loadPlugins(["ragents.orchestration", "ragents.ask", ...LANGUAGE_SERVER_PLUGINS]);
  assert.deepEqual(loaded.executor.map((entry) => entry.plugin), [...LANGUAGE_SERVER_PLUGINS]);
  for (const { plugin, revision } of loaded.executor) {
    const file = path.join(hostRoot(), "bundles", plugin, EXECUTOR_CONTRIBUTION_FILE);
    assert.equal(revision, createHash("sha256").update(await readFile(file)).digest("hex"), plugin);
    assert.equal((await loadExecutorContribution(plugin, file, revision)).revision, revision, `${plugin}: the workstation loads the same file`);
  }
  const servers = loaded.executor.map((entry) => prepareExecutorContribution(entry, pluginToolsDirectory("/data", entry.plugin)).parts.languageServers!.map((server) => server.id));
  assert.deepEqual(servers, [["roslyn"], ["fsharp"], ["typescript"]]);
  const executor = new WorkspaceOperationExecutor({
    contextFor: () => Promise.reject(new Error("not asked")),
    modules: [languageServerModule(loaded.executor.flatMap((entry) => prepareExecutorContribution(entry, "/data").parts.languageServers ?? []))],
  });
  assert.deepEqual(await executor.execute("run-1", "fsharp_snapshot", null), { instances: [] });
  await executor.shutdown();
});

test("a workstation provisions exactly the built-in plugins with an executor contribution and the bundles they need to load", () => {
  assert.deepEqual(workspaceProvisionPlugins().map((plugin) => plugin.id).sort(),
    ["ragents.ask", "ragents.browser", "ragents.documents", ...LANGUAGE_SERVER_PLUGINS].sort());
});

test("Roslyn and FSAC start from their plugin's tool folder, a .dll through dotnet, a binary directly, also with Windows paths", async (t) => {
  const tools = await realpath(await mkdtemp(path.join(tmpdir(), "ragents-lsp-tools-")));
  t.after(() => rm(tools, { recursive: true, force: true }));
  const saved = { roslyn: process.env[ROSLYN_SERVER_VARIABLE], fsharp: process.env.FSHARP_LANGUAGE_SERVER };
  t.after(() => {
    for (const [name, value] of [[ROSLYN_SERVER_VARIABLE, saved.roslyn], ["FSHARP_LANGUAGE_SERVER", saved.fsharp]] as const) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  });
  delete process.env[ROSLYN_SERVER_VARIABLE];
  const context = workspaceProcessContext({ runId: "run-1", cwd: tools, root: tools, home: { home: tools }, logDirectory: tools, hostRoot: undefined });
  const [roslyn] = roslynExecutor(executorMachine(tools)).languageServers!;
  await assert.rejects(roslyn!.launch(context, path.join(tools, "Sample.sln")), /neither is ROSLYN_LANGUAGE_SERVER set nor does .*Microsoft\.CodeAnalysis\.LanguageServer\.dll exist/);
  const provisioned = path.join(tools, ...ROSLYN_SERVER_FILE.split("/"));
  await mkdir(path.dirname(provisioned), { recursive: true });
  await writeFile(provisioned, "");
  const launched = await roslyn!.launch(context, path.join(tools, "Sample.sln"));
  assert.equal(launched.command, "dotnet");
  assert.deepEqual(launched.args.slice(0, 2), [provisioned, "--stdio"]);

  process.env[ROSLYN_SERVER_VARIABLE] = "C:\\Users\\dev\\AppData\\Local\\ragents\\workspace\\tools\\roslyn\\Microsoft.CodeAnalysis.LanguageServer.dll";
  const windows = await roslyn!.launch(context, path.join(tools, "Sample.sln"));
  assert.equal(windows.command, "dotnet");
  assert.deepEqual(windows.args.slice(0, 2), [process.env[ROSLYN_SERVER_VARIABLE], "--stdio"]);
  process.env.FSHARP_LANGUAGE_SERVER = "C:\\tools\\fsautocomplete\\fsautocomplete.exe";
  const [fsharp] = fsharpExecutor(executorMachine(tools)).languageServers!;
  const binary = await fsharp!.launch({ ...context, logDirectory: "C:\\temp" }, path.join(tools, "Sample.sln"));
  assert.equal(binary.command, "C:\\tools\\fsautocomplete\\fsautocomplete.exe");
  assert.deepEqual(binary.args, ["--state-directory", path.join("C:\\temp", "fsautocomplete")]);
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
  const first = await project("a", "export const count: number = \"one\";\n");
  const second = await project("b", "export const label: string = 7;\n");
  await writeFile(path.join(workspace, "loose.ts"), "export const outside: string = 1;\n");
  const result = await runManagedProcess({ command: "git", args: ["init", "-q"], cwd: workspace, env: process.env, label: "git", timeoutMs: 30_000 });
  assert.equal(result.code, 0);
  const executor = new WorkspaceOperationExecutor({
    contextFor: (runId) => Promise.resolve(workspaceProcessContext({
      runId,
      cwd: workspace,
      root: workspace,
      home: { home: path.join(directory, "home") },
      logDirectory: path.join(directory, "logs"),
      hostRoot: hostRoot(),
    })),
    modules: [sandboxToolsModule, languageServerModule(partsOf("ragents.lsp-typescript", typescriptExecutor).languageServers!, {
      openTimeoutMs: 120_000,
      diagnosticsTimeoutMs: 60_000,
    })],
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

test("two TypeScript roots stay open side by side in the same run", { timeout: 300_000 }, async () => {
  const f = await tsFixture();
  try {
    assert.match(await f.executor.execute("run-ts", "typescript_open", { root: "a" }) as string, /1 open instance of TypeScript/);
    assert.match(await f.executor.execute("run-ts", "typescript_open", { root: "a" }) as string, /already open/);
    assert.match(await f.executor.execute("run-ts", "typescript_open", { root: "b" }) as string, /2 open instances of TypeScript/);
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
      f.executor.execute("run-ts", "typescript_diagnostics", { paths: ["loose.ts"] }),
      (error: Error) => error.message.includes("is in no open TypeScript root")
        && error.message.includes(f.first)
        && error.message.includes(f.second),
    );

    const edited = await f.executor.execute("run-ts", "edit", {
      file_path: "b/broken.ts",
      old_string: "7",
      new_string: "false",
    });
    assert.match(textOf(edited), /Diagnostics \(TypeScript\) b\/broken\.ts: 1 error/);
    assert.doesNotMatch(textOf(edited), /a\/broken\.ts/);

    assert.match(await f.executor.execute("run-ts", "typescript_close", { root: "a" }) as string, /1 open instance/);
    assert.deepEqual(await f.roots("run-ts"), [`${f.second}:ready`]);
    assert.match(await f.executor.execute("run-ts", "typescript_diagnostics", {}) as string, /b\/broken\.ts:1:14 error 2322/);

    await f.executor.stopRun("run-ts");
    assert.deepEqual(await f.roots("run-ts"), []);
  } finally {
    await f.close();
  }
});
