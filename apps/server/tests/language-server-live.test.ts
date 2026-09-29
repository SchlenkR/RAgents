import assert from "node:assert/strict";
import { cp, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  LanguageServerHost,
  executorMachine,
  hostDataDirectory,
  pluginToolsDirectory,
  runManagedProcess,
  workspaceProcessContext,
  type LanguageServerAdapter,
  type WorkspaceExecutorContribution,
  type WorkspaceProcessContext,
} from "@ragents/workspace-executor";
import { executor as fsharpExecutor } from "../../../plugins/ragents.lsp-fsharp/executor.ts";
import { executor as roslynExecutor } from "../../../plugins/ragents.lsp-roslyn/executor.ts";
import { executor as typescriptExecutor } from "../../../plugins/ragents.lsp-typescript/executor.ts";
import { hostRoot } from "../src/host-version.ts";

const enabled = process.env.RAGENTS_LSP_TESTS === "1";
const skip = enabled ? false : "set RAGENTS_LSP_TESTS=1 (pnpm provision --workspace fetches the language servers)";
const fixtures = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures", "lsp");
const RUN = "run-lsp";

/** A plugin's language server, as a workstation's executor builds it from the plugin's contribution. */
const languageServerOf = (plugin: string, contribution: WorkspaceExecutorContribution): LanguageServerAdapter =>
  contribution(executorMachine(pluginToolsDirectory(hostDataDirectory(), plugin))).languageServers![0]!;

interface Workspace {
  root: string;
  contextFor: () => Promise<WorkspaceProcessContext>;
  context: WorkspaceProcessContext;
  dispose: () => Promise<void>;
}

const workspace = async (fixture: string): Promise<Workspace> => {
  const directory = await realpath(await mkdtemp(path.join(os.tmpdir(), "ragents-lsp-")));
  const root = path.join(directory, "workspace");
  const home = path.join(directory, "home");
  await cp(path.join(fixtures, fixture), root, { recursive: true });
  await mkdir(home, { recursive: true });
  const context = workspaceProcessContext({
    runId: RUN,
    cwd: root,
    root,
    home: { home, nugetPackages: path.join(os.homedir(), ".nuget", "packages") },
    logDirectory: home,
    hostRoot: hostRoot(),
  });
  return {
    root,
    context,
    contextFor: () => Promise.resolve(context),
    dispose: () => rm(directory, { recursive: true, force: true }),
  };
};

const restore = async (context: WorkspaceProcessContext, solution: string): Promise<void> => {
  let output = "";
  const result = await runManagedProcess({
    command: "dotnet",
    args: ["restore", solution, "--source", "https://api.nuget.org/v3/index.json"],
    cwd: context.root,
    env: context.env,
    label: "dotnet restore",
    timeoutMs: 180_000,
    onStdout: (chunk) => { output += chunk.toString(); },
    onStderr: (chunk) => { output += chunk.toString(); },
  });
  assert.equal(result.code, 0, output);
};

test("Roslyn reports C# errors of an edited file without a build", { skip, timeout: 600_000 }, async () => {
  const ws = await workspace("dotnet");
  const host = new LanguageServerHost(languageServerOf("ragents.lsp-roslyn", roslynExecutor), ws.contextFor);
  try {
    await restore(ws.context, "Sample.sln");
    const summary = await host.open(RUN, "Sample.sln");
    assert.match(summary, /Loaded Sample\.sln/);
    assert.match(await host.open(RUN, "Sample.sln"), /already open/);

    const greeter = path.join(ws.root, "CSharpLib", "Greeter.cs");
    const original = await readFile(greeter, "utf8");
    assert.equal(await host.diagnostics(RUN, ["CSharpLib/Greeter.cs"], false), "Diagnostics (Roslyn) CSharpLib/Greeter.cs: no errors");

    await writeFile(greeter, "namespace CSharpLib;\n\npublic static class Greeter\n{\n    public static int Value = \"text\";\n}\n");
    const annotation = await host.annotate(RUN, greeter);
    assert.match(annotation ?? "", /^Diagnostics \(Roslyn\) CSharpLib\/Greeter\.cs: 1 error/m);
    assert.match(annotation ?? "", /CSharpLib\/Greeter\.cs:5:31 error CS0029/);

    await writeFile(greeter, original);
    assert.equal(await host.diagnostics(RUN, ["CSharpLib/Greeter.cs"], false), "Diagnostics (Roslyn) CSharpLib/Greeter.cs: no errors");

    const created = path.join(ws.root, "CSharpLib", "Broken.cs");
    await writeFile(created, "namespace CSharpLib;\n\npublic static class Broken\n{\n    public static int Value = \"text\";\n}\n");
    assert.match(await host.annotate(RUN, created) ?? "", /CSharpLib\/Broken\.cs:5:31 error CS0029/);

    assert.equal(await host.annotate(RUN, path.join(ws.root, "README.md")), undefined);
  } finally {
    await host.shutdown();
    await ws.dispose();
  }
});

test("FSAC reports F# errors of an edited project file", { skip, timeout: 600_000 }, async () => {
  const ws = await workspace("dotnet");
  const host = new LanguageServerHost(languageServerOf("ragents.lsp-fsharp", fsharpExecutor), ws.contextFor);
  try {
    await restore(ws.context, "Sample.sln");
    assert.match(await host.open(RUN, "Sample.sln"), /Loaded 1 F# project from Sample\.sln/);

    const library = path.join(ws.root, "FSharpLib", "Library.fs");
    const original = await readFile(library, "utf8");
    assert.equal(await host.diagnostics(RUN, ["FSharpLib/Library.fs"], false), "Diagnostics (FSAC) FSharpLib/Library.fs: no errors");

    await writeFile(library, `${original}\nlet broken: int = "text"\n`);
    const annotation = await host.annotate(RUN, library);
    assert.match(annotation ?? "", /^Diagnostics \(FSAC\) FSharpLib\/Library\.fs: 1 error/m);
    assert.match(annotation ?? "", /FSharpLib\/Library\.fs:5:19 error 1:/);

    await writeFile(library, original);
    assert.equal(await host.diagnostics(RUN, ["FSharpLib/Library.fs"], false), "Diagnostics (FSAC) FSharpLib/Library.fs: no errors");
  } finally {
    await host.shutdown();
    await ws.dispose();
  }
});

test("TypeScript reports errors of an edited file and lists changed files via git", { skip, timeout: 300_000 }, async () => {
  const ws = await workspace("typescript");
  const host = new LanguageServerHost(languageServerOf("ragents.lsp-typescript", typescriptExecutor), ws.contextFor);
  try {
    assert.match(await host.open(RUN, "."), /TypeScript server ready on workspace/);
    const clean = "Diagnostics (TypeScript) src/index.ts: no errors";
    assert.equal(await host.diagnostics(RUN, ["src/index.ts"], false), clean);

    const startedAt = Date.now();
    assert.equal(await host.diagnostics(RUN, ["src/index.ts"], false), clean);
    const repeatMs = Date.now() - startedAt;
    assert.ok(repeatMs < 5_000, `the unchanged file took ${repeatMs} ms again`);

    const index = path.join(ws.root, "src", "index.ts");
    await writeFile(index, "export const count: number = 3;\nexport const label = \"three\";\n");
    const cleanEditAt = Date.now();
    assert.equal(await host.annotate(RUN, index), clean);
    const cleanEditMs = Date.now() - cleanEditAt;
    assert.ok(cleanEditMs < 10_000, `the error-free change took ${cleanEditMs} ms`);

    await writeFile(index, "export const count: number = \"three\";\n");
    const annotation = await host.annotate(RUN, index);
    assert.match(annotation ?? "", /^Diagnostics \(TypeScript\) src\/index\.ts: 1 error/m);
    assert.match(annotation ?? "", /src\/index\.ts:1:14 error 2322/);
    assert.equal(await host.diagnostics(RUN, ["src/index.ts"], false), annotation);

    await assert.rejects(host.diagnostics(RUN, ["tsconfig.json"], false), /no TypeScript extension/);
    await assert.rejects(host.diagnostics(RUN, undefined, false), /Git working directory/);

    for (const args of [["init", "-q"], ["add", "."], ["-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "-m", "init"]]) {
      const result = await runManagedProcess({ command: "git", args, cwd: ws.root, env: ws.context.env, label: "git", timeoutMs: 30_000 });
      assert.equal(result.code, 0);
    }
    assert.equal(await host.diagnostics(RUN, undefined, false), "No changed TypeScript files in the open roots");
    await writeFile(path.join(ws.root, "src", "extra.ts"), "export const x: string = 1;\n");
    assert.match(await host.diagnostics(RUN, undefined, false), /src\/extra\.ts:1:14 error 2322/);
  } finally {
    await host.shutdown();
    await ws.dispose();
  }
});
